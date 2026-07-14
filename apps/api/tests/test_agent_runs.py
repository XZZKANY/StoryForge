from __future__ import annotations

import inspect
import json

import pytest
from agent_run_test_support import _seed_agent_run, _stored_run_events
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.domains.agent_runs import event_types
from app.domains.agent_runs.bookrun_summary import (
    _bookrun_budget_details,
    _bookrun_budget_summary,
    _bookrun_chapter_plan_summary,
    _bookrun_risk_summary,
)
from app.domains.agent_runs.intent import SUPPORTED_INTENTS as RUNTIME_SUPPORTED_INTENTS
from app.domains.agent_runs.intent import _detect_intent as detect_runtime_intent
from app.domains.agent_runs.intent import _role_hints, _role_mentions
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent, SubagentRun
from app.domains.ide import router as ide_router


def test_agent_run_models_are_registered_in_metadata() -> None:
    """Agent Runtime 控制平面表必须进入统一 ORM 元数据。"""

    assert AgentRun.__tablename__ == "agent_runs"
    assert AgentRunEvent.__tablename__ == "agent_run_events"
    assert SubagentRun.__tablename__ == "subagent_runs"
    assert AgentArtifact.__tablename__ == "agent_artifacts"


def test_agent_run_event_type_constants_preserve_existing_protocol_values() -> None:
    """事件常量只收敛既有协议名，不夹带 turn/streaming 新模型。"""

    from app.domains.agent_runs.service import _control_event_type

    assert frozenset(
        {
            "agent_run_started",
            "agent_plan_created",
            "subagent_started",
            "subagent_completed",
            "tool_trace",
            "permission_required",
            "agent_artifact",
            "agent_run_completed",
            "agent_run_failed",
            "system_job",
            "permission_approved",
            "permission_denied",
            "pause_run",
            "resume_run",
            "stop_run",
            "retry_from_checkpoint",
        }
    ) == event_types.AGENT_RUN_EVENT_TYPES
    assert frozenset(
        {
            "approve_permission",
            "deny_permission",
            "pause_run",
            "resume_run",
            "stop_run",
            "retry_from_checkpoint",
        }
    ) == event_types.CONTROL_MESSAGE_TYPES
    assert frozenset(
        {
            "permission_approved",
            "permission_denied",
            "pause_run",
            "resume_run",
            "stop_run",
            "retry_from_checkpoint",
        }
    ) == event_types.CONTROL_MESSAGE_EVENT_TYPES
    assert _control_event_type("approve_permission") == "permission_approved"
    assert _control_event_type("deny_permission") == "permission_denied"
    assert _control_event_type("pause_run") == "pause_run"
    assert event_types.event_type_for_control_message("custom_legacy_event") == "custom_legacy_event"
    assert "turn_started" not in event_types.AGENT_RUN_EVENT_TYPES
    assert "message_delta" not in event_types.AGENT_RUN_EVENT_TYPES


def test_record_agent_event_sequences_increment_from_existing_max(session: Session) -> None:
    """底层事件写入必须按 run 内最大 sequence 递增，给 service.py 拆分提供顺序护栏。"""

    from app.domains.agent_runs.service import record_agent_event

    run = _seed_agent_run(session)
    session.add(
        AgentRunEvent(
            run_id=run.id,
            event_type="seeded",
            actor="test",
            message="已有事件",
            payload={"seed": True},
            sequence=7,
        )
    )
    session.commit()

    first = record_agent_event(
        session,
        run,
        event_type="tool_trace",
        actor="root-agent",
        message="第一条新增事件",
        payload={"step": 1},
    )
    second = record_agent_event(
        session,
        run,
        event_type="agent_run_completed",
        actor="root-agent",
        message="第二条新增事件",
        payload={"step": 2},
    )

    assert [first.sequence, second.sequence] == [8, 9]
    stored_sequences = [
        event.sequence
        for event in session.query(AgentRunEvent).filter_by(run_id=run.id).order_by(AgentRunEvent.sequence)
    ]
    assert stored_sequences == [7, 8, 9]


