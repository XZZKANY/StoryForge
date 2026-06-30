from __future__ import annotations

import json
import os
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import TextIO

from sqlalchemy import select
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.common.metrics import observe_book_generation_chapter
from app.domains.artifacts.models import Artifact
from app.domains.blueprints.models import BookBlueprint  # noqa: F401  facade re-export
from app.domains.blueprints.schemas import BookBlueprintCreate
from app.domains.blueprints.service import create_book_blueprint, lock_book_blueprint, trigger_chapter_plan
from app.domains.book_runs.book_generation_changes import (
    StoryStateRosterEntry,
    append_story_state_changes_instruction,
    build_story_state_roster,
    extract_story_state_changes_from_content,
    extract_story_state_changes_from_tool_calls,
    normalize_story_state_changes_with_roster,
    story_state_changes_tools,
    validate_story_state_change_dicts,
)
from app.domains.book_runs.book_generation_judge import (  # noqa: F401  facade re-export
    _CATEGORY_DIMENSION,
    MAX_REPAIR_ROUNDS,
    REPAIR_THRESHOLD,
    WORD_COUNT_CEILING_RUNAWAY_FACTOR,
    _apply_word_count_floor,
    _book_id_for_scene,
    _build_judge_payload,
    _fast_judge_enabled,
    _judge_and_repair_loop,
    _JudgeRunResult,
    _maybe_repair,
    _quality_score,
    _record_summary_judge,
    _run_real_judge,
)
from app.domains.book_runs.book_generation_llm import (  # noqa: F401  facade re-export
    THINK_BLOCK_RE,
    THINK_CLOSE_RE,
    THINK_OPEN_RE,
    _call_llm,
    _cost_breakdown,
    _env_value,
    _llm_request_headers,
    _optional_float,
    _optional_int,
    _required_env,
    _strip_reasoning_leak,
    _token_usage,
    _total_cost_estimate,
)
from app.domains.book_runs.book_generation_memory import (
    extract_memory_atoms_for_chapter,
    memory_recall_chars_for_chapter,
)
from app.domains.book_runs.book_generation_metrics import (  # noqa: F401  facade re-export
    MARKDOWN_CHAPTER_HEADING_RE,
    _aggregate_cost_breakdown,
    _artifact_payload_sha256,
    _artifact_text,
    _body_char_count,
    _chapter_index,
    _chapter_metric,
    _evidence_summary,
    _failure_count,
    _float_value,
    _integration_metrics_from_audit_artifact,
    _latency_summary,
    _markdown_chapter_body_char_counts,
    _per_chapter_char_counts,
    _result_summary,
    _sum_chapter_int,
)
from app.domains.book_runs.book_generation_preflight import (  # noqa: F401  facade re-export
    LLM_SETTINGS_ENV_KEYS,
    REQUIRED_REAL_LLM_ENV,
    _assert_preflight,
    missing_book_generation_env,
    resolved_llm_env,
)
from app.domains.book_runs.book_generation_progress import (  # noqa: F401  facade re-export
    _pause_by_budget,
    _pause_by_failure,
    _pause_by_interrupt,
)
from app.domains.book_runs.book_generation_records import (  # noqa: F401  facade re-export
    MODEL_RUN_SUMMARY_MAX_CHARS,
    _finalize_scene_decision,
    _model_run_summary_text,
    _persist_draft_scene,
    _record_model_run,
    _record_scene_packet,
)
from app.domains.book_runs.book_generation_serial_metrics import (  # noqa: F401  facade re-export
    _arc_completion_rate,
    _chapter_generation_time_p50,
    _direct_memory_recall_budget_used,
    _serial_integration_metrics,
)
from app.domains.book_runs.errors import (  # noqa: F401  facade re-export
    BookGenerationError,
    BookGenerationPreflightError,
)
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.prompt_assembly import assemble_prompt_injection
from app.domains.book_runs.schemas import BookRunCreate, BookRunProgressUpdate
from app.domains.book_runs.service import apply_book_run_progress, create_book_run
from app.domains.book_runs.workflow_prompt_bridge import build_draft_prompt_from_state
from app.domains.books.models import Book, Chapter, Scene
from app.domains.character_bible.schemas import CharacterBibleCreate
from app.domains.character_bible.service import create_character_bible_entry
from app.domains.continuity.models import ScenePacket
from app.domains.exports.book_markdown_exporter import export_book_run_audit_report, export_book_run_markdown
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.model_runs.models import ModelRun
from app.domains.style_packs.schemas import StylePackCreate
from app.domains.style_packs.service import create_style_pack

