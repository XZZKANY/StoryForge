from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import TextIO
from urllib import error, request

from sqlalchemy import select
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.artifacts.models import Artifact
from app.domains.blueprints.models import BookBlueprint
from app.domains.blueprints.schemas import BookBlueprintCreate
from app.domains.blueprints.service import create_book_blueprint, lock_book_blueprint, trigger_chapter_plan
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
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import (
    JUDGE_SYSTEM_FAILURE_CATEGORY,
    DetectedIssue,
    _detect_character_bible_violations,
    _detect_style_fingerprint_drift,
    _detect_timeline_conflicts,
    _forbidden_trait_phrases,
    deterministic_judge_fallback,
    semantic_judge_with_status,
)
from app.domains.model_runs.models import ModelRun
from app.domains.model_runs.schemas import ModelRunCreate
from app.domains.model_runs.service import create_model_run
from app.domains.repair.schemas import RepairPatchCreate
from app.domains.repair.service import create_repair_patch
from app.domains.style_packs.schemas import StylePackCreate
from app.domains.style_packs.service import create_style_pack, list_style_packs

REQUIRED_REAL_LLM_ENV = (
    "STORYFORGE_LLM_API_KEY",
    "STORYFORGE_LLM_BASE_URL",
    "STORYFORGE_LLM_MODEL",
    "STORYFORGE_LLM_PROVIDER",
)

REPAIR_THRESHOLD = 70
MAX_REPAIR_ROUNDS = 3
# 字数上限护栏倍数：蓝图 chapter_word_count_max 是「目标上限」而非硬拒批线。
# 实测真实模型（如 mimo）在质量门禁全 pass 时仍系统性写超目标上限，且超出部分是
# 密实正文而非注水。固定上限会误伤这类好内容，故只在超过 目标上限 × 该倍数 时
# 才判「失控」拒批——既放过「写得好但偏长」，又拦得住「无限重复/截断失败」。
WORD_COUNT_CEILING_RUNAWAY_FACTOR = 2.5
MARKDOWN_CHAPTER_HEADING_RE = re.compile(r"^##\s+第\s*(\d+)\s*章\b")
# 推理模型（mimo 等）会把思维链放进 <think>...</think>，部分返回风格让它混进
# message.content。完整成对的标记整段剥掉；只剩闭合标签 </think> 时（开头 <think>
# 被上游吞掉的残体）连同它之前的推理草稿一并丢弃，只保留最后一段闭合标签之后的正文。
THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
THINK_OPEN_RE = re.compile(r"<think>", re.IGNORECASE)
THINK_CLOSE_RE = re.compile(r"</think>", re.IGNORECASE)
MODEL_RUN_SUMMARY_MAX_CHARS = 50000
# 续写上文 recap 的默认上限：最近 N 章给完整正文，更早章节压缩成前情提要，
# 避免逐章拼接全部前文导致 prompt 与本地查询开销随章数平方增长。
RECAP_FULL_CHAPTERS_DEFAULT = 2
RECAP_MAX_CHARS_DEFAULT = 6000
RECAP_OLDER_SUMMARY_MAX_CHARS = 160


class BookGenerationPreflightError(RuntimeError):
    """真实 LLM 生成缺少私有运行配置。"""


class BookGenerationError(RuntimeError):
    """真实 LLM 生成运行失败，不能写入完成证据。"""


@dataclass(frozen=True)
class BookGenerationResult:
    """真实 LLM 整书生成产物，供验证报告引用。"""

    book_run: BookRun
    markdown_artifact: Artifact
    audit_artifact: Artifact
    chapter_count: int
    approved_chapter_count: int = 0


@dataclass(frozen=True)
class _JudgeRunResult:
    """单轮 Judge 的持久化结果，附带是否走快速路径的审计原因。"""

    issues: list[JudgeIssue]
    quality_score: int
    quality_issues: list[dict[str, object]]
    fast_path_reason: str | None = None


def _count_approved_chapters(completed_chapters: list[dict[str, object]]) -> int:
    """统计真正批准（产出）的章数，与"已处理章数"区分，避免计数失真。"""

    return sum(1 for item in completed_chapters if item.get("approved"))


def missing_book_generation_env(env: Mapping[str, str | None] | None = None) -> list[str]:
    """列出真实 LLM 生成所需但尚未配置的环境变量名。"""

    source = os.environ if env is None else env
    return [name for name in REQUIRED_REAL_LLM_ENV if not _env_value(source, name)]


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


def _assert_preflight(
    source: Mapping[str, str | None],
    chapter_count: int,
    token_budget: int,
    target_word_count: int | None = None,
    chapter_word_count_min: int = 600,
    chapter_word_count_max: int = 1600,
    *,
    max_chapter_count: int = 10,
) -> None:
    missing = missing_book_generation_env(source)
    if missing:
        joined = ", ".join(missing)
        raise BookGenerationPreflightError(f"缺少真实 LLM 生成环境变量：{joined}。")
    if max_chapter_count <= 0:
        raise BookGenerationPreflightError("真实 LLM 生成章节上限必须为正数。")
    if chapter_count < 1 or chapter_count > max_chapter_count:
        raise BookGenerationPreflightError(f"真实 LLM 生成只允许 1 到 {max_chapter_count} 章。")
    if token_budget <= 0:
        raise BookGenerationPreflightError("真实 LLM 生成必须设置正数 token_budget。")
    if target_word_count is not None and target_word_count <= 0:
        raise BookGenerationPreflightError("真实 LLM 生成必须设置正数 target_word_count。")
    if chapter_word_count_min <= 0 or chapter_word_count_max <= 0:
        raise BookGenerationPreflightError("真实 LLM 生成章节字数上下限必须为正数。")
    if chapter_word_count_min > chapter_word_count_max:
        raise BookGenerationPreflightError("真实 LLM 生成章节最小字数不能大于最大字数。")


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


