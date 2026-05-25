from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.common.exceptions import InputError

from app.domains.books.models import Book, Scene
from app.domains.jobs.models import JobRun
from app.domains.model_runs.models import ModelRun
from app.domains.model_runs.schemas import ModelRunCreate, RunsJobRunRetryRead
from app.domains.prompt_packs.models import PromptPack
from app.domains.runtime_tools.service import list_runtime_tools
from app.domains.workspaces.models import Workspace


class ModelRunError(InputError):
    """模型运行日志引用对象不存在或作用域不一致。"""


def create_model_run(session: Session, payload: ModelRunCreate) -> ModelRun:
    _validate_references(session, payload)
    model_run = ModelRun(**payload.model_dump())
    session.add(model_run)
    session.commit()
    session.refresh(model_run)
    return model_run


def list_model_runs(
    session: Session,
    *,
    workspace_id: int | None = None,
    book_id: int | None = None,
    job_run_id: int | None = None,
) -> Sequence[ModelRun]:
    statement = select(ModelRun).order_by(ModelRun.id)
    if workspace_id is not None:
        statement = statement.where(ModelRun.workspace_id == workspace_id)
    if book_id is not None:
        statement = statement.where(ModelRun.book_id == book_id)
    if job_run_id is not None:
        statement = statement.where(ModelRun.job_run_id == job_run_id)
    return session.scalars(statement).all()


