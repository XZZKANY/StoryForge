from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs.event_types import (
    AGENT_ARTIFACT,
    AGENT_PLAN_CREATED,
    AGENT_RUN_COMPLETED,
    AGENT_RUN_FAILED,
    PERMISSION_REQUIRED,
    SUBAGENT_COMPLETED,
    SUBAGENT_STARTED,
    SYSTEM_JOB,
    TOOL_TRACE,
)
from app.domains.agent_runs.models import AgentRun, AgentRunEvent
from app.domains.agent_runs.run_payloads import (
    _book_run_id_from_result,
    _current_plan_step,
    _optional_positive_int,
)
from app.domains.agent_runs.runtime_recovery import (
    RUNTIME_PENDING_CALL_ARTIFACT_KIND,
    build_runtime_interruption_payload,
    build_tool_recovery_payload,
)
from app.domains.agent_runs.skill_catalog import _agent_plan_payload
from app.domains.agent_runs.tooling import list_agent_runtime_tool_specs
from app.domains.agent_runs.trace import AgentToolTrace

_TOOL_SPECS_BY_NAME = {spec.name: spec for spec in list_agent_runtime_tool_specs()}


class _AgentRunEventSink:
    """Adapter that lets AgentRuntime write to the existing AgentRun event store."""

    def __init__(self, session: Session, *, on_event: Callable[[AgentRunEvent], None] | None = None) -> None:
        self._session = session
        self._on_event = on_event

    def _emit(self, event: AgentRunEvent) -> None:
        if self._on_event is not None:
            self._on_event(event)

    def _emit_latest_event(self, run: AgentRun, event_type: str) -> None:
        event = self._session.scalar(
            select(AgentRunEvent)
            .where(AgentRunEvent.run_id == run.id, AgentRunEvent.event_type == event_type)
            .order_by(AgentRunEvent.sequence.desc(), AgentRunEvent.id.desc())
            .limit(1)
        )
        if event is not None:
            self._emit(event)

    def record_plan(self, run: AgentRun, result: dict[str, Any]) -> None:
        from app.domains.agent_runs.service import record_agent_event

        plan = result.get("plan") if isinstance(result.get("plan"), list) else []
        run.root_plan = plan
        run.current_step = _current_plan_step(plan)
        run.assistant_session_id = _optional_positive_int(result.get("assistant_session_id"))
        run.book_run_id = _book_run_id_from_result(result) or run.book_run_id
        self._session.add(run)
        self._session.commit()
        self._session.refresh(run)
        self._emit(
            record_agent_event(
                self._session,
                run,
                event_type=AGENT_PLAN_CREATED,
                actor="root-agent",
                message="Root Agent 已创建执行计划。",
                payload=_agent_plan_payload(intent=result.get("intent"), goal=run.goal, scope=run.scope, plan=plan),
            )
        )

    def record_tool_trace(self, run: AgentRun, trace: AgentToolTrace, index: int) -> None:
        from app.domains.agent_runs.service import record_agent_event, record_subagent_run

        input_summary = trace.input_summary
        output_summary = trace.output_summary or {}
        if trace.tool_name.startswith("subagent."):
            role = trace.tool_name.removeprefix("subagent.")
            self._emit(
                record_agent_event(
                    self._session,
                    run,
                    event_type=SUBAGENT_STARTED,
                    actor="root-agent",
                    message=f"{role} 子代理开始执行。",
                    payload={"index": index, "role": role, "input_summary": input_summary},
                )
            )
            subagent = record_subagent_run(
                self._session,
                run,
                role=role,
                input_summary=input_summary,
                output_summary=output_summary,
                status=trace.status,
            )
            self._emit(
                record_agent_event(
                    self._session,
                    run,
                    event_type=SUBAGENT_COMPLETED,
                    actor=role,
                    message=f"{role} 子代理执行完成。",
                    payload={
                        "index": index,
                        "subagent_run_id": subagent.id,
                        "role": role,
                        "output_summary": output_summary,
                    },
                )
            )
        self._emit(
            record_agent_event(
                self._session,
                run,
                event_type=TOOL_TRACE,
                actor="tool-registry",
                message=f"工具 {trace.tool_name} 返回 {trace.status}。",
                payload={
                    "index": index,
                    "trace": trace.as_dict(),
                    "recovery": build_tool_recovery_payload(
                        trace,
                        index,
                        spec=_TOOL_SPECS_BY_NAME.get(trace.tool_name),
                    ),
                },
            )
        )

    def record_artifact(
        self,
        run: AgentRun,
        *,
        kind: str,
        payload: dict[str, Any],
        requires_confirmation: bool,
    ) -> None:
        from app.domains.agent_runs.service import record_agent_artifact

        record_agent_artifact(
            self._session,
            run,
            kind=kind,
            payload=payload,
            requires_confirmation=requires_confirmation,
        )
        self._emit_latest_event(run, AGENT_ARTIFACT)

    def record_permission_required(self, run: AgentRun, result: dict[str, Any], *, reason: str) -> None:
        from app.domains.agent_runs.service import record_agent_event

        agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
        proposed_patch = result.get("proposed_patch") if isinstance(result.get("proposed_patch"), dict) else None
        run.status = "paused"
        run.current_step = "permission.confirm"
        self._session.add(run)
        self._session.commit()
        self._session.refresh(run)
        self._emit(
            record_agent_event(
                self._session,
                run,
                event_type=PERMISSION_REQUIRED,
                actor="permission-gate",
                message="该步骤需要作者确认后才能继续。",
                payload={
                    "permission_profile": run.permission_profile,
                    "intent": result.get("intent"),
                    "reason": reason,
                    "proposed_patch": proposed_patch,
                    "confirmation_action": agent_result.get("confirmation_action"),
                    "blocked_tool": "file.revise" if proposed_patch else result.get("intent"),
                },
            )
        )

    def record_system_job(
        self,
        run: AgentRun,
        *,
        key: str,
        payload: dict[str, Any],
        artifact_kind: str | None = None,
        artifact_payload: dict[str, Any] | None = None,
    ) -> None:
        from app.domains.agent_runs.service import record_agent_artifact, record_agent_event

        if artifact_kind and artifact_payload is not None:
            record_agent_artifact(
                self._session,
                run,
                kind=artifact_kind,
                payload=artifact_payload,
                requires_confirmation=False,
            )
            self._emit_latest_event(run, AGENT_ARTIFACT)
        actor = str(payload.get("actor") or f"system-{key}-agent")
        message = str(payload.get("message") or f"隐藏系统任务 {key} 已完成。")
        self._emit(
            record_agent_event(
                self._session,
                run,
                event_type=SYSTEM_JOB,
                actor=actor,
                message=message,
                payload={item_key: item_value for item_key, item_value in payload.items() if item_key != "message"},
            )
        )

    def complete(self, run: AgentRun, result: dict[str, Any]) -> None:
        from app.domains.agent_runs.service import complete_agent_run

        complete_agent_run(self._session, run, result=result)
        self._emit_latest_event(run, AGENT_RUN_COMPLETED)

    def fail(self, run: AgentRun, *, message: str, payload: dict[str, Any] | None = None) -> None:
        from app.domains.agent_runs.service import fail_agent_run

        fail_agent_run(self._session, run, message=message, payload=payload)
        self._emit_latest_event(run, AGENT_RUN_FAILED)

    def runtime_interruption(self, run: AgentRun, *, boundary: str) -> dict[str, Any] | None:
        self._session.refresh(run)
        return build_runtime_interruption_payload(run, boundary=boundary)

    def record_runtime_pending_call(self, run: AgentRun, *, payload: dict[str, Any]) -> None:
        from app.domains.agent_runs.service import record_agent_artifact

        record_agent_artifact(
            self._session,
            run,
            kind=RUNTIME_PENDING_CALL_ARTIFACT_KIND,
            payload=payload,
            requires_confirmation=False,
        )
        self._emit_latest_event(run, AGENT_ARTIFACT)
