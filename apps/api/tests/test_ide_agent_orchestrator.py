from __future__ import annotations

import asyncio
import threading
from types import SimpleNamespace

import pytest
from agent_transport import agent_result, stream_agent_message
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.domains.assistant import service as assistant_service
from app.domains.book_runs.book_generation import BookGenerationError
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.ide import orchestrator as legacy_orchestrator
from app.domains.ide import review_reasoning
from app.domains.ide.orchestrator import SUPPORTED_INTENTS, _detect_intent


def _seed_chapter_review_context(session_factory: sessionmaker[Session]) -> dict[str, int | str]:
    content = "林岚举起左臂，旁人看见左臂完好无损。作者直接解释这说明她早已摆脱旧伤，港口风声却仍很低。"
    with session_factory() as session:
        book = Book(title="灯塔余烬", status="draft", premise="林岚在港口追查失真的灯塔信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧伤", status="draft", summary=None)
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="港口谈判", status="draft", content=content)
        session.add(scene)
        session.flush()
        packet = ScenePacket(
            scene_id=scene.id,
            status="assembled",
            packet={
                "必须包含事实": ["左臂受伤"],
                "风格规则": ["克制"],
                "证据链接": [{"source_ref": "asset://character/lin-lan#v1", "rationale": "角色资产要求左臂仍受伤。"}],
            },
            version=1,
        )
        session.add(packet)
        session.commit()
        return {"scene_id": scene.id, "scene_packet_id": packet.id, "content": content}


def test_supported_intents_are_registered() -> None:
    assert {
        "chat.explain",
        "file.review",
        "file.revise",
        "chapter.review",
        "chapter.repair",
        "bookrun.start",
    } == SUPPORTED_INTENTS


def test_legacy_orchestrator_facade_points_to_agent_runtime_contract() -> None:
    """旧 orchestrator 路径只保留兼容 interface，真实契约来自 AgentRuntime。"""

    from app.domains.agent_runs import intent as runtime_intent
    from app.domains.agent_runs import runtime as agent_runtime
    from app.domains.agent_runs.errors import AgentOrchestrationError

    assert legacy_orchestrator.SUPPORTED_INTENTS is runtime_intent.SUPPORTED_INTENTS
    assert legacy_orchestrator._detect_intent is runtime_intent._detect_intent  # noqa: SLF001
    assert legacy_orchestrator.AgentOrchestrationError is AgentOrchestrationError
    assert hasattr(agent_runtime, "orchestrate_agent_message")


def test_legacy_orchestrator_delegates_to_agent_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    """外部旧调用方仍可走旧函数名，但执行交给 live AgentRuntime facade。"""

    from app.domains.agent_runs import service as agent_run_service

    captured: dict[str, object] = {}

    def fake_run_agent_user_message(session, *, agent_session_id, message):  # noqa: ANN001 - test double
        captured["session"] = session
        captured["agent_session_id"] = agent_session_id
        captured["message"] = message
        return SimpleNamespace(result={"type": "agent_result", "intent": "chat.explain"})

    monkeypatch.setattr(agent_run_service, "run_agent_user_message", fake_run_agent_user_message)

    fake_session = object()
    message = {"type": "user_message", "user_message": "解释一下"}
    result = legacy_orchestrator.orchestrate_agent_message(  # type: ignore[arg-type]
        fake_session,
        agent_session_id="legacy-session",
        message=message,
    )

    assert result == {"type": "agent_result", "intent": "chat.explain"}
    assert captured == {
        "session": fake_session,
        "agent_session_id": "legacy-session",
        "message": message,
    }


def test_detect_intent_honors_explicit_intent_after_keyword_table_retired() -> None:
    """F11：中文关键词表已下线。自由文本不再被「问题/修/审」等词劫进固定管线，
    只有显式 intent 或结构化参数才路由；桌面修订按钮靠显式 intent=file.revise 定向。"""

    file_args = {"file_path": "正文/第01章.md", "content": "正文内容"}

    # 无显式 intent、无 reviewer role hint 的自由文本一律落 chat.explain 工具循环。
    assert _detect_intent("修选中问题：plot-1 prose-1", file_args, None) == "chat.explain"
    assert _detect_intent("只修剧情问题", file_args, None) == "chat.explain"

    # 显式 intent 始终优先，定向修订不再塌成审稿。
    assert _detect_intent("修选中问题：plot-1 prose-1", file_args, "file.revise") == "file.revise"
    assert _detect_intent("只修剧情问题", file_args, "file.revise") == "file.revise"
    # reviewer role hint + 文件上下文仍走 file.review 固定管线。
    review_args = {**file_args, "agent_role_hints": ["plot_reviewer"]}
    assert _detect_intent("看看这章", review_args, None) == "file.review"


