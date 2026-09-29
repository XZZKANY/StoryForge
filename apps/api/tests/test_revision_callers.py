"""四个调用入口继续经过真实修订 facade，外层仍决定是否产出 patch。"""

from __future__ import annotations

import json

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script, _send_chat_message
from agent_run_test_support import _seed_agent_run
from sqlalchemy import select

from app.domains.agent_runs.event_sink import _AgentRunEventSink
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.agent_runs.service import handle_agent_control_message
from app.domains.assistant import service
from app.domains.assistant.models import AssistantMessage, AssistantToolCall
from app.domains.assistant.schemas import AssistantDraftResponse

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


@pytest.mark.parametrize("second_check_passes", [False, True])
def test_chapter_internal_repair_uses_revision_before_second_check(session, tmp_path, monkeypatch, second_check_passes):
    _enable_loop_env(monkeypatch)
    project = tmp_path / "project"
    (project / "正文").mkdir(parents=True)
    target = project / "正文" / "第001章.md"
    target.write_text("", encoding="utf-8")
    phases = []

    def chat(_session, *, user_message, context_block, assistant_session_id):
        if "整理成 Chapter Brief" in user_message:
            return {"reply": '{"goal":"建立冲突","required_beats":["见面"]}'}
        phases.append("check")
        if phases.count("check") == 2 and second_check_passes:
            return {"reply": '{"findings":[]}'}
        return {
            "reply": '{"findings":[{"rule":"missing_required_beat","severity":"hard",'
            '"message":"缺少见面","line":1,"evidence":"开场独白"}]}'
        }

    def generate(_source, *, system_prompt, user_prompt):
        phases.append("repair")
        assert "一" * 1800 in user_prompt
        assert "缺少见面" in user_prompt
        return {"content": "二" * 1800, "completion_tokens": 10, "latency_ms": 1}

    monkeypatch.setattr(service, "chat_reply", chat)
    monkeypatch.setattr(
        service,
        "draft_file_content",
        lambda *_a, **_kw: AssistantDraftResponse(
            content="一" * 1800,
            summary="草稿完成",
            model="fake",
            latency_ms=1,
            completion_tokens=10,
            assistant_session_id=1,
        ),
    )
    monkeypatch.setattr(service, "_call_llm_streamed", generate)
    run = _seed_agent_run(session, public_id="run-revision-repair")
    run.permission_profile = "ask"
    session.commit()
    initial = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message={
            "intent": "chapter.write",
            "user_message": "写第一章",
            "args": {"project_path": str(project), "file_path": str(target), "context_bundle": {"files": []}},
        },
    )
    before_messages = list(session.scalars(select(AssistantMessage)))
    control = handle_agent_control_message(
        session,
        public_id=run.public_id,
        session_id=run.session_id,
        control_type="resume_run",
        payload={"chapter_brief": initial["agent_result"]["chapter_brief"]},
    )
    result = control.resumed_result
    assert result is not None
    assert phases == ["check", "repair", "check"]
    assert result["agent_result"]["repair_count"] == 1
    if second_check_passes:
        assert result["proposed_patch"]["after"] == "二" * 1800
        assert result["agent_result"]["chapter_check"]["status"] == "pass"
    else:
        assert result.get("proposed_patch") is None
        assert result["agent_result"]["chapter_check"]["status"] == "repairable"
    assert target.read_text(encoding="utf-8") == ""
    tools = list(session.scalars(select(AssistantToolCall).where(AssistantToolCall.tool_name == "assistant.revise")))
    assert len(tools) == 1 and tools[0].status == "completed"
    messages = list(session.scalars(select(AssistantMessage).order_by(AssistantMessage.id)))
    assert [m.role for m in messages[len(before_messages) :]] == ["user", "assistant"]
    assert messages[-1].content == f"已按指令修订 {target}，修订后约 1800 字。"
    assert [t["tool_name"] for t in result["tool_trace"]].count("chapter.repair") == 1