# 续写上文 recap 的默认上限：最近 N 章给完整正文，更早章节压缩成前情提要，
# 避免逐章拼接全部前文导致 prompt 与本地查询开销随章数平方增长。
RECAP_FULL_CHAPTERS_DEFAULT = 2
RECAP_MAX_CHARS_DEFAULT = 6000
RECAP_OLDER_SUMMARY_MAX_CHARS = 160
DEFAULT_GENERATION_PREMISE = "沈砚在苍岭城调查失踪的铜钟匠，逐步追出城防钟楼背后的旧盟约。"
DEFAULT_GENERATION_TONE = "克制悬疑"
DEFAULT_GENERATION_POV = "沈砚"
DEFAULT_GENERATION_LOCATION = "苍岭城"
DEFAULT_GENERATION_TITLE_SEED = "铜钟疑案"


@dataclass(frozen=True)
class BookGenerationResult:
    """真实 LLM 整书生成产物，供验证报告引用。"""

    book_run: BookRun
    markdown_artifact: Artifact
    audit_artifact: Artifact
    chapter_count: int
    approved_chapter_count: int = 0


def _count_approved_chapters(completed_chapters: list[dict[str, object]]) -> int:
    """统计真正批准（产出）的章数，与"已处理章数"区分，避免计数失真。"""

    return sum(1 for item in completed_chapters if item.get("approved"))


def _assert_no_missing_chapters(
    session: Session,
    book_run_id: int,
    chapter_count: int,
    completed_chapters: list[dict[str, object]],
    tokens_used: int,
) -> None:
    """缺章护栏：标 completed 前确认 1..N 章全部批准产出，否则拒绝完成并落 failed。

    防止「书里静默缺章/空章却仍标 completed 且算 sha256」这种把缺失当成功的假象——
    导出只收 approved 章，未批准章会被悄悄丢成空洞，绝不能再当作整书完成。
    """

    expected = set(range(1, chapter_count + 1))
    approved = {
        int(item["chapter_index"])
        for item in completed_chapters
        if item.get("approved") and item.get("chapter_index") is not None
    }
    missing = sorted(expected - approved)
    if not missing:
        return
    _pause_by_failure(
        session,
        book_run_id,
        chapter_count,
        completed_chapters,
        tokens_used,
        f"缺章护栏：第 {missing} 章未批准或缺失，拒绝标记 completed。",
    )
    raise BookGenerationError(
        f"缺章护栏触发：第 {missing} 章未批准或缺失，BookRun 不标 completed（防止静默产出缺章成稿）。"
    )


