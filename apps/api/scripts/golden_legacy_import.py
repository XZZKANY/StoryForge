"""Legacy database import oracle (P4-3): a synthetic Python database written through the real assistant service
and ORM, then read back through the read models the routes serve.

The database carries what an older install still has next to the current tables: the extra columns of 0.1.10
(`book_run_id` / `blueprint_id` / `artifact_id`) and a retired table with a row; the import must ignore them. JSON
columns go through SQLAlchemy's serializer and booleans through its Boolean type, as on the author's machine;
timestamps are pinned afterwards (CURRENT_TIMESTAMP format) so the record is deterministic. The record carries the
database as `iterdump()` statements: the TS replay rebuilds the same file, imports it into the engine database and
reads it back through the engine. Expected reads: session detail, recent sessions, tool-call lists, run events
(timestamps dropped, the engine read model has none) and save points.
"""

from __future__ import annotations

import hashlib
import os

import prometheus_client  # noqa: F401 - imported before the audit hook: its process collector probes /proc
from golden_fs import isolated_fs_oracle

SECRET = "sk-oracle-legacy-123456"
SOURCES = [
    "app/domains/assistant/service.py",
    "app/domains/assistant/schemas.py",
    "app/domains/assistant/models.py",
    "app/domains/agent_runs/models.py",
    "app/domains/agent_runs/service_store.py",
    "app/domains/agent_runs/save_points.py",
    "app/db/base.py",
]
SUMMARY = {"path": "正文/第001章.md", "ratio": 0.5, "budget": 3000.0, "flags": [True, False, None],
           "10": "整数形的键", "emoji": "😀\u2028", "nested": {"quote": "\"引号\"\n换行", "empty": {}}}
PENDING = {"status": "pending", "intent": "file.review", "boundary": "after_tool:context.load",
           "pending_tool": "file.review", "resume_strategy": "continue_pending_call"}


