"""Opt-in real Native writer -> API receipt -> production chat, no GUI claim."""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
from agent_external_chat_test_support import engine as engine
from agent_external_chat_test_support import lease, live_setup
from agent_external_writeback_test_support import AFTER, BEFORE
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs import service
from app.domains.agent_runs.fs.native_receipts import NativeWritebackIdentity
from app.domains.agent_runs.loop.external_chat import external_control_context
from app.domains.agent_runs.loop.external_wait_lifecycle import claim_external_execution
from app.domains.agent_runs.loop.external_wait_store import read_external_wait
from app.domains.agent_runs.loop.external_writeback import prepare_external_writeback, reconcile_external_writeback
from app.domains.agent_runs.models import AgentRunEvent
from app.platform.ai_sdk import MessageRole


def native_bridge(tmp_path, wait, mode):
    binary = Path(os.environ["STORYFORGE_NATIVE_RECEIPT_TEST_BINARY"]).resolve(strict=True)
    allowed = Path(__file__).resolve().parents[3] / "apps/desktop/src-tauri/target/debug/deps"
    assert binary.is_file() and binary.is_relative_to(allowed.resolve(strict=True))
    fixture_path = tmp_path / f"native-{mode}.json"
    fixture_path.write_bytes(json.dumps({
        "root": wait.project_path, "mode": mode, "rawBefore": wait.raw_before,
        "request": {"operationKey": wait.operation_key, "source": wait.source,
                    "path": str(Path(wait.project_path) / wait.requested_path), "content": wait.proposal.after},
    }, ensure_ascii=False).encode())
    env = {**os.environ, "STORYFORGE_EXTERNAL_CHAT_NATIVE_FIXTURE": str(fixture_path)}
    result = subprocess.run([str(binary), "--ignored", "--exact", "external_chat_bridge_tests::native_receipt_bridge"],
                            env=env, capture_output=True, timeout=30)
    assert result.returncode == 0, "Native fixture command failed; inspect the captured fixture and runner output"
    return json.loads(fixture_path.with_suffix(".output.json").read_bytes())


@pytest.mark.skipif(not os.environ.get("STORYFORGE_NATIVE_RECEIPT_TEST_BINARY"), reason="explicit compiled Native fixture required")
def test_real_native_receipt_resumes_production_same_run_and_reads_actual_disk(engine, tmp_path, monkeypatch):
    with Session(engine) as session:
        run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch)
        service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                               message=message, external_lease=lease())
        current = read_external_wait(session, run)
        native_identity = NativeWritebackIdentity.model_validate(native_bridge(tmp_path, current.wait, "describe"))
        assert (root / "chapter.md").read_bytes() == BEFORE.encode()
        assert not (root / ".storyforge/writeback-receipts").exists()
        context = external_control_context(session, run)
        current = prepare_external_writeback(context, wait_id=current.wait.wait_id, expected_revision=current.wait.revision,
                                             identity=native_identity, decision="approve", permission_profile="ask")
        actual_receipt = native_bridge(tmp_path, current.wait, "apply")
        assert actual_receipt["state"] == "applied" and actual_receipt["receiptPersisted"] is True
        assert (root / "chapter.md").read_bytes() == AFTER.encode()
        current = reconcile_external_writeback(context, wait_id=current.wait.wait_id, expected_revision=current.wait.revision)
        assert current.wait.feedback_consumed and current.wait.historical_applied
        # Explicit internal fixture claim: no Desktop version/audit/GUI acceptance inferred.
        claim_external_execution(session, run, wait_id=current.wait.wait_id, expected_revision=current.wait.revision,
                                 execution_epoch=lease().execution_epoch, delivery_complete=True)
        owner = session.scalar(select(AgentRunEvent).where(AgentRunEvent.event_type == "agent_execution_started")
                               .order_by(AgentRunEvent.sequence.desc()).limit(1))
        result = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                                       message=message, external_lease=lease(), started_event=owner)
        assert result["run_id"] == "live-run" and run.status == "completed"
        assert len(provider.requests) == 2 and len(revisions) == 1
        read = next(m for m in provider.requests[-1].messages if m.role is MessageRole.TOOL and m.tool_call_id == "read")
        assert json.loads(read.content)["content"] == (root / "chapter.md").read_bytes().decode() == AFTER
