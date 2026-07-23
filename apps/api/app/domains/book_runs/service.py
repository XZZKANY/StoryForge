from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.common.exceptions import InputError, NotFoundError
from app.db.session import SessionLocal
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs._coerce import (  # noqa: F401  facade re-export
    bounded_ratio as _bounded_ratio,
)
from app.domains.book_runs.dispatch import (  # noqa: F401  facade re-export
    DEFAULT_ENTITY_BUDGET,
    DEFAULT_PHASE_POLICY,
    build_book_run_workflow_dispatch,
)
from app.domains.book_runs.gate import (  # noqa: F401  facade re-export
    even_volume_plan as _even_volume_plan,
)
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.progression import (  # noqa: F401  facade re-export
    CONTROLLED_PROGRESS_KEYS,
    STICKY_PROGRESS_KEYS,
    apply_book_run_progress,
    pause_book_run,
    resume_book_run,
    retry_book_run_from_checkpoint,
    stop_book_run,
)
from app.domains.book_runs.progression import (
    provider_resolution_progress_summary as _provider_resolution_progress_summary,
)
from app.domains.book_runs.schemas import BookRunCreate
from app.domains.book_runs.timeline import (  # noqa: F401  facade re-export
    sync_completed_chapter_timeline_events as _sync_completed_chapter_timeline_events,
)
from app.domains.books.models import Book
from app.domains.provider_gateway.service import resolve_provider

DEFAULT_TIMELINE_PROJECT_ID = 1
DEFAULT_TIMELINE_VOLUME_ID = 1


class BookRunError(InputError):
    """BookRun 启动输入或状态不满足整书编排约束。"""


class BookRunBlockedError(InputError):
    """BookRun 前置条件未满足。"""

    status_code = 422


class BookRunNotFoundError(NotFoundError):
    """BookRun 不存在。"""


def create_book_run(session: Session, payload: BookRunCreate) -> BookRun:
    """启动 9A 最小 BookRun，等待 workflow 顺序驱动章节。"""

    if session.get(Book, payload.book_id) is None:
        raise BookRunError("作品不存在，无法启动 BookRun。")
    blueprint = session.get(BookBlueprint, payload.blueprint_id)
    if blueprint is None or blueprint.book_id != payload.book_id:
        raise BookRunError("Blueprint 不存在或不属于目标作品。")
    if blueprint.status != "locked":
        raise BookRunBlockedError("Blueprint 尚未锁定，不能启动 BookRun。")
    book_run = BookRun(
        book_id=payload.book_id,
        blueprint_id=payload.blueprint_id,
        status="running",
        current_chapter_index=1,
        total_chapters=blueprint.target_chapter_count,
        progress={
            "completed_chapters": [],
            "provider_resolution": _provider_resolution_progress_summary(resolve_provider(session, "llm")),
        },
        checkpoint=[],
        token_budget=payload.token_budget,
        tokens_used=0,
        time_budget_sec=payload.time_budget_sec,
        elapsed_time_sec=0,
        chapter_budget=payload.chapter_budget,
        estimated_cost=0.0,
        cost_summary={"estimated_cost": 0.0},
    )
    session.add(book_run)
    session.commit()
    session.refresh(book_run)
    return book_run


def get_book_run(session: Session, book_run_id: int) -> BookRun:
    """读取 BookRun 详情。"""

    book_run = session.get(BookRun, book_run_id)
    if book_run is None:
        raise BookRunNotFoundError("BookRun 不存在。")
    return book_run


_logger = logging.getLogger(__name__)

# 单进程后台触发的章节上限：与 BookRunStartRequest.max_chapters 的上界保持一致。
START_TRIGGER_CHAPTER_CAP = 6
# 未显式提供预算时，按每章给一份保守 token 预算，避免立刻触发预算暂停。
DEFAULT_TOKENS_PER_CHAPTER = 4000


