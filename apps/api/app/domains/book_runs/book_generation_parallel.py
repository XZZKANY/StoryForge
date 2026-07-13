"""真实 LLM 并发整书生成 runner 的 workflow 桥接层。

API 环境不直接安装 workflow 包；本模块沿用既有桥接模式，只加载
BookLoop/NovelLoop 所需的纯 Python 编排模块，不触发 workflow 顶层依赖。
"""

from __future__ import annotations

import importlib.util
import re
import sys
import threading
import time
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.common.metrics import observe_book_generation_chapter
from app.domains.artifacts.schemas import ArtifactCreate
from app.domains.artifacts.service import create_artifact
from app.domains.book_runs import book_generation as generation
from app.domains.book_runs.book_context import clear_book_context_cache, observe_book_context_cache
from app.domains.book_runs.book_generation_memory import (
    character_state_extracts as _character_state_extracts,
)
from app.domains.book_runs.book_generation_memory import (
    extract_memory_atoms_for_chapter as _extract_memory_atoms_for_chapter,
)
from app.domains.book_runs.book_generation_memory import (
    memory_recall_chars_for_chapter as _memory_recall_chars_for_chapter,
)
from app.domains.book_runs.book_generation_memory import (
    world_fact_extracts as _world_fact_extracts,
)
from app.domains.book_runs.schemas import BookRunCreate, BookRunProgressUpdate
from app.domains.book_runs.service import apply_book_run_progress, create_book_run
from app.domains.exports.book_markdown_exporter import export_book_run_audit_report, export_book_run_markdown

__all__ = [
    "_character_state_extracts",
    "_extract_memory_atoms_for_chapter",
    "_memory_recall_chars_for_chapter",
    "_world_fact_extracts",
    "run_book_generation_parallel",
    "run_book_loop_with_thread_sessions",
]

# 业务 JOIN scenes 查询的判定：剔除 session.refresh / lazy load 的单表回读。
# 真实业务路径（BookContext._build、_build_recap_context、_book_id_for_scene）都走 JOIN scenes，
# 而 ORM 写后回读形如 `SELECT scenes.* FROM scenes WHERE scenes.id = ?`，没有 JOIN scenes，
# 不属于业务查询计数范畴。
_JOIN_SCENES_RE = re.compile(r'\bjoin\s+"?scenes"?\b')