def fill(db, service, schemas, models) -> None:
    """Sessions, messages and tool calls through the service; runs, events, artifacts and subagents through the
    ORM, interleaved so ids are not grouped per run."""

    session_create = schemas.AssistantSessionCreate
    for payload in [
        {"title": f"修订 token={SECRET}", "task_type": "ide_agent_orchestration", "project_path": "D:/book",
         "messages": [{"role": "user", "content": f"我的 key 是 {SECRET}"},
                      {"role": "assistant", "content": "收到。😀\r\n第二行 \"引号\""}]},
        {"title": "单轮修订", "task_type": "desktop_revise", "project_path": None, "messages": []},
        {"title": "别的书", "task_type": "ide_agent_orchestration", "project_path": "D:/other",
         "messages": [{"role": "user", "content": "你好"}]},
        {"title": "同一本书的第二个会话", "task_type": "ide_agent_orchestration", "project_path": "D:/book",
         "messages": []},
    ]:
        service.create_assistant_session(db, session_create(**payload))
    service.append_assistant_message(db, 2, schemas.AssistantMessageCreate(role="system", content="系统提示"))
    service.append_assistant_message(db, 1, schemas.AssistantMessageCreate(role="user", content="再写一章"))

    create, update = schemas.AssistantToolCallCreate, schemas.AssistantToolCallUpdate
    first = service.create_assistant_tool_call(db, 1, create(
        tool_name="fs.read", status="running", input_summary=SUMMARY, output_summary={}))
    service.update_assistant_tool_call(db, first.id, update(
        status="completed", output_summary={"chars": 1200, "excerpt": f"含 {SECRET} 的摘录"}))
    failed = service.create_assistant_tool_call(db, 3, create(
        tool_name="file.revise", status="running", input_summary={"path": "a.md"}))
    service.update_assistant_tool_call(db, failed.id, update(
        status="failed", error_message=f"模型请求失败：{SECRET}", related_type="agent_run", related_id=2))
    service.create_assistant_tool_call(db, 1, create(tool_name="project.consistency", status="planned"))

    AgentRun, Event, Artifact, Subagent = models
    runs = [
        AgentRun(public_id="legacy-run-1", session_id="agent-1", assistant_session_id=1, goal="审一遍第一章",
                 scope={"project_root": "D:/book", "paths": ["正文/第001章.md"]}, permission_profile="ask",
                 budget={"max_steps": 8, "tokens": 3000.0}, status="completed",
                 root_plan=[{"step": "fs.read", "status": "done"}, {"step": "file.review", "status": "done"}],
                 current_step="done"),
        AgentRun(public_id="legacy-run-2", session_id="agent-1", assistant_session_id=1, goal=f"改第一章 {SECRET}",
                 scope={}, permission_profile="ask", budget={}, status="paused", root_plan=[],
                 current_step="permission.confirm"),
        AgentRun(public_id="legacy-run-3", session_id="agent-2", assistant_session_id=None, goal="没有绑会话的 run",
                 scope={"project_root": "D:/other"}, permission_profile="auto", budget={"ratio": 0.25},
                 status="failed", root_plan=[], current_step=None),
        AgentRun(public_id="legacy-run-4", session_id="agent-3", assistant_session_id=3, goal="跑到一半",
                 scope={}, permission_profile="read", budget={}, status="running", root_plan=[],
                 current_step="tool:fs.read"),
        AgentRun(public_id="legacy-run-5", session_id="agent-3", assistant_session_id=3, goal="作者停下",
                 scope={}, permission_profile="ask", budget={}, status="stopped", root_plan=[],
                 current_step="stopped"),
    ]
    db.add_all(runs)
    db.flush()
    r1, r2, r3, r4, r5 = (run.id for run in runs)
    rows = [
        Event(run_id=r1, event_type="agent_run_started", actor="root_agent", message="开始", sequence=1,
              payload={"goal": "审一遍第一章", "budget": {"tokens": 3000.0}}),
        Event(run_id=r2, event_type="agent_run_started", actor="root_agent", message=f"开始 {SECRET}", sequence=1,
              payload={"goal": f"改第一章 {SECRET}"}),
        Event(run_id=r1, event_type="tool_trace", actor="root_agent", message="读取", sequence=2,
              payload={"trace": {"tool_name": "fs.read", "status": "completed", "audit_event_id": "a1"},
                       "index": 1, "summary": SUMMARY}),
        Artifact(run_id=r1, kind="review_report", requires_confirmation=False,
                 payload={"kind": "review", "file_path": "正文/第001章.md", "issues": [{"id": "i-1", "score": 0.75}],
                          "token_budget": 3000.0}),
        Event(run_id=r2, event_type="tool_trace", actor="root_agent", message="", sequence=2,
              payload={"trace": {"tool_name": "file.revise", "status": "completed"}, "index": 1}),
        Artifact(run_id=r2, kind="proposed_patch", requires_confirmation=True,
                 payload={"kind": "file_revision", "file_path": "正文/第001章.md", "before": "旧", "after": "新😀",
                          "requires_confirmation": True}),
        Event(run_id=r2, event_type="permission_required", actor="root_agent", message="等待确认", sequence=3,
              payload={"blocked_tool": "file.revise", "permission_profile": "ask"}),
        Artifact(run_id=r2, kind="runtime_pending_call", requires_confirmation=False, payload=PENDING),
        Event(run_id=r1, event_type="agent_run_completed", actor="root_agent", message="完成", sequence=3,
              payload={"assistant_session_id": 1, "result": {"status": "completed", "proposed_patch": None}}),
        Artifact(run_id=r1, kind="system_summary", requires_confirmation=False, payload={"summary": "隐藏的系统摘要"}),
        Event(run_id=r3, event_type="agent_run_failed", actor="root_agent", message="失败", sequence=1,
              payload={"error": f"provider 401 {SECRET}", "reason": "llm_error"}),
        Event(run_id=r4, event_type="agent_run_started", actor="root_agent", message="开始", sequence=1, payload={}),
        Event(run_id=r5, event_type="stop_run", actor="author", message="停止", sequence=1,
              payload={"control_type": "stop_run", "source": "desktop"}),
        Subagent(run_id=r1, parent_run_id=None, role="reviewer", input={"path": "正文/第001章.md"},
                 output={"issues": 1, "score": 0.5}, status="completed"),
        Subagent(run_id=r5, parent_run_id=r1, role="writer", input={}, output={}, status="failed"),
    ]
    for row in rows:
        db.add(row)
        db.flush()
    db.commit()


def legacy_extras(connection) -> None:
    """What an older install still carries: 0.1.10 columns with values and a retired table."""

    for statement in [
        "ALTER TABLE assistant_sessions ADD COLUMN blueprint_id INTEGER",
        "ALTER TABLE assistant_sessions ADD COLUMN book_run_id INTEGER",
        "ALTER TABLE assistant_sessions ADD COLUMN artifact_id INTEGER",
        "ALTER TABLE agent_runs ADD COLUMN book_run_id INTEGER",
        "CREATE TABLE book_runs (id INTEGER NOT NULL PRIMARY KEY, status VARCHAR(50) NOT NULL)",
        "INSERT INTO book_runs (id, status) VALUES (7, 'completed')",
        "UPDATE assistant_sessions SET book_run_id = 7, blueprint_id = 3, artifact_id = 9 WHERE id = 2",
        "UPDATE agent_runs SET book_run_id = 7 WHERE id = 3",
    ]:
        connection.exec_driver_sql(statement)


