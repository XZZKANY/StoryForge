"""Assistant session store oracle (P4-1b): the real assistant session / message / tool-call services on in-memory
sqlite, driven by one operation script.

Each operation records what the service returned (serialized through the same read models the HTTP routes use,
timestamps dropped), the error class and message, or a validation rejection (the request models are built here, as
the routes would). After every operation the raw rows the agent loop reads (session title, messages, tool calls) are
recorded too. All writes land within one second, so the recent-session order is the id tie-break, as in the TS
replay with a fixed clock.
"""

from __future__ import annotations

import hashlib
import os

import prometheus_client  # noqa: F401 - imported before the audit hook: its process collector probes /proc
from golden_fs import isolated_fs_oracle

SECRET = "sk-oracle-secret-123456"
SOURCES = [
    "app/domains/assistant/service.py",
    "app/domains/assistant/schemas.py",
    "app/domains/assistant/models.py",
    "app/common/redaction.py",
]
TIMESTAMPS = {"created_at", "updated_at", "started_at", "finished_at"}


def operations() -> list[dict]:
    long = "长" * 12001
    return [
        {"op": "create_session", "payload": {
            "title": f"修订 token={SECRET}", "task_type": "desktop_revise", "project_path": "D:/book",
            "messages": [{"role": "user", "content": f"我的 key 是 {SECRET}"},
                         {"role": "assistant", "content": "收到。"}]}},
        {"op": "create_session", "payload": {"title": "IDE Agent: 你好", "task_type": "ide_agent_orchestration",
                                             "project_path": None, "messages": []}},
        {"op": "create_session", "payload": {"title": "别的书", "task_type": "ide_agent_orchestration",
                                             "project_path": "D:/other", "messages": []}},
        {"op": "append_message", "session": 1, "payload": {"role": "user", "content": f"再说一次 {SECRET}"}},
        {"op": "append_message", "session": 2, "payload": {"role": "system", "content": "系统提示"}},
        {"op": "append_message", "session": 99, "payload": {"role": "user", "content": "不存在的会话"}},
        {"op": "create_tool_call", "session": 1, "payload": {
            "tool_name": "fs.read", "status": "running",
            "input_summary": {"path": "正文/第001章.md", "api_key": "k", "nested": {"note": f"带 {SECRET}"}}}},
        {"op": "create_tool_call", "session": 1, "payload": {
            "tool_name": "assistant.chat_loop", "status": "completed", "input_summary": {},
            "output_summary": {"rounds": 2, "cost": 2.5, "flag": True, "items": [1, None, "x"]},
            "error_message": f"失败了 {SECRET}", "related_type": "agent_run", "related_id": 3}},
        {"op": "create_tool_call", "session": 2, "payload": {"tool_name": "file.review", "status": "paused",
                                                             "input_summary": {"x": 1}}},
        {"op": "update_tool_call", "id": 1, "payload": {"status": "completed",
                                                        "output_summary": {"returned_chars": 12, "token": SECRET}}},
        {"op": "update_tool_call", "id": 2, "payload": {"error_message": f"只改错误 {SECRET}"}},
        {"op": "update_tool_call", "id": 3, "payload": {"input_summary": {"y": 2}, "status": "failed"}},
        {"op": "update_tool_call", "id": 99, "payload": {"status": "failed"}},
        {"op": "list_tool_calls", "session": 1},
        {"op": "list_tool_calls", "session": 99},
        {"op": "get_session", "session": 1},
        {"op": "get_session", "session": 99},
        {"op": "set_title", "session": 2, "title": f"你好 {SECRET}"},
        {"op": "list_recent", "kwargs": {}},
        {"op": "list_recent", "kwargs": {"project_path": "D:/book"}},
        {"op": "list_recent", "kwargs": {"limit": 1}},
        {"op": "list_recent", "kwargs": {"project_path": "D:/none"}},
        # Request-model rejections (the HTTP routes answer 422 before the service runs).
        {"op": "create_session", "payload": {"title": "", "task_type": "t", "messages": []}},
        {"op": "create_session", "payload": {"title": "长" * 161, "task_type": "t", "messages": []}},
        {"op": "create_session", "payload": {"title": "t", "task_type": "", "messages": []}},
        {"op": "create_session", "payload": {"title": "t", "task_type": "t", "project_path": "p" * 1025,
                                             "messages": []}},
        {"op": "create_session", "payload": {"title": "t", "task_type": "t",
                                             "messages": [{"role": "user", "content": "x"}] * 51}},
        {"op": "create_session", "payload": {"title": "t", "task_type": "t", "messages": [], "extra": 1}},
        {"op": "append_message", "session": 1, "payload": {"role": "bot", "content": "x"}},
        {"op": "append_message", "session": 1, "payload": {"role": "user", "content": ""}},
        {"op": "append_message", "session": 1, "payload": {"role": "user", "content": long}},
        {"op": "create_tool_call", "session": 1, "payload": {"tool_name": "", "status": "running"}},
        {"op": "create_tool_call", "session": 1, "payload": {"tool_name": "t" * 121, "status": "running"}},
        {"op": "create_tool_call", "session": 1, "payload": {"tool_name": "t", "status": "weird"}},
        {"op": "create_tool_call", "session": 1, "payload": {"tool_name": "t", "status": "planned", "related_id": 0}},
        {"op": "create_tool_call", "session": 1, "payload": {"tool_name": "t", "status": "needs_approval",
                                                             "error_message": "e" * 4001}},
        {"op": "create_tool_call", "session": 1, "payload": {"tool_name": "t", "status": "planned",
                                                             "related_type": "r" * 81}},
        {"op": "update_tool_call", "id": 1, "payload": {"status": "weird"}},
        {"op": "create_tool_call", "session": 1, "payload": {"tool_name": "t", "status": "planned"}},
    ]


