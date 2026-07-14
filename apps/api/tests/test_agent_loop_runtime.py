from __future__ import annotations

import json
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import (
    _enable_loop_env,
    _fake_llm_script,
    _send_chat_message,
    _write_author_instructions,
)
from fastapi.testclient import TestClient

from app.domains.agent_runs import loop_runtime
from app.domains.assistant import service as assistant_service
from app.domains.book_runs.errors import BookGenerationError

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


def test_read_author_instructions_missing_returns_none(novel_project: Path) -> None:
    """无 .storyforge/agent-instructions.md 时返回 None（不注入）。"""
    assert loop_runtime._read_author_instructions(str(novel_project)) is None


def test_read_author_instructions_reads_and_strips(novel_project: Path) -> None:
    """有文件时返回 strip 后的正文。"""
    _write_author_instructions(novel_project, "  语气克制，多挑逻辑硬伤。\n")
    assert loop_runtime._read_author_instructions(str(novel_project)) == "语气克制，多挑逻辑硬伤。"


def test_read_author_instructions_empty_returns_none(novel_project: Path) -> None:
    """纯空白内容视为无指令，返回 None。"""
    _write_author_instructions(novel_project, "   \n\n  ")
    assert loop_runtime._read_author_instructions(str(novel_project)) is None


def test_read_author_instructions_truncates_when_too_long(novel_project: Path) -> None:
    """超长指令按上限截断并带截断标记，不撑爆 context。"""
    _write_author_instructions(novel_project, "字" * (loop_runtime._AUTHOR_INSTRUCTIONS_MAX_CHARS + 500))
    result = loop_runtime._read_author_instructions(str(novel_project))
    assert result is not None
    assert "已截断" in result
    assert len(result) <= loop_runtime._AUTHOR_INSTRUCTIONS_MAX_CHARS + 20


def test_read_author_instructions_bad_project_returns_none(tmp_path: Path) -> None:
    """项目目录不存在时静默返回 None（_resolve_root 抛错被吞）。"""
    assert loop_runtime._read_author_instructions(str(tmp_path / "nonexistent")) is None


def test_chat_loop_appends_author_instructions_to_system(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """.storyforge/agent-instructions.md 存在时，作者指令作为独立 system 消息进第一轮请求。"""

    _enable_loop_env(monkeypatch)
    _write_author_instructions(novel_project, "你是资深网文编辑，先夸再挑刺。")
    calls = _fake_llm_script(monkeypatch, [{"content": "好的。", "tool_calls": [], "completion_tokens": 3}])

    _send_chat_message(
        client,
        run_id="run-author-instructions",
        project_path=str(novel_project),
        message="给点建议",
    )

    system_messages = [item for item in calls[0]["messages"] if item.get("role") == "system"]
    assert any("资深网文编辑" in str(item.get("content")) for item in system_messages)
    # 追加为独立消息，基础系统提示本体不被篡改
    assert system_messages[0]["content"] == loop_runtime._SYSTEM_PROMPT


def test_chat_loop_without_author_instructions_injects_no_extra_system(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """无 agent-instructions.md 时不注入额外 system 消息，既有行为零变化。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(monkeypatch, [{"content": "好的。", "tool_calls": [], "completion_tokens": 3}])

    _send_chat_message(
        client,
        run_id="run-no-author-instructions",
        project_path=str(novel_project),
        message="给点建议",
    )

    # novel_project 无 canon.json，scene_block 为 None，system 仅基础提示一条
    system_messages = [item for item in calls[0]["messages"] if item.get("role") == "system"]
    assert len(system_messages) == 1
    assert system_messages[0]["content"] == loop_runtime._SYSTEM_PROMPT


def test_chat_loop_executes_fs_tools_and_answers(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """自由文本对话走工具循环：LLM 自主 fs.list/fs.read 后作答，事件与证据链齐全。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {"id": "c1", "type": "function", "function": {"name": "fs_list", "arguments": "{}"}},
                    {
                        "id": "c2",
                        "type": "function",
                        "function": {"name": "fs_read", "arguments": json.dumps({"path": "正文/第01章.md"})},
                    },
                ],
                "completion_tokens": 5,
            },
            {"content": "第一章写灯塔连续异常闪光，林岚开始留证。", "tool_calls": [], "completion_tokens": 9},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop",
        project_path=str(novel_project),
        message="这个项目现在写到哪一步了？",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert result["intent"] == "chat.explain"
    assert result["agent_result"]["summary"] == "第一章写灯塔连续异常闪光，林岚开始留证。"
    assert result["agent_result"]["chat_loop"]["rounds"] == 2
    assert result["agent_result"]["chat_loop"]["tool_call_count"] == 2
    assert [trace["tool_name"] for trace in result["tool_trace"]] == ["fs.list", "fs.read"]

    # 第二轮 LLM 请求里必须带回工具结果（fs.read 的正文内容进了 tool 消息）
    assert len(calls) == 2
    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    assert len(tool_messages) == 2
    assert any("灯塔" in str(item.get("content")) for item in tool_messages)

    # REST 事件流：真实 plan + 两条 tool_trace
    events = client.get("/api/agent-runs/run-chat-loop/events").json()
    event_types = [event["event_type"] for event in events]
    assert "agent_plan_created" in event_types
    trace_events = [event for event in events if event["event_type"] == "tool_trace"]
    assert [event["payload"]["trace"]["tool_name"] for event in trace_events] == ["fs.list", "fs.read"]

    # 会话消息与工具调用证据链
    assistant_session_id = result["assistant_session_id"]
    session_detail = client.get(f"/api/assistant/sessions/{assistant_session_id}").json()
    assert [message["role"] for message in session_detail["messages"]][-2:] == ["user", "assistant"]
    tool_calls = client.get(f"/api/assistant/sessions/{assistant_session_id}/tool-calls").json()
    tool_names = [item["tool_name"] for item in tool_calls]
    assert "fs.list" in tool_names
    assert "fs.read" in tool_names
    assert "assistant.chat_loop" in tool_names