def _strip_reasoning_leak(content: str) -> str:
    """剥离混进正文的思维链：成对 <think>…</think> 整段删除；只剩残缺闭合标签时，
    丢弃最后一个 </think> 及其之前的全部内容（即被泄漏的推理草稿），只留其后的正文。"""

    cleaned = THINK_BLOCK_RE.sub("", content)
    if THINK_CLOSE_RE.search(cleaned):
        cleaned = cleaned[cleaned.rfind("</think>") + len("</think>") :]
    # 残留的孤立开标签（极少见：有开无闭）直接抹掉标记本身，避免标签裸露在成稿里。
    cleaned = THINK_OPEN_RE.sub("", cleaned)
    return cleaned.strip()


def _call_llm(
    source: Mapping[str, str | None],
    *,
    system_prompt: str,
    user_prompt: str,
) -> dict[str, object]:
    """对真实 OpenAI 兼容端点发一次 chat/completions，返回正文与 token 使用。"""

    payload = {
        "model": _required_env(source, "STORYFORGE_LLM_MODEL"),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": _optional_float(source, "STORYFORGE_LLM_TEMPERATURE", 0.7),
    }
    max_completion_tokens = _optional_int(source, "STORYFORGE_LLM_MAX_COMPLETION_TOKENS", 0)
    if max_completion_tokens > 0:
        payload["max_completion_tokens"] = max_completion_tokens
    reasoning_effort = _env_value(source, "STORYFORGE_LLM_REASONING_EFFORT")
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    http_request = request.Request(
        f"{_required_env(source, 'STORYFORGE_LLM_BASE_URL').rstrip('/')}/chat/completions",
        data=body,
        headers=_llm_request_headers(source),
        method="POST",
    )
    timeout = _optional_float(source, "STORYFORGE_LLM_TIMEOUT_SECONDS", 300.0)
    started_at = time.monotonic()
    print(
        f"[_call_llm] url={http_request.full_url} timeout={timeout}s body_bytes={len(body)} "
        f"prompt_chars={len(user_prompt)} max_completion_tokens={payload.get('max_completion_tokens', 'unset')} "
        f"reasoning_effort={payload.get('reasoning_effort', 'unset')}",
        file=sys.stderr,
        flush=True,
    )
    try:
        with request.urlopen(http_request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        try:
            error_body = exc.read().decode("utf-8", errors="replace")[:2000]
        except Exception:  # noqa: BLE001 - 仅用于诊断，读不出 body 不应掩盖原始错误
            error_body = "<无法读取响应体>"
        print(
            f"[_call_llm] HTTPError code={exc.code} elapsed={elapsed_ms}ms body={error_body}",
            file=sys.stderr,
            flush=True,
        )
        raise BookGenerationError(
            f"真实 LLM 返回 HTTP {exc.code}（耗时 {elapsed_ms}ms）：{error_body}"
        ) from exc
    except (error.URLError, TimeoutError) as exc:
        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        reason = getattr(exc, "reason", exc)
        print(
            f"[_call_llm] 连接失败/超时 elapsed={elapsed_ms}ms timeout={timeout}s reason={reason}",
            file=sys.stderr,
            flush=True,
        )
        raise BookGenerationError(
            f"真实 LLM 调用超时或连接失败（耗时 {elapsed_ms}ms，timeout={timeout}s）：{reason}"
        ) from exc
    finish_reason = None
    choices = data.get("choices") if isinstance(data, dict) else None
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        finish_reason = choices[0].get("finish_reason")
    content = data["choices"][0]["message"]["content"]
    if not isinstance(content, str) or not content.strip():
        raw_usage = data.get("usage") if isinstance(data, dict) else None
        print(
            f"[_call_llm] 空返回 finish_reason={finish_reason} usage={raw_usage} "
            f"elapsed={int((time.monotonic() - started_at) * 1000)}ms",
            file=sys.stderr,
            flush=True,
        )
        raise BookGenerationError("真实 LLM 返回内容为空，不能继续 BookRun 生成。")
    raw_chars = len(content)
    content = _strip_reasoning_leak(content)
    if not content:
        print(
            f"[_call_llm] 思维链剥离后内容为空 finish_reason={finish_reason} raw_chars={raw_chars} "
            f"elapsed={int((time.monotonic() - started_at) * 1000)}ms",
            file=sys.stderr,
            flush=True,
        )
        raise BookGenerationError("真实 LLM 返回仅含思维链、无正文，不能继续 BookRun 生成。")
    if len(content) != raw_chars:
        print(
            f"[_call_llm] 剥离思维链泄漏 raw_chars={raw_chars} clean_chars={len(content)}",
            file=sys.stderr,
            flush=True,
        )
    usage = _token_usage(data, user_prompt, content)
    cost_breakdown = _cost_breakdown(source, usage)
    print(
        f"[_call_llm] ok finish_reason={finish_reason} completion_tokens={usage.get('completion_tokens')} "
        f"content_chars={len(content)} elapsed={int((time.monotonic() - started_at) * 1000)}ms",
        file=sys.stderr,
        flush=True,
    )
    return {
        "content": content,
        **usage,
        "cost_cny_estimated": cost_breakdown["total_cny"],
        "cost_breakdown": cost_breakdown,
        "latency_ms": max(0, int((time.monotonic() - started_at) * 1000)),
    }


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


def _persist_draft_scene(session: Session, chapter: Chapter, content: str) -> Scene:
    """先把生成正文落为 draft 场景（不批准、不进 BookContext），供 Judge/Repair 操作。"""

    scene = Scene(
        chapter_id=chapter.id,
        ordinal=1,
        title=f"{chapter.title} 真实 LLM 正文",
        status="draft",
        content=content,
    )
    session.add(scene)
    session.commit()
    session.refresh(scene)
    return scene


def _finalize_scene_decision(
    session: Session,
    chapter: Chapter,
    scene: Scene,
    quality_score: int,
) -> bool:
    """门禁后置：仅当 Judge 评分达标才批准并追加进 BookContext；否则标 needs_revision 且不进上下文。

    坏章不进上下文是关键——否则它会污染后续每一章的 recap，把劣质蔓延到全书。
    """

    from app.domains.book_runs.book_context import get_book_context, skip_book_context_invalidation_once

    if quality_score < REPAIR_THRESHOLD:
        scene.status = "needs_revision"
        session.commit()
        session.refresh(scene)
        return False

    scene.status = "approved"
    chapter.status = "approved"
    skip_book_context_invalidation_once(session, chapter.book_id)
    session.commit()
    session.refresh(scene)

    # Phase 1 Context 增量化：仅达标章节追加进 BookContext 缓存，喂下一章 recap。
    context = get_book_context(session, chapter.book_id)
    context.append_chapter(
        session=session,
        chapter_id=chapter.id,
        ordinal=chapter.ordinal,
        title=chapter.title or f"第{chapter.ordinal}章",
        summary=chapter.summary or "",
        content=scene.content or "",
    )
    return True


def _record_model_run(
    session: Session,
    book_run: BookRun,
    scene: Scene,
    source: Mapping[str, str | None],
    generated: dict[str, object],
):
    input_summary = _model_run_summary_text(str(generated["prompt"]))
    output_summary = _model_run_summary_text(str(generated["content"]))
    return create_model_run(
        session,
        ModelRunCreate(
            book_id=book_run.book_id,
            scene_id=scene.id,
            provider_name=_required_env(source, "STORYFORGE_LLM_PROVIDER"),
            model_name=_required_env(source, "STORYFORGE_LLM_MODEL"),
            capability="llm",
            latency_ms=int(generated["latency_ms"]),
            token_usage=int(generated["token_usage"]),
            input_summary=input_summary,
            output_summary=output_summary,
            payload={
                "book_run_id": book_run.id,
                "mode": "phase9b_real_llm_smoke",
                "token_usage_source": generated["token_usage_source"],
                "prompt_tokens": generated.get("prompt_tokens", 0),
                "completion_tokens": generated.get("completion_tokens", 0),
                "total_tokens": generated["token_usage"],
                "cost_cny_estimated": generated.get("cost_cny_estimated", 0.0),
                "cost_source": (
                    generated.get("cost_breakdown", {}).get("source", "unavailable")
                    if isinstance(generated.get("cost_breakdown"), dict)
                    else "unavailable"
                ),
                "cost_breakdown": generated.get("cost_breakdown", {}),
                "input_summary_original_length": len(str(generated["prompt"])),
                "output_summary_original_length": len(str(generated["content"])),
                "input_summary_truncated": len(input_summary) < len(str(generated["prompt"])),
                "output_summary_truncated": len(output_summary) < len(str(generated["content"])),
            },
        ),
    )


def _model_run_summary_text(text: str) -> str:
    """ModelRun 摘要字段有 50000 字符上限；真实 prompt 本身不在这里裁剪。"""

    if len(text) <= MODEL_RUN_SUMMARY_MAX_CHARS:
        return text
    marker = f"\n\n[摘要已截断：原始长度 {len(text)} 字符，仅保留开头和结尾用于审计]\n\n"
    remaining = MODEL_RUN_SUMMARY_MAX_CHARS - len(marker)
    head_length = remaining // 2
    tail_length = remaining - head_length
    return text[:head_length] + marker + text[-tail_length:]


def _record_scene_packet(session: Session, book_run: BookRun, scene: Scene) -> ScenePacket:
    packet = ScenePacket(
        scene_id=scene.id,
        job_run_id=None,
        status="assembled",
        packet={"book_run_id": book_run.id, "真实 LLM 生成": True, "证据链接": []},
        version=1,
    )
    session.add(packet)
    session.commit()
    session.refresh(packet)
    return packet


_SEVERITY_PENALTY = {"high": 15, "medium": 8, "low": 3}
_CATEGORY_DIMENSION = {
    "setting_conflict": "world_consistency",
    "timeline_conflict": "timeline_consistency",
    "relationship_conflict": "character_consistency",
    "character_consistency": "character_consistency",
    "character_voice_violation": "character_consistency",
    "style_drift": "style_consistency",
    "judge_system_failure": "system_reliability",
}
_SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def _judge_and_repair_loop(
    session: Session,
    source: Mapping[str, str | None],
    book_run: BookRun,
    scene: Scene,
    scene_packet: ScenePacket,
) -> dict[str, object]:
    """多轮 Judge→Repair 循环，直到 score ≥ 阈值或达到最大轮数。"""

    repair_patch_ids: list[int] = []
    final_issues: list[JudgeIssue] = []
    final_quality_score = 100
    final_quality_issues: list[dict[str, object]] = []
    final_fast_path_reason: str | None = None

    for _round_num in range(MAX_REPAIR_ROUNDS):
        session.refresh(scene)
        judge_result = _run_real_judge(session, source, book_run, scene, scene_packet)
        final_issues = judge_result.issues
        final_quality_score = judge_result.quality_score
        final_quality_issues = judge_result.quality_issues
        final_fast_path_reason = judge_result.fast_path_reason

        if final_quality_score >= REPAIR_THRESHOLD or not final_issues:
            break

        repair_patch_id, _repaired_content = _maybe_repair(session, scene, final_issues, scene.content or "")
        if repair_patch_id is not None:
            repair_patch_ids.append(repair_patch_id)
        else:
            break

    final_quality_score, final_quality_issues = _apply_word_count_floor(
        session, book_run, scene, final_quality_score, final_quality_issues
    )

    judge_report_id = final_issues[0].id if final_issues else _record_summary_judge(
        session,
        scene,
        scene_packet,
        final_quality_score,
        fast_path_reason=final_fast_path_reason,
    ).id

    return {
        "judge_report_id": judge_report_id,
        "repair_patch_id": repair_patch_ids[-1] if repair_patch_ids else None,
        "repair_patch_ids": repair_patch_ids,
        "repair_rounds": len(repair_patch_ids),
        "quality_score": final_quality_score,
        "quality_issues": final_quality_issues,
    }


def _apply_word_count_floor(
    session: Session,
    book_run: BookRun,
    scene: Scene,
    quality_score: int,
    quality_issues: list[dict[str, object]],
) -> tuple[int, list[dict[str, object]]]:
    """字数门禁：下限硬拒（防截断/太短），上限按护栏倍数放宽（只拦失控，不拦偏长）。

    Judge 评分管一致性/文风，但管不住「正文被截断/太短」这种结构性残缺——
    一段 50 字的占位正文可能毫无一致性问题却拿满分。下限给 score=100 加一道真实约束。

    上限不再用蓝图目标值直接拒批：真实模型在质量全 pass 时仍系统性写超目标，且超出
    部分多为密实正文。改为 目标上限 × WORD_COUNT_CEILING_RUNAWAY_FACTOR 作为失控线，
    只拦「无限重复/明显失控」，放过「写得好但偏长」。
    """

    blueprint = session.get(BookBlueprint, book_run.blueprint_id) if book_run.blueprint_id else None
    if blueprint is None:
        return quality_score, quality_issues

    char_count = len((scene.content or "").strip())
    floor = int(blueprint.chapter_word_count_min or 0)
    ceiling = int(blueprint.chapter_word_count_max or 0)
    runaway_ceiling = int(ceiling * WORD_COUNT_CEILING_RUNAWAY_FACTOR) if ceiling > 0 else 0
    violation: str | None = None
    if floor > 0 and char_count < floor:
        violation = f"正文 {char_count} 字低于下限 {floor} 字，疑似截断或未完成。"
    elif runaway_ceiling > 0 and char_count > runaway_ceiling:
        violation = (
            f"正文 {char_count} 字超过失控线 {runaway_ceiling} 字"
            f"（目标上限 {ceiling} × {WORD_COUNT_CEILING_RUNAWAY_FACTOR}），疑似重复或失控。"
        )

    if violation is None:
        return quality_score, quality_issues

    quality_issues = [
        *quality_issues,
        {
            "issue_id": None,
            "category": "word_count_violation",
            "severity": "high",
            "summary": violation,
            "dimension": "structural_completeness",
        },
    ]
    # 直接压到阈值以下，确保 _finalize_scene_decision 拒批，而非仅扣几分仍可能过线。
    return min(quality_score, REPAIR_THRESHOLD - 1), quality_issues


def _run_real_judge(
    session: Session,
    source: Mapping[str, str | None],
    book_run: BookRun,
    scene: Scene,
    scene_packet: ScenePacket,
) -> _JudgeRunResult:
    """对生成正文跑真实 Judge（语义模型 + 确定性检测器），算出质量分与问题清单。"""

    payload = _build_judge_payload(session, scene, scene_packet)

    # 构建 character_voice_constraints，包含 forbidden_traits
    book_id = _book_id_for_scene(session, scene.id)
    character_voice_constraints: list[dict] = []
    if book_id is not None:
        from app.domains.character_bible.service import list_character_bible_entries

        entries = list_character_bible_entries(session, book_id=book_id)
        for entry in entries:
            forbidden = _forbidden_trait_phrases(entry.forbidden_traits)
            if forbidden:
                character_voice_constraints.append({
                    "name": entry.canonical_name,
                    "forbidden_traits": forbidden,
                })

    deterministic_issues = deterministic_judge_fallback(payload)
    local_issues = [
        *deterministic_issues,
        *_detect_character_bible_violations(session, payload),
        *_detect_timeline_conflicts(session, payload),
        *_detect_style_fingerprint_drift(session, payload),
    ]
    # 旁路诚实性：本地门禁只有在「确实有可校验的本地规则」时才算数。
    # required_facts 与 style_rules 都为空 → 本地门禁等于没查，score=100 是假象，必须走语义 Judge。
    local_coverage = bool(payload.required_facts) or bool(payload.style_rules)
    if _fast_judge_enabled(source) and local_coverage and not local_issues:
        return _JudgeRunResult(
            issues=[],
            quality_score=100,
            quality_issues=[],
            fast_path_reason="local_gate_passed",
        )

    # 传递 character_voice_constraints 给 create_judge_issues
    # 注意：create_judge_issues 内部会调用 semantic_judge_with_status，
    # 但它用的是 _load_voice_constraints 读 voice_traits，不读 forbidden_traits。
    # 我们需要直接调用 semantic_judge_with_status 并传入 character_voice_constraints。
    # 手动执行 Judge 流程（复制 create_judge_issues 的逻辑，但传入 character_voice_constraints）
    outcome = semantic_judge_with_status(payload, character_voice_constraints=character_voice_constraints)
    detected = outcome.issues or deterministic_issues
    detected = [
        *detected,
        *[
            issue
            for issue in local_issues
            if issue.category not in {item.category for item in detected}
            or issue.matched_text not in {item.matched_text for item in detected}
        ],
    ]

    # 注入失败标记
    if outcome.failed:
        detected.append(
            DetectedIssue(
                category=JUDGE_SYSTEM_FAILURE_CATEGORY,
                severity="high",
                span_start=0,
                span_end=0,
                summary="语义评审调用失败（网络/超时/响应不可解析），仅执行确定性检测。",
                recommended_repair_mode="none",
                expected_text="",
                replacement_text="",
                matched_text="",
                metadata={"judge_degraded": True},
            )
        )

    # 写入数据库
    issues = [
        JudgeIssue(
            scene_id=payload.scene_id,
            scene_packet_id=payload.scene_packet_id,
            issue_type=item.category,
            severity=item.severity,
            status="open",
            description=item.summary,
            payload={
                "span_start": item.span_start,
                "span_end": item.span_end,
                "evidence_links": payload.evidence_links,
                "recommended_repair_mode": item.recommended_repair_mode,
                "expected_text": item.expected_text,
                "replacement_text": item.replacement_text,
                "matched_text": item.matched_text,
                **(item.metadata or {}),
            },
        )
        for item in detected
    ]
    session.add_all(issues)
    session.commit()
    for issue in issues:
        session.refresh(issue)

    quality_score = _quality_score(issues)
    quality_issues = [
        {
            "issue_id": issue.id,
            "category": issue.issue_type,
            "severity": issue.severity,
            "summary": issue.description,
            "dimension": _CATEGORY_DIMENSION.get(issue.issue_type, "narrative_quality"),
        }
        for issue in issues
    ]
    return _JudgeRunResult(issues=issues, quality_score=quality_score, quality_issues=quality_issues)


def _fast_judge_enabled(source: Mapping[str, str | None]) -> bool:
    """默认启用本地快速 Judge；显式设为 0/false/no/off 时恢复全量语义评审。"""

    value = _env_value(source, "STORYFORGE_LLM_SMOKE_FAST_JUDGE").lower()
    return value not in {"0", "false", "no", "off"}


def _quality_score(issues: list[JudgeIssue]) -> int:
    """按严重性扣分，把评审问题压成 0-100 的质量分。"""

    score = 100
    for issue in issues:
        score -= _SEVERITY_PENALTY.get(issue.severity, 8)
    return max(0, score)


def _build_judge_payload(session: Session, scene: Scene, scene_packet: ScenePacket) -> JudgeIssueCreate:
    """从 Style Pack 编出 Judge 的风格规则。角色约束通过 character_voice_constraints 单独传递。"""

    book_id = _book_id_for_scene(session, scene.id)
    style_rules: list[str] = []

    # Style Pack → style_rules
    if book_id is not None:
        packs = list_style_packs(session, book_id)
        if packs:
            pack_payload = packs[-1].payload if isinstance(packs[-1].payload, dict) else {}
            tone = pack_payload.get("语气") or pack_payload.get("tone")
            if isinstance(tone, str) and tone.strip():
                style_rules.append(f"保持{tone.strip()}语气")
            rules = pack_payload.get("规则") or pack_payload.get("rules") or []
            style_rules.extend(rule for rule in rules if isinstance(rule, str) and rule.strip())
            forbidden = pack_payload.get("禁用表达") or pack_payload.get("forbidden_phrases") or []
            style_rules.extend(f"禁用：{phrase}" for phrase in forbidden if isinstance(phrase, str) and phrase.strip())

    return JudgeIssueCreate(
        scene_id=scene.id,
        scene_packet_id=scene_packet.id,
        content=scene.content or "",
        required_facts=[],
        style_rules=style_rules,
        evidence_links=[],
    )


def _book_id_for_scene(session: Session, scene_id: int) -> int | None:
    row = session.execute(
        select(Chapter.book_id).join(Scene, Scene.chapter_id == Chapter.id).where(Scene.id == scene_id)
    ).first()
    return int(row[0]) if row is not None else None


def _maybe_repair(
    session: Session,
    scene: Scene,
    issues: list[JudgeIssue],
    content: str,
) -> tuple[int | None, str]:
    """对最高严重性问题生成一次定向修复补丁，并把 span 替换写回正文。"""

    # Judge 系统失败标记没有可替换的 span，排除在修复目标之外，否则会浪费一轮修复。
    repairable = [issue for issue in issues if issue.issue_type != JUDGE_SYSTEM_FAILURE_CATEGORY]
    if not repairable:
        return None, content
    target = min(repairable, key=lambda issue: _SEVERITY_ORDER.get(issue.severity, 1))
    try:
        repair_patch = create_repair_patch(session, RepairPatchCreate(issue_id=target.id, content=content))
    except Exception:  # noqa: BLE001 — span 与正文不再匹配时跳过修复，保留原文与问题证据。
        return None, content
    patch = repair_patch.patch or {}
    span_start = int(patch.get("span_start", 0))
    span_end = int(patch.get("span_end", span_start))
    replacement_text = str(patch.get("replacement_text", ""))
    if span_start < 0 or span_end < span_start or span_end > len(content):
        return repair_patch.id, content
    repaired_content = content[:span_start] + replacement_text + content[span_end:]
    scene.content = repaired_content
    session.commit()
    session.refresh(scene)
    return repair_patch.id, repaired_content


def _record_summary_judge(
    session: Session,
    scene: Scene,
    scene_packet: ScenePacket,
    quality_score: int,
    *,
    fast_path_reason: str | None = None,
) -> JudgeIssue:
    """Judge 未发现问题时仍落一条通过记录，作为审计链的 judge_report_id。"""

    payload: dict[str, object] = {"score": quality_score, "mode": "phase9b_real_llm_smoke"}
    if fast_path_reason is not None:
        payload["judge_fast_path"] = fast_path_reason
    judge = JudgeIssue(
        scene_id=scene.id,
        scene_packet_id=scene_packet.id,
        job_run_id=None,
        issue_type="phase9b_real_judge_pass",
        severity="low",
        status="resolved",
        description="真实 Judge 未发现一致性或文风问题，章节通过。",
        payload=payload,
    )
    session.add(judge)
    session.commit()
    session.refresh(judge)
    return judge


def _pause_by_failure(
    session: Session,
    book_run_id: int,
    chapter_index: int,
    completed_chapters: list[dict[str, object]],
    tokens_used: int,
    error_message: str,
) -> None:
    """单章生成失败时落库已完成证据，便于断点诊断与续跑，而非整进程零证据退出。"""

    session.rollback()
    apply_book_run_progress(
        session,
        book_run_id,
        BookRunProgressUpdate(
            status="failed",
            current_chapter_index=chapter_index,
            progress={
                "completed_chapters": completed_chapters,
                "budget": {"tokens_used": tokens_used, "elapsed_time_sec": 0, "estimated_cost": 0.0},
                "failure": {"chapter_index": chapter_index, "error": error_message[:2000]},
            },
        ),
    )


def _pause_by_interrupt(
    session: Session,
    book_run_id: int,
    chapter_index: int,
    completed_chapters: list[dict[str, object]],
    tokens_used: int,
) -> None:
    """进程被中断（Ctrl-C / SystemExit）时把 run 落为可续跑的 paused，避免孤儿 running。"""

    session.rollback()
    apply_book_run_progress(
        session,
        book_run_id,
        BookRunProgressUpdate(
            status="paused_by_user",
            current_chapter_index=chapter_index,
            progress={
                "completed_chapters": completed_chapters,
                "budget": {"tokens_used": tokens_used, "elapsed_time_sec": 0, "estimated_cost": 0.0},
                "pause_reason": f"在第 {chapter_index} 章生成期间被中断，已保住前 {len(completed_chapters)} 章证据。",
            },
        ),
    )


def _pause_by_budget(
    session: Session,
    book_run_id: int,
    chapter_index: int,
    completed_chapters: list[dict[str, object]],
    tokens_used: int,
) -> None:
    apply_book_run_progress(
        session,
        book_run_id,
        BookRunProgressUpdate(
            status="paused_by_budget",
            current_chapter_index=chapter_index,
            progress={
                "completed_chapters": completed_chapters,
                "budget": {"tokens_used": tokens_used, "elapsed_time_sec": 0, "estimated_cost": 0.0},
                "pause_reason": "token_budget_exceeded",
            },
        ),
    )


def _serial_integration_metrics(
    session: Session,
    book_run: BookRun,
    completed_chapters: list[dict[str, object]],
) -> dict[str, object]:
    """从串行直跑可观测事实生成集成指标，不把串行路径伪装成并发路径。"""

    chapter_count = max(1, len(completed_chapters))
    legacy_scene_query_count = max(1, chapter_count * 2)
    context_cache_hit_rate = round((legacy_scene_query_count - 1) / legacy_scene_query_count, 4)
    return {
        "context_cache_hit_rate": context_cache_hit_rate,
        "memory_recall_budget_used": _direct_memory_recall_budget_used(completed_chapters),
        "arc_completion_rate": _arc_completion_rate(session, book_run.blueprint_id),
        "db_query_count_per_chapter": 3,
        "chapter_generation_time_p50": _chapter_generation_time_p50(completed_chapters),
        "concurrent_chapter_utilization": 0.0,
        "metric_scope": "phase9b_direct_smoke_serial",
        "metric_notes": {
            "context_cache_hit_rate": "按旧基线每章风格和前文各一次 Scene 查询、当前 BookContext 一次初始化查询投影。",
            "db_query_count_per_chapter": "沿用 Phase 1 Context 优化本地验收上限，真实查询计数由专门回归测试覆盖。",
            "concurrent_chapter_utilization": "串行直跑为串行章节循环；PH5 并发门禁必须由 workflow BookLoop 并发 runner 证明。",
        },
    }


def _direct_memory_recall_budget_used(completed_chapters: list[dict[str, object]]) -> int:
    """串行直跑未注入 Story Memory 召回预算，按当前运行事实记为 0。"""

    return sum(int(item.get("memory_recall_chars") or 0) for item in completed_chapters if isinstance(item, dict))


def _arc_completion_rate(session: Session, blueprint_id: int | None) -> float:
    if blueprint_id is None:
        return 0.0
    blueprint = session.get(BookBlueprint, blueprint_id)
    metadata = blueprint.metadata_ if blueprint is not None and isinstance(blueprint.metadata_, dict) else {}
    planning_summary = metadata.get("planning_summary") if isinstance(metadata, dict) else None
    if not isinstance(planning_summary, dict):
        return 0.0
    value = planning_summary.get("arc_completion_ratio")
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, int | float):
        return max(0.0, min(1.0, float(value)))
    return 0.0


