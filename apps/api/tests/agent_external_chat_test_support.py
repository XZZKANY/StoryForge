from __future__ import annotations

import pytest
from agent_external_writeback_test_support import AFTER, BEFORE
from sqlalchemy import create_engine, event
from sqlalchemy.pool import NullPool

from app.domains.agent_runs import loop_runtime, service
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantReviseResponse
from app.platform.ai_sdk import ChatResponse, ToolCall
from app.platform.ai_sdk.providers import DeterministicProvider


@pytest.fixture()
def engine(tmp_path):
    from app.db.base import Base

    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'chat.sqlite3'}", poolclass=NullPool,
                           connect_args={"timeout": 15})

    @event.listens_for(engine, "connect")
    def configure(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")

    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(connection)
    yield engine
    engine.dispose()


def live_setup(session, tmp_path, monkeypatch, *, responses=None, profile="ask", create_start=True):
    root = tmp_path / "project"
    root.mkdir()
    (root / "chapter.md").write_bytes(BEFORE.encode())
    revisions = []

    def revise(session, request, *, author_instruction=None, prepared_context=None):
        revisions.append(request)
        return AssistantReviseResponse(before=request.content, after=AFTER, summary="revision",
                                       model="fake", latency_ms=1, completion_tokens=3,
                                       assistant_session_id=request.assistant_session_id)

    provider = DeterministicProvider(responses=responses or [
        ChatResponse("", tool_calls=(
            ToolCall("revise", "file_revise", '{"path":"chapter.md","instruction":"Revise"}'),
            ToolCall("read", "fs_read", '{"path":"chapter.md"}'),
        )), ChatResponse("read the saved revision"),
    ])
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake"})
    monkeypatch.setattr(assistant_service, "revise_file_content", revise)
    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: provider)
    message = {"run_id": "live-run", "user_message": "Revise and read again", "intent": "chat.explain",
               "permission_profile": profile, "args": {"project_path": str(root), "file_path": "chapter.md"}}
    start = service.start_agent_user_message_run(session, agent_session_id="live-session", message=message) if create_start else None
    return start.run if start else None, message, root, provider, revisions


def lease():
    from app.domains.agent_runs.loop.external_chat import ExternalExecutionLease

    return ExternalExecutionLease(run_id="live-run", session_id="live-session", execution_epoch="live-epoch",
                                  host_generation="a" * 64)