def test_chat_loop_feeds_unknown_tool_error_back_and_recovers(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """LLM 请求未知工具时不崩：错误作为观测反馈，模型下一轮仍可作答。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {"id": "c1", "type": "function", "function": {"name": "fs_delete", "arguments": "{}"}}
                ],
                "completion_tokens": 3,
            },
            {"content": "我只有只读权限，先说结论。", "tool_calls": [], "completion_tokens": 4},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-unknown",
        project_path=str(novel_project),
        message="随便聊聊这个项目",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert result["agent_result"]["summary"] == "我只有只读权限，先说结论。"
    assert [trace["status"] for trace in result["tool_trace"]] == ["failed"]

    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    assert len(tool_messages) == 1
    assert "未知工具" in str(tool_messages[0]["content"])


def test_chat_loop_falls_back_to_single_turn_when_first_call_fails(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """首轮 LLM 调用失败（如 provider 不支持 tools）时静默回落单轮对话。"""

    _enable_loop_env(monkeypatch)
    _fake_llm_script(monkeypatch, [BookGenerationError("真实 LLM 返回 HTTP 400：tools 不支持")])
    monkeypatch.setattr(
        assistant_service,
        "chat_reply",
        lambda session, *, user_message, context_block, assistant_session_id: {
            "reply": "单轮回答",
            "model": "fake-model",
            "completion_tokens": 1,
            "latency_ms": 1,
        },
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-fallback",
        project_path=str(novel_project),
        message="讲讲这个项目",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert result["agent_result"]["summary"] == "单轮回答"
    assert "chat_loop" not in result["agent_result"]
    assert result["tool_trace"] == []

    events = client.get("/api/agent-runs/run-chat-loop-fallback/events").json()
    assert [event["event_type"] for event in events].count("agent_plan_created") == 1


def test_chat_loop_file_review_feeds_trimmed_issues_and_records_report(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """循环内 file.review：后端从盘上读稿、精简 issue 反馈给模型、整包 report 落 artifact。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {"name": "file_review", "arguments": json.dumps({"path": "正文/第01章.md"})},
                    }
                ],
                "completion_tokens": 3,
            },
            {"content": "审稿完成，问题清单见报告。", "tool_calls": [], "completion_tokens": 5},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-review",
        project_path=str(novel_project),
        message="帮我审一下第一章",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert result["agent_result"]["summary"] == "审稿完成，问题清单见报告。"
    assert result["agent_result"]["requires_user_confirmation"] is False
    assert result["agent_result"]["review_report"]["kind"] == "review_report"
    assert result["agent_result"]["review_report"]["file_path"].endswith("第01章.md")
    assert [trace["tool_name"] for trace in result["tool_trace"]] == ["file.review"]

    # 反馈给模型的是精简 issue 要点，不是整包 report（agent_findings/context 不回灌）
    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    assert len(tool_messages) == 1
    feedback = str(tool_messages[0]["content"])
    assert "issue_count" in feedback
    assert "agent_findings" not in feedback

    # review_report artifact 落盘 + 工具证据链
    artifacts = client.get("/api/agent-runs/run-chat-loop-review/artifacts").json()
    assert "review_report" in [artifact["kind"] for artifact in artifacts]
    tool_calls = client.get(f"/api/assistant/sessions/{result['assistant_session_id']}/tool-calls").json()
    assert "file.review" in [item["tool_name"] for item in tool_calls]


