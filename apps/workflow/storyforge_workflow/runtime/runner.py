from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from storyforge_workflow import create_generation_graph, initial_generation_state
from storyforge_workflow.persistence import InMemoryWorkflowStore
from storyforge_workflow.runtime.checkpoints import ModelRunPayload, ModelRunSink, RuntimeCheckpointStore
from storyforge_workflow.runtime.lifecycle import (
    InMemoryWorkflowLifecycleStore,
    WorkflowFailureKind,
    WorkflowLifecycleStatus,
)
from storyforge_workflow.runtime.provider_execution import ProviderExecutionResult, execute_provider_text
from storyforge_workflow.runtime.session import InMemoryWorkflowSessionStore


@dataclass(frozen=True)
class WorkflowRuntimeResult:
    thread_id: str
    job_run_id: str
    status: str
    current_node: str
    provider_execution: ProviderExecutionResult | None


class WorkflowRuntime:
    """把生成图、provider 执行摘要与运行时检查点串起来的最小运行器。"""

    def __init__(
        self,
        *,
        audit_store: InMemoryWorkflowStore | None = None,
        checkpoint_store: RuntimeCheckpointStore | None = None,
        model_run_sink: ModelRunSink | None = None,
        lifecycle_store: InMemoryWorkflowLifecycleStore | None = None,
        session_store: InMemoryWorkflowSessionStore | None = None,
    ) -> None:
        self.audit_store = audit_store or InMemoryWorkflowStore()
        self.checkpoint_store = checkpoint_store or RuntimeCheckpointStore()
        self.model_run_sink = model_run_sink
        self.lifecycle_store = lifecycle_store or InMemoryWorkflowLifecycleStore()
        self.session_store = session_store or InMemoryWorkflowSessionStore()
        self.graph = create_generation_graph(store=self.audit_store, checkpointer=InMemorySaver())

    def start(self, *, thread_id: str, job_run_id: str, premise: str, user_intent: str, scene_packet: dict[str, Any]) -> WorkflowRuntimeResult:
        session = self.session_store.create(
            session_id=_session_id(thread_id, job_run_id),
            thread_id=thread_id,
            job_run_id=job_run_id,
            status=WorkflowLifecycleStatus.QUEUED,
            current_node="runtime_start",
        )
        self.lifecycle_store.record(
            thread_id=thread_id,
            job_run_id=job_run_id,
            status=WorkflowLifecycleStatus.QUEUED,
            current_node="runtime_start",
            message="workflow 运行已排队。",
        )
        state = initial_generation_state(
            thread_id=thread_id,
            job_run_id=job_run_id,
            premise=premise,
            user_intent=user_intent,
            scene_packet=scene_packet,
        )
        prompt_summary = f"{premise}::{scene_packet.get('scene_goal', '')}"
        self.session_store.update_status(
            session.session_id,
            status=WorkflowLifecycleStatus.PROVIDER_RUNNING,
            current_node="provider_execution",
        )
        self.session_store.append_prompt(
            session.session_id,
            node_name="provider_execution",
            prompt_summary=prompt_summary,
            model_name=None,
        )
        self.lifecycle_store.record(
            thread_id=thread_id,
            job_run_id=job_run_id,
            status=WorkflowLifecycleStatus.PROVIDER_RUNNING,
            current_node="provider_execution",
            message="provider 文本生成调用中。",
        )
        try:
            provider_execution = execute_provider_text(
                capability="llm",
                prompt_summary=prompt_summary,
            )
        except Exception as exc:
            return self._record_provider_failure(
                thread_id=thread_id,
                job_run_id=job_run_id,
                state=state,
                prompt_summary=prompt_summary,
                error=exc,
            )
        self.session_store.append_prompt(
            session.session_id,
            node_name="provider_execution",
            prompt_summary=prompt_summary,
            model_name=provider_execution.model_name,
        )
        model_run = self.checkpoint_store.record_model_run(
            thread_id=thread_id,
            job_run_id=job_run_id,
            provider_name=provider_execution.provider_name,
            model_name=provider_execution.model_name,
            capability=provider_execution.capability,
            latency_ms=provider_execution.latency_ms,
            token_usage=provider_execution.token_usage,
            input_summary=prompt_summary,
            output_summary=provider_execution.summary,
        )
        persisted_model_run_id = self._emit_model_run_payload(model_run)
        state["model_run_id"] = persisted_model_run_id if persisted_model_run_id is not None else model_run.model_run_id
        self.session_store.update_status(
            session.session_id,
            status=WorkflowLifecycleStatus.GRAPH_RUNNING,
            current_node="book_director",
        )
        self.lifecycle_store.record(
            thread_id=thread_id,
            job_run_id=job_run_id,
            status=WorkflowLifecycleStatus.GRAPH_RUNNING,
            current_node="book_director",
            message="LangGraph 生成图执行中。",
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
        lifecycle_status = WorkflowLifecycleStatus.APPROVAL_WAITING if status == "interrupted" else WorkflowLifecycleStatus.COMPLETED
        lifecycle_message = "等待人工审批。" if status == "interrupted" else "workflow 运行完成。"
        current_node = latest_state.get("current_node", "unknown")
        self.session_store.update_status(
            session.session_id,
            status=lifecycle_status,
            current_node=current_node,
        )
        self.session_store.heartbeat(session.session_id)
        self.lifecycle_store.record(
            thread_id=thread_id,
            job_run_id=job_run_id,
            status=lifecycle_status,
            current_node=current_node,
            message=lifecycle_message,
        )
        return WorkflowRuntimeResult(
            thread_id=thread_id,
            job_run_id=job_run_id,
            status=status,
            current_node=current_node,
            provider_execution=provider_execution,
        )

    def _record_provider_failure(
        self,
        *,
        thread_id: str,
        job_run_id: str,
        state: dict[str, Any],
        prompt_summary: str,
        error: Exception,
    ) -> WorkflowRuntimeResult:
        model_run = self.checkpoint_store.record_model_run(
            thread_id=thread_id,
            job_run_id=job_run_id,
            provider_name="openai-compatible",
            model_name="storyforge-writer",
            capability="llm",
            latency_ms=0,
            token_usage=0,
            input_summary=prompt_summary,
            output_summary="",
            status="failed",
            error_message=str(error),
        )
        persisted_model_run_id = self._emit_model_run_payload(model_run)
        state.update(
            {
                "model_run_id": persisted_model_run_id if persisted_model_run_id is not None else model_run.model_run_id,
                "current_node": "provider_execution",
                "error_code": "provider_execution_failed",
            }
        )
        self.checkpoint_store.save_state(thread_id, state)
        self.checkpoint_store.record(
            thread_id=thread_id,
            job_run_id=job_run_id,
            current_node="provider_execution",
            summary=f"provider 调用失败：{error}",
            approval_status="failed",
        )
        failure_kind = _provider_failure_kind(error)
        self.lifecycle_store.record_failure(
            thread_id=thread_id,
            job_run_id=job_run_id,
            current_node="provider_execution",
            message=str(error),
            failure_kind=failure_kind,
            recoverable=True,
        )
        session = self.session_store.get(_session_id(thread_id, job_run_id))
        if session is not None:
            self.session_store.update_status(
                session.session_id,
                status=WorkflowLifecycleStatus.RECOVERABLE_FAILED,
                current_node="provider_execution",
            )
            self.session_store.heartbeat(session.session_id)
        return WorkflowRuntimeResult(
            thread_id=thread_id,
            job_run_id=job_run_id,
            status="failed",
            current_node="provider_execution",
            provider_execution=None,
        )

    def resume(self, *, thread_id: str, job_run_id: str, decision: dict[str, Any]) -> WorkflowRuntimeResult:
        session = self.session_store.get(_session_id(thread_id, job_run_id))
        if session is None:
            session = self.session_store.create(
                session_id=_session_id(thread_id, job_run_id),
                thread_id=thread_id,
                job_run_id=job_run_id,
                status=WorkflowLifecycleStatus.RESUMING,
                current_node="human_approval",
            )
        else:
            session = self.session_store.update_status(
                session.session_id,
                status=WorkflowLifecycleStatus.RESUMING,
                current_node="human_approval",
            )
        self.lifecycle_store.record(
            thread_id=thread_id,
            job_run_id=job_run_id,
            status=WorkflowLifecycleStatus.RESUMING,
            current_node="human_approval",
            message="workflow 从人工审批点恢复。",
        )
        prompt_summary = str(decision)
        self.session_store.append_prompt(
            session.session_id,
            node_name="human_approval",
            prompt_summary=prompt_summary,
            model_name=None,
        )
        provider_execution = execute_provider_text(
            capability="llm",
            prompt_summary=prompt_summary,
        )
        self.session_store.append_prompt(
            session.session_id,
            node_name="human_approval",
            prompt_summary=prompt_summary,
            model_name=provider_execution.model_name,
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
        current_node = latest_state.get("current_node", "unknown")
        self.session_store.update_status(
            session.session_id,
            status=WorkflowLifecycleStatus.COMPLETED,
            current_node=current_node,
        )
        self.session_store.heartbeat(session.session_id)
        self.lifecycle_store.record(
            thread_id=thread_id,
            job_run_id=job_run_id,
            status=WorkflowLifecycleStatus.COMPLETED,
            current_node=current_node,
            message="workflow 恢复执行完成。",
        )
        return WorkflowRuntimeResult(
            thread_id=thread_id,
            job_run_id=job_run_id,
            status="completed",
            current_node=current_node,
            provider_execution=provider_execution,
        )

    def _emit_model_run_payload(self, model_run: Any) -> int | None:
        if self.model_run_sink is None:
            return None
        return self.model_run_sink.record(
            ModelRunPayload(
                thread_id=model_run.thread_id,
                job_run_id=model_run.job_run_id,
                provider_name=model_run.provider_name,
                model_name=model_run.model_name,
                capability=model_run.capability,
                latency_ms=model_run.latency_ms,
                token_usage=model_run.token_usage,
                input_summary=model_run.input_summary,
                output_summary=model_run.output_summary,
                status=model_run.status,
                error_message=model_run.error_message,
            )
        )


def _session_id(thread_id: str, job_run_id: str) -> str:
    """生成稳定 session_id，保持同一 thread/job 的 start 与 resume 可关联。"""

    return f"{thread_id}:{job_run_id}"


def _provider_failure_kind(error: Exception) -> WorkflowFailureKind:
    """把第一阶段可识别 provider 异常映射为 lifecycle 失败分类。"""

    message = str(error).lower()
    if "timeout" in message or "timed out" in message:
        return WorkflowFailureKind.PROVIDER_TIMEOUT
    if "invalid" in message or "parse" in message:
        return WorkflowFailureKind.PROVIDER_INVALID_RESPONSE
    return WorkflowFailureKind.UNKNOWN_RUNTIME_ERROR