def p4_assistant_store_snapshot() -> dict:
    with isolated_fs_oracle("storyforge-golden-assistant-store-") as (api, _run):
        os.environ["STORYFORGE_LLM_API_KEY"] = SECRET
        from pydantic import ValidationError
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.db.base import Base
        from app.domains.assistant import service
        from app.domains.assistant.models import AssistantMessage, AssistantSession, AssistantToolCall
        from app.domains.assistant.schemas import (
            AssistantMessageCreate,
            AssistantMessageRead,
            AssistantSessionCreate,
            AssistantSessionRead,
            AssistantToolCallCreate,
            AssistantToolCallRead,
            AssistantToolCallUpdate,
        )

        engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)()

        def dump(model, row):
            return {k: v for k, v in model.model_validate(row).model_dump(mode="json").items() if k not in TIMESTAMPS}

        def session_read(row):
            value = dump(AssistantSessionRead, row)
            value["messages"] = [{k: v for k, v in item.items() if k not in TIMESTAMPS} for item in value["messages"]]
            return value

        def raw():
            db.expire_all()
            return {
                "sessions": [{"id": r.id, "title": r.title, "project_path": r.project_path}
                             for r in db.query(AssistantSession).order_by(AssistantSession.id)],
                "messages": [{"id": r.id, "session_id": r.session_id, "role": r.role, "content": r.content}
                             for r in db.query(AssistantMessage).order_by(AssistantMessage.id)],
                "tool_calls": [{"id": r.id, "session_id": r.session_id, "tool_name": r.tool_name, "status": r.status,
                                "input_summary": r.input_summary, "output_summary": r.output_summary,
                                "error_message": r.error_message, "related_type": r.related_type,
                                "related_id": r.related_id}
                               for r in db.query(AssistantToolCall).order_by(AssistantToolCall.id)],
            }

        records = []
        for op in operations():
            record = {"op": op}
            try:
                if op["op"] == "create_session":
                    record["result"] = session_read(
                        service.create_assistant_session(db, AssistantSessionCreate(**op["payload"])))
                elif op["op"] == "append_message":
                    payload = AssistantMessageCreate(**op["payload"])
                    record["result"] = dump(AssistantMessageRead,
                                            service.append_assistant_message(db, op["session"], payload))
                elif op["op"] == "create_tool_call":
                    payload = AssistantToolCallCreate(**op["payload"])
                    record["result"] = dump(AssistantToolCallRead,
                                            service.create_assistant_tool_call(db, op["session"], payload))
                elif op["op"] == "update_tool_call":
                    payload = AssistantToolCallUpdate(**op["payload"])
                    record["result"] = dump(AssistantToolCallRead,
                                            service.update_assistant_tool_call(db, op["id"], payload))
                elif op["op"] == "list_tool_calls":
                    record["result"] = [dump(AssistantToolCallRead, row)
                                        for row in service.list_assistant_tool_calls(db, op["session"])]
                elif op["op"] == "get_session":
                    record["result"] = session_read(service.get_assistant_session(db, op["session"]))
                elif op["op"] == "set_title":
                    # The hidden title job assigns the column directly (conversation_runtime).
                    row = service.get_assistant_session(db, op["session"])
                    row.title = op["title"][:160]
                    db.add(row)
                    db.commit()
                    record["result"] = None
                elif op["op"] == "list_recent":
                    record["result"] = [session_read(row)
                                        for row in service.list_recent_assistant_sessions(db, **op["kwargs"])]
            except ValidationError:
                record["rejected"] = 422
            except Exception as exc:  # noqa: BLE001 - the oracle records every failure shape
                record["error"] = {"type": type(exc).__name__, "message": str(exc)}
            record["raw"] = raw()
            records.append(record)
        return {
            "format_version": 1,
            "suite": "p4-assistant-store",
            "secret": SECRET,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "records": records,
        }