def pin_timestamps(connection) -> None:
    """CURRENT_TIMESTAMP values, pinned: recent-session order follows updated_at with one tie (id breaks it)."""

    updated = {1: "2026-07-03 09:00:00", 2: "2026-07-05 12:30:00", 3: "2026-07-03 09:00:00", 4: "2026-07-01 08:00:00"}
    for session_id, at in updated.items():
        connection.exec_driver_sql(
            "UPDATE assistant_sessions SET created_at = ?, updated_at = ? WHERE id = ?",
            (f"2026-06-30 1{session_id}:00:00", at, session_id))
    for table in ["assistant_messages", "assistant_tool_calls", "agent_runs", "agent_run_events", "agent_artifacts",
                  "subagent_runs"]:
        connection.exec_driver_sql(
            f"UPDATE {table} SET created_at = '2026-07-02 10:' || printf('%02d', id) || ':00', "
            "updated_at = '2026-07-02 11:' || printf('%02d', id) || ':30'")
    connection.exec_driver_sql("UPDATE assistant_tool_calls SET started_at = '2026-07-02 10:00:05' WHERE id = 1")


def legacy_reads(db) -> list[dict]:
    """Every read the desktop serves from these tables, as the routes serialize it."""

    from app.domains.agent_runs.models import AgentRun
    from app.domains.agent_runs.router import get_agent_run_save_points_endpoint, list_agent_run_events_endpoint
    from app.domains.agent_runs.schemas import AgentRunEventRead
    from app.domains.assistant import service
    from app.domains.assistant.models import AssistantSession
    from app.domains.assistant.schemas import AssistantSessionRead, AssistantToolCallRead

    db.expire_all()
    reads: list[dict] = []
    session_ids = [row.id for row in db.query(AssistantSession).order_by(AssistantSession.id)]
    for session_id in session_ids:
        reads.append({"op": "session", "id": session_id, "result": AssistantSessionRead.model_validate(
            service.get_assistant_session(db, session_id)).model_dump(mode="json")})
        reads.append({"op": "tool_calls", "id": session_id, "result": [
            AssistantToolCallRead.model_validate(row).model_dump(mode="json")
            for row in service.list_assistant_tool_calls(db, session_id)]})
    projects = sorted({row.project_path for row in db.query(AssistantSession) if row.project_path})
    for kwargs in [{"limit": 20, "project_path": None}, {"limit": 2, "project_path": None},
                   *({"limit": 20, "project_path": project} for project in projects)]:
        reads.append({"op": "recent", "kwargs": kwargs, "result": [
            AssistantSessionRead.model_validate(row).model_dump(mode="json")
            for row in service.list_recent_assistant_sessions(db, **kwargs)]})
    for run in db.query(AgentRun).order_by(AgentRun.id):
        reads.append({"op": "events", "run": run.public_id, "result": [
            {k: v for k, v in AgentRunEventRead.model_validate(event).model_dump(mode="json").items()
             if k not in ("created_at", "updated_at")}
            for event in list_agent_run_events_endpoint(run.public_id, db)]})
        reads.append({"op": "save_points", "run": run.public_id,
                      "result": get_agent_run_save_points_endpoint(run.public_id, db)})
    return reads


def p4_legacy_import_snapshot() -> dict:
    with isolated_fs_oracle("storyforge-golden-legacy-import-") as (api, _run):
        os.environ["STORYFORGE_LLM_API_KEY"] = SECRET
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.db.base import Base
        from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent, SubagentRun
        from app.domains.assistant import schemas, service

        engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        with engine.begin() as connection:
            legacy_extras(connection)
        db = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)()
        fill(db, service, schemas, (AgentRun, AgentRunEvent, AgentArtifact, SubagentRun))
        with engine.begin() as connection:
            pin_timestamps(connection)
        reads = legacy_reads(db)
        raw = engine.raw_connection()
        try:
            # create_all emits indexes in set order (hash seeded per process): sorted, before COMMIT.
            dumped = list(raw.driver_connection.iterdump())
            indexes = sorted(s for s in dumped if s.startswith(("CREATE INDEX", "CREATE UNIQUE INDEX")))
            rest = [s for s in dumped if s not in indexes]
            assert rest[-1] == "COMMIT;"
            statements = [*rest[:-1], *indexes, rest[-1]]
            counts = {table: raw.driver_connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                      for table in ["assistant_sessions", "assistant_messages", "assistant_tool_calls", "agent_runs",
                                    "agent_run_events", "agent_artifacts", "subagent_runs"]}
        finally:
            raw.close()
        return {
            "format_version": 1,
            "suite": "p4-legacy-import",
            "secret": SECRET,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "legacy_sql": statements,
            "rows": counts,
            "reads": reads,
        }