class _SceneSelectQueryCounter:
    """统计并发章节窗口内的 Scene SELECT 查询。"""

    def __init__(self, bind: Any) -> None:
        self._bind = bind
        self._lock = threading.Lock()
        self._count = 0
        self._enabled = False

    def __enter__(self) -> _SceneSelectQueryCounter:
        event.listen(self._bind, "before_cursor_execute", self._record)
        self._enabled = True
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        if self._enabled:
            event.remove(self._bind, "before_cursor_execute", self._record)
            self._enabled = False

    def _record(
        self,
        _conn: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        normalized = statement.lstrip().lower()
        if not normalized.startswith("select"):
            return
        if not _JOIN_SCENES_RE.search(normalized):
            return
        with self._lock:
            self._count += 1

    def metrics(self, chapter_count: int) -> dict[str, object]:
        denominator = max(1, chapter_count)
        with self._lock:
            total = self._count
        return {
            "db_query_count_total": total,
            "db_query_count_per_chapter": round(total / denominator, 3),
            "db_query_count_scope": "scene_business_join_select",
        }


def _workflow_orchestrators_dir() -> Path:
    """定位相邻 workflow orchestrators 目录。"""

    apps_dir = Path(__file__).resolve().parents[4]
    return apps_dir / "workflow" / "storyforge_workflow" / "orchestrators"


def _workflow_dir() -> Path:
    """定位相邻 workflow 包根目录。"""

    return _workflow_orchestrators_dir().parent


def _load_file_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 workflow 模块：{path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@lru_cache(maxsize=1)
def _load_workflow_modules() -> tuple[ModuleType, ModuleType, ModuleType]:
    """加载 BookLoop、NovelLoop 与质量屏障模块，返回动态桥接模块。"""

    orchestrators_dir = _workflow_orchestrators_dir()
    workflow_dir = _workflow_dir()
    if "storyforge_workflow" not in sys.modules:
        pkg = ModuleType("storyforge_workflow")
        pkg.__path__ = [str(workflow_dir)]
        sys.modules["storyforge_workflow"] = pkg
    if "storyforge_workflow.orchestrators" not in sys.modules:
        orchestrators_pkg = ModuleType("storyforge_workflow.orchestrators")
        orchestrators_pkg.__path__ = [str(orchestrators_dir)]
        sys.modules["storyforge_workflow.orchestrators"] = orchestrators_pkg
    novel_loop = _load_file_module(
        "storyforge_workflow.orchestrators.novel_loop",
        orchestrators_dir / "novel_loop.py",
    )
    book_loop = _load_file_module(
        "storyforge_workflow.orchestrators.book_loop",
        orchestrators_dir / "book_loop.py",
    )
    quality_dir = workflow_dir / "quality"
    if "storyforge_workflow.quality" not in sys.modules:
        quality_pkg = ModuleType("storyforge_workflow.quality")
        quality_pkg.__path__ = [str(quality_dir)]
        sys.modules["storyforge_workflow.quality"] = quality_pkg
    arc_consistency = _load_file_module(
        "storyforge_workflow.quality.arc_consistency",
        quality_dir / "arc_consistency.py",
    )
    return book_loop, novel_loop, arc_consistency


_book_loop_module, _novel_loop_module, _arc_consistency_module = _load_workflow_modules()

BookLoopRequest = _book_loop_module.BookLoopRequest
BookLoopResult = _book_loop_module.BookLoopResult
ArcConsistencyBarrier = _arc_consistency_module.ArcConsistencyBarrier
NovelLoopResult = _novel_loop_module.NovelLoopResult


def run_book_loop_with_thread_sessions(
    *,
    book_run_id: int,
    book_id: int,
    blueprint_id: int,
    total_chapters: int,
    chapter_parallelism: int,
    session_factory: Callable[[], object],
    run_chapter: Callable[[Any, int], Any],
    consistency_barrier: Any = None,
    progress_callback: Callable[[Any], None] | None = None,
    require_prior_chapter_commit_before_start: bool = False,
    precommit_chapter: Callable[[Any, int, Any, list[dict[str, object]]], Any] | None = None,
) -> Any:
    """用每章独立 session 执行 workflow BookLoop 并发窗口。"""

    def run_chapter_with_session(chapter_index: int) -> Any:
        with session_factory() as session:
            return run_chapter(session, chapter_index)

    def precommit_with_session(chapter_index: int, chapter_result: Any, committed_chapters: list[dict[str, object]]) -> Any:
        if precommit_chapter is None:
            return chapter_result
        with session_factory() as session:
            return precommit_chapter(session, chapter_index, chapter_result, committed_chapters)

    return _book_loop_module.run_book_loop(
        BookLoopRequest(
            book_run_id=book_run_id,
            book_id=book_id,
            blueprint_id=blueprint_id,
            total_chapters=total_chapters,
            chapter_parallelism=chapter_parallelism,
            require_prior_chapter_commit_before_start=require_prior_chapter_commit_before_start,
        ),
        run_chapter_with_session,
        progress_callback=progress_callback,
        consistency_barrier=consistency_barrier,
        precommit_chapter=precommit_with_session if precommit_chapter is not None else None,
    )


def run_book_generation_parallel(
    session: Session,
    *,
    session_factory: Callable[[], object],
    chapter_count: int,
    chapter_parallelism: int,
    token_budget: int,
    target_word_count: int | None = None,
    chapter_word_count_min: int = 600,
    chapter_word_count_max: int = 1600,
    max_chapter_count: int = 8,
    env: dict[str, str | None] | None = None,
) -> Any:
    """用 workflow BookLoop 并发执行 真实 LLM 小规模实测。"""

    source = dict(env) if env is not None else dict(generation.os.environ)
    _assert_parallel_preflight(
        source,
        chapter_count=chapter_count,
        chapter_parallelism=chapter_parallelism,
        token_budget=token_budget,
        target_word_count=target_word_count,
        chapter_word_count_min=chapter_word_count_min,
        chapter_word_count_max=chapter_word_count_max,
        max_chapter_count=max_chapter_count,
    )
    started_at = time.monotonic()
    book = generation._create_generation_book(session, chapter_count)
    generation._seed_consistency_data(session, book.id)
    blueprint = generation.create_book_blueprint(
        session,
        generation._blueprint_payload(
            book.id,
            chapter_count,
            target_word_count=target_word_count,
            chapter_word_count_min=chapter_word_count_min,
            chapter_word_count_max=chapter_word_count_max,
        ),
    )
    generation.lock_book_blueprint(session, blueprint.id)
    generation.trigger_chapter_plan(session, blueprint.id)
    book_run = create_book_run(
        session,
        BookRunCreate(
            book_id=book.id,
            blueprint_id=blueprint.id,
            token_budget=token_budget,
            time_budget_sec=generation._optional_int(source, "STORYFORGE_LLM_SMOKE_TIME_BUDGET_SECONDS", 900),
            chapter_budget=None,
        ),
    )
    chapter_extras: dict[int, dict[str, object]] = {}
    extras_lock = threading.Lock()
    db_write_lock = threading.Lock()

    def run_chapter(chapter_session: Session, chapter_index: int) -> Any:
        chapter_started_at = time.monotonic()
        with db_write_lock:
            chapter = generation._chapter(chapter_session, book.id, chapter_index)
        generated = generation._generate_chapter(
            chapter_session,
            source,
            chapter_index,
            chapter,
            book_run_id=book_run.id,
        )
        with extras_lock:
            chapter_extras[chapter_index] = {
                "generation_latency_ms": int(generated.get("latency_ms") or 0),
                "chapter_elapsed_time_sec": max(0, int(time.monotonic() - chapter_started_at)),
                "draft_only": True,
            }
        return NovelLoopResult(
            status="approved",
            final_draft=str(generated["content"]),
            source_model_run_id=None,
            judge_report_id=None,
            repair_patch_id=None,
            approved_scene_id=None,
            token_usage=int(generated.get("token_usage") or 0),
            elapsed_time_sec=max(0, int(time.monotonic() - started_at)),
            cost_estimate=0.0,
        )

    def precommit_chapter(
        chapter_session: Session,
        chapter_index: int,
        chapter_result: Any,
        _committed_chapters: list[dict[str, object]],
    ) -> Any:
        chapter_started_at = time.monotonic()
        with db_write_lock:
            chapter = generation._chapter(chapter_session, book.id, chapter_index)
            memory_recall_chars = _memory_recall_chars_for_chapter(chapter_session, book.id, chapter.ordinal)
        generated = generation._generate_chapter(
            chapter_session,
            source,
            chapter_index,
            chapter,
            book_run_id=book_run.id,
        )
        with db_write_lock:
            scene = generation._persist_draft_scene(chapter_session, chapter, str(generated["content"]))
            current_book_run = chapter_session.get(generation.BookRun, book_run.id)
            model_run = generation._record_model_run(chapter_session, current_book_run, scene, source, generated)
            scene_packet = generation._record_scene_packet(
                chapter_session,
                current_book_run,
                scene,
                story_state_changes=list(generated.get("story_state_changes") or []),
                story_state_changes_source=str(generated.get("story_state_changes_source") or ""),
            )
        outcome = generation._judge_and_repair_loop(chapter_session, source, current_book_run, scene, scene_packet)
        observe_book_generation_chapter(
            judge_call_count=int(outcome.get("judge_call_count") or 0),
            repair_patch_count=len(outcome.get("repair_patch_ids") or []),
            cost_cny_estimated=float(generated.get("cost_cny_estimated") or 0.0),
        )
        with db_write_lock:
            approved = generation._finalize_scene_decision(
                chapter_session, chapter, scene, int(outcome.get("quality_score") or 0)
            )
        memory_atom_ids: list[str] = []
        if approved:
            with db_write_lock:
                memory_atom_ids = _extract_memory_atoms_for_chapter(
                    chapter_session,
                    book_id=book.id,
                    chapter_id=chapter.id,
                    chapter_ordinal=chapter.ordinal,
                    approved_scene_id=int(scene.id),
                    content=str(generated["content"]),
                )
        with extras_lock:
            chapter_extras[chapter_index] = {
                "generation_latency_ms": int(generated.get("latency_ms") or 0),
                "chapter_elapsed_time_sec": max(0, int(time.monotonic() - chapter_started_at)),
                "repair_patch_ids": list(outcome.get("repair_patch_ids") or []),
                "repair_rounds": int(outcome.get("repair_rounds") or 0),
                "judge_call_count": int(outcome.get("judge_call_count") or 0),
                "quality_score": int(outcome.get("quality_score") or 0),
                "quality_issues": list(outcome.get("quality_issues") or []),
                "story_state_commit": outcome.get("story_state_commit"),
                "story_state_changes_source": generated.get("story_state_changes_source"),
                "story_state_tool_call_count": generated.get("story_state_tool_call_count", 0),
                "memory_recall_chars": memory_recall_chars,
            }
        status = "approved" if approved else "awaiting_review"
        return NovelLoopResult(
            status=status,
            final_draft=str(generated["content"]),
            source_model_run_id=int(model_run.id),
            judge_report_id=int(outcome["judge_report_id"]),
            repair_patch_id=outcome.get("repair_patch_id"),
            approved_scene_id=int(scene.id) if status == "approved" else None,
            token_usage=int(generated.get("token_usage") or chapter_result.token_usage or 0),
            elapsed_time_sec=max(0, int(time.monotonic() - started_at)),
            cost_estimate=getattr(chapter_result, "cost_estimate", 0.0),
            fallback_metadata=getattr(chapter_result, "fallback_metadata", None),
            memory_atom_ids=memory_atom_ids,
            skill_runs=tuple(getattr(chapter_result, "skill_runs", ())),
        )

    clear_book_context_cache(book.id)
    consistency_barrier = _arc_consistency_barrier_from_blueprint(session, blueprint.id, chapter_count)
    bind = session.get_bind()
    with observe_book_context_cache() as cache_observer, _SceneSelectQueryCounter(bind) as query_counter:
        book_loop_result = run_book_loop_with_thread_sessions(
            book_run_id=book_run.id,
            book_id=book.id,
            blueprint_id=blueprint.id,
            total_chapters=chapter_count,
            chapter_parallelism=chapter_parallelism,
            session_factory=session_factory,
            run_chapter=run_chapter,
            consistency_barrier=consistency_barrier,
            precommit_chapter=precommit_chapter,
        )
        cache_snapshot = cache_observer.snapshot()
        db_query_metrics = query_counter.metrics(chapter_count)
    progress = _parallel_progress(
        session,
        book_loop_result.progress,
        book_run_id=book_run.id,
        blueprint_id=blueprint.id,
        chapter_extras=chapter_extras,
        context_cache_metrics=_context_cache_metrics(cache_snapshot),
        db_query_metrics=db_query_metrics,
        source=source,
    )
    completed_book_run = apply_book_run_progress(
        session,
        book_run.id,
        BookRunProgressUpdate(
            status=book_loop_result.status,
            current_chapter_index=book_loop_result.current_chapter_index,
            progress=progress,
        ),
    )
    if completed_book_run.status == "completed":
        markdown_artifact = export_book_run_markdown(session, completed_book_run.id)
        audit_artifact = export_book_run_audit_report(session, completed_book_run.id)
    else:
        markdown_artifact, audit_artifact = _blocked_run_artifacts(session, completed_book_run)
    return generation.BookGenerationResult(
        book_run=completed_book_run,
        markdown_artifact=markdown_artifact,
        audit_artifact=audit_artifact,
        chapter_count=chapter_count,
    )


def _assert_parallel_preflight(
    source: dict[str, str | None],
    *,
    chapter_count: int,
    chapter_parallelism: int,
    token_budget: int,
    target_word_count: int | None,
    chapter_word_count_min: int,
    chapter_word_count_max: int,
    max_chapter_count: int,
) -> None:
    generation._assert_preflight(
        source,
        chapter_count,
        token_budget,
        target_word_count,
        chapter_word_count_min,
        chapter_word_count_max,
        max_chapter_count=max_chapter_count,
    )
    if chapter_parallelism <= 1:
        raise generation.BookGenerationPreflightError("并发真实 LLM runner 的并发度必须大于 1。")


def _arc_consistency_barrier_from_blueprint(session: Session, blueprint_id: int, total_chapters: int) -> Any:
    """从 Blueprint 章节弧线摘要构建 workflow 弧线屏障；无规划时保持放行。"""

    blueprint = session.get(generation.BookBlueprint, blueprint_id)
    metadata = blueprint.metadata_ if blueprint is not None and isinstance(blueprint.metadata_, dict) else {}
    summary = metadata.get("planning_summary") if isinstance(metadata, dict) else None
    if not isinstance(summary, dict):
        return None
    chapter_arc_links = summary.get("chapter_arc_links")
    if not isinstance(chapter_arc_links, dict):
        return None
    ratio = _bounded_ratio(summary.get("arc_completion_ratio"))
    chapters: dict[int, dict[str, object]] = {}
    for chapter_index in range(1, total_chapters + 1):
        raw_arc_ids = chapter_arc_links.get(str(chapter_index))
        if not isinstance(raw_arc_ids, list):
            continue
        arc_ids = [arc_id.strip() for arc_id in raw_arc_ids if isinstance(arc_id, str) and arc_id.strip()]
        if arc_ids:
            chapters[chapter_index] = {"planning_refs": {"arc_ids": arc_ids, "arc_completion_ratio": ratio}}
    if not chapters:
        return None
    return ArcConsistencyBarrier(chapters)


def _bounded_ratio(value: object) -> float:
    if not isinstance(value, int | float) or value <= 0:
        return 0.0
    return min(float(value), 1.0)


def _blocked_run_artifacts(session: Session, book_run: Any) -> tuple[Any, Any]:
    """为被屏障或评审阻断的并发 runner 留下可审计证据，不伪装为完整导出。"""

    book = session.get(generation.Book, book_run.book_id)
    workspace_id = book.workspace_id if book is not None else None
    content = _blocked_markdown_content(book_run)
    markdown_artifact = create_artifact(
        session,
        ArtifactCreate(
            workspace_id=workspace_id,
            book_id=book_run.book_id,
            artifact_type="book_run_blocked_markdown",
            lineage_key=f"book-run:{book_run.id}:blocked-markdown",
            name="book_run_blocked.md",
            storage_uri=f"memory://book-runs/{book_run.id}/book_run_blocked.md",
            mime_type="text/markdown",
            size_bytes=len(content.encode("utf-8")),
            payload={"content": content},
        ),
    )
    report = {
        "book_run_id": book_run.id,
        "blueprint_id": book_run.blueprint_id,
        "status": book_run.status,
        "current_chapter_index": book_run.current_chapter_index,
        "progress": book_run.progress,
    }
    audit_artifact = create_artifact(
        session,
        ArtifactCreate(
            workspace_id=workspace_id,
            book_id=book_run.book_id,
            artifact_type="book_run_blocked_audit_report",
            lineage_key=f"book-run:{book_run.id}:blocked-audit-report",
            name="blocked_audit_report.json",
            storage_uri=f"memory://book-runs/{book_run.id}/blocked_audit_report.json",
            mime_type="application/json",
            size_bytes=len(str(report).encode("utf-8")),
            payload=report,
        ),
    )
    return markdown_artifact, audit_artifact


def _blocked_markdown_content(book_run: Any) -> str:
    progress = book_run.progress if isinstance(book_run.progress, dict) else {}
    conflict = progress.get("consistency_conflict") if isinstance(progress.get("consistency_conflict"), dict) else {}
    lines = [
        "---",
        f"book_run_id: {book_run.id}",
        f"blueprint_id: {book_run.blueprint_id}",
        f"status: {book_run.status}",
        "---",
        "",
        "# BookRun 阻断证据",
        "",
        f"- 当前章节：{book_run.current_chapter_index}",
        f"- 完成章节数：{len(progress.get('completed_chapters') or [])}",
    ]
    if conflict:
        lines.append(f"- 一致性冲突：{conflict.get('chapter_index')}")
    return "\n".join(lines).strip() + "\n"


def _parallel_progress(
    session: Session,
    progress: dict[str, object],
    *,
    book_run_id: int,
    blueprint_id: int,
    chapter_extras: dict[int, dict[str, object]],
    context_cache_metrics: dict[str, object],
    db_query_metrics: dict[str, object],
    source: dict[str, str | None],
) -> dict[str, object]:
    next_progress = dict(progress)
    completed = []
    for item in list(next_progress.get("completed_chapters") or []):
        chapter_progress = dict(item)
        chapter_index = int(chapter_progress.get("chapter_index") or 0)
        chapter_progress.update(chapter_extras.get(chapter_index, {}))
        completed.append(chapter_progress)
    next_progress["completed_chapters"] = completed
    metrics = dict(next_progress.get("integration_metrics") or {})
    metrics.update(_parallel_observed_metrics(session, book_run_id, blueprint_id, completed))
    metrics.update(context_cache_metrics)
    metrics.update(db_query_metrics)
    next_progress["integration_metrics"] = metrics
    next_progress["real_llm_smoke"] = {
        "provider_name": generation._required_env(source, "STORYFORGE_LLM_PROVIDER"),
        "model_name": generation._required_env(source, "STORYFORGE_LLM_MODEL"),
        "chapter_count": len(completed),
        "runner": "phase9b_parallel_workflow",
    }
    return next_progress


def _context_cache_metrics(snapshot: Any) -> dict[str, object]:
    metrics: dict[str, object] = {
        "context_cache_hits": snapshot.hits,
        "context_cache_misses": snapshot.misses,
        "context_cache_observation_scope": "book_context_get_book_context",
    }
    if snapshot.hit_rate is not None:
        metrics["context_cache_hit_rate"] = snapshot.hit_rate
    return metrics


def _parallel_observed_metrics(
    session: Session,
    book_run_id: int,
    blueprint_id: int,
    completed_chapters: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "memory_recall_budget_used": generation._direct_memory_recall_budget_used(completed_chapters),
        "arc_completion_rate": generation._arc_completion_rate(session, blueprint_id),
        "chapter_generation_time_p50": generation._chapter_generation_time_p50(completed_chapters),
        "memory_recall_budget_scope": "phase9b_parallel_story_memory_recall",
        "book_run_id": book_run_id,
    }