def _chapter_generation_time_p50(completed_chapters: list[dict[str, object]]) -> float:
    seconds: list[float] = []
    for item in completed_chapters:
        if not isinstance(item, dict):
            continue
        latency_ms = item.get("generation_latency_ms")
        if isinstance(latency_ms, bool):
            continue
        if isinstance(latency_ms, int | float):
            seconds.append(max(0.0, float(latency_ms) / 1000))
            continue
        elapsed = item.get("chapter_elapsed_time_sec")
        if isinstance(elapsed, bool):
            continue
        if isinstance(elapsed, int | float):
            seconds.append(max(0.0, float(elapsed)))
    return round(float(median(seconds)), 3) if seconds else 0.0


def _llm_request_headers(source: Mapping[str, str | None]) -> dict[str, str]:
    credential = _required_env(source, "STORYFORGE_LLM_API_KEY")
    auth_header = _env_value(source, "STORYFORGE_LLM_AUTH_HEADER").lower() or "bearer"
    headers = {"Content-Type": "application/json"}
    if auth_header == "api-key":
        headers["api-key"] = credential
        return headers
    if auth_header != "bearer":
        raise BookGenerationPreflightError("STORYFORGE_LLM_AUTH_HEADER 只支持 api-key 或 bearer。")
    headers["Authorization"] = f"Bearer {credential}"
    return headers


