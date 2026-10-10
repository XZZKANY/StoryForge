"""Application boundaries: real revision facade and polishing provider seam."""

from __future__ import annotations

import json

import pytest
from agent_run_test_support import _seed_agent_run
from sqlalchemy import select
from test_author_voice_policy import TAIL, _resolution

from app.common.author_edit_policy import build_author_edit_policy
from app.domains.agent_runs.event_sink import _AgentRunEventSink
from app.domains.agent_runs.patches import polishing_service, run_controlled_polish
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.assistant import service
from app.domains.assistant.models import AssistantToolCall
from app.platform.ai_sdk.contracts import ChatResponse
from app.platform.ai_sdk.providers.anthropic import AnthropicProvider

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


@pytest.mark.parametrize("quality_gate", [None, "polish"])
def test_http_revision_uses_project_author_control_for_mixed_quote_and_typo_edit(
    client, tmp_path, monkeypatch, quality_gate
):
    project = tmp_path / "project"
    (project / ".storyforge").mkdir(parents=True)
    author_file = project / ".storyforge/agent-instructions.md"
    author_file.write_text("AUTHOR_VOICE_SENTINEL：把中文引号统一成直引号。", encoding="utf-8")
    original = "“灯还亮着。”她说。\n钥匙落在地扳上。\n" + TAIL
    target = project / "正文.md"
    target.write_text(original, encoding="utf-8", newline="")
    candidate = original.replace("“", '"').replace("”", '"').replace("地扳", "地板")
    requests = []
    monkeypatch.setattr(service, "missing_llm_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fixture-model"})

    def generate(_source, **kwargs):
        requests.append(kwargs)
        return {"content": candidate}

    monkeypatch.setattr(service, "_call_llm_streamed", generate)
    response = client.post(
        "/api/assistant/revise",
        json={
            "file_path": "正文.md",
            "project_root": str(project),
            "content": original,
            "instruction": "修复地扳这个错字。",
            "quality_gate": quality_gate,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["after"] == candidate and len(requests) == 1
    assert '"allowed_punctuation_forms": ["quotes"]' in requests[0]["user_prompt"]
    assert "AUTHOR_VOICE_SENTINEL" in requests[0]["system_prompt"]
    assert target.read_text(encoding="utf-8") == original


def test_http_missing_protected_literal_records_failure_without_generation(client, session, monkeypatch):
    monkeypatch.setattr(service, "missing_llm_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fixture-model"})

    def unexpected(*_, **__):
        pytest.fail("unapplicable protection must fail before model")

    monkeypatch.setattr(service, "_call_llm_streamed", unexpected)
    response = client.post(
        "/api/assistant/revise",
        json={
            "file_path": "正文.md",
            "content": "原文。",
            "instruction": "保留“缺失片段”逐字不变。",
        },
    )
    assert response.status_code == 502, response.text
    tool = session.scalars(select(AssistantToolCall)).one()
    assert tool.status == "failed"
    assert "作者编辑要求无效" in tool.error_message
    assert "缺失片段" not in tool.error_message


def test_online_segments_cannot_edit_explicit_protected_span_and_trace_contains_no_raw_voice():
    original = "等等？？？。门，，依然敞着。\n" + TAIL
    policy = build_author_edit_policy(
        original,
        instruction="保留“等等？？？”逐字不变；润色其他句子。",
        author_requirements=("VOICE_PRIVATE：保留重复问号。",),
    )
    requests = []

    class Provider:
        def complete(self, request):
            requests.append(request)
            payload = json.loads(request.messages[-1].content)
            assert all("等等？？？" not in item["text"] for item in payload["segments"])
            return ChatResponse(
                content=json.dumps(
                    {
                        "segments": [
                            {**item, "text": item["text"].replace("，，", "，")} for item in payload["segments"]
                        ]
                    },
                    ensure_ascii=False,
                )
            )

    result = run_controlled_polish(original, resolution=_resolution(), provider=Provider(), edit_policy=policy)
    assert result.decision.selected_source == "online"
    assert result.decision.text == original.replace("，，", "，")
    assert policy.source_sha256 in requests[0].messages[0].content
    trace = json.dumps(result.trace_summary(), ensure_ascii=False)
    assert "VOICE_PRIVATE" not in trace and "等等" not in trace
    assert result.trace_summary()["edit_policy"] == policy.summary()


@pytest.mark.parametrize("author_requested", [False, True])
def test_live_file_revision_model_hint_cannot_grant_itself_quote_permission(
    client, tmp_path, monkeypatch, author_requested
):
    from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script, _send_chat_message

    _enable_loop_env(monkeypatch)
    project = tmp_path / "project"
    project.mkdir()
    original = "“灯还亮着。”她说。\n钥匙落在地扳上。\n" + TAIL
    target = project / "正文.md"
    target.write_text(original, encoding="utf-8", newline="")
    candidate = original.replace("“", '"').replace("”", '"').replace("地扳", "地板")
    prompts = []

    def generate(_source, **kwargs):
        prompts.append(kwargs["user_prompt"])
        return {"content": candidate}

    monkeypatch.setattr(service, "_call_llm_streamed", generate)
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
                            "arguments": json.dumps(
                                {"path": "正文.md", "instruction": "把中文引号统一成直引号，并修复地扳。"}
                            ),
                        },
                    }
                ],
            },
            {"content": "请确认修订。", "tool_calls": []},
        ],
    )
    message = "把中文引号统一成直引号，并修复地扳。" if author_requested else "只修复地扳，不改引号。"
    result = _send_chat_message(
        client,
        run_id=f"run-voice-permission-{author_requested}",
        project_path=str(project),
        message=message,
        permission_profile="ask",
    )[-1]
    assert result["type"] == "agent_result", result
    expected = candidate if author_requested else original.replace("地扳", "地板")
    assert result["proposed_patch"]["after"] == expected
    assert len(prompts) == 1 and message in prompts[0]
    assert target.read_text(encoding="utf-8") == original