def test_chat_trim_preserves_inner_records_audit_and_pending_patch(client, monkeypatch, novel_project):
    _enable_loop_env(monkeypatch)
    target = novel_project / "正文" / "第01章.md"
    before = target.read_text(encoding="utf-8")
    after = "灯塔错误闪光。\n"
    prompts = []

    def generate(_source, *, system_prompt, user_prompt):
        prompts.append(user_prompt)
        return {"content": after, "completion_tokens": 0, "latency_ms": 1}

    monkeypatch.setattr(service, "_call_llm_streamed", generate)
    rounds = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "trim1",
                        "type": "function",
                        "function": {
                            "name": "project_trim_prose",
                            "arguments": json.dumps({"path": "正文/第01章.md", "target_percent": 15}),
                        },
                    }
                ],
            },
            {"content": "压缩候选已生成，请确认。", "tool_calls": []},
        ],
    )
    events = _send_chat_message(
        client,
        run_id="run-revision-trim",
        project_path=str(novel_project),
        message="压缩第一章约15%",
        permission_profile="ask",
    )
    result = events[-1]
    assert result["type"] == "agent_result", result
    assert len(prompts) == 1 and "15%" in prompts[0]
    patch = result["proposed_patch"]
    assert (patch["kind"], patch["before"], patch["after"]) == ("prose_trim", before, after)
    assert patch["trim_audit"] == {
        "original_chars": len(before),
        "compressed_chars": len(after),
        "target_percent": 15,
        "actual_percent": round((1 - len(after) / len(before)) * 100, 1),
    }
    assert patch["requires_confirmation"] is True
    assert target.read_text(encoding="utf-8") == before
    assert "project_trim_prose" not in [t["function"]["name"] for t in rounds[1]["tools"]]
    assert client.get("/api/agent-runs/run-revision-trim").json()["status"] == "paused"
    artifacts = client.get("/api/agent-runs/run-revision-trim/artifacts").json()
    assert len([a for a in artifacts if a["kind"] == "proposed_patch"]) == 1
    session_id = result["assistant_session_id"]
    tools = client.get(f"/api/assistant/sessions/{session_id}/tool-calls").json()
    assert sorted(t["tool_name"] for t in tools) == ["assistant.chat_loop", "assistant.revise", "project.trim_prose"]
    messages = client.get(f"/api/assistant/sessions/{session_id}").json()["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant"]
    assert "15%" in messages[0]["content"]
    assert messages[-1]["content"] == "压缩候选已生成，请确认。"


@pytest.mark.parametrize("entry", ["chat", "intent"])
def test_file_revision_entry_retains_its_message_and_evidence_layers(client, monkeypatch, novel_project, entry):
    from agent_transport import agent_result

    _enable_loop_env(monkeypatch)
    target = novel_project / "正文" / "第01章.md"
    before = target.read_text(encoding="utf-8")
    generations = []
    instruction = "结尾补一个动作"

    def generate(_source, *, system_prompt, user_prompt):
        generations.append(user_prompt)
        return {"content": before + "林岚按下记录键。", "completion_tokens": 0, "latency_ms": 1}

    monkeypatch.setattr(service, "_call_llm_streamed", generate)
    if entry == "chat":
        _fake_llm_script(
            monkeypatch,
            [
                {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "revise1",
                            "type": "function",
                            "function": {
                                "name": "file_revise",
                                "arguments": json.dumps({"path": "正文/第01章.md", "instruction": instruction}),
                            },
                        }
                    ],
                },
                {"content": "请确认修订。", "tool_calls": []},
            ],
        )
        result = _send_chat_message(
            client,
            run_id="run-layer-chat",
            project_path=str(novel_project),
            message=instruction,
            permission_profile="ask",
        )[-1]
    else:
        result = agent_result(
            client,
            "session-layer-intent",
            run_id="run-layer-intent",
            user_message=instruction,
            intent="file.revise",
            args={"file_path": str(target), "content": before, "instruction": instruction},
        )
    assert result["type"] == "agent_result", result
    assert len(generations) == 1
    assert result["proposed_patch"]["before"] == before
    assert result["proposed_patch"]["after"] == before + "林岚按下记录键。"
    assert target.read_text(encoding="utf-8") == before
    session_id = result["assistant_session_id"]
    records = client.get(f"/api/assistant/sessions/{session_id}/tool-calls").json()
    expected_tools = (
        ["assistant.chat_loop", "assistant.revise", "file.revise"] if entry == "chat" else ["assistant.revise"]
    )
    assert sorted(t["tool_name"] for t in records) == expected_tools
    assert all(t["status"] == "completed" for t in records)
    messages = client.get(f"/api/assistant/sessions/{session_id}").json()["messages"]
    expected_roles = ["user", "assistant"] * (2 if entry == "chat" else 1)
    assert [m["role"] for m in messages] == expected_roles
    assert instruction in messages[0]["content"]
    assert messages[1]["content"].startswith(f"已按指令修订 {target}")
    if entry == "chat":
        assert [m["content"] for m in messages[2:]] == [instruction, "请确认修订。"]