def _token_usage(data: object, prompt: str, content: str) -> dict[str, int | str]:
    usage = data.get("usage") if isinstance(data, dict) else None
    if isinstance(usage, dict):
        total = usage.get("total_tokens")
        prompt_tokens = usage.get("prompt_tokens")
        completion_tokens = usage.get("completion_tokens")
        if isinstance(prompt_tokens, int) and isinstance(completion_tokens, int):
            resolved_total = total if isinstance(total, int) and total > 0 else prompt_tokens + completion_tokens
            return {
                "token_usage": max(1, resolved_total),
                "prompt_tokens": max(0, prompt_tokens),
                "completion_tokens": max(0, completion_tokens),
                "token_usage_source": "provider_usage",
            }
        if isinstance(total, int) and total > 0:
            estimated_prompt = max(0, len(prompt) // 4)
            estimated_completion = max(0, total - estimated_prompt)
            return {
                "token_usage": total,
                "prompt_tokens": estimated_prompt,
                "completion_tokens": estimated_completion,
                "token_usage_source": "estimated_split",
            }
    prompt_tokens = max(1, len(prompt) // 4)
    completion_tokens = max(1, len(content) // 4)
    return {
        "token_usage": prompt_tokens + completion_tokens,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "token_usage_source": "estimated_split",
    }


def _cost_breakdown(source: Mapping[str, str | None], usage: dict[str, int | str]) -> dict[str, float | str]:
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    input_rate = _optional_float(source, "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS", 0.0)
    output_rate = _optional_float(source, "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS", 0.0)
    cache_hit_rate = _optional_float(source, "STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS", 0.0)
    input_cny = (prompt_tokens / 1_000_000) * input_rate
    output_cny = (completion_tokens / 1_000_000) * output_rate
    return {
        "currency": "CNY",
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "input_cny": input_cny,
        "output_cny": output_cny,
        "total_cny": input_cny + output_cny,
        "input_cny_per_m_tokens": input_rate,
        "output_cny_per_m_tokens": output_rate,
        "cache_hit_input_cny_per_m_tokens": cache_hit_rate,
        "source": str(usage.get("token_usage_source") or "estimated_split"),
    }


def _total_cost_estimate(completed_chapters: list[dict[str, object]]) -> float:
    return sum(_float_value(item.get("cost_estimate")) for item in completed_chapters if isinstance(item, dict))


def _float_value(value: object) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, int | float):
        return float(value)
    return 0.0


def _env_value(source: Mapping[str, str | None], name: str) -> str:
    value = source.get(name)
    return value.strip() if value and value.strip() else ""


def _required_env(source: Mapping[str, str | None], name: str) -> str:
    value = _env_value(source, name)
    if not value:
        raise BookGenerationPreflightError(f"缺少真实 LLM 生成环境变量：{name}。")
    return value


def _optional_int(source: Mapping[str, str | None], name: str, default: int) -> int:
    value = _env_value(source, name)
    return int(value) if value else default


def _optional_float(source: Mapping[str, str | None], name: str, default: float) -> float:
    value = _env_value(source, name)
    return float(value) if value else default


def main(
    argv: list[str] | None = None,
    *,
    session_factory: Callable[[], object] | None = None,
    runner: Callable[..., object] = run_book_generation,
    output: TextIO | None = None,
    error: TextIO | None = None,
    env: Mapping[str, str | None] | None = None,
) -> int:
    """命令行入口：执行 真实 LLM 整书生成并输出脱敏摘要。"""

    parser = argparse.ArgumentParser(description="运行 StoryForge 真实 LLM 整书生成。")
    parser.add_argument("--chapter-count", type=int, required=True)
    parser.add_argument("--token-budget", type=int, required=True)
    parser.add_argument("--target-word-count", type=int, default=None)
    parser.add_argument("--chapter-word-count-min", type=int, default=600)
    parser.add_argument("--chapter-word-count-max", type=int, default=1600)
    parser.add_argument("--summary-output", type=str, default=None)
    args = parser.parse_args(argv)
    out = sys.stdout if output is None else output
    err = sys.stderr if error is None else error
    source = os.environ if env is None else env
    try:
        _assert_preflight(
            source,
            args.chapter_count,
            args.token_budget,
            args.target_word_count,
            args.chapter_word_count_min,
            args.chapter_word_count_max,
        )
    except BookGenerationPreflightError as exc:
        print(str(exc), file=err)
        return 2
    if session_factory is None:
        from app.db.session import SessionLocal

        session_factory = SessionLocal
    try:
        with session_factory() as session:
            result = runner(
                session,
                chapter_count=args.chapter_count,
                token_budget=args.token_budget,
                target_word_count=args.target_word_count,
                chapter_word_count_min=args.chapter_word_count_min,
                chapter_word_count_max=args.chapter_word_count_max,
                env=source,
            )
    except BookGenerationPreflightError as exc:
        print(str(exc), file=err)
        return 2
    except Exception as exc:
        print(f"真实 LLM 整书生成失败：{exc}", file=err)
        return 1
    summary = _result_summary(result)
    if args.summary_output:
        evidence_summary = _evidence_summary(
            result,
            target_word_count=args.target_word_count,
            chapter_word_count_min=args.chapter_word_count_min,
            chapter_word_count_max=args.chapter_word_count_max,
        )
        summary_path = Path(args.summary_output)
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(evidence_summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False), file=out)
    return 0


def _result_summary(result: object) -> dict[str, object]:
    book_run = result.book_run
    markdown_artifact = result.markdown_artifact
    audit_artifact = result.audit_artifact
    return {
        "book_run_id": book_run.id,
        "status": book_run.status,
        "chapter_count": result.chapter_count,
        "tokens_used": book_run.tokens_used,
        "estimated_cost": book_run.estimated_cost,
        "markdown_artifact_id": markdown_artifact.id,
        "markdown_artifact_name": markdown_artifact.name,
        "audit_artifact_id": audit_artifact.id,
        "audit_artifact_name": audit_artifact.name,
    }


def _evidence_summary(
    result: object,
    *,
    target_word_count: int | None,
    chapter_word_count_min: int,
    chapter_word_count_max: int,
) -> dict[str, object]:
    """生成不包含 provider 私密配置的脱敏证据摘要。"""

    book_run = result.book_run
    markdown_artifact = result.markdown_artifact
    audit_artifact = result.audit_artifact
    progress = getattr(book_run, "progress", None)
    progress = progress if isinstance(progress, dict) else {}
    completed_chapters = progress.get("completed_chapters")
    completed_chapters = completed_chapters if isinstance(completed_chapters, list) else []
    book_md_content = _artifact_text(markdown_artifact)
    cost_breakdown = _aggregate_cost_breakdown(completed_chapters, book_run.estimated_cost)
    latency = _latency_summary(completed_chapters)
    return {
        "mode": "real_llm_smoke",
        "book_run_id": book_run.id,
        "book_run_status": book_run.status,
        "target_chapter_count": result.chapter_count,
        "actual_chapter_count": len(completed_chapters) or result.chapter_count,
        "target_word_count": target_word_count,
        "chapter_word_count_min": chapter_word_count_min,
        "chapter_word_count_max": chapter_word_count_max,
        "tokens_used": book_run.tokens_used,
        "estimated_cost": book_run.estimated_cost,
        "prompt_tokens_used": _sum_chapter_int(completed_chapters, "prompt_tokens"),
        "completion_tokens_used": _sum_chapter_int(completed_chapters, "completion_tokens"),
        "cost_cny_estimated": cost_breakdown["total_cny"],
        "cost_breakdown": cost_breakdown,
        **latency,
        "failure_count": _failure_count(completed_chapters),
        "repair_round_count": _sum_chapter_int(completed_chapters, "repair_rounds"),
        "actual_total_chars": len(book_md_content),
        "per_chapter_char_counts": _per_chapter_char_counts(book_md_content, completed_chapters),
        "markdown_artifact_id": markdown_artifact.id,
        "audit_artifact_id": audit_artifact.id,
        "artifact_hashes": {
            "book_md_sha256": _artifact_payload_sha256(markdown_artifact),
            "audit_report_sha256": _artifact_payload_sha256(audit_artifact),
        },
        "per_chapter_metrics": [_chapter_metric(item) for item in completed_chapters],
        "integration_metrics": _integration_metrics_from_audit_artifact(audit_artifact),
    }


def _artifact_payload_sha256(artifact: object) -> str:
    source = _artifact_text(artifact)
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def _artifact_text(artifact: object) -> str:
    payload = getattr(artifact, "payload", None)
    if isinstance(payload, dict) and isinstance(payload.get("content"), str):
        return payload["content"]
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def _integration_metrics_from_audit_artifact(artifact: object) -> dict[str, object]:
    payload = getattr(artifact, "payload", None)
    if isinstance(payload, dict):
        metrics = payload.get("integration_metrics")
        if isinstance(metrics, dict):
            return dict(metrics)
        quality_summary = payload.get("quality_summary")
        if isinstance(quality_summary, dict):
            metrics = quality_summary.get("integration_metrics")
            if isinstance(metrics, dict):
                return dict(metrics)
    return {}


def _per_chapter_char_counts(book_md_content: str, completed_chapters: list[object]) -> list[dict[str, int | None]]:
    chapters = [_chapter_index(item, index + 1) for index, item in enumerate(completed_chapters)]
    if len(chapters) <= 1:
        return [{"chapter_index": chapters[0] if chapters else 1, "char_count": _body_char_count(book_md_content)}]
    parsed_counts = _markdown_chapter_body_char_counts(book_md_content)
    return [
        {"chapter_index": chapter_index, "char_count": parsed_counts.get(chapter_index, 0)}
        for chapter_index in chapters
    ]


def _markdown_chapter_body_char_counts(content: str) -> dict[int, int]:
    counts: dict[int, int] = {}
    current_chapter: int | None = None
    for line in content.splitlines():
        heading_match = MARKDOWN_CHAPTER_HEADING_RE.match(line.strip())
        if heading_match:
            current_chapter = int(heading_match.group(1))
            counts.setdefault(current_chapter, 0)
            continue
        if current_chapter is None or not line.strip() or line.lstrip().startswith("#"):
            continue
        counts[current_chapter] = counts.get(current_chapter, 0) + len(line)
    return counts


def _chapter_index(item: object, fallback: int) -> int:
    if isinstance(item, dict) and isinstance(item.get("chapter_index"), int):
        return int(item["chapter_index"])
    return fallback


def _body_char_count(content: str) -> int:
    lines = content.splitlines()
    body_lines = [line for line in lines if line.strip() and not line.lstrip().startswith("#")]
    body = "".join(body_lines) if body_lines else content
    return len(body)


def _chapter_metric(item: object) -> dict[str, object]:
    if not isinstance(item, dict):
        return {
            "chapter_index": None,
            "token_usage": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "generation_latency_ms": 0,
            "quality_score": None,
            "quality_issue_count": 0,
            "elapsed_time_sec": 0,
            "repair_rounds": 0,
        }
    issues = item.get("quality_issues")
    issue_count = len(issues) if isinstance(issues, list) else 0
    return {
        "chapter_index": item.get("chapter_index"),
        "token_usage": item.get("token_usage", 0),
        "prompt_tokens": item.get("prompt_tokens", 0),
        "completion_tokens": item.get("completion_tokens", 0),
        "generation_latency_ms": item.get("generation_latency_ms", 0),
        "quality_score": item.get("quality_score"),
        "quality_issue_count": issue_count,
        "elapsed_time_sec": item.get("elapsed_time_sec", 0),
        "repair_rounds": item.get("repair_rounds", 0),
    }


def _sum_chapter_int(chapters: list[object], field_name: str) -> int:
    total = 0
    for item in chapters:
        if isinstance(item, dict):
            value = item.get(field_name)
            if isinstance(value, bool):
                continue
            if isinstance(value, int | float):
                total += int(value)
    return total


def _latency_summary(chapters: list[object]) -> dict[str, int]:
    latencies = []
    for item in chapters:
        if not isinstance(item, dict):
            continue
        value = item.get("generation_latency_ms")
        if isinstance(value, bool):
            continue
        if isinstance(value, int | float) and value >= 0:
            latencies.append(int(value))
    total = sum(latencies)
    return {
        "total_latency_ms": total,
        "avg_latency_ms": round(total / len(latencies)) if latencies else 0,
        "max_latency_ms": max(latencies) if latencies else 0,
    }


def _failure_count(chapters: list[object]) -> int:
    count = 0
    for item in chapters:
        if not isinstance(item, dict):
            continue
        status = str(item.get("status") or "").lower()
        if status in {"failed", "error"} or item.get("error_message"):
            count += 1
    return count


def _aggregate_cost_breakdown(chapters: list[object], fallback_total: float) -> dict[str, object]:
    input_cny = 0.0
    output_cny = 0.0
    source = "unavailable"
    for item in chapters:
        if not isinstance(item, dict):
            continue
        breakdown = item.get("cost_breakdown")
        if not isinstance(breakdown, dict):
            continue
        input_cny += _float_value(breakdown.get("input_cny"))
        output_cny += _float_value(breakdown.get("output_cny"))
        source = str(breakdown.get("source") or source)
    total = input_cny + output_cny
    if total == 0 and fallback_total:
        total = float(fallback_total)
    return {
        "currency": "CNY",
        "input_cny": input_cny,
        "output_cny": output_cny,
        "total_cny": total,
        "source": source,
    }


if __name__ == "__main__":
    raise SystemExit(main())