def run_book_generation(
    session: Session,
    *,
    chapter_count: int,
    token_budget: int,
    target_word_count: int | None = None,
    chapter_word_count_min: int = 600,
    chapter_word_count_max: int = 1600,
    max_chapter_count: int = 10,
    env: Mapping[str, str | None] | None = None,
) -> BookGenerationResult:
    """用真实 OpenAI 兼容 LLM 跑受控章节数的 BookRun 整书生成。"""

    source = resolved_llm_env(env)
    _assert_preflight(
        source,
        chapter_count,
        token_budget,
        target_word_count,
        chapter_word_count_min,
        chapter_word_count_max,
        max_chapter_count=max_chapter_count,
    )
    started_at = time.monotonic()
    book = _create_generation_book(session, chapter_count)
    _seed_consistency_data(session, book.id)
    blueprint = create_book_blueprint(
        session,
        _blueprint_payload(
            book.id,
            chapter_count,
            target_word_count=target_word_count,
            chapter_word_count_min=chapter_word_count_min,
            chapter_word_count_max=chapter_word_count_max,
        ),
    )
    lock_book_blueprint(session, blueprint.id)
    trigger_chapter_plan(session, blueprint.id)
    book_run = create_book_run(
        session,
        BookRunCreate(
            book_id=book.id,
            blueprint_id=blueprint.id,
            token_budget=token_budget,
            time_budget_sec=_optional_int(source, "STORYFORGE_LLM_SMOKE_TIME_BUDGET_SECONDS", 900),
            chapter_budget=chapter_count,
        ),
    )
    completed_chapters: list[dict[str, object]] = []
    tokens_used = 0
    for chapter_index in range(1, chapter_count + 1):
        chapter_started_at = time.monotonic()
        chapter = _chapter(session, book.id, chapter_index)
        memory_recall_chars = memory_recall_chars_for_chapter(session, book.id, chapter.ordinal)
        try:
            generated = _generate_chapter(session, source, chapter_index, chapter, book_run_id=book_run.id)
            tokens_used += generated["token_usage"]
            scene = _persist_draft_scene(session, chapter, str(generated["content"]))
            model_run = _record_model_run(session, book_run, scene, source, generated)
            scene_packet = _record_scene_packet(
                session,
                book_run,
                scene,
                story_state_changes=list(generated.get("story_state_changes") or []),
                story_state_changes_source=str(generated.get("story_state_changes_source") or ""),
            )
            outcome = _judge_and_repair_loop(session, source, book_run, scene, scene_packet)
            observe_book_generation_chapter(
                judge_call_count=int(outcome.get("judge_call_count") or 0),
                repair_patch_count=len(outcome.get("repair_patch_ids") or []),
                cost_cny_estimated=float(generated.get("cost_cny_estimated") or 0.0),
            )
            approved = _finalize_scene_decision(session, chapter, scene, int(outcome["quality_score"]))
            memory_atom_ids = (
                extract_memory_atoms_for_chapter(
                    session,
                    book_id=book.id,
                    chapter_id=chapter.id,
                    chapter_ordinal=chapter.ordinal,
                    approved_scene_id=int(scene.id),
                    content=scene.content or str(generated["content"]),
                )
                if approved
                else []
            )
        except BookGenerationError as exc:
            _pause_by_failure(session, book_run.id, chapter_index, completed_chapters, tokens_used, str(exc))
            raise BookGenerationError(
                f"真实 LLM 生成在第 {chapter_index} 章失败，已保住前 {len(completed_chapters)} 章证据：{exc}"
            ) from exc
        except (KeyboardInterrupt, SystemExit):
            _pause_by_interrupt(session, book_run.id, chapter_index, completed_chapters, tokens_used)
            raise
        completed_chapters.append(
            {
                "chapter_index": chapter_index,
                "model_run_id": model_run.id,
                "judge_report_id": outcome["judge_report_id"],
                "repair_patch_id": outcome["repair_patch_id"],
                "repair_patch_ids": outcome["repair_patch_ids"],
                "repair_rounds": outcome["repair_rounds"],
                "judge_call_count": int(outcome.get("judge_call_count") or 0),
                "approved_scene_id": scene.id,
                "scene_status": scene.status,
                "approved": approved,
                "token_usage": generated["token_usage"],
                "prompt_tokens": generated["prompt_tokens"],
                "completion_tokens": generated["completion_tokens"],
                "generation_latency_ms": generated["latency_ms"],
                "elapsed_time_sec": max(0, int(time.monotonic() - started_at)),
                "chapter_elapsed_time_sec": max(0, int(time.monotonic() - chapter_started_at)),
                "cost_estimate": generated["cost_cny_estimated"],
                "cost_breakdown": generated["cost_breakdown"],
                "quality_score": outcome["quality_score"],
                "quality_issues": outcome["quality_issues"],
                "story_state_commit": outcome.get("story_state_commit"),
                "story_state_changes_source": generated.get("story_state_changes_source"),
                "story_state_tool_call_count": generated.get("story_state_tool_call_count", 0),
                "memory_atom_ids": memory_atom_ids,
                "memory_recall_chars": memory_recall_chars,
            }
        )
        if tokens_used > token_budget:
            _pause_by_budget(session, book_run.id, chapter_index, completed_chapters, tokens_used)
            raise BookGenerationError("真实 LLM 生成触发 token 预算暂停，不能标记为 completed。")
    _assert_no_missing_chapters(session, book_run.id, chapter_count, completed_chapters, tokens_used)
    book_run = apply_book_run_progress(
        session,
        book_run.id,
        BookRunProgressUpdate(
            status="completed",
            current_chapter_index=chapter_count,
            progress={
                "completed_chapters": completed_chapters,
                "budget": {
                    "tokens_used": tokens_used,
                    "elapsed_time_sec": max(0, int(time.monotonic() - started_at)),
                    "estimated_cost": _total_cost_estimate(completed_chapters),
                },
                "integration_metrics": _serial_integration_metrics(
                    session,
                    book_run,
                    completed_chapters,
                ),
                "real_llm_smoke": {
                    "provider_name": _required_env(source, "STORYFORGE_LLM_PROVIDER"),
                    "model_name": _required_env(source, "STORYFORGE_LLM_MODEL"),
                    "chapter_count": chapter_count,
                },
            },
        ),
    )
    markdown_artifact = export_book_run_markdown(session, book_run.id)
    audit_artifact = export_book_run_audit_report(session, book_run.id)
    return BookGenerationResult(
        book_run=book_run,
        markdown_artifact=markdown_artifact,
        audit_artifact=audit_artifact,
        chapter_count=chapter_count,
        approved_chapter_count=_count_approved_chapters(completed_chapters),
    )