def test_encode_agent_run_sse_event_is_stable_json_snapshot(session: Session) -> None:
    """SSE 编码必须只投影 AgentRunEvent 事实源，不引入额外运行态。"""

    from app.domains.agent_runs.service import encode_agent_run_sse_event, record_agent_event

    run = _seed_agent_run(session, public_id="run-sse-encoder")
    event = record_agent_event(
        session,
        run,
        event_type="tool_trace",
        actor="tool-registry",
        message="命令 audit.open 已执行。",
        payload={"command_id": "audit.open", "result": {"ok": True}},
    )

    encoded = encode_agent_run_sse_event(event)

    assert encoded.startswith("event: tool_trace\n")
    assert encoded.endswith("\n\n")
    assert encoded.count("\ndata: ") == 1
    payload = json.loads(encoded.split("data: ", 1)[1].split("\n\n", 1)[0])
    assert payload == {
        "id": event.id,
        "run_id": run.id,
        "event_type": "tool_trace",
        "actor": "tool-registry",
        "message": "命令 audit.open 已执行。",
        "payload": {"command_id": "audit.open", "result": {"ok": True}},
        "sequence": 1,
        "created_at": event.created_at.isoformat(),
    }


def test_sse_user_message_enters_through_runtime_facade() -> None:
    """IDE SSE pump 不应直接串联 user_message run 的 start/execute 细节。"""

    source = inspect.getsource(ide_router._agent_user_message_payloads)  # noqa: SLF001

    assert "run_agent_user_message(" in source
    assert "start_agent_user_message_run(" not in source
    assert "execute_agent_user_message_run(" not in source


def test_agent_runtime_supported_intents_are_registered() -> None:
    assert {
        "chat.explain",
        "file.review",
        "file.revise",
        "chapter.review",
        "chapter.repair",
        "bookrun.start",
    } == RUNTIME_SUPPORTED_INTENTS


def test_agent_runtime_detect_intent_honors_explicit_intent_over_free_text() -> None:
    """F11：关键词表已下线。自由文本不再被「修/审」等词劫进固定管线，
    只有显式 intent 或结构化参数（reviewer role hint）才路由到 file.review/revise。"""

    file_args = {"file_path": "正文/第01章.md", "content": "正文内容"}

    # 无显式 intent、无 role hint 的自由文本一律落 chat.explain 工具循环。
    assert detect_runtime_intent("修选中问题：plot-1 prose-1", file_args, None) == "chat.explain"
    # 显式 intent 始终优先。
    assert detect_runtime_intent("修选中问题：plot-1 prose-1", file_args, "file.revise") == "file.revise"
    assert detect_runtime_intent("随便一句话", file_args, "file.review") == "file.review"
    # reviewer role hint + 文件上下文仍走 file.review 固定管线。
    review_args = {**file_args, "agent_role_hints": ["plot_reviewer"]}
    assert detect_runtime_intent("看看这章", review_args, None) == "file.review"


def test_agent_runtime_role_hints_resolve_mentions_and_filter_unknowns() -> None:
    args = {
        "agent_role_hints": ["plot_reviewer", "unknown_reviewer", "@人物"],
        "agent_role_mentions": ["@剧情", "@文风", "@未知"],
    }

    assert _role_hints(args) == ["plot_reviewer", "character_reviewer", "prose_reviewer"]
    assert _role_mentions(args) == ["@剧情", "@文风", "@未知"]


def test_agent_runtime_bookrun_summary_helpers_describe_budget_and_risks() -> None:
    command_args = {"chapter_budget": 6, "token_budget": 9000, "time_budget_sec": 1800}

    assert _bookrun_chapter_plan_summary(command_args) == "生成最多 6 章"
    assert _bookrun_budget_summary(command_args) == "9000 tokens，1800 秒"
    assert _bookrun_budget_details(command_args) == {
        "token_budget": 9000,
        "time_budget_sec": 1800,
        "chapter_budget": 6,
        "uses_default_budget": False,
    }
    assert _bookrun_risk_summary(command_args) == [
        "token_budget 较高，可能产生更长运行时间和更高成本",
        "chapter_budget 较高，建议确认章节范围",
        "time_budget_sec 较长，运行会停留在后台",
        "写作任务以 managed 模式运行，不会写入当前 Desktop 草稿或 pending patch",
    ]


def test_agent_run_returns_404_for_missing_run(client: TestClient) -> None:
    """不存在的 AgentRun 应返回明确 404。"""

    response = client.get("/api/agent-runs/not-found")

    assert response.status_code == 404
    assert response.json() == {"detail": "AgentRun 不存在。"}


