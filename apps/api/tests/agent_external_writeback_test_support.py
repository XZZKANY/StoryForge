from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs import service
from app.domains.agent_runs.fs import fs_read
from app.domains.agent_runs.fs.native_receipts import NativeWritebackIdentity
from app.domains.agent_runs.loop.checkpoint_store import StoryForgeCheckpointStore
from app.domains.agent_runs.loop.external_wait_state import WholeFileProposal
from app.domains.agent_runs.loop.external_writeback import publish_external_wait
from app.domains.agent_runs.loop.sdk_context import StoryForgeRuntimeContext
from app.domains.agent_runs.loop.types import ChatLoopOutcome
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent
from app.domains.agent_runs.permission import PermissionGate
from app.domains.agent_runs.tools import list_loop_tool_specs, tool_definition_from_spec
from app.domains.assistant.models import AssistantSession, AssistantToolCall
from app.platform.ai_sdk import ChatMessage, ChatResponse, MessageRole, ToolCall, ToolSpec
from app.platform.ai_sdk.providers import DeterministicProvider
from app.platform.ai_sdk.runtime import RuntimeCheckpoint, RuntimePhase, ToolCallingRuntime
from app.platform.ai_sdk.tools import RuntimeTool, RuntimeToolResult, ToolRegistry

BEFORE = "旧章\r\n"
AFTER = "新章 🌙\n"
WAIT_ID = "wait-one"


@dataclass
class Fixture:
    context: StoryForgeRuntimeContext
    checkpoint: RuntimeCheckpoint
    root: Path
    proposal: WholeFileProposal
    evidence: AssistantToolCall
    started: AgentRunEvent
    provider: DeterministicProvider
    registry: ToolRegistry
    calls: list[str]

    def publish(self):
        return publish_external_wait(self.context, self.checkpoint, proposal=self.proposal,
                                     raw_before=BEFORE.encode(), assistant_tool_call_id=self.evidence.id,
                                     execution_epoch="epoch-one", execution_id=self.started.id)


def fixture(session, tmp_path, *, profile="ask", confirmation=True):
    root = tmp_path / "project"
    root.mkdir()
    (root / "chapter.md").write_bytes(BEFORE.encode())
    (root / "other.md").write_text("unchanged", encoding="utf-8")
    run = service.create_or_resume_agent_run(session, public_id="external-run", session_id="session", goal="revise")
    assistant = AssistantSession(title="external", task_type="revision")
    session.add(assistant)
    session.flush()
    run.assistant_session_id = assistant.id
    run.permission_profile = profile
    run.current_step = "chat.loop"
    evidence = AssistantToolCall(session_id=assistant.id, tool_name="file.revise", status="running")
    session.add(evidence)
    session.commit()
    started = service.start_agent_execution(session, run)
    calls = []

    def unused(ctx, payload):
        raise AssertionError("domain handler must not execute")

    ctx = StoryForgeRuntimeContext(
        session=session, assistant_session_id=assistant.id, run=run, source={}, permission_gate=PermissionGate(),
        definitions={s.name: tool_definition_from_spec(s, unused) for s in list_loop_tool_specs()},
        execute_tool=lambda name, payload: unused(None, payload), on_trace=lambda trace: None,
        outcome=ChatLoopOutcome(answer=""),
        recovery_message={"args": {"project_path": str(root), "file_path": "chapter.md",
                                  "context_bundle": {"files": [{"path": "./chapter.md", "excerpt": "old"},
                                                               {"path": "other.md", "excerpt": "peer"}]}}},
    )
    messages = (ChatMessage(MessageRole.USER, "revise then read"),)
    StoryForgeCheckpointStore(ctx).save(RuntimeCheckpoint(run.public_id, "test", RuntimePhase.BEFORE_MODEL, messages))

    def propose(context, arguments):
        calls.append("propose")
        return RuntimeToolResult.deferred(WAIT_ID)

    def read(context, arguments):
        calls.append("read")
        return RuntimeToolResult.success(fs_read(str(root), arguments["path"]))

    registry = ToolRegistry([
        RuntimeTool(ToolSpec("file_revise", "Propose", {"type": "object"}), propose),
        RuntimeTool(ToolSpec("fs_read", "Read", {"type": "object"}), read),
    ])
    provider = DeterministicProvider(responses=[
        ChatResponse("", tool_calls=(ToolCall("write-call", "file_revise", '{"path":"chapter.md"}'),
                                     ToolCall("read-call", "fs_read", '{"path":"chapter.md"}'))),
        ChatResponse("checked"),
    ])
    result = ToolCallingRuntime(provider, registry).run(messages, model="test", run_id=run.public_id)
    return Fixture(ctx, result.checkpoint, root,
                   WholeFileProposal(id="patch-one", before=BEFORE.replace("\r\n", "\n"), after=AFTER,
                                     requires_confirmation=confirmation), evidence, started, provider, registry, calls)


def identity(wait):
    relative = wait.target.lower() if os.name == "nt" else wait.target

    def digest(value):
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()

    return NativeWritebackIdentity(relativePath=relative, operationId=digest([relative, wait.operation_key]),
                                   fingerprint=digest([relative, wait.operation_key, wait.source, wait.proposal.after]))


def ledger(wait, *, state="applied", outcome=True, current=AFTER):
    # Synthetic disk fixture; real Native writer/golden evidence lives in Rust/reader tests.
    directory = Path(wait.canonical_root) / ".storyforge/writeback-receipts"
    directory.mkdir(parents=True, exist_ok=True)
    bound = wait.binding()
    intent = {"schemaVersion": 1, "operationId": bound.identity.operation_id, "fingerprint": bound.identity.fingerprint,
              "relativePath": bound.identity.relative_path, "beforeHash": bound.before_hash,
              "afterHash": bound.after_hash, "checkpointTimestamp": 7}
    result = {"schemaVersion": 1, "operationId": bound.identity.operation_id, "fingerprint": bound.identity.fingerprint,
              "state": state, "detail": None}
    (directory / f"{bound.identity.operation_id}.intent.json").write_text(json.dumps(intent), encoding="utf-8")
    if outcome:
        (directory / f"{bound.identity.operation_id}.outcome.json").write_text(json.dumps(result), encoding="utf-8")
    (Path(wait.project_path) / wait.requested_path).write_bytes(current.encode())


def observed(engine, run_id):
    with Session(engine) as session:
        run = session.get(AgentRun, run_id)
        artifacts = list(session.scalars(select(AgentArtifact).where(AgentArtifact.run_id == run_id).order_by(AgentArtifact.id)))
        events = list(session.scalars(select(AgentRunEvent).where(AgentRunEvent.run_id == run_id).order_by(AgentRunEvent.sequence)))
        evidence = list(session.scalars(select(AssistantToolCall).where(AssistantToolCall.session_id == run.assistant_session_id)))
        return run.status, run.current_step, [a.payload for a in artifacts], [e.event_type for e in events], evidence[0].status
