from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError
from app.common.scope import ScopeNotFoundError, validate_scope
from app.domains.evaluations.models import EvaluationCase, EvaluationRun
from app.domains.evaluations.schemas import (
    EvaluationCaseCreate,
    EvaluationFailedSampleRead,
    EvaluationRunCreate,
    EvaluationRunDetailRead,
    EvaluationRunRead,
)


class EvaluationError(InputError):
    """评测对象引用不存在或输入不合法。"""


class EvaluationRunNotFoundError(EvaluationError):
    """评测运行不存在时由路由层转换为可重试的 404。"""


def create_evaluation_case(session: Session, payload: EvaluationCaseCreate) -> EvaluationCase:
    _validate_scope(session, payload.workspace_id, payload.book_id)
    case = EvaluationCase(
        workspace_id=payload.workspace_id,
        book_id=payload.book_id,
        case_name=payload.case_name,
        case_type=payload.case_type,
        status="active",
        input_payload=payload.input_payload,
        expected_payload=payload.expected_payload,
    )
    session.add(case)
    session.commit()
    session.refresh(case)
    return case


def create_evaluation_run(session: Session, payload: EvaluationRunCreate) -> EvaluationRun:
    case = session.get(EvaluationCase, payload.case_id) if payload.case_id is not None else None
    if payload.case_id is not None and case is None:
        raise EvaluationError("评测用例不存在。")
    if case is not None:
        if payload.workspace_id is not None and payload.workspace_id != case.workspace_id:
            raise EvaluationError("评测运行作用域必须与评测用例一致。")
        if payload.book_id is not None and payload.book_id != case.book_id:
            raise EvaluationError("评测运行作用域必须与评测用例一致。")
    workspace_id = payload.workspace_id if payload.workspace_id is not None else (case.workspace_id if case is not None else None)
    book_id = payload.book_id if payload.book_id is not None else (case.book_id if case is not None else None)
    _validate_scope(
        session,
        workspace_id,
        book_id,
    )
    observed = payload.observed_payload
    expected = case.expected_payload if case is not None else {}
    metrics = _build_metrics(expected, observed)
    summary = (
        f"一致性错误率 {metrics['consistency_error_rate']:.2f}，"
        f"修复成功率 {metrics['repair_success_rate']:.2f}，"
        f"用户接受率 {metrics['user_acceptance_rate']:.2f}，"
        f"未回收 open loop {metrics['open_loop_count']}。"
    )
    run = EvaluationRun(
        case_id=payload.case_id,
        workspace_id=workspace_id,
        book_id=book_id,
        status="completed",
        metrics=metrics,
        summary=summary,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def list_evaluation_runs(session: Session, *, workspace_id: int | None = None, book_id: int | None = None) -> Sequence[EvaluationRun]:
    statement = build_evaluation_run_list_query(workspace_id=workspace_id, book_id=book_id)
    return session.scalars(statement).all()


def build_evaluation_run_list_query(*, workspace_id: int | None = None, book_id: int | None = None):
    """构造按主键升序排列的评测运行查询，供分页 helper 复用。"""

    statement = select(EvaluationRun).order_by(EvaluationRun.id)
    if workspace_id is not None:
        statement = statement.where(EvaluationRun.workspace_id == workspace_id)
    if book_id is not None:
        statement = statement.where(EvaluationRun.book_id == book_id)
    return statement


def get_evaluation_run_detail(session: Session, run_id: int) -> EvaluationRunDetailRead:
    """读取评测运行详情，不生成新评测。"""

    run = _get_evaluation_run(session, run_id)
    failed_samples = _failed_samples_from_metrics(run.metrics or {})
    return EvaluationRunDetailRead(
        run=EvaluationRunRead.model_validate(run),
        trend_points=_trend_points_from_metrics(run.metrics or {}),
        failed_sample_count=len(failed_samples),
        studio_feedback_href=_first_studio_href(failed_samples),
    )


def list_failed_samples(session: Session, run_id: int) -> list[EvaluationFailedSampleRead]:
    """读取失败样例并暴露回到 Studio 修复入口的最小线索。"""

    run = _get_evaluation_run(session, run_id)
    return _failed_samples_from_metrics(run.metrics or {})


def _get_evaluation_run(session: Session, run_id: int) -> EvaluationRun:
    run = session.get(EvaluationRun, run_id)
    if run is None:
        raise EvaluationRunNotFoundError("评测运行不存在，无法读取详情。")
    return run


def _validate_scope(session: Session, workspace_id: int | None, book_id: int | None) -> None:
    try:
        validate_scope(session, workspace_id, book_id)
    except ScopeNotFoundError as exc:
        if str(exc).startswith("工作区"):
            raise EvaluationError("工作区不存在，无法创建评测对象。") from exc
        raise EvaluationError("作品不存在，无法创建评测对象。") from exc


def _build_metrics(expected: dict, observed: dict) -> dict:
    scene_count = max(1, _non_negative_int(observed, "scene_count", expected.get("scene_count", 1) or 1))
    open_issue_count = _non_negative_int(observed, "open_issue_count", 0)
    repair_attempts = max(1, _non_negative_int(observed, "repair_attempts", 1))
    repair_accepted = _non_negative_int(observed, "repair_accepted", 0)
    suggestions_total = max(1, _non_negative_int(observed, "suggestions_total", 1))
    suggestions_accepted = _non_negative_int(observed, "suggestions_accepted", 0)
    open_loop_count = _non_negative_int(observed, "open_loop_count", expected.get("open_loop_count", 0) or 0)
    _validate_ratio_bounds(open_issue_count, scene_count)
    _validate_ratio_bounds(repair_accepted, repair_attempts)
    _validate_ratio_bounds(suggestions_accepted, suggestions_total)
    metrics = {
        "consistency_error_rate": round(open_issue_count / scene_count, 4),
        "repair_success_rate": round(repair_accepted / repair_attempts, 4),
        "user_acceptance_rate": round(suggestions_accepted / suggestions_total, 4),
        "open_loop_count": open_loop_count,
    }
    failed_samples = observed.get("failed_samples")
    if isinstance(failed_samples, list):
        metrics["failed_samples"] = failed_samples
        metrics["failed_sample_count"] = len(failed_samples)
    return metrics


def _non_negative_int(values: dict, name: str, default: object) -> int:
    raw_value = values.get(name, default)
    if isinstance(raw_value, bool):
        raise EvaluationError(f"{name} 必须是非负整数。")
    try:
        value = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise EvaluationError(f"{name} 必须是非负整数。") from exc
    if isinstance(raw_value, float) and not raw_value.is_integer():
        raise EvaluationError(f"{name} 必须是非负整数。")
    if value < 0:
        raise EvaluationError("评测指标数值不合法：指标计数不能为负数。")
    return value


def _validate_ratio_bounds(numerator: int, denominator: int) -> None:
    if numerator > denominator:
        raise EvaluationError("评测指标数值不合法：比例分子不能超过分母。")


def _failed_samples_from_metrics(metrics: dict) -> list[EvaluationFailedSampleRead]:
    samples = metrics.get("failed_samples")
    if not isinstance(samples, list):
        return []
    result: list[EvaluationFailedSampleRead] = []
    for index, sample in enumerate(samples, start=1):
        if not isinstance(sample, dict):
            continue
        chapter_id = sample.get("chapter_id")
        artifact_id = sample.get("artifact_id")
        studio_href = f"/studio?chapter_id={chapter_id}" if isinstance(chapter_id, int) else None
        result.append(
            EvaluationFailedSampleRead(
                id=str(sample.get("id", f"sample-{index}")),
                reason=str(sample.get("reason", "未提供失败原因")),
                chapter_id=chapter_id if isinstance(chapter_id, int) else None,
                artifact_id=artifact_id if isinstance(artifact_id, int) else None,
                repair_hint=str(sample.get("repair_hint", "回到 Studio 查看对应章节并重新执行 Judge/Repair。")),
                studio_href=studio_href,
            )
        )
    return result


def _trend_points_from_metrics(metrics: dict) -> list[dict[str, object]]:
    return [
        {"metric": "consistency_error_rate", "value": metrics.get("consistency_error_rate", 0)},
        {"metric": "repair_success_rate", "value": metrics.get("repair_success_rate", 0)},
        {"metric": "user_acceptance_rate", "value": metrics.get("user_acceptance_rate", 0)},
        {"metric": "open_loop_count", "value": metrics.get("open_loop_count", 0)},
    ]


def _first_studio_href(samples: list[EvaluationFailedSampleRead]) -> str | None:
    for sample in samples:
        if sample.studio_href:
            return sample.studio_href
    return None