def test_agent_run_event_sequence_unique_index_rejects_duplicates(session: Session) -> None:
    """同一 run 内重复 sequence 必须被唯一索引拒绝，事件重放顺序不允许歧义。"""

    from sqlalchemy.exc import IntegrityError

    run = _seed_agent_run(session, public_id="run-sequence-unique")
    session.add(AgentRunEvent(run_id=run.id, event_type="tool_trace", actor="root-agent", sequence=1))
    session.commit()

    session.add(AgentRunEvent(run_id=run.id, event_type="tool_trace", actor="root-agent", sequence=1))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_record_agent_event_retries_on_sequence_conflict(session: Session) -> None:
    """并发写读到相同 max(sequence) 时，冲突方必须重读重试而不是丢事件。"""

    from sqlalchemy import event as sa_event

    from app.domains.agent_runs.service import record_agent_event

    run = _seed_agent_run(session, public_id="run-sequence-retry")
    record_agent_event(session, run, event_type="agent_run_started", actor="root-agent")

    conflicts: list[int] = []

    def inject_conflicting_row(flush_session: Session, *_args: object) -> None:
        # 模拟另一连接抢先提交同号事件：在 ORM flush 之前塞入同 (run_id, sequence) 行。
        # 该行与失败的插入同处一个 SAVEPOINT，回滚后重试路径必须成功拿到该序号。
        conflicts.append(1)
        flush_session.connection().exec_driver_sql(
            "INSERT INTO agent_run_events (run_id, event_type, actor, message, payload, sequence) "
            f"VALUES ({run.id}, 'tool_trace', 'rival-writer', '', '{{}}', 2)"
        )

    sa_event.listen(session, "before_flush", inject_conflicting_row, once=True)

    recorded = record_agent_event(session, run, event_type="tool_trace", actor="root-agent")

    assert conflicts == [1]
    assert recorded.sequence == 2
    sequences = [event.sequence for event in _stored_run_events(session, run)]
    assert sequences == [1, 2]


def test_bootstrap_sqlite_renumbers_legacy_duplicate_sequences(tmp_path) -> None:
    """存量 sidecar 库带重复 (run_id, sequence) 时，bootstrap 必须先重排再补唯一索引。"""

    from sqlalchemy import create_engine
    from sqlalchemy import inspect as sa_inspect

    from app.db.base import Base
    from app.db.session import bootstrap_sqlite_database

    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'legacy.sqlite3'}")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql("DROP INDEX uq_agent_run_events_run_sequence")
        connection.exec_driver_sql(
            "INSERT INTO agent_runs (public_id, session_id, goal, scope, permission_profile, budget, status, root_plan) "
            "VALUES ('run-legacy', 'session-legacy', 'goal', '{}', 'risk_confirm', '{}', 'running', '[]')"
        )
        for sequence in (1, 2, 2, 3):
            connection.exec_driver_sql(
                "INSERT INTO agent_run_events (run_id, event_type, actor, message, payload, sequence) "
                f"VALUES (1, 'tool_trace', 'root-agent', '', '{{}}', {sequence})"
            )

    bootstrap_sqlite_database(engine)

    with engine.connect() as connection:
        rows = connection.exec_driver_sql(
            "SELECT sequence FROM agent_run_events WHERE run_id = 1 ORDER BY sequence, id"
        ).fetchall()
    assert [row[0] for row in rows] == [1, 2, 3, 4]
    index_names = {index["name"] for index in sa_inspect(engine).get_indexes("agent_run_events")}
    assert "uq_agent_run_events_run_sequence" in index_names
    engine.dispose()


def test_detect_intent_requires_scene_packet_for_chapter_review() -> None:
    """自由文本「审阅」没带 scene_packet_id 时必须落回 chat.explain 工具循环：
    chapter.review 绑定 DB 实体，路由过去只会因缺参报「这轮没跑通」。"""

    assert detect_runtime_intent("帮我审阅一下这个项目", {}, None) == "chat.explain"
    assert detect_runtime_intent("章节审阅", {}, None) == "chat.explain"
    assert detect_runtime_intent("审阅这一章", {"scene_packet_id": 3}, None) == "chapter.review"
    # F11：仅有文件上下文、无 reviewer role hint 的自由文本也落 chat.explain，
    # 由循环内 file.review 工具自主决定，不再被「审阅」关键词劫进固定管线。
    file_args = {"file_path": "正文/第01章.md", "content": "正文"}
    assert detect_runtime_intent("审阅这份稿子", file_args, None) == "chat.explain"
    # 带 reviewer role hint 才路由固定 file.review 管线。
    assert detect_runtime_intent("审阅这份稿子", {**file_args, "agent_role_hints": ["prose_reviewer"]}, None) == "file.review"


