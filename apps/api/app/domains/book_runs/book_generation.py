from __future__ import annotations

import os
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import TextIO

from sqlalchemy import select
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.artifacts.models import Artifact
from app.domains.blueprints.models import BookBlueprint  # noqa: F401  facade re-export
from app.domains.blueprints.schemas import BookBlueprintCreate
from app.domains.blueprints.service import create_book_blueprint, lock_book_blueprint, trigger_chapter_plan
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
        try:
            generated = _generate_chapter(session, source, chapter_index, chapter)
            tokens_used += generated["token_usage"]
            scene = _persist_draft_scene(session, chapter, str(generated["content"]))
            model_run = _record_model_run(session, book_run, scene, source, generated)
            scene_packet = _record_scene_packet(session, book_run, scene)
            outcome = _judge_and_repair_loop(session, source, book_run, scene, scene_packet)
            approved = _finalize_scene_decision(session, chapter, scene, int(outcome["quality_score"]))
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
            }
        )
        if tokens_used > token_budget:
            _pause_by_budget(session, book_run.id, chapter_index, completed_chapters, tokens_used)
            raise BookGenerationError("真实 LLM 生成触发 token 预算暂停，不能标记为 completed。")
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
        try:
            generated = _generate_chapter(session, source, chapter_index, chapter)
        except (KeyboardInterrupt, SystemExit):
            _pause_by_interrupt(session, book_run.id, chapter_index, completed_chapters, tokens_used)
            raise
        tokens_used += int(generated["token_usage"])
        scene = _persist_draft_scene(session, chapter, str(generated["content"]))
        model_run = _record_model_run(session, book_run, scene, source, generated)
        scene_packet = _record_scene_packet(session, book_run, scene)
        outcome = _judge_and_repair_loop(session, source, book_run, scene, scene_packet)
        approved = _finalize_scene_decision(session, chapter, scene, int(outcome["quality_score"]))
        completed_chapters.append(
            {
                "chapter_index": chapter_index,
                "model_run_id": model_run.id,
                "judge_report_id": outcome["judge_report_id"],
                "repair_patch_id": outcome["repair_patch_id"],
                "repair_patch_ids": outcome["repair_patch_ids"],
                "repair_rounds": outcome["repair_rounds"],
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
            }
        )
        completed_ordinals.add(chapter_index)
        if tokens_used > token_budget:
            _pause_by_budget(session, book_run.id, chapter_index, completed_chapters, tokens_used)
            raise BookGenerationError("真实 LLM 断点续跑触发 token 预算暂停，不能标记为 completed。")

    completed_chapters.sort(key=lambda item: int(item.get("chapter_index") or 0))
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
        premise="林岚在雾港追查失真的灯塔信号，并把每一步证据写入审计链。",
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
            canonical_name="林岚",
            aliases=["雾港调查员"],
            voice_traits={"语气": "克制", "句式": ["短句", "少解释"]},
            forbidden_traits={
                "禁止": [
                    "突然健谈",
                    "忘记左臂旧伤",
                    "主动解释动机",
                    "长篇大论",
                    "情绪外露",
                    "微笑",
                    "大笑",
                    "哭泣",
                    "流泪",
                ],
                "替换": {
                    "突然健谈": "她只说了必要的话",
                    "主动解释动机": "她没有解释",
                    "长篇大论": "她说得很简短",
                    "微笑": "她面无表情",
                    "大笑": "她没有笑",
                    "哭泣": "她咬紧牙关",
                    "流泪": "她眼眶发红但没有流泪",
                },
            },
        ),
    )
    create_style_pack(
        session,
        StylePackCreate(
            book_id=book_id,
            name="雾港克制悬疑风格",
            payload={
                "语气": "克制悬疑",
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
                "示例句": ["她把左臂藏进披风，没有解释。"],
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
        premise="林岚在雾港追查失真的灯塔信号，并把每一步证据写入审计链。",
        tone="克制悬疑",
        target_word_count=target_word_count or max(1200, chapter_count * 1200),
        target_chapter_count=chapter_count,
        chapter_word_count_min=chapter_word_count_min,
        chapter_word_count_max=chapter_word_count_max,
        metadata={
            "pov": "林岚",
            "location": "雾港",
            "title_seed": "真实生成",
            "planning_arcs": _default_planning_arcs(chapter_count),
        },
    )


def _default_planning_arcs(chapter_count: int) -> list[dict[str, object]]:
    """为真实生成写入结构化弧线，让 arc completion 指标来自 Blueprint 事实源。"""

    targets = list(range(1, chapter_count + 1))
    return [
        {
            "arc_id": "audit_signal",
            "title": "灯塔信号审计链",
            "target_chapters": targets,
            "payoff_chapter": chapter_count,
        }
    ]


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
                "approved_scene_id": scene.id,
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
    prompt = build_draft_prompt_from_state(injection, full_chapter=True)

    # 测试探针：故意注入违规指令，验证 Judge 检测 + Repair 修复能力。
    # 仅在 SMOKE_INJECT_VIOLATION_CHAPTER 指定的章节触发，默认关闭。
    inject_violation_chapter = _optional_int(source, "SMOKE_INJECT_VIOLATION_CHAPTER", 0)
    if inject_violation_chapter == chapter_index:
        violation_override = (
            "\n\n【特殊要求 - 覆盖角色设定】\n"
            "本章中，林岚因调查压力过大而情绪崩溃，忍不住哭泣流泪。"
            "这是剧情需要，必须明确描写她哭泣或流泪的画面。\n"
        )
        prompt = prompt + violation_override

    result = _call_llm(
        source,
        system_prompt="你是 StoryForge 的中文长篇创作助手。",
        user_prompt=prompt,
    )
    return {"prompt": prompt, **result}


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
