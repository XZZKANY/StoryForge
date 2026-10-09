from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.common.performance import measured
from app.domains.agent_runs.event_types import (
    AGENT_ARTIFACT,
    AGENT_PLAN_CREATED,
    PERMISSION_REQUIRED,
    SUBAGENT_COMPLETED,
    SUBAGENT_STARTED,
    SYSTEM_JOB,
    TOOL_TRACE,
)
from app.domains.agent_runs.models import AgentRun, AgentRunEvent
from app.domains.agent_runs.permission import canonical_permission_profile
from app.domains.agent_runs.result_contracts import execution_result_payload
from app.domains.agent_runs.run_payloads import (
    book_run_id_from_result as _book_run_id_from_result,
)
from app.domains.agent_runs.run_payloads import (
    current_plan_step as _current_plan_step,
)
from app.domains.agent_runs.run_payloads import (
    optional_positive_int as _optional_positive_int,
)
from app.domains.agent_runs.runtime_recovery import (
    RUNTIME_PENDING_CALL_ARTIFACT_KIND,
    build_runtime_interruption_payload,
    build_tool_recovery_payload,
)
from app.domains.agent_runs.skill_catalog import agent_plan_payload as _agent_plan_payload
from app.domains.agent_runs.tools import list_agent_runtime_tool_specs
from app.domains.agent_runs.trace import AgentToolTrace

_TOOL_SPECS_BY_NAME = {spec.name: spec for spec in list_agent_runtime_tool_specs()}


class _AgentRunEventSink:
    """Adapter that lets AgentRuntime write to the existing AgentRun event store."""

    def __init__(self, session: Session, *, on_event: Callable[[AgentRunEvent], None] | None = None) -> None:
        self._session = session
        self._on_event = on_event
        self._execution_id: int | None = None

    def bind_execution(self, started: AgentRunEvent) -> None:
        self._execution_id = started.id

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

    def notify_external_wait(self, run: AgentRun) -> None:
        self._emit_latest_event(run, "agent_writeback_waiting")

    @measured("store.plan")
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
        from app.domains.agent_runs.service import record_agent_event, rollback_failed_settlement

        # 守卫式 status 写：与 complete_agent_run/fail_agent_run 对称（B1-001 家族第 4 个汇流点，UF-01）。
        # 这条 sink 在末轮产补丁的 post-loop 窗口执行，其间控制通道可能已从另一连接把 run 落成
        # stopped/failed；worker 用 expire_on_commit=False 下的 stale run（内存恒 running）无条件写
        # paused 会覆盖控制通道决定（last-writer-wins），把作者的停止复活成 reap 免疫 + 可 approve 的
        # paused。refresh 只供提前退出；条件 UPDATE 才能原子确认仍在 running，
        # 只有胜出者发 PERMISSION_REQUIRED，不能把已确认的停止复活为可操作提案。
        self._session.refresh(run)
        if run.status != "running":
            return
        agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
        proposed_patch = result.get("proposed_patch") if isinstance(result.get("proposed_patch"), dict) else None
        with rollback_failed_settlement(self._session):
            changed = self._session.execute(update(AgentRun).where(
                AgentRun.id == run.id, AgentRun.status == "running",
                AgentRun.execution_owner_event_id == self._execution_id if self._execution_id is not None else True,
            ).values(status="paused", current_step="permission.confirm").execution_options(synchronize_session=False))
            self._session.refresh(run)
            if changed.rowcount != 1:
                self._session.commit()
                return
            event = record_agent_event(
                self._session,
                run,
                event_type=PERMISSION_REQUIRED,
                actor="permission-gate",
                message="该步骤需要作者确认后才能继续。",
                payload={
                    "permission_profile": canonical_permission_profile(run.permission_profile),
                    **({"execution_id": self._execution_id} if self._execution_id is not None else {}),
                    "intent": result.get("intent"),
                    # 断线/超时后前端拉事件表重建终态（F10）时，permission_required 也是终态之一，
                    # 而 reconstructAgentResultFromEvents 把 assistant_session_id 当重建必要字段，
                    # 缺它则每轮轮询都返回 null → 已生成的待确认补丁永远回不到 UI。
                    "assistant_session_id": run.assistant_session_id,
                    "summary": agent_result.get("summary"),
                    "requires_user_confirmation": True,
                    **(execution_result_payload(result) if agent_result.get("execution_outcome") else {}),
                    "reason": reason,
                    "proposed_patch": proposed_patch,
                    "confirmation_action": agent_result.get("confirmation_action"),
                    "confirmation_kind": agent_result.get("confirmation_kind"),
                    "chapter_brief": agent_result.get("chapter_brief"),
                    "blocked_tool": (
                        (proposed_patch.get("created_by_tool") or "file.revise")
                        if proposed_patch
                        else result.get("intent")
                    ),
                },
            )
        self._emit(event)

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

        complete_agent_run(self._session, run, result=result, on_event=self._emit, expected_execution_id=self._execution_id)

    def fail(self, run: AgentRun, *, message: str, payload: dict[str, Any] | None = None) -> None:
        from app.domains.agent_runs.service import fail_agent_run

        fail_agent_run(self._session, run, message=message, payload=payload, on_event=self._emit,
                       expected_execution_id=self._execution_id)

    def record_runtime_progress(self, run: AgentRun, payload: dict[str, Any]) -> None:
        from app.domains.agent_runs.runtime_progress import record_runtime_progress

        self._emit(record_runtime_progress(self._session, run, payload))

    def runtime_interruption(self, run: AgentRun, *, boundary: str) -> dict[str, Any] | None:
        self._session.refresh(run)
        return build_runtime_interruption_payload(run, boundary=boundary)

    def record_runtime_pending_call(self, run: AgentRun, *, payload: dict[str, Any]) -> None:
        from app.domains.agent_runs.service import record_agent_artifact

        record_agent_artifact(
            self._session,
            run,
            kind=RUNTIME_PENDING_CALL_ARTIFACT_KIND,
            payload={
                **payload,
                "permission_profile": canonical_permission_profile(run.permission_profile),
            },
            requires_confirmation=False,
        )
        self._emit_latest_event(run, AGENT_ARTIFACT)


AgentRunEventSink = _AgentRunEventSink
