"""A stopped overlapping invocation cannot return a new actionable patch."""

import threading
from concurrent.futures import ThreadPoolExecutor

import test_agent_delivery_races as delivery_race_support
from agent_transport import parse_agent_sse
from sqlalchemy import event

from app.domains.agent_runs import service
from app.domains.assistant import service as assistant_service

engine = delivery_race_support.engine


def test_superseded_worker_drops_patch_when_stop_wins_before_permission_cas(
    client, monkeypatch, session_factory, engine, tmp_path
):
    old_at_cas, allow_old, new_in_model, allow_new = (threading.Event() for _ in range(4))
    calls = []
    lock = threading.Lock()
    paused_cas = False
    session_id, run_id = "superseded-patch-session", "superseded-patch-run"
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])

    def generate(*args, **kwargs):
        with lock:
            calls.append(True)
            number = len(calls)
        if number == 2:
            new_in_model.set()
            assert allow_new.wait(timeout=10)
        return {"content": f"林岚踏进港口。第{number}版。", "completion_tokens": 8, "latency_ms": 1}

    monkeypatch.setattr(assistant_service, "_call_llm_streamed", generate)

    def hold_old(connection, cursor, statement, parameters, context, executemany):
        nonlocal paused_cas
        if (
            not paused_cas
            and statement.startswith("UPDATE agent_runs SET status=")
            and "permission.confirm" in parameters
        ):
            paused_cas = True
            old_at_cas.set()
            assert allow_old.wait(timeout=10)

    def request():
        return parse_agent_sse(
            client.post(
                f"/api/ide/agent/sessions/{session_id}/stream",
                json={
                    "run_id": run_id,
                    "user_message": "精简这段",
                    "intent": "file.revise",
                    "permission_profile": "ask",
                    "args": {"file_path": str(tmp_path / "chapter.md"), "content": "林岚走进港口。"},
                },
            ).text
        )

    event.listen(engine, "before_cursor_execute", hold_old)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            old = pool.submit(request)
            try:
                assert old_at_cas.wait(timeout=5)
                newer = pool.submit(request)
                assert new_in_model.wait(timeout=5)
                with session_factory() as session:
                    stopped = service.handle_agent_control_message(
                        session, public_id=run_id, session_id=session_id, control_type="stop_run"
                    )
                    assert stopped.event.payload["run_status"] == "stopped"
                    assert stopped.event.payload["control_effect"] == "requested"
                allow_old.set()
                frames = old.result(timeout=5)
            finally:
                allow_old.set()
                allow_new.set()
            newer.result(timeout=5)
    finally:
        allow_old.set()
        allow_new.set()
        event.remove(engine, "before_cursor_execute", hold_old)
    assert not any(f["type"] == "permission_required" for f in frames)
    assert client.get(f"/api/agent-runs/{run_id}").json()["status"] == "stopped"
    assert frames[-1].get("proposed_patch") is None
    assert frames[-1].get("agent_result", {}).get("requires_user_confirmation") is not True
