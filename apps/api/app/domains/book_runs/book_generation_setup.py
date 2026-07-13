"""Book, blueprint, consistency seed, and resume reconstruction helpers."""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.blueprints.schemas import BookBlueprintCreate
from app.domains.book_runs.book_generation_contracts import (
    DEFAULT_GENERATION_LOCATION,
    DEFAULT_GENERATION_POV,
    DEFAULT_GENERATION_PREMISE,
    DEFAULT_GENERATION_TITLE_SEED,
    DEFAULT_GENERATION_TONE,
)
from app.domains.book_runs.book_generation_judge import CATEGORY_DIMENSION, quality_score
from app.domains.book_runs.errors import BookGenerationError
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book, Chapter, Scene
from app.domains.character_bible.schemas import CharacterBibleCreate
from app.domains.character_bible.service import create_character_bible_entry
from app.domains.continuity.models import ScenePacket
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.model_runs.models import ModelRun
from app.domains.style_packs.schemas import StylePackCreate
from app.domains.style_packs.service import create_style_pack


def create_generation_book(session: Session, chapter_count: int) -> Book:
    book = Book(
        title=f"真实 LLM 整书生成 {chapter_count} 章",
        status="draft",
        premise=DEFAULT_GENERATION_PREMISE,
    )
    session.add(book)
    session.commit()
    session.refresh(book)
    return book


def seed_consistency_data(session: Session, book_id: int) -> None:
    """为生成书写入一条 Character Bible 与一个 Style Pack。"""

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


def blueprint_payload(
    book_id: int,
    chapter_count: int,
    *,
    target_word_count: int | None = None,
    chapter_word_count_min: int = 600,
    chapter_word_count_max: int = 1600,
    planning_arcs: Callable[[int], list[dict[str, object]]],
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
            "planning_arcs": planning_arcs(chapter_count),
        },
    )


def default_planning_arcs(chapter_count: int) -> list[dict[str, object]]:
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
        },
    ]


def _arc_points(chapter_count: int, *candidates: int) -> list[int]:
    return sorted({min(chapter_count, max(1, int(value))) for value in candidates})


arc_points = _arc_points


def chapter_for_generation(session: Session, book_id: int, chapter_index: int) -> Chapter:
    return (
        session.query(Chapter)
        .filter(Chapter.book_id == book_id, Chapter.ordinal == chapter_index)
        .order_by(Chapter.id)
        .one()
    )


def reconstruct_completed_chapters(session: Session, book_run_id: int) -> list[dict[str, object]]:
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
        score = quality_score(list(blocking_issues))
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
                "approved": True,
                "token_usage": model_run.token_usage,
                "elapsed_time_sec": 0,
                "cost_estimate": 0.0,
                "quality_score": score,
                "quality_issues": [
                    {
                        "issue_id": issue.id,
                        "category": issue.issue_type,
                        "severity": issue.severity,
                        "summary": issue.description,
                        "dimension": CATEGORY_DIMENSION.get(issue.issue_type, "narrative_quality"),
                    }
                    for issue in blocking_issues
                ],
            }
        )
        seen_ordinals.add(chapter.ordinal)
    return completed