def assert_book_run_startable(
    session: Session,
    book_run_id: int,
    *,
    max_chapters: int = START_TRIGGER_CHAPTER_CAP,
    token_budget: int | None = None,
    env: Mapping[str, str | None] | None = None,
) -> tuple[BookRun, int, int]:
    """同步前置校验：存在性、状态、LLM 凭据与重复触发，返回 (run, 章节数, token 预算)。

    由 start 端点在返回 202 之前内联调用，让缺凭据 / 状态不符立即得到反馈，
    而不是沉默地在后台任务里失败。
    """

    from app.domains.book_runs.book_generation import missing_book_generation_env

    book_run = get_book_run(session, book_run_id)
    if book_run.status != "running":
        raise BookRunBlockedError(
            f"BookRun 状态为 {book_run.status}，只能对 running 的运行发起生成；"
            "已暂停或停止的运行请用 resume / retry。"
        )
    generation = (book_run.progress or {}).get("generation")
    if isinstance(generation, Mapping) and generation.get("state") in {"dispatched", "running"}:
        raise BookRunBlockedError("BookRun 生成已在进行中，请勿重复发起。")
    missing = missing_book_generation_env(env)
    if missing:
        raise BookRunBlockedError(
            "缺少真实 LLM 生成所需环境变量：" + ", ".join(missing) + "。"
        )
    chapter_count = min(book_run.total_chapters, max_chapters)
    if chapter_count < 1:
        raise BookRunBlockedError("BookRun 总章节数无效，无法发起生成。")
    resolved_budget = token_budget or book_run.token_budget or (chapter_count * DEFAULT_TOKENS_PER_CHAPTER)
    return book_run, chapter_count, resolved_budget


def mark_book_run_generation_dispatched(session: Session, book_run_id: int) -> BookRun:
    """在 progress 下挂 generation 派发标记，用于拒绝并发重复触发。

    直接写 progress 子键并提交，不走 apply_book_run_progress——后者会按 payload
    重算 status / 预算 / checkpoint，会覆盖真实运行状态。
    """

    book_run = get_book_run(session, book_run_id)
    progress = dict(book_run.progress or {})
    progress["generation"] = {
        "state": "dispatched",
        "dispatched_at": datetime.now(UTC).isoformat(),
    }
    book_run.progress = progress
    session.commit()
    session.refresh(book_run)
    return book_run


def run_book_run_generation_blocking(
    book_run_id: int,
    *,
    chapter_count: int,
    token_budget: int,
    env: Mapping[str, str | None] | None = None,
) -> None:
    """后台任务体：用独立 Session 驱动顺序生成（复用 Phase 9B 串行编排）。

    请求级 Session 在后台任务运行时已关闭，故此处自行开 SessionLocal。
    resume_book_generation 对每章的 BookGenerationError 已 pause_by_failure 落失败证据并翻 failed；
    其它逃逸异常由 except 里的 _fail_book_run_if_non_terminal 兜底把仍非终态的 run 翻 failed，
    杜绝僵尸 running。两者都记日志并吞异常，避免后台任务崩溃 worker（D1-001）。
    """

    # 延迟导入：phase9b 模块在导入期依赖本模块，顶层导入会形成循环。
    from app.domains.book_runs.book_generation import resume_book_generation

    session = SessionLocal()
    try:
        resume_book_generation(
            session,
            book_run_id=book_run_id,
            chapter_count=chapter_count,
            token_budget=token_budget,
            max_chapter_count=START_TRIGGER_CHAPTER_CAP,
            env=env,
        )
    except Exception:  # noqa: BLE001 - 失败证据已落库，避免后台任务向上抛
        _logger.exception("BookRun %s 后台生成失败", book_run_id)
        _fail_book_run_if_non_terminal(session, book_run_id)
    finally:
        session.close()


def _fail_book_run_if_non_terminal(session: Session, book_run_id: int) -> None:
    """后台生成抛出未被 resume 内部按章捕获的异常时的兜底：把仍停在非终态的 BookRun 翻 failed，
    杜绝僵尸 running（D1-001）。BookGenerationError 已在 resume 每章 pause_by_failure，
    paused_by_* 是合法的可续跑态，两者均不动，只收尸 running。"""

    try:
        session.rollback()
        book_run = session.get(BookRun, book_run_id)
        if book_run is None or book_run.status in {
            "completed",
            "failed",
            "stopped",
            "paused_by_user",
            "paused_by_budget",
        }:
            return
        book_run.status = "failed"
        progress = dict(book_run.progress or {})
        progress.setdefault("failure", {"error": "后台生成异常退出，已收尸为 failed。"})
        book_run.progress = progress
        session.commit()
    except Exception:  # noqa: BLE001 - 兜底翻状态失败不再向上抛，避免遮蔽原始异常
        _logger.exception("BookRun %s 兜底翻 failed 失败", book_run_id)
        session.rollback()