def resume_book_generation(
    session: Session,
    *,
    book_run_id: int,
    chapter_count: int,
    token_budget: int,
    target_word_count: int | None = None,
    chapter_word_count_min: int = 600,
    chapter_word_count_max: int = 1600,
    max_chapter_count: int = 10,
    env: Mapping[str, str | None] | None = None,
) -> BookGenerationResult:
    """从已保留的真实 LLM 生成的 SQLite 继续补完剩余章节。"""

    source = os.environ if env is None else env
    _assert_preflight(
        source,
        chapter_count,
        token_budget,
        target_word_count,
        chapter_word_count_min,
        chapter_word_count_max,
        max_chapter_count=max_chapter_count,
    )
    started_at = time.monotonic()
    book_run = session.get(BookRun, book_run_id)
    if book_run is None:
        raise BookGenerationError(f"BookRun {book_run_id} 不存在，无法断点续跑。")
    if book_run.status == "completed":
        markdown_artifact = export_book_run_markdown(session, book_run.id)
        audit_artifact = export_book_run_audit_report(session, book_run.id)
        return BookGenerationResult(
            book_run=book_run,
            markdown_artifact=markdown_artifact,
            audit_artifact=audit_artifact,
            chapter_count=chapter_count,
            approved_chapter_count=_count_approved_chapters(
                _reconstruct_completed_chapters(session, book_run.id)
            ),
        )
    if book_run.total_chapters != chapter_count:
        book_run.total_chapters = chapter_count
        book_run.chapter_budget = chapter_count
        session.commit()
        session.refresh(book_run)

    completed_chapters = _reconstruct_completed_chapters(session, book_run.id)
    completed_ordinals = {
        int(item["chapter_index"])
        for item in completed_chapters
        if isinstance(item.get("chapter_index"), int)
    }
    tokens_used = sum(int(item.get("token_usage") or 0) for item in completed_chapters)

    for chapter_index in range(1, chapter_count + 1):
        if chapter_index in completed_ordinals:
            continue
        chapter_started_at = time.monotonic()
        chapter = _chapter(session, book_run.book_id, chapter_index)
        memory_recall_chars = memory_recall_chars_for_chapter(session, book_run.book_id, chapter.ordinal)
        try:
            generated = _generate_chapter(session, source, chapter_index, chapter, book_run_id=book_run.id)
        except (KeyboardInterrupt, SystemExit):
            _pause_by_interrupt(session, book_run.id, chapter_index, completed_chapters, tokens_used)
            raise
        tokens_used += int(generated["token_usage"])
        scene = _persist_draft_scene(session, chapter, str(generated["content"]))
        model_run = _record_model_run(session, book_run, scene, source, generated)
        scene_packet = _record_scene_packet(
            session,
            book_run,
            scene,
            story_state_changes=list(generated.get("story_state_changes") or []),
            story_state_changes_source=str(generated.get("story_state_changes_source") or ""),
        )
        outcome = _judge_and_repair_loop(session, source, book_run, scene, scene_packet)
        observe_book_generation_chapter(
            judge_call_count=int(outcome.get("judge_call_count") or 0),
            repair_patch_count=len(outcome.get("repair_patch_ids") or []),
            cost_cny_estimated=float(generated.get("cost_cny_estimated") or 0.0),
        )
        approved = _finalize_scene_decision(session, chapter, scene, int(outcome["quality_score"]))
        memory_atom_ids = (
            extract_memory_atoms_for_chapter(
                session,
                book_id=book_run.book_id,
                chapter_id=chapter.id,
                chapter_ordinal=chapter.ordinal,
                approved_scene_id=int(scene.id),
                content=scene.content or str(generated["content"]),
            )
            if approved
            else []
        )
        completed_chapters.append(
            {
                "chapter_index": chapter_index,
                "model_run_id": model_run.id,
                "judge_report_id": outcome["judge_report_id"],
                "repair_patch_id": outcome["repair_patch_id"],
                "repair_patch_ids": outcome["repair_patch_ids"],
                "repair_rounds": outcome["repair_rounds"],
                "judge_call_count": int(outcome.get("judge_call_count") or 0),
                "approved_scene_id": scene.id,
                "scene_status": scene.status,
                "approved": approved,
                "token_usage": generated["token_usage"],
                "prompt_tokens": generated["prompt_tokens"],
                "completion_tokens": generated["completion_tokens"],
                "generation_latency_ms": generated["latency_ms"],
                "elapsed_time_sec": max(0, int(time.monotonic() - started_at)),
                "chapter_elapsed_time_sec": max(0, int(time.monotonic() - chapter_started_at)),
                "cost_estimate": generated["cost_cny_estimated"],
                "cost_breakdown": generated["cost_breakdown"],
                "quality_score": outcome["quality_score"],
                "quality_issues": outcome["quality_issues"],
                "story_state_commit": outcome.get("story_state_commit"),
                "story_state_changes_source": generated.get("story_state_changes_source"),
                "story_state_tool_call_count": generated.get("story_state_tool_call_count", 0),
                "memory_atom_ids": memory_atom_ids,
                "memory_recall_chars": memory_recall_chars,
            }
        )
        completed_ordinals.add(chapter_index)
        if tokens_used > token_budget:
            _pause_by_budget(session, book_run.id, chapter_index, completed_chapters, tokens_used)
            raise BookGenerationError("真实 LLM 断点续跑触发 token 预算暂停，不能标记为 completed。")

    completed_chapters.sort(key=lambda item: int(item.get("chapter_index") or 0))
    _assert_no_missing_chapters(session, book_run.id, chapter_count, completed_chapters, tokens_used)
    book_run = apply_book_run_progress(
        session,
        book_run.id,
        BookRunProgressUpdate(
            status="completed",
            current_chapter_index=chapter_count,
            progress={
                "completed_chapters": completed_chapters,
                "budget": {
                    "tokens_used": tokens_used,
                    "elapsed_time_sec": max(0, int(time.monotonic() - started_at)),
                    "estimated_cost": _total_cost_estimate(completed_chapters),
                },
                "integration_metrics": _serial_integration_metrics(
                    session,
                    book_run,
                    completed_chapters,
                ),
                "real_llm_smoke": {
                    "provider_name": _required_env(source, "STORYFORGE_LLM_PROVIDER"),
                    "model_name": _required_env(source, "STORYFORGE_LLM_MODEL"),
                    "chapter_count": chapter_count,
                    "resume": True,
                },
            },
        ),
    )
    markdown_artifact = export_book_run_markdown(session, book_run.id)
    audit_artifact = export_book_run_audit_report(session, book_run.id)
    return BookGenerationResult(
        book_run=book_run,
        markdown_artifact=markdown_artifact,
        audit_artifact=audit_artifact,
        chapter_count=chapter_count,
        approved_chapter_count=_count_approved_chapters(completed_chapters),
    )


