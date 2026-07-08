from __future__ import annotations

from collections.abc import Mapping

from sqlalchemy.orm import Session

from app.common.exceptions import InputError
from app.common.redaction import redact_sensitive, redact_sensitive_text
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book, Chapter, Scene
from app.domains.jobs.models import JobRun
from app.domains.model_runs.models import ModelRun
from app.domains.model_runs.schemas import ModelRunCreate
from app.domains.prompt_packs.models import PromptPack
from app.domains.workspaces.models import Workspace


class ModelRunError(InputError):
    """模型运行日志引用对象不存在或作用域不一致。"""


def create_model_run(session: Session, payload: ModelRunCreate) -> ModelRun:
    _validate_references(session, payload)
    run_data = payload.model_dump()
    for key in ("input_summary", "output_summary", "error_message"):
        value = run_data.get(key)
        if isinstance(value, str):
            run_data[key] = redact_sensitive_text(value)
    run_data["payload"] = redact_sensitive(run_data.get("payload", {}))
    model_run = ModelRun(**run_data)
    session.add(model_run)
    session.commit()
    session.refresh(model_run)
    return model_run


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
    book_run_id: int | None = None,
    chapter_id: int | None = None,
    prompt_pack_id: int | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cost_estimate: float = 0.0,
    finish_reason: str | None = None,
    retry_count: int = 0,
    repair_count: int = 0,
    prompt_template_version: str | None = None,
    prompt_hash: str | None = None,
    payload: dict | None = None,
) -> ModelRun:
    return create_model_run(
        session,
        ModelRunCreate(
            workspace_id=workspace_id,
            book_id=book_id,
            book_run_id=book_run_id,
            chapter_id=chapter_id,
            scene_id=scene_id,
            job_run_id=job_run_id,
            prompt_pack_id=prompt_pack_id,
            provider_name=provider_name,
            model_name=model_name,
            capability=capability,
            status="completed",
            latency_ms=latency_ms,
            token_usage=token_usage,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_estimate=cost_estimate,
            finish_reason=finish_reason,
            retry_count=retry_count,
            repair_count=repair_count,
            prompt_template_version=prompt_template_version,
            prompt_hash=prompt_hash,
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
    book_run_id: int | None = None,
    chapter_id: int | None = None,
    prompt_pack_id: int | None = None,
    error_kind: str | None = None,
    retry_count: int = 0,
    repair_count: int = 0,
    prompt_template_version: str | None = None,
    prompt_hash: str | None = None,
    payload: dict | None = None,
) -> ModelRun:
    return create_model_run(
        session,
        ModelRunCreate(
            workspace_id=workspace_id,
            book_id=book_id,
            book_run_id=book_run_id,
            chapter_id=chapter_id,
            scene_id=scene_id,
            job_run_id=job_run_id,
            prompt_pack_id=prompt_pack_id,
            provider_name=provider_name,
            model_name=model_name,
            capability=capability,
            status="failed",
            latency_ms=0,
            token_usage=0,
            error_kind=error_kind,
            retry_count=retry_count,
            repair_count=repair_count,
            prompt_template_version=prompt_template_version,
            prompt_hash=prompt_hash,
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
    input_tokens = _optional_nonnegative_int(metadata.get("prompt_tokens")) or _optional_nonnegative_int(metadata.get("input_tokens")) or 0
    output_tokens = _optional_nonnegative_int(metadata.get("completion_tokens")) or _optional_nonnegative_int(metadata.get("output_tokens")) or 0
    cost_estimate = _optional_nonnegative_float(metadata.get("cost_estimate"))
    error_kind = _optional_text(metadata.get("error_kind"))
    retry_after_seconds = _optional_nonnegative_int(metadata.get("retry_after_seconds"))
    if retry_after_seconds is not None:
        metadata["retry_after_seconds"] = retry_after_seconds
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
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_estimate=cost_estimate,
            finish_reason=_optional_text(metadata.get("finish_reason")),
            retry_count=_optional_nonnegative_int(metadata.get("retry_count")) or 0,
            repair_count=_optional_nonnegative_int(metadata.get("repair_count")) or 0,
            prompt_template_version=_optional_text(metadata.get("prompt_template_version")),
            prompt_hash=_optional_text(metadata.get("prompt_hash")),
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
            error_kind=error_kind,
            retry_count=_optional_nonnegative_int(metadata.get("retry_count")) or 0,
            repair_count=_optional_nonnegative_int(metadata.get("repair_count")) or 0,
            prompt_template_version=_optional_text(metadata.get("prompt_template_version")),
            prompt_hash=_optional_text(metadata.get("prompt_hash")),
            payload=metadata,
        )
    raise ModelRunError("不支持的 workflow ModelRun 状态，无法记录模型运行日志。")


def _validate_references(session: Session, payload: ModelRunCreate) -> None:
    if payload.workspace_id is not None and session.get(Workspace, payload.workspace_id) is None:
        raise ModelRunError("工作区不存在，无法记录模型运行日志。")
    if payload.book_id is not None and session.get(Book, payload.book_id) is None:
        raise ModelRunError("作品不存在，无法记录模型运行日志。")
    if payload.book_run_id is not None and session.get(BookRun, payload.book_run_id) is None:
        raise ModelRunError("BookRun 不存在，无法记录模型运行日志。")
    if payload.chapter_id is not None and session.get(Chapter, payload.chapter_id) is None:
        raise ModelRunError("章节不存在，无法记录模型运行日志。")
    if payload.scene_id is not None and session.get(Scene, payload.scene_id) is None:
        raise ModelRunError("场景不存在，无法记录模型运行日志。")
    if payload.job_run_id is not None and session.get(JobRun, payload.job_run_id) is None:
        raise ModelRunError("任务不存在，无法记录模型运行日志。")
    if payload.prompt_pack_id is not None and session.get(PromptPack, payload.prompt_pack_id) is None:
        raise ModelRunError("Prompt Pack 不存在，无法记录模型运行日志。")


def _optional_text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _optional_nonnegative_int(value: object) -> int | None:
    if type(value) is int and value >= 0:
        return value
    return None


def _optional_nonnegative_float(value: object) -> float:
    if isinstance(value, int | float) and not isinstance(value, bool) and value >= 0:
        return float(value)
    return 0.0


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