@pytest.mark.parametrize("scenario", ["reversed", "same-event", "failed-model"])
def test_real_polish_handler_preserves_event_roles_and_degraded_confirmation(session, tmp_path, monkeypatch, scenario):
    project = tmp_path / "project"
    (project / "人物").mkdir(parents=True)
    (project / ".storyforge").mkdir()
    (project / ".storyforge/agent-instructions.md").write_text("保留重复问号。", encoding="utf-8")
    original = "林岚把铜钥匙交给顾迟。真的？？？门，，没有关。\n" + TAIL
    target = project / "正文.md"
    target.write_text(original, encoding="utf-8", newline="")
    for name in ("林岚", "顾迟"):
        (project / f"人物/{name}.md").write_text(name + "是人物。", encoding="utf-8")
    candidate = original.replace("交给", "递给")
    if scenario == "reversed":
        candidate = original.replace("林岚把铜钥匙交给顾迟", "顾迟把铜钥匙交给林岚")
    monkeypatch.setattr(polishing_service, "resolve_polish_llm", lambda **_: _resolution())

    def complete(_provider, request):
        if scenario == "failed-model":
            return ChatResponse(content="invalid-json")
        payload = json.loads(request.messages[-1].content)
        return ChatResponse(
            content=json.dumps(
                {
                    "segments": [
                        {**item, "text": item["text"].replace(original, candidate)} for item in payload["segments"]
                    ]
                },
                ensure_ascii=False,
            )
        )

    monkeypatch.setattr(AnthropicProvider, "complete", complete)
    run = _seed_agent_run(session, public_id=f"run-voice-event-{scenario}")
    run.permission_profile = "full"
    session.commit()
    result = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message={
            "intent": "chapter.polish",
            "user_message": "只润色表达。",
            "args": {
                "project_path": str(project),
                "file_path": "正文.md",
                "content": original,
                "context_bundle": {
                    "project_root": str(project),
                    "files": [
                        {"relative_path": f"人物/{name}.md", "kind": "character", "excerpt": name + "是人物。"}
                        for name in ("林岚", "顾迟")
                    ],
                },
            },
        },
    )
    patch = result["proposed_patch"]
    if scenario == "reversed":
        assert "event_relation_changed" in result["agent_result"]["polish"]["gate_reasons"]["online"]
        assert patch["candidate_source"] == "local" and patch["requires_confirmation"]
        assert "林岚把铜钥匙交给顾迟" in patch["after"]
    elif scenario == "same-event":
        assert patch["after"] == candidate and not patch["requires_confirmation"]
    else:
        assert patch["degraded"] and patch["requires_confirmation"]
        assert "？？？" in patch["after"] and "门，没有关" in patch["after"]
    assert target.read_text(encoding="utf-8") == original
