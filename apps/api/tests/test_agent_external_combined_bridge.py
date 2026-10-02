"""Opt-in combined HTTP API / real Native / mounted Desktop, no paid provider or GUI."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import socket
import subprocess
import time
from pathlib import Path
from threading import Thread

import pytest
import uvicorn
from agent_external_chat_test_support import engine as engine
from agent_external_chat_test_support import live_setup
from agent_external_writeback_test_support import AFTER, BEFORE
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.config import get_settings
from app.db.session import get_session
from app.domains.agent_runs import external_admission, host_lifecycle, host_lifecycle_router
from app.domains.agent_runs.fs.delivery_audit import inspect_delivery_audit
from app.domains.agent_runs.loop.checkpoint_store import latest_checkpoint_artifact
from app.domains.agent_runs.loop.external_wait_state import decode_wait
from app.domains.agent_runs.models import AgentRunEvent
from app.domains.agent_runs.service_store import get_agent_run
from app.main import app
from app.platform.ai_sdk import MessageRole


@pytest.mark.skipif(not os.getenv("STORYFORGE_RUN_EXTERNAL_COMBINED"), reason="explicit compiled Native/Node integration required")
@pytest.mark.parametrize(("profile", "scenario"), [
    ("ask", "normal"), ("auto", "normal"), ("full", "normal"),
    ("ask", "native_ack_lost"), ("ask", "audit_unavailable"),
    ("ask", "pause_after_native"), ("ask", "stop_after_native"),
    ("ask", "buffer_changed"), ("ask", "disk_changed_before_native"),
    ("ask", "snapshot_unavailable"), ("ask", "branch_unavailable"), ("ask", "reject"),
    ("ask", "outcome_missing_after_write"), ("ask", "disk_changed_after_write"),
    ("ask", "manual_remount"), ("ask", "close_during_audit"), ("ask", "cold_audit_repair"),
])
def test_combined_api_native_and_mounted_coordinator(engine, tmp_path, monkeypatch, profile, scenario):
    state = host_lifecycle.HostLifecycle()
    monkeypatch.setattr(host_lifecycle, "HOST_LIFECYCLE", state)
    monkeypatch.setattr(host_lifecycle_router, "HOST_LIFECYCLE", state)
    repo = Path(__file__).resolve().parents[3]
    binary = Path(os.environ["STORYFORGE_NATIVE_RECEIPT_TEST_BINARY"]).resolve(strict=True)
    assert binary.is_file() and binary.is_relative_to((repo / "apps/desktop/src-tauri/target/debug/deps").resolve())
    node = shutil.which("node")
    assert node is not None, "an installed Node runtime is required"
    frontend = repo / "apps/desktop/frontend"
    runner = frontend / "node_modules/vitest/vitest.mjs"
    assert runner.is_file()
    with Session(engine) as session:
        _, _, project, provider, revisions = live_setup(session, tmp_path, monkeypatch, profile=profile, create_start=False)
    data_root = tmp_path / "shadow-data"
    data_root.mkdir()
    # Synthetic capability belongs only to this isolated test. Production release remains false.
    generation = "a" * 64
    monkeypatch.setattr(external_admission, "RELEASE_GATE_PASSED", True)
    monkeypatch.setenv("STORYFORGE_MANAGED_HOST_GENERATION", generation)
    monkeypatch.setenv("STORYFORGE_EXTERNAL_WRITEBACK_ENABLED", "1")
    monkeypatch.setattr(get_settings(), "storyforge_api_key", "external-combined-fixture")

    def scoped_session():
        with Session(engine, expire_on_commit=False) as session:
            yield session

    old_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_session] = scoped_session
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, lifespan="off", log_level="error", access_log=False, timeout_graceful_shutdown=2))
    # Explicit Windows asyncio loop; this environment's uvicorn auto loop imports uvloop.
    thread = Thread(target=lambda: asyncio.run(server.serve(sockets=[listener])), daemon=True)
    thread.start()
    fixture = tmp_path / "combined.json"
    fixture.write_bytes(json.dumps({
        "project": str(project), "before": BEFORE, "after": AFTER, "nativeBinary": str(binary),
        "dataRoot": str(data_root), "profile": profile, "scenario": scenario,
        "config": {"baseUrl": f"http://127.0.0.1:{port}", "apiKey": "external-combined-fixture",
                   "managedHostGeneration": generation, "executionProtocols": ["external_writeback_v1"]},
    }, ensure_ascii=False).encode())
    try:
        deadline = time.monotonic() + 5
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert server.started, "isolated HTTP server failed to start"
        result = subprocess.run([node, str(runner), "run", "tests/agent-external-combined.test.tsx", "--pool=threads", "--maxWorkers=1"],
                                cwd=frontend, capture_output=True, timeout=120,
                                env={**os.environ, "STORYFORGE_EXTERNAL_COMBINED_FIXTURE": str(fixture)})
        (tmp_path / "desktop-runner.log").write_bytes(result.stdout + result.stderr)
        assert result.returncode == 0, result.stdout.decode(errors="replace") + result.stderr.decode(errors="replace")
        with Session(engine) as session:
            run = get_agent_run(session, "live-run")
            artifact = latest_checkpoint_artifact(session, run)
            assert artifact is not None
            wait = decode_wait(artifact.payload, run)
            if scenario in {"outcome_missing_after_write", "disk_changed_after_write"}:
                missing = scenario == "outcome_missing_after_write"
                assert run.status == "paused" and wait.stage == "reconciliation"
                assert not wait.feedback_consumed and not wait.delivery_complete
                assert wait.historical_applied is not missing
                assert wait.observation.state == ("outcome_unknown" if missing else "applied")
                assert wait.observation.current == ("after" if missing else "diverged")
                assert len(provider.requests) == len(revisions) == 1
                assert session.query(AgentRunEvent).filter_by(run_id=run.id, event_type="agent_execution_started").count() == 1
                assert (project / "chapter.md").read_bytes() == (AFTER if missing else AFTER + "外部改动\n").encode()
                assert len(list((project / ".storyforge/writeback-receipts").glob("*.intent.json"))) == 1
                assert len(list((project / ".storyforge/writeback-receipts").glob("*.outcome.json"))) == (0 if missing else 1)
                assert len(list((project / ".storyforge/author-loop").glob("*.md"))) == 1
                return
            if scenario in {"buffer_changed", "disk_changed_before_native", "snapshot_unavailable", "branch_unavailable"}:
                assert run.status == "paused" and not wait.feedback_consumed and not wait.historical_applied
                assert wait.delivery_complete is False
                assert wait.stage == ("await_authorization" if scenario == "buffer_changed" else "reconciliation")
                if scenario != "buffer_changed":
                    assert wait.observation.state == "missing"
                assert len(provider.requests) == len(revisions) == 1
                assert session.query(AgentRunEvent).filter_by(run_id=run.id, event_type="agent_execution_started").count() == 1
                expected = BEFORE + "外部改动\n" if scenario == "disk_changed_before_native" else BEFORE
                assert (project / "chapter.md").read_bytes() == expected.encode()
                assert not list((project / ".storyforge/writeback-receipts").glob("*.intent.json"))
                assert not list((project / ".storyforge/writeback-receipts").glob("*.outcome.json"))
                assert not list((project / ".storyforge/author-loop").glob("*.md"))
                return
            if scenario in {"pause_after_native", "stop_after_native", "close_during_audit"}:
                assert run.status == ("stopped" if scenario == "stop_after_native" else "paused")
                assert (wait.execution_epoch is None or scenario == "close_during_audit") and wait.feedback_consumed and wait.historical_applied
                assert wait.delivery_complete is False and inspect_delivery_audit(wait.binding())
                assert session.query(AgentRunEvent).filter_by(run_id=run.id, event_type="agent_execution_started").count() == 1
                assert len(provider.requests) == len(revisions) == 1
                assert not any(message.role is MessageRole.TOOL and message.tool_call_id == "read"
                               for request in provider.requests for message in request.messages)
                assert (project / "chapter.md").read_bytes() == AFTER.encode()
                assert len(list((project / ".storyforge/writeback-receipts").glob("*.intent.json"))) == 1
                assert len(list((project / ".storyforge/author-loop").glob("*.md"))) == 1
                return
            assert run.status == "completed"
            assert session.scalar(select(AgentRunEvent).where(AgentRunEvent.run_id == run.id,
                                                             AgentRunEvent.event_type == "agent_run_completed")) is not None
            assert session.query(AgentRunEvent).filter_by(run_id=run.id, event_type="agent_execution_started").count() == 2
            if scenario == "reject":
                assert wait.decision == "reject" and wait.feedback_consumed and not wait.historical_applied
                assert len(provider.requests) == 2 and len(revisions) == 1
                feedback = next(message for message in provider.requests[-1].messages
                                if message.role is MessageRole.TOOL and message.tool_call_id == "revise")
                assert json.loads(feedback.content) == {"error": "作者拒绝了这份修订，文件未写回。"}
                read = next(message for message in provider.requests[-1].messages
                            if message.role is MessageRole.TOOL and message.tool_call_id == "read")
                assert json.loads(read.content)["content"] == BEFORE.replace("\r\n", "\n").replace("\r", "\n")
                assert (project / "chapter.md").read_bytes() == BEFORE.encode()
                assert not list((project / ".storyforge/writeback-receipts").glob("*.intent.json"))
                assert not list((project / ".storyforge/author-loop").glob("*.md"))
                return
            assert wait.feedback_consumed and wait.historical_applied and wait.delivery_complete
            assert inspect_delivery_audit(wait.binding())
            assert len(provider.requests) == 2 and len(revisions) == 1
            read = next(message for message in provider.requests[-1].messages
                        if message.role is MessageRole.TOOL and message.tool_call_id == "read")
            assert json.loads(read.content)["content"] == (project / "chapter.md").read_bytes().decode() == AFTER
            assert len(list((project / ".storyforge/writeback-receipts").glob("*.intent.json"))) == 1
            assert len(list((project / ".storyforge/writeback-receipts").glob("*.outcome.json"))) == 1
            assert len(list((project / ".storyforge/author-loop").glob("*.md"))) == 1
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        listener.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)
        assert not thread.is_alive(), "isolated test HTTP server did not stop"