def _create_generation_book(session: Session, chapter_count: int) -> Book:
    book = Book(
        title=f"真实 LLM 整书生成 {chapter_count} 章",
        status="draft",
        premise=DEFAULT_GENERATION_PREMISE,
    )
    session.add(book)
    session.commit()
    session.refresh(book)
    return book


def _seed_consistency_data(session: Session, book_id: int) -> None:
    """为生成书写入一条 Character Bible 与一个 Style Pack，让真实一致性数据进入 prompt。"""

    create_character_bible_entry(
        session,
        CharacterBibleCreate(
            book_id=book_id,
            canonical_name=DEFAULT_GENERATION_POV,
            aliases=["山城巡检官"],
            voice_traits={"语气": "克制", "句式": ["短句", "少解释"]},
            forbidden_traits={
                "禁止": [
                    "突然健谈",
                    "忘记右手旧灼伤",
                    "主动解释动机",
                    "长篇大论",
                    "情绪外露",
                    "微笑",
                    "大笑",
                    "哭泣",
                    "流泪",
                ],
                "替换": {
                    "突然健谈": "他只说了必要的话",
                    "忘记右手旧灼伤": "他把右手藏进袖口",
                    "主动解释动机": "他没有解释",
                    "长篇大论": "他说得很简短",
                    "微笑": "他面无表情",
                    "大笑": "他没有笑",
                    "哭泣": "他咬紧牙关",
                    "流泪": "他眼眶发红但没有流泪",
                },
            },
        ),
    )
    create_style_pack(
        session,
        StylePackCreate(
            book_id=book_id,
            name="苍岭克制悬疑风格",
            payload={
                "语气": DEFAULT_GENERATION_TONE,
                "视角": "第三人称贴身",
                "规则": ["多用动作与画面", "对话推动信息", "避免心理描写", "不写情绪词结尾"],
                "禁用表达": [
                    "不禁",
                    "情不自禁",
                    "忽然",
                    "仿佛",
                    "莫名",
                    "五味杂陈",
                    "心中一震",
                    "缓缓",
                    "深深地",
                ],
                "示例句": ["他把巡检牌收回袖口，没有解释。"],
            },
        ),
    )