def get_runs_job_run(session: Session, *, job_run_id: int) -> dict[str, Any]:
    job = session.get(JobRun, job_run_id)
    if job is None:
        raise ModelRunError("任务不存在，无法读取 Runs 工作台任务状态。")
    progress = dict(job.progress or {})
    checkpoint = {
        key: progress[key]
        for key in ("thread_id", "current_node", "approval_status")
        if key in progress
    }
    model_runs = list_model_runs(session, job_run_id=job_run_id)
    return {
        "id": job.id,
        "job_type": job.job_type,
        "status": job.status,
        "progress": progress,
        "checkpoint": checkpoint or None,
        "model_runs": [
            {
                "id": model_run.id,
                "provider_name": model_run.provider_name,
                "model_name": model_run.model_name,
                "capability": model_run.capability,
                "status": model_run.status,
                "latency_ms": model_run.latency_ms,
                "token_usage": model_run.token_usage,
                "error_message": model_run.error_message,
            }
            for model_run in model_runs
        ],
        "runtime_diagnostics": _runtime_diagnostics(job, progress, model_runs),
        "error_message": job.error_message,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def _runtime_diagnostics(job: JobRun, progress: Mapping[str, object], model_runs: Sequence[ModelRun]) -> dict[str, Any]:
    """聚合运行时读侧摘要，避免页面自行拼装 runtime 事实。"""

    current_node = _first_text(progress, "current_node", "failed_node") or "unknown"
    thread_id = _first_text(progress, "thread_id")
    recoverable = _recoverable_from_progress(job, progress)
    failure_kind = _first_text(progress, "failure_kind", "error_code") or _failure_kind_from_error(job.error_message)
    lifecycle_status = _first_text(progress, "lifecycle_status") or _lifecycle_status_from_job(job.status, recoverable)
    lifecycle_message = _first_text(progress, "lifecycle_message") or job.error_message or f"任务状态：{job.status}"

    return {
        "workflow_session": {
            "session_id": _session_id(thread_id, job.id),
            "thread_id": thread_id,
            "job_run_id": str(job.id),
            "status": str(job.status),
            "current_node": current_node,
            "approval_status": _first_text(progress, "approval_status"),
            "last_heartbeat_ms": _optional_nonnegative_int(progress.get("last_heartbeat_ms")),
            "prompt_count": _optional_nonnegative_int(progress.get("prompt_count")) or 0,
        },
        "workflow_lifecycle": {
            "status": lifecycle_status,
            "current_node": current_node,
            "message": lifecycle_message,
            "failure_kind": failure_kind,
            "recoverable": recoverable,
        },
        "provider": _provider_summary(progress, model_runs),
        "model_usage": _model_usage_summary(model_runs),
        "runtime_tools": _runtime_tool_summaries(progress, model_runs, current_node),
    }


def _session_id(thread_id: str | None, job_run_id: int) -> str | None:
    if thread_id is None:
        return None
    return f"{thread_id}:{job_run_id}"


def _recoverable_from_progress(job: JobRun, progress: Mapping[str, object]) -> bool | None:
    value = progress.get("recoverable")
    if isinstance(value, bool):
        return value
    if job.status == "failed":
        return bool(_checkpoint_from_progress(progress))
    return None


def _failure_kind_from_error(error_message: str | None) -> str | None:
    if not error_message:
        return None
    normalized = error_message.lower()
    if "timeout" in normalized or "timed out" in normalized:
        return "provider_timeout"
    if "invalid" in normalized or "parse" in normalized:
        return "provider_invalid_response"
    return "unknown_runtime_error"


def _lifecycle_status_from_job(status: str, recoverable: bool | None) -> str:
    if status == "failed":
        return "recoverable_failed" if recoverable else "terminal_failed"
    if status == "running":
        return "graph_running"
    if status == "queued":
        return "queued"
    if status == "completed":
        return "completed"
    return status


def _provider_summary(progress: Mapping[str, object], model_runs: Sequence[ModelRun]) -> dict[str, object] | None:
    provider_execution = progress.get("provider_execution")
    if isinstance(provider_execution, Mapping):
        return {
            "provider_name": _text_or_default(provider_execution.get("provider_name"), "暂无 provider"),
            "model_name": _text_or_default(provider_execution.get("model_name"), "暂无模型"),
            "capability": _text_or_default(provider_execution.get("capability"), "unknown"),
            "status": _text_or_default(provider_execution.get("status"), "unknown"),
            "latency_ms": _optional_nonnegative_int(provider_execution.get("latency_ms")) or 0,
            "token_usage": _optional_nonnegative_int(provider_execution.get("token_usage")) or 0,
            "error_message": _optional_text(provider_execution.get("error_message")),
        }
    if not model_runs:
        return None
    latest = model_runs[-1]
    return {
        "provider_name": latest.provider_name,
        "model_name": latest.model_name,
        "capability": latest.capability,
        "status": latest.status,
        "latency_ms": latest.latency_ms,
        "token_usage": latest.token_usage,
        "error_message": latest.error_message,
    }


def _model_usage_summary(model_runs: Sequence[ModelRun]) -> dict[str, int]:
    return {
        "model_run_count": len(model_runs),
        "failed_model_run_count": sum(1 for model_run in model_runs if model_run.status == "failed"),
        "total_token_usage": sum(model_run.token_usage for model_run in model_runs),
        "max_latency_ms": max((model_run.latency_ms for model_run in model_runs), default=0),
    }


def _runtime_tool_summaries(
    progress: Mapping[str, object], model_runs: Sequence[ModelRun], current_node: str
) -> list[dict[str, object]]:
    explicit_tool_names = set(_string_list(progress.get("runtime_tool_names")))
    capabilities = {
        model_run.capability
        for model_run in model_runs
        if model_run.capability
    }
    provider_execution = progress.get("provider_execution")
    if isinstance(provider_execution, Mapping):
        capability = provider_execution.get("capability")
        if isinstance(capability, str) and capability:
            capabilities.add(capability)

    summaries: list[dict[str, object]] = []
    for tool in list_runtime_tools():
        workflow_nodes = list(tool.references.workflow_nodes)
        required_capabilities = list(tool.required_capabilities)
        is_explicit = tool.name in explicit_tool_names
        matches_node = current_node in workflow_nodes
        matches_capability = bool(capabilities.intersection(required_capabilities))
        if not (is_explicit or matches_node or matches_capability):
            continue
        summaries.append(
            {
                "name": tool.name,
                "domain": tool.domain,
                "required_capabilities": required_capabilities,
                "evidence_fields": list(tool.evidence_fields),
                "workflow_nodes": workflow_nodes,
            }
        )
    return summaries


def retry_runs_job_run(session: Session, *, job_run_id: int) -> RunsJobRunRetryRead:
    """基于失败 JobRun 的 checkpoint 创建恢复任务，不直接执行 workflow。"""

    job = session.get(JobRun, job_run_id)
    if job is None:
        raise ModelRunError("任务不存在，无法创建失败重试。")
    progress = dict(job.progress or {})
    checkpoint = _checkpoint_from_progress(progress)
    failed_node = _first_text(progress, "failed_node", "current_node")
    unavailable_reason = _retry_unavailable_reason(job, checkpoint, failed_node)
    if unavailable_reason is not None:
        return RunsJobRunRetryRead(
            can_retry=False,
            retry_job_run_id=None,
            source_job_run_id=job.id,
            recovery_node=failed_node,
            checkpoint=checkpoint or None,
            retry_status="未创建",
            unavailable_reason=unavailable_reason,
        )

    retry_job = JobRun(
        book_id=job.book_id,
        scene_id=job.scene_id,
        job_type=f"{job.job_type}_retry",
        status="queued",
        progress={
            "retry_of_job_run_id": job.id,
            "recovery_node": failed_node,
            "checkpoint": checkpoint,
            "source_error_message": job.error_message,
        },
    )
    session.add(retry_job)
    session.commit()
    session.refresh(retry_job)
    return RunsJobRunRetryRead(
        can_retry=True,
        retry_job_run_id=retry_job.id,
        source_job_run_id=job.id,
        recovery_node=failed_node,
        checkpoint=checkpoint,
        retry_status=retry_job.status,
        unavailable_reason=None,
    )


def record_runtime_model_run(
    session: Session,
    *,
    job_run_id: int,
    provider_name: str,
    model_name: str,
    capability: str,
    latency_ms: int,
    token_usage: int,
    input_summary: str,
    output_summary: str,
    workspace_id: int | None = None,
    book_id: int | None = None,
    scene_id: int | None = None,
    prompt_pack_id: int | None = None,
    payload: dict | None = None,
) -> ModelRun:
    return create_model_run(
        session,
        ModelRunCreate(
            workspace_id=workspace_id,
            book_id=book_id,
            scene_id=scene_id,
            job_run_id=job_run_id,
            prompt_pack_id=prompt_pack_id,
            provider_name=provider_name,
            model_name=model_name,
            capability=capability,
            status="completed",
            latency_ms=latency_ms,
            token_usage=token_usage,
            input_summary=input_summary,
            output_summary=output_summary,
            payload=payload or {},
        ),
    )


def record_failed_runtime_model_run(
    session: Session,
    *,
    job_run_id: int,
    provider_name: str,
    model_name: str,
    capability: str,
    input_summary: str,
    error_message: str,
    workspace_id: int | None = None,
    book_id: int | None = None,
    scene_id: int | None = None,
    prompt_pack_id: int | None = None,
    payload: dict | None = None,
) -> ModelRun:
    return create_model_run(
        session,
        ModelRunCreate(
            workspace_id=workspace_id,
            book_id=book_id,
            scene_id=scene_id,
            job_run_id=job_run_id,
            prompt_pack_id=prompt_pack_id,
            provider_name=provider_name,
            model_name=model_name,
            capability=capability,
            status="failed",
            latency_ms=0,
            token_usage=0,
            input_summary=input_summary,
            output_summary=None,
            error_message=error_message,
            payload=payload or {},
        ),
    )


def record_workflow_model_run_payload(session: Session, payload: Mapping[str, object]) -> ModelRun:
    """记录 workflow adapter 产出的 ModelRun payload，继续复用现有真表 helper。"""

    job_run_id = _require_positive_int(payload, "job_run_id")
    provider_name = _require_text(payload, "provider_name")
    model_name = _require_text(payload, "model_name")
    capability = _require_text(payload, "capability")
    input_summary = _require_text(payload, "input_summary")
    metadata = _payload_metadata(payload)
    status = _require_text(payload, "status")
    if status == "completed":
        return record_runtime_model_run(
            session,
            job_run_id=job_run_id,
            provider_name=provider_name,
            model_name=model_name,
            capability=capability,
            latency_ms=_require_nonnegative_int(payload, "latency_ms"),
            token_usage=_require_nonnegative_int(payload, "token_usage"),
            input_summary=input_summary,
            output_summary=_require_text(payload, "output_summary"),
            payload=metadata,
        )
    if status == "failed":
        return record_failed_runtime_model_run(
            session,
            job_run_id=job_run_id,
            provider_name=provider_name,
            model_name=model_name,
            capability=capability,
            input_summary=input_summary,
            error_message=_require_text(payload, "error_message"),
            payload=metadata,
        )
    raise ModelRunError("不支持的 workflow ModelRun 状态，无法记录模型运行日志。")


def _validate_references(session: Session, payload: ModelRunCreate) -> None:
    if payload.workspace_id is not None and session.get(Workspace, payload.workspace_id) is None:
        raise ModelRunError("工作区不存在，无法记录模型运行日志。")
    if payload.book_id is not None and session.get(Book, payload.book_id) is None:
        raise ModelRunError("作品不存在，无法记录模型运行日志。")
    if payload.scene_id is not None and session.get(Scene, payload.scene_id) is None:
        raise ModelRunError("场景不存在，无法记录模型运行日志。")
    if payload.job_run_id is not None and session.get(JobRun, payload.job_run_id) is None:
        raise ModelRunError("任务不存在，无法记录模型运行日志。")
    if payload.prompt_pack_id is not None and session.get(PromptPack, payload.prompt_pack_id) is None:
        raise ModelRunError("Prompt Pack 不存在，无法记录模型运行日志。")


def _checkpoint_from_progress(progress: Mapping[str, object]) -> dict[str, object]:
    return {
        key: progress[key]
        for key in ("thread_id", "current_node", "approval_status", "model_run_id")
        if key in progress
    }


def _first_text(payload: Mapping[str, object], *keys: str) -> str | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _optional_text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _text_or_default(value: object, default: str) -> str:
    return value if isinstance(value, str) and value else default


def _optional_nonnegative_int(value: object) -> int | None:
    if type(value) is int and value >= 0:
        return value
    return None


def _string_list(value: object) -> list[str]:
    if not isinstance(value, Sequence) or isinstance(value, str | bytes | bytearray):
        return []
    return [item for item in value if isinstance(item, str) and item]


def _retry_unavailable_reason(job: JobRun, checkpoint: Mapping[str, object], failed_node: str | None) -> str | None:
    if job.status != "failed":
        return "任务尚未失败，不能创建失败重试。"
    if not checkpoint:
        return "缺少 checkpoint，无法创建失败重试。"
    if failed_node is None:
        return "缺少失败节点，无法创建失败重试。"
    return None


def _require_positive_int(payload: Mapping[str, object], key: str) -> int:
    value = payload.get(key)
    if type(value) is not int or value <= 0:
        raise ModelRunError("workflow ModelRun payload 的 job_run_id 必须是已持久化 JobRun 的正整数 ID。")
    return value


def _require_nonnegative_int(payload: Mapping[str, object], key: str) -> int:
    value = payload.get(key)
    if type(value) is not int or value < 0:
        raise ModelRunError(f"workflow ModelRun payload 的 {key} 必须是非负整数。")
    return value


def _require_text(payload: Mapping[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or value == "":
        raise ModelRunError(f"workflow ModelRun payload 缺少 {key}。")
    return value


def _payload_metadata(payload: Mapping[str, object]) -> dict:
    metadata = payload.get("payload")
    return dict(metadata) if isinstance(metadata, Mapping) else {}