def test_reap_non_terminal_agent_runs_fails_stale_and_records_reason(session: Session) -> None:
    """起服收尸：running（线程已随进程消失）收为 failed 并写 reason=process_restart；
    paused（等待作者确认补丁 / 用户暂停的持久可恢复态）与已终态的不动。

    paused 必须保住：收尸它会毁掉待确认补丁并锁死 approve 门（仅在 status==paused 放行）。"""

    from app.domains.agent_runs.service import reap_non_terminal_agent_runs

    running = _seed_agent_run(session, public_id="run-reap-running")
    paused = _seed_agent_run(session, public_id="run-reap-paused")
    paused.status = "paused"
    already_done = _seed_agent_run(session, public_id="run-reap-done")
    already_done.status = "completed"
    session.add_all([paused, already_done])
    session.commit()

    reaped = reap_non_terminal_agent_runs(session)
    assert reaped == 1

    session.refresh(running)
    session.refresh(paused)
    session.refresh(already_done)
    assert running.status == "failed"
    assert paused.status == "paused"
    assert already_done.status == "completed"

    running_events = _stored_run_events(session, running)
    assert running_events[-1].event_type == "agent_run_failed"
    assert running_events[-1].payload["reason"] == "process_restart"


def test_complete_agent_run_payload_carries_rebuild_fields(session: Session) -> None:
    """AGENT_RUN_COMPLETED payload 落齐重建终态所需字段：断线后拉事件表即可复原（F10）。"""

    from app.domains.agent_runs.service import complete_agent_run

    run = _seed_agent_run(session, public_id="run-complete-payload")
    result = {
        "intent": "chat.explain",
        "assistant_session_id": 7,
        "agent_result": {
            "summary": "已完成审阅。",
            "requires_user_confirmation": False,
            "chat_loop": {"rounds": 3, "tool_call_count": 5, "extra": "略"},
        },
        "proposed_patch": {
            "id": "patch-1",
            "created_by_tool": "file.revise",
            "file_path": "正文/第01章.md",
            "before": "长" * 5000,
            "after": "长" * 5000,
        },
    }

    complete_agent_run(session, run, result=result)
    events = _stored_run_events(session, run)
    payload = events[-1].payload
    assert payload["intent"] == "chat.explain"
    assert payload["assistant_session_id"] == 7
    assert payload["summary"] == "已完成审阅。"
    assert payload["has_proposed_patch"] is True
    assert payload["proposed_patch"] == {
        "id": "patch-1",
        "created_by_tool": "file.revise",
        "file_path": "正文/第01章.md",
    }
    # 补丁全文不进事件表，避免膨胀。
    assert "before" not in payload["proposed_patch"]
    assert payload["chat_loop"] == {"rounds": 3, "tool_call_count": 5}


def test_websocket_terminal_encoder_emits_completed_event(session: Session) -> None:
    """完成事件必须能被编码成 WS 流消息，供断线重建路径重放（F10）。"""

    from app.domains.agent_runs.event_encoders import websocket_stream_events_from_agent_event
    from app.domains.agent_runs.service import complete_agent_run

    run = _seed_agent_run(session, public_id="run-terminal-encoder")
    complete_agent_run(
        session,
        run,
        result={
            "intent": "chat.explain",
            "assistant_session_id": 3,
            "agent_result": {"summary": "收工。", "requires_user_confirmation": False},
        },
    )
    completed_event = _stored_run_events(session, run)[-1]
    assert completed_event.event_type == "agent_run_completed"

    encoded = websocket_stream_events_from_agent_event(completed_event)
    assert len(encoded) == 1
    message = encoded[0]
    assert message["type"] == "agent_run_completed"
    assert message["run_id"] == run.public_id
    assert message["assistant_session_id"] == run.assistant_session_id
    assert message["status"] == "completed"
    assert message["payload"]["summary"] == "收工。"