def test_agent_user_message_file_review_returns_multi_agent_report(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    message = agent_result(
        client,
        "session-file-review",
        user_message="审查当前章节的结构、人物和节奏",
        intent="file.review",
        args={
            "file_path": "正文/第01章.md",
            "content": "林岚走进港口。她看见灯塔熄灭。其实这说明旧案还没结束。众人沉默地离开。",
            "context_bundle": {
                "files": [
                    {
                        "relative_path": "人物/林岚.md",
                        "kind": "character",
                        "title": "林岚",
                        "excerpt": "林岚害怕失去证据，所以拒绝撤离。",
                    },
                    {
                        "relative_path": "大纲/第一卷.md",
                        "kind": "outline",
                        "title": "第一卷",
                        "excerpt": "港口旧案推动主线。",
                    },
                ]
            },
        },
    )

    assert message["type"] == "agent_result"
    assert message["intent"] == "file.review"
    assert message["proposed_patch"] is None
    assert message["agent_result"]["requires_user_confirmation"] is False

    report = message["agent_result"]["review_report"]
    assert report["kind"] == "review_report"
    assert report["file_path"] == "正文/第01章.md"
    assert report["mode"] == "heuristic_only"
    assert report["context"]["file_count"] == 2
    assert report["agent_findings"]["plot"]["agent"] == "plot-agent"
    assert report["agent_findings"]["character"]["agent"] == "character-agent"
    assert report["agent_findings"]["prose"]["agent"] == "prose-agent"
    assert report["agent_findings"]["plot"]["mode"] == "heuristic"
    assert report["agent_findings"]["character"]["mode"] == "heuristic"
    assert report["agent_findings"]["prose"]["mode"] == "heuristic"
    assert len(report["issues"]) >= 1
    issue_ids = [issue["id"] for issue in report["issues"]]
    assert len(issue_ids) == len(set(issue_ids))
    assert all(issue["id"].startswith(f"{issue['category']}-") for issue in report["issues"])
    assert all(issue["suggested_action"] for issue in report["issues"])
    assert "启发式预扫" in message["agent_result"]["summary"]

    assert [item["tool_name"] for item in message["tool_trace"]] == [
        "context.load",
        "subagent.plot_reviewer",
        "subagent.character_reviewer",
        "subagent.prose_reviewer",
        "subagent.continuity_reviewer",
        "subagent.synthesizer",
    ]
    assert [step["step"] for step in message["plan"]] == [
        "context.load",
        "subagents.review",
        "synthesizer.merge",
    ]
    assert message["tool_trace"][1]["output_summary"]["mode"] == "heuristic"
    assert message["tool_trace"][5]["output_summary"]["strategy"] == "deterministic_merge"


def test_agent_user_message_file_review_can_stream_intermediate_events(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    frames = stream_agent_message(
        client,
        "session-file-review-stream",
        run_id="run-review-stream",
        user_message="审查当前章节的结构、人物和节奏",
        intent="file.review",
        args={
            "file_path": "正文/第01章.md",
            "content": "林岚走进港口。她看见灯塔熄灭。其实这说明旧案还没结束。众人沉默地离开。",
            "context_bundle": {"files": []},
        },
    )
    started = frames[0]
    first_step = frames[1]
    events = frames[1:]

    assert started["type"] == "agent_run_started"
    assert started["run_id"] == "run-review-stream"
    assert first_step["type"] == "agent_step"
    assert first_step["run_id"] == "run-review-stream"
    assert events[-1]["type"] == "agent_result"
    assert events[-1]["run_id"] == "run-review-stream"
    assert events[-1]["intent"] == "file.review"
    assert any(event["type"] == "tool_trace" for event in events)
    assert events[-1]["agent_result"]["review_report"]["kind"] == "review_report"


def test_agent_user_message_streams_runtime_events_before_result(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.domains.agent_runs.runtime import AgentRuntime
    from app.domains.ide import router as ide_router

    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])
    original_execute_tool = AgentRuntime._execute_tool  # noqa: SLF001 - test probes runtime boundary
    file_review_blocked = threading.Event()
    allow_file_review = threading.Event()

    def blocking_execute_tool(self, tool_name, context, payload):  # noqa: ANN001 - test double
        if tool_name == "file.review":
            file_review_blocked.set()
            assert allow_file_review.wait(timeout=5)
        return original_execute_tool(self, tool_name, context, payload)

    monkeypatch.setattr(AgentRuntime, "_execute_tool", blocking_execute_tool)

    async def collect_frames() -> list[dict]:
        received: list[dict] = []
        frames = ide_router._agent_user_message_payloads(  # noqa: SLF001 - probes the live SSE pump
            session,
            session_id="session-file-review-realtime",
            message={
                "type": "user_message",
                "stream": True,
                "run_id": "run-review-realtime",
                "user_message": "审查当前章节的结构、人物和节奏",
                "intent": "file.review",
                "args": {
                    "file_path": "正文/第01章.md",
                    "content": "林岚走进港口。她看见灯塔熄灭。其实这说明旧案还没结束。",
                    "context_bundle": {"files": []},
                },
            },
        )
        async for frame in frames:
            received.append(frame)
            if frame["type"] == "tool_trace" and frame["trace"]["tool_name"] == "context.load":
                assert file_review_blocked.wait(timeout=2)
                allow_file_review.set()
            if frame["type"] == "agent_result":
                break
        return received

    received = asyncio.run(collect_frames())

    context_trace_index = next(
        index
        for index, event in enumerate(received)
        if event["type"] == "tool_trace" and event["trace"]["tool_name"] == "context.load"
    )
    result_index = next(index for index, event in enumerate(received) if event["type"] == "agent_result")
    assert received[0]["type"] == "agent_run_started"
    assert context_trace_index < result_index
    assert isinstance(received[context_trace_index]["sequence"], int)
    assert received[-1]["run_id"] == "run-review-realtime"


def test_agent_user_message_stream_error_carries_run_id(client: TestClient) -> None:
    received = stream_agent_message(
        client,
        "session-stream-error",
        run_id="run-stream-error",
        assistant_session_id=999999,
        user_message="继续上一轮",
        intent="chat.explain",
        args={"context": "正文"},
    )
    started = received[0]

    assert started["type"] == "agent_run_started"
    error = received[-1]
    assert error["type"] == "error"
    assert error["run_id"] == "run-stream-error"
    assert "Assistant 会话不存在" in error["detail"]


def test_file_review_without_open_file_degrades_to_chat(client: TestClient) -> None:
    """无 file_path 的 file.review 降级为项目级对话，而不是硬报错（对话统领项目）。"""

    message = agent_result(
        client,
        "session-review-no-file",
        user_message="审查当前章节",
        intent="file.review",
        args={"content": "缺少 file_path"},
    )

    assert message["type"] == "agent_result"
    assert message["intent"] == "chat.explain"
    assert message["proposed_patch"] is None
    assert message["agent_result"]["requires_user_confirmation"] is False


def test_file_review_uses_llm_when_configured(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(
        review_reasoning,
        "resolved_llm_env",
        lambda: {
            "STORYFORGE_LLM_MODEL": "storyforge-reviewer",
            "STORYFORGE_LLM_BASE_URL": "https://example.test/v1",
            "STORYFORGE_LLM_API_KEY": "test-key",
        },
    )

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        if "plot-agent" in system_prompt:
            code = "plot.llm_conflict"
            message = "LLM 判断冲突压力不足。"
        elif "character-agent" in system_prompt:
            code = "character.llm_motive"
            message = "LLM 判断人物动机需要补证据。"
        else:
            code = "prose.llm_density"
            message = "LLM 判断段落信息密度偏高。"
        return {
            "content": f'[{{"severity":"high","code":"{code}","message":"{message}","evidence":"灯塔熄灭"}}]',
            "completion_tokens": 8,
            "latency_ms": 12,
        }

    monkeypatch.setattr(review_reasoning, "_call_llm", fake_call_llm)

    message = agent_result(
        client,
        "session-file-review-llm",
        user_message="审查当前章节",
        intent="file.review",
        args={
            "file_path": "正文/第01章.md",
            "content": "林岚走进港口。她看见灯塔熄灭，却没有停下。",
        },
    )

    report = message["agent_result"]["review_report"]
    assert report["mode"] == "llm"
    assert {issue["code"] for issue in report["issues"]} == {
        "plot.llm_conflict",
        "character.llm_motive",
        "prose.llm_density",
    }
    assert {issue["id"] for issue in report["issues"]} == {"plot-1", "character-1", "prose-1"}
    assert {issue["category"] for issue in report["issues"]} == {"plot", "character", "prose"}
    assert report["agent_findings"]["plot"]["mode"] == "llm"
    assert report["agent_findings"]["plot"]["model"] == "storyforge-reviewer"
    assert report["agent_findings"]["plot"]["latency_ms"] == 12
    assert message["tool_trace"][1]["output_summary"]["model"] == "storyforge-reviewer"


def test_file_review_degrades_per_subagent_on_llm_error(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(
        review_reasoning,
        "resolved_llm_env",
        lambda: {
            "STORYFORGE_LLM_MODEL": "storyforge-reviewer",
            "STORYFORGE_LLM_BASE_URL": "https://example.test/v1",
            "STORYFORGE_LLM_API_KEY": "test-key",
        },
    )

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        if "character-agent" in system_prompt:
            raise BookGenerationError("character timeout")
        return {
            "content": '[{"severity":"low","code":"llm.ok","message":"LLM 子代理完成。","evidence":"灯塔熄灭"}]',
            "completion_tokens": 8,
            "latency_ms": 12,
        }

    monkeypatch.setattr(review_reasoning, "_call_llm", fake_call_llm)

    message = agent_result(
        client,
        "session-file-review-mixed",
        user_message="审查当前章节",
        intent="file.review",
        args={
            "file_path": "正文/第01章.md",
            "content": "林岚走进港口。她看见灯塔熄灭，却没有停下。其实这说明旧案还没结束。",
        },
    )

    report = message["agent_result"]["review_report"]
    assert report["mode"] == "mixed"
    assert report["agent_findings"]["plot"]["mode"] == "llm"
    assert report["agent_findings"]["character"]["mode"] == "heuristic"
    assert report["agent_findings"]["prose"]["mode"] == "llm"
    assert "character timeout" in report["agent_findings"]["character"]["degraded_reason"]
    assert "部分 LLM 子代理失败" in message["agent_result"]["summary"]
    assert message["tool_trace"][2]["output_summary"]["mode"] == "heuristic"
    assert "degraded_reason" in message["tool_trace"][2]["output_summary"]


def test_file_review_parses_fenced_json_as_llm(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(
        review_reasoning,
        "resolved_llm_env",
        lambda: {
            "STORYFORGE_LLM_MODEL": "storyforge-reviewer",
            "STORYFORGE_LLM_BASE_URL": "https://example.test/v1",
            "STORYFORGE_LLM_API_KEY": "test-key",
        },
    )

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        return {
            "content": (
                "```json\n"
                '[{"severity":"high","code":"llm.fenced","message":"围栏内的问题。","evidence":"灯塔熄灭"}]\n'
                "```"
            ),
            "completion_tokens": 8,
            "latency_ms": 12,
        }

    monkeypatch.setattr(review_reasoning, "_call_llm", fake_call_llm)

    message = agent_result(
        client,
        "session-file-review-fenced",
        user_message="审查当前章节",
        intent="file.review",
        args={
            "file_path": "正文/第01章.md",
            "content": "林岚走进港口。她看见灯塔熄灭，却没有停下。",
        },
    )

    report = message["agent_result"]["review_report"]
    assert report["mode"] == "llm"
    assert {issue["code"] for issue in report["issues"]} == {"llm.fenced"}
    assert report["agent_findings"]["plot"]["mode"] == "llm"


def test_file_review_reports_llm_failed_when_all_subagents_fail(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(
        review_reasoning,
        "resolved_llm_env",
        lambda: {
            "STORYFORGE_LLM_MODEL": "storyforge-reviewer",
            "STORYFORGE_LLM_BASE_URL": "https://example.test/v1",
            "STORYFORGE_LLM_API_KEY": "test-key",
        },
    )

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        raise BookGenerationError("endpoint down")

    monkeypatch.setattr(review_reasoning, "_call_llm", fake_call_llm)

    message = agent_result(
        client,
        "session-file-review-allfail",
        user_message="审查当前章节",
        intent="file.review",
        args={
            "file_path": "正文/第01章.md",
            "content": "林岚走进港口。她看见灯塔熄灭，却没有停下。其实这说明旧案还没结束。",
        },
    )

    report = message["agent_result"]["review_report"]
    summary = message["agent_result"]["summary"]
    assert report["mode"] == "llm_failed"
    assert report["agent_findings"]["plot"]["mode"] == "heuristic"
    assert report["agent_findings"]["character"]["mode"] == "heuristic"
    assert report["agent_findings"]["prose"]["mode"] == "heuristic"
    assert report["agent_findings"]["plot"]["degraded_reason"]
    assert "已配置 LLM" in summary
    assert "未配置" not in summary


def test_agent_user_message_file_revise_returns_proposed_patch(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        return {"content": "修订后正文", "completion_tokens": 8, "latency_ms": 10}

    monkeypatch.setattr(assistant_service, "_call_llm", fake_call_llm)

    message = agent_result(
        client,
        "session-file-revise",
        user_message="把这个文件改得更紧一点",
        intent="file.revise",
        args={
            "file_path": "正文/第02章.md",
            "content": "当前正文",
            "instruction": "检查人物动机",
        },
    )

    assert message["type"] == "agent_result"
    assert message["intent"] == "file.revise"
    assert message["agent_result"]["requires_user_confirmation"] is True
    assert message["proposed_patch"]["kind"] == "file_revision"
    assert message["proposed_patch"]["file_path"] == "正文/第02章.md"
    assert message["proposed_patch"]["before"] == "当前正文"
    assert message["proposed_patch"]["after"] == "修订后正文"
    assert message["proposed_patch"]["requires_confirmation"] is True
    revise_trace = next(item for item in message["tool_trace"] if item["tool_name"] == "file.revise")
    assert revise_trace["status"] == "completed"
    assert revise_trace["output_summary"]["latency_ms"] == 10
    assert [item["tool_name"] for item in message["tool_trace"]][-2:] == ["file.revise", "judge.run"]

    session_id = message["assistant_session_id"]
    tool_calls = client.get(f"/api/assistant/sessions/{session_id}/tool-calls").json()
    assert len(tool_calls) == 1
    assert tool_calls[0]["tool_name"] == "assistant.revise"
    assert tool_calls[0]["status"] == "completed"


def test_agent_file_revise_can_use_previous_review_report(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    captured: dict[str, str] = {}

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        captured["user_prompt"] = user_prompt
        return {"content": "修订后正文", "completion_tokens": 8, "latency_ms": 10}

    monkeypatch.setattr(assistant_service, "_call_llm", fake_call_llm)

    message = agent_result(
        client,
        "session-file-revise-from-review",
        user_message="按刚才的审稿意见修一版",
        intent="file.revise",
        args={
            "file_path": "正文/第01章.md",
            "content": "当前正文",
            "instruction": "按刚才的审稿意见修一版",
            "review_report": {
                "kind": "review_report",
                "issues": [
                    {
                        "agent": "plot-agent",
                        "severity": "high",
                        "message": "没有明显冲突信号。",
                        "evidence": "未检测到转折。",
                    }
                ],
                "suggested_actions": ["先补强章节目标和冲突推进。"],
            },
        },
    )

    assert message["type"] == "agent_result"
    assert message["intent"] == "file.revise"
    assert "上一轮多视角审稿报告" in captured["user_prompt"]
    assert "没有明显冲突信号" in captured["user_prompt"]
    revise_trace = next(item for item in message["tool_trace"] if item["tool_name"] == "file.revise")
    assert revise_trace["input_summary"]["review_issue_count"] == 1


def test_revise_scope_selected_ids_only_lists_those(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    captured: dict[str, str] = {}

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        captured["user_prompt"] = user_prompt
        return {"content": "修订后正文", "completion_tokens": 8, "latency_ms": 10}

    monkeypatch.setattr(assistant_service, "_call_llm", fake_call_llm)

    message = agent_result(
        client,
        "session-file-revise-scope-selected",
        user_message="只修第二条",
        intent="file.revise",
        args={
            "file_path": "正文/第01章.md",
            "content": "当前正文",
            "instruction": "只修第二条",
            "review_report": {
                "kind": "review_report",
                "issues": [
                    {
                        "id": "plot-1",
                        "category": "plot",
                        "agent": "plot-agent",
                        "severity": "high",
                        "message": "剧情冲突不足。",
                        "evidence": "港口。",
                    },
                    {
                        "id": "character-1",
                        "category": "character",
                        "agent": "character-agent",
                        "severity": "medium",
                        "message": "人物动机不清。",
                        "evidence": "她离开。",
                    },
                    {
                        "id": "prose-1",
                        "category": "prose",
                        "agent": "prose-agent",
                        "severity": "low",
                        "message": "解释性表达偏多。",
                        "evidence": "这说明。",
                    },
                ],
            },
        },
    )

    assert "人物动机不清" in captured["user_prompt"]
    assert "剧情冲突不足" not in captured["user_prompt"]
    assert "解释性表达偏多" not in captured["user_prompt"]
    assert message["agent_result"]["applied_scope"]["issue_ids"] == ["character-1"]
    assert message["agent_result"]["applied_scope"]["categories"] == ["character"]


def test_revise_constraints_reach_prompt(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    captured: dict[str, str] = {}

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        captured["user_prompt"] = user_prompt
        return {"content": "修订后正文", "completion_tokens": 8, "latency_ms": 10}

    monkeypatch.setattr(assistant_service, "_call_llm", fake_call_llm)

    message = agent_result(
        client,
        "session-file-revise-constraints",
        user_message="只修人物问题，保留结尾",
        intent="file.revise",
        args={
            "file_path": "正文/第01章.md",
            "content": "当前正文",
            "instruction": "只修人物问题，保留结尾",
            "revision_constraints": ["不动对白"],
            "review_report": {
                "kind": "review_report",
                "issues": [
                    {
                        "id": "plot-1",
                        "category": "plot",
                        "agent": "plot-agent",
                        "severity": "high",
                        "message": "剧情冲突不足。",
                        "evidence": "港口。",
                    },
                    {
                        "id": "character-1",
                        "category": "character",
                        "agent": "character-agent",
                        "severity": "medium",
                        "message": "人物动机不清。",
                        "evidence": "她离开。",
                    },
                ],
            },
        },
    )

    assert "硬约束（必须遵守）" in captured["user_prompt"]
    assert "保留结尾" in captured["user_prompt"]
    assert "不动对白" in captured["user_prompt"]
    assert "人物动机不清" in captured["user_prompt"]
    assert "剧情冲突不足" not in captured["user_prompt"]
    assert message["agent_result"]["applied_scope"]["categories"] == ["character"]
    assert message["agent_result"]["applied_scope"]["constraints"] == ["不动对白", "保留结尾"]


def test_revise_unknown_issue_id_is_reported(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        return {"content": "修订后正文", "completion_tokens": 8, "latency_ms": 10}

    monkeypatch.setattr(assistant_service, "_call_llm", fake_call_llm)

    message = agent_result(
        client,
        "session-file-revise-unknown",
        user_message="修 plot-99",
        intent="file.revise",
        args={
            "file_path": "正文/第01章.md",
            "content": "当前正文",
            "instruction": "修 plot-99",
            "selected_issue_ids": ["plot-99"],
            "review_report": {
                "kind": "review_report",
                "issues": [
                    {
                        "id": "plot-1",
                        "category": "plot",
                        "agent": "plot-agent",
                        "severity": "high",
                        "message": "剧情冲突不足。",
                        "evidence": "港口。",
                    }
                ],
            },
        },
    )

    scope = message["agent_result"]["applied_scope"]
    assert scope["issue_ids"] == []
    assert scope["dropped_unknown_ids"] == ["plot-99"]
    assert "忽略不存在" in message["agent_result"]["summary"]
    revise_trace = next(item for item in message["tool_trace"] if item["tool_name"] == "file.revise")
    assert revise_trace["input_summary"]["applied_scope"]["dropped_unknown_ids"] == ["plot-99"]
