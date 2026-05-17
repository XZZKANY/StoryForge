from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from langgraph.types import Command

from storyforge_workflow import create_generation_graph, initial_generation_state
from storyforge_workflow.persistence import InMemoryWorkflowStore
from storyforge_workflow.runtime.checkpoints import RuntimeCheckpointStore
from storyforge_workflow.runtime.provider_execution import ProviderExecutionResult, simulate_provider_execution


@dataclass(frozen=True)
class WorkflowRuntimeResult:
    thread_id: str
    job_run_id: str
    status: str
    current_node: str
    provider_execution: ProviderExecutionResult


class WorkflowRuntime:
    """把生成图、provider 执行摘要与运行时检查点串起来的最小运行器。"""

    def __init__(
        self,
        *,
        audit_store: InMemoryWorkflowStore | None = None,
        checkpoint_store: RuntimeCheckpointStore | None = None,
    ) -> None:
        self.audit_store = audit_store or InMemoryWorkflowStore()
        self.checkpoint_store = checkpoint_store or RuntimeCheckpointStore()
        self.graph = create_generation_graph(store=self.audit_store)

    def start(self, *, thread_id: str, job_run_id: str, premise: str, user_intent: str, scene_packet: dict[str, Any]) -> WorkflowRuntimeResult:
        state = initial_generation_state(
            thread_id=thread_id,
            job_run_id=job_run_id,
            premise=premise,
            user_intent=user_intent,
            scene_packet=scene_packet,
        )
        provider_execution = simulate_provider_execution(
            capability="llm",
            provider_name="mock-provider",
            model_name="storyforge-writer",
            prompt_summary=f"{premise}::{scene_packet.get('scene_goal', '')}",
        )
        chunks = list(self.graph.stream(state, {"configurable": {"thread_id": thread_id}}))
        latest_state = self.graph.get_state({"configurable": {"thread_id": thread_id}}).values
        self.checkpoint_store.save_state(thread_id, latest_state)
        self.checkpoint_store.record(
            thread_id=thread_id,
            job_run_id=job_run_id,
            current_node=latest_state.get("current_node", "unknown"),
            summary=provider_execution.summary,
            approval_status=latest_state.get("approval_status", "pending"),
        )
        status = "interrupted" if chunks and "__interrupt__" in chunks[-1] else "completed"
        return WorkflowRuntimeResult(
            thread_id=thread_id,
            job_run_id=job_run_id,
            status=status,
            current_node=latest_state.get("current_node", "unknown"),
            provider_execution=provider_execution,
        )

    def resume(self, *, thread_id: str, job_run_id: str, decision: dict[str, Any]) -> WorkflowRuntimeResult:
        provider_execution = simulate_provider_execution(
            capability="llm",
            provider_name="mock-provider",
            model_name="storyforge-approval",
            prompt_summary=str(decision),
        )
        list(self.graph.stream(Command(resume=decision), {"configurable": {"thread_id": thread_id}}))
        latest_state = self.graph.get_state({"configurable": {"thread_id": thread_id}}).values
        self.checkpoint_store.save_state(thread_id, latest_state)
        self.checkpoint_store.record(
            thread_id=thread_id,
            job_run_id=job_run_id,
            current_node=latest_state.get("current_node", "unknown"),
            summary=provider_execution.summary,
            approval_status=latest_state.get("approval_status", "pending"),
        )
        return WorkflowRuntimeResult(
            thread_id=thread_id,
            job_run_id=job_run_id,
            status="completed",
            current_node=latest_state.get("current_node", "unknown"),
            provider_execution=provider_execution,
        )