def _blueprint_payload(
    book_id: int,
    chapter_count: int,
    *,
    target_word_count: int | None = None,
    chapter_word_count_min: int = 600,
    chapter_word_count_max: int = 1600,
) -> BookBlueprintCreate:
    return BookBlueprintCreate(
        book_id=book_id,
        premise=DEFAULT_GENERATION_PREMISE,
        tone=DEFAULT_GENERATION_TONE,
        target_word_count=target_word_count or max(1200, chapter_count * 1200),
        target_chapter_count=chapter_count,
        chapter_word_count_min=chapter_word_count_min,
        chapter_word_count_max=chapter_word_count_max,
        metadata={
            "pov": DEFAULT_GENERATION_POV,
            "location": DEFAULT_GENERATION_LOCATION,
            "title_seed": DEFAULT_GENERATION_TITLE_SEED,
            "planning_arcs": _default_planning_arcs(chapter_count),
        },
    )


def _default_planning_arcs(chapter_count: int) -> list[dict[str, object]]:
    """为真实生成写入多条结构化弧线，避免单弧线覆盖全书导致屏障空转。"""

    opening = _arc_points(chapter_count, 1, max(1, chapter_count // 2), chapter_count)
    pressure = _arc_points(chapter_count, 2, max(2, (chapter_count * 2) // 3), max(2, chapter_count - 1))
    world_rule = _arc_points(chapter_count, 1, max(1, chapter_count // 3), chapter_count)
    return [
        {
            "arc_id": "missing_bellsmith_case",
            "title": "铜钟匠失踪案",
            "target_chapters": opening,
            "payoff_chapter": chapter_count,
        },
        {
            "arc_id": "patrol_oath_pressure",
            "title": "巡检誓约压力",
            "target_chapters": pressure,
            "payoff_chapter": pressure[-1],
        },
        {
            "arc_id": "city_bell_rule",
            "title": "城防钟楼旧盟约",
            "target_chapters": world_rule,
            "payoff_chapter": chapter_count,
        }
    ]


def _arc_points(chapter_count: int, *candidates: int) -> list[int]:
    """把候选章号压成有序去重目标点，所有点都落在全书范围内。"""

    return sorted({min(chapter_count, max(1, int(value))) for value in candidates})


def _chapter(session: Session, book_id: int, chapter_index: int) -> Chapter:
    chapter = (
        session.query(Chapter)
        .filter(Chapter.book_id == book_id, Chapter.ordinal == chapter_index)
        .order_by(Chapter.id)
        .one()
    )
    return chapter


def _reconstruct_completed_chapters(session: Session, book_run_id: int) -> list[dict[str, object]]:
    """从中断前已落库的章节证据重建 BookRun 进度。"""

    book_run = session.get(BookRun, book_run_id)
    if book_run is None:
        raise BookGenerationError(f"BookRun {book_run_id} 不存在，无法重建进度。")
    rows = session.execute(
        select(Chapter, Scene, ModelRun, ScenePacket)
        .join(Scene, Scene.chapter_id == Chapter.id)
        .join(ModelRun, ModelRun.scene_id == Scene.id)
        .join(ScenePacket, ScenePacket.scene_id == Scene.id)
        .where(
            Chapter.book_id == book_run.book_id,
            Chapter.status == "approved",
            Scene.status == "approved",
            Scene.content.is_not(None),
            ModelRun.book_id == book_run.book_id,
        )
        .order_by(Chapter.ordinal, Scene.ordinal, Scene.id)
    ).all()

    completed: list[dict[str, object]] = []
    seen_ordinals: set[int] = set()
    for chapter, scene, model_run, scene_packet in rows:
        if chapter.ordinal in seen_ordinals:
            continue
        judge_issues = session.scalars(
            select(JudgeIssue)
            .where(JudgeIssue.scene_id == scene.id, JudgeIssue.scene_packet_id == scene_packet.id)
            .order_by(JudgeIssue.id)
        ).all()
        if not judge_issues:
            raise BookGenerationError(f"第 {chapter.ordinal} 章缺少 Judge 证据，无法断点续跑。")
        repair_patches = session.scalars(
            select(RepairPatch).where(RepairPatch.scene_id == scene.id).order_by(RepairPatch.id)
        ).all()
        blocking_issues = [issue for issue in judge_issues if issue.issue_type != "phase9b_real_judge_pass"]
        quality_score = _quality_score(list(blocking_issues))
        completed.append(
            {
                "chapter_index": chapter.ordinal,
                "model_run_id": model_run.id,
                "judge_report_id": judge_issues[0].id,
                "repair_patch_id": repair_patches[-1].id if repair_patches else None,
                "repair_patch_ids": [patch.id for patch in repair_patches],
                "repair_rounds": len(repair_patches),
                "judge_call_count": max(1, len(judge_issues)),
                "approved_scene_id": scene.id,
                # 本函数只重建 status==approved 的章，按定义即已批准产出；
                # 缺章护栏与 _count_approved_chapters 都依赖该标记，断点续跑时不可漏。
                "approved": True,
                "token_usage": model_run.token_usage,
                "elapsed_time_sec": 0,
                "cost_estimate": 0.0,
                "quality_score": quality_score,
                "quality_issues": [
                    {
                        "issue_id": issue.id,
                        "category": issue.issue_type,
                        "severity": issue.severity,
                        "summary": issue.description,
                        "dimension": _CATEGORY_DIMENSION.get(issue.issue_type, "narrative_quality"),
                    }
                    for issue in blocking_issues
                ],
            }
        )
        seen_ordinals.add(chapter.ordinal)
    return completed


def _generate_chapter(
    session: Session,
    source: Mapping[str, str | None],
    chapter_index: int,
    chapter: Chapter,
    *,
    book_run_id: int | None = None,
) -> dict[str, object]:
    recap_full_chapters = _optional_int(source, "STORYFORGE_LLM_SMOKE_RECAP_FULL_CHAPTERS", RECAP_FULL_CHAPTERS_DEFAULT)

    # Phase 1 Context 增量化：传入 chapter_ordinal 触发 BookContext 缓存路径
    injection = assemble_prompt_injection(
        session,
        book_id=chapter.book_id,
        chapter_id=chapter.id,
        chapter_ordinal=chapter.ordinal,  # Phase 1: 新增参数触发缓存
        chapter_title=chapter.title,
        chapter_goal=chapter.summary or "推进主线调查。",
        style_baseline_chapter_window=recap_full_chapters if recap_full_chapters > 0 else None,
    )
    roster = build_story_state_roster(
        session,
        book_id=chapter.book_id,
        book_run_id=book_run_id,
        chapter_pov=chapter.pov,
        chapter_location=chapter.location,
    )
    prompt = append_story_state_changes_instruction(
        build_draft_prompt_from_state(injection, full_chapter=True),
        roster=roster,
    )

    # 测试探针：故意注入违规指令，验证 Judge 检测 + Repair 修复能力。
    # 仅在 SMOKE_INJECT_VIOLATION_CHAPTER 指定的章节触发，默认关闭。
    inject_violation_chapter = _optional_int(source, "SMOKE_INJECT_VIOLATION_CHAPTER", 0)
    if inject_violation_chapter == chapter_index:
        violation_override = (
            "\n\n【特殊要求 - 覆盖角色设定】\n"
            "本章中，沈砚因调查压力过大而情绪崩溃，忍不住哭泣流泪。"
            "这是剧情需要，必须明确描写他哭泣或流泪的画面。\n"
        )
        prompt = prompt + violation_override

    call_kwargs: dict[str, object] = {}
    if _story_state_tool_calls_enabled(source):
        call_kwargs["tools"] = story_state_changes_tools()
        call_kwargs["tool_choice"] = "auto"
    result = _call_llm(
        source,
        system_prompt="你是 StoryForge 的中文长篇创作助手。",
        user_prompt=prompt,
        **call_kwargs,
    )
    content, block_changes = extract_story_state_changes_from_content(str(result["content"]))
    tool_changes = extract_story_state_changes_from_tool_calls(result.get("tool_calls"))
    raw_changes = tool_changes or block_changes
    story_state_changes_source = "tool_call" if tool_changes else "json_block" if block_changes else "none"
    normalized_changes = normalize_story_state_changes_with_roster(raw_changes, roster)
    story_state_changes, schema_errors = validate_story_state_change_dicts(normalized_changes)
    if schema_errors:
        story_state_changes = _retry_story_state_changes_schema(
            source,
            prose=content,
            invalid_changes=normalized_changes,
            schema_errors=schema_errors,
            roster=roster,
        )
        if story_state_changes:
            story_state_changes_source = f"{story_state_changes_source}_schema_retry"
    result["content"] = content
    return {
        "prompt": prompt,
        "story_state_changes": story_state_changes,
        "story_state_changes_source": story_state_changes_source,
        "story_state_tool_call_count": len(result.get("tool_calls") or []),
        **result,
    }


def _story_state_tool_calls_enabled(source: Mapping[str, str | None]) -> bool:
    value = _env_value(source, "STORYFORGE_LLM_STORY_STATE_TOOL_CALLS").lower()
    return value not in {"0", "false", "no", "off"}


def _retry_story_state_changes_schema(
    source: Mapping[str, str | None],
    *,
    prose: str,
    invalid_changes: list[dict[str, object]],
    schema_errors: list[str],
    roster: list[StoryStateRosterEntry],
) -> list[dict[str, object]]:
    """仅重试修正 CHANGES JSON schema，不重写章节正文。"""

    roster_lines = []
    for entry in roster[:30]:
        entity_id = getattr(entry, "entity_id", "")
        entity_kind = getattr(entry, "entity_kind", "")
        canonical_name = getattr(entry, "canonical_name", "")
        aliases = "、".join(getattr(entry, "aliases", ()) or ()) or "无"
        roster_lines.append(
            f"- {entity_kind} | entity_id={entity_id} | canonical_name={canonical_name} | aliases={aliases}"
        )
    retry_prompt = (
        "请只修正下列 STORY_STATE_CHANGES JSON 数组，使其满足 schema；不要改写正文，不要解释。\n\n"
        f"【正文】\n{prose[:4000]}\n\n"
        f"【schema 错误】\n" + "\n".join(f"- {error}" for error in schema_errors) + "\n\n"
        "【花名册】\n" + "\n".join(roster_lines) + "\n\n"
        f"【待修正 JSON】\n{json.dumps(invalid_changes, ensure_ascii=False)}"
    )
    try:
        retry = _call_llm(
            source,
            system_prompt="你是 StoryForge 的 CHANGES JSON schema 修正器。只返回 JSON 数组。",
            user_prompt=retry_prompt,
        )
    except BookGenerationError:
        return []
    raw_content = str(retry.get("content") or "").strip()
    wrapped = raw_content
    if "【STORY_STATE_CHANGES】" not in wrapped:
        wrapped = f"【STORY_STATE_CHANGES】\n{raw_content}\n【/STORY_STATE_CHANGES】"
    _cleaned, retry_changes = extract_story_state_changes_from_content(wrapped)
    normalized = normalize_story_state_changes_with_roster(retry_changes, roster)
    valid, _errors = validate_story_state_change_dicts(normalized)
    return valid


def _prior_chapters_recap(
    session: Session,
    book_id: int,
    ordinal: int,
    *,
    full_chapters: int = RECAP_FULL_CHAPTERS_DEFAULT,
    max_chars: int = RECAP_MAX_CHARS_DEFAULT,
) -> str | None:
    """构建有界的续写上文：最近 N 章给完整正文，更早章节压成前情提要。

    一次 JOIN 取回全部前序章节及其首个已批准 scene，避免逐章 N+1 查询；
    总长度受 max_chars 限制，让 prompt 与查询开销不随章数线性膨胀。
    """

    if ordinal <= 1:
        return None
    rows = session.execute(
        select(Chapter.ordinal, Chapter.title, Chapter.summary, Scene.content)
        .join(Scene, Scene.chapter_id == Chapter.id)
        .where(
            Chapter.book_id == book_id,
            Chapter.ordinal < ordinal,
            Scene.status == "approved",
            Scene.content.is_not(None),
        )
        .order_by(Chapter.ordinal, Scene.ordinal, Scene.id)
    ).all()

    # 同章多个已批准 scene 时只取序最靠前的一个，保持与原行为一致。
    seen: set[int] = set()
    chapters: list[tuple[str, str, str]] = []  # (title, summary, content)
    for chap_ordinal, title, summary, content in rows:
        if chap_ordinal in seen:
            continue
        body = str(content).strip() if content else ""
        if not body:
            continue
        seen.add(chap_ordinal)
        chapters.append((str(title or f"第{chap_ordinal}章"), str(summary or "").strip(), body))
    if not chapters:
        return None

    full = chapters[-full_chapters:] if full_chapters > 0 else []
    older = chapters[: len(chapters) - len(full)]

    sections: list[str] = []
    if older:
        digest_lines = [
            f"- {title}：{(summary or body)[:RECAP_OLDER_SUMMARY_MAX_CHARS]}"
            for title, summary, body in older
        ]
        sections.append("【前情提要（更早章节梗概）】\n" + "\n".join(digest_lines))
    for title, _summary, body in full:
        sections.append(f"【最近章节原文 · {title}】\n{body}")

    recap = "\n\n".join(sections)
    if len(recap) <= max_chars:
        return recap
    # 超限时优先保留最近章节原文（位于末尾），从头截断。
    return recap[-max_chars:]


def main(
    argv: list[str] | None = None,
    *,
    session_factory: Callable[[], object] | None = None,
    runner: Callable[..., object] = run_book_generation,
    output: TextIO | None = None,
    error: TextIO | None = None,
    env: Mapping[str, str | None] | None = None,
) -> int:
    from app.domains.book_runs.book_generation_cli import main as cli_main

    return cli_main(
        argv,
        session_factory=session_factory,
        runner=runner,
        output=output,
        error=error,
        env=env,
    )


if __name__ == "__main__":
    raise SystemExit(main())