def test_chat_loop_file_revise_produces_confirmable_patch_and_pauses(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """循环内 file.revise：生成待确认补丁即暂停等作者确认；后续轮不再提供修订工具。"""

    from app.domains.assistant import service as assistant_service

    _enable_loop_env(monkeypatch)
    monkeypatch.setattr(
        assistant_service,
        "_call_llm",
        lambda source, *, system_prompt, user_prompt: {
            "content": "灯塔第三十三次错误闪光，林岚按下了记录键。",
            "completion_tokens": 6,
            "latency_ms": 5,
        },
    )
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "file_revise",
                            "arguments": json.dumps({"path": "正文/第01章.md", "instruction": "结尾补一个动作"}),
                        },
                    }
                ],
                "completion_tokens": 4,
            },
            {"content": "补丁已生成，等你在界面确认。", "tool_calls": [], "completion_tokens": 4},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-revise",
        project_path=str(novel_project),
        message="把第一章结尾改得更有推进感",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    patch = result["proposed_patch"]
    assert patch["kind"] == "file_revision"
    assert patch["requires_confirmation"] is True
    assert patch["file_path"] == str((novel_project / "正文" / "第01章.md").resolve())
    assert "灯塔" in patch["before"]
    assert patch["after"] == "灯塔第三十三次错误闪光，林岚按下了记录键。"
    assert result["agent_result"]["requires_user_confirmation"] is True
    assert result["agent_result"]["writeback_blocked_until_user_confirms"] is True
    assert [step["step"] for step in result["plan"]] == ["agent.loop", "permission.confirm"]

    # 第二轮反馈不携带修订后全文，且不再提供 file_revise 工具
    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    assert "proposed_patch_created" in str(tool_messages[0]["content"])
    assert "灯塔第三十三次" not in str(tool_messages[0]["content"])
    round2_tools = [item["function"]["name"] for item in calls[1]["tools"]]
    assert "file_revise" not in round2_tools
    assert "fs_read" in round2_tools

    # 权限事件 + run 暂停在 permission.confirm，补丁 artifact 待确认
    events = client.get("/api/agent-runs/run-chat-loop-revise/events").json()
    event_types = [event["event_type"] for event in events]
    assert "permission_required" in event_types
    assert "agent_run_completed" not in event_types
    permission_event = next(event for event in events if event["event_type"] == "permission_required")
    assert permission_event["payload"]["blocked_tool"] == "file.revise"
    run = client.get("/api/agent-runs/run-chat-loop-revise").json()
    assert run["status"] == "paused"
    assert run["current_step"] == "permission.confirm"
    artifacts = client.get("/api/agent-runs/run-chat-loop-revise/artifacts").json()
    patch_artifacts = [artifact for artifact in artifacts if artifact["kind"] == "proposed_patch"]
    assert len(patch_artifacts) == 1
    assert patch_artifacts[0]["requires_confirmation"] is True


def test_chat_loop_second_revise_in_same_run_is_rejected(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """同一轮对话第二次 file_revise 被拒绝为观测反馈，只产出一个待确认补丁。"""

    from app.domains.assistant import service as assistant_service

    _enable_loop_env(monkeypatch)
    monkeypatch.setattr(
        assistant_service,
        "_call_llm",
        lambda source, *, system_prompt, user_prompt: {
            "content": "修订后正文",
            "completion_tokens": 3,
            "latency_ms": 5,
        },
    )
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "file_revise",
                            "arguments": json.dumps({"path": "正文/第01章.md", "instruction": "改开头"}),
                        },
                    },
                    {
                        "id": "c2",
                        "type": "function",
                        "function": {
                            "name": "file_revise",
                            "arguments": json.dumps({"path": "设定/人物.md", "instruction": "改人设"}),
                        },
                    },
                ],
                "completion_tokens": 4,
            },
            {"content": "第一个补丁等你确认，第二个文件下轮再改。", "tool_calls": [], "completion_tokens": 4},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-revise-twice",
        project_path=str(novel_project),
        message="把第一章和人物设定都改一下",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert result["proposed_patch"]["file_path"] == str((novel_project / "正文" / "第01章.md").resolve())
    assert [trace["status"] for trace in result["tool_trace"]] == ["completed", "failed"]
    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    assert len(tool_messages) == 2
    assert "最多生成一个待确认补丁" in str(tool_messages[1]["content"])
    artifacts = client.get("/api/agent-runs/run-chat-loop-revise-twice/artifacts").json()
    assert len([artifact for artifact in artifacts if artifact["kind"] == "proposed_patch"]) == 1


def test_chat_loop_file_review_path_escape_feeds_error_and_recovers(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """file_review 越界路径被拒绝为观测反馈，循环不中断且不产生 artifact。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {"name": "file_review", "arguments": json.dumps({"path": "../外面.md"})},
                    }
                ],
                "completion_tokens": 3,
            },
            {"content": "这个路径在项目外，我只能审项目里的稿件。", "tool_calls": [], "completion_tokens": 4},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-review-escape",
        project_path=str(novel_project),
        message="审一下 ../外面.md",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert [trace["status"] for trace in result["tool_trace"]] == ["failed"]
    assert "review_report" not in result["agent_result"]
    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    assert "路径越界" in str(tool_messages[0]["content"])
    artifacts = client.get("/api/agent-runs/run-chat-loop-review-escape/artifacts").json()
    assert [artifact for artifact in artifacts if artifact["kind"] == "review_report"] == []
