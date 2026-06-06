from __future__ import annotations

from sqlalchemy.orm import Session

from app.common.exceptions import InputError, NotFoundError
from app.domains.blueprints.models import BookBlueprint
from app.domains.blueprints.schemas import BookBlueprintCreate, ChapterPlanTriggerRead
from app.domains.books.models import Book, Chapter


class BlueprintError(InputError):
    """Blueprint 输入或状态不满足全书编排约束。"""


class BlueprintNotFoundError(NotFoundError):
    """Blueprint 不存在时由路由层转换为 404。"""


class BlueprintPlanningBlockedError(InputError):
    """Blueprint 未满足章节规划前置条件。"""

    status_code = 422


def create_book_blueprint(session: Session, payload: BookBlueprintCreate) -> BookBlueprint:
    """创建草稿 Blueprint，只校验作品归属和最小规模约束。"""

    if session.get(Book, payload.book_id) is None:
        raise BlueprintError("作品不存在，无法创建 Blueprint。")
    blueprint = BookBlueprint(
        book_id=payload.book_id,
        premise=payload.premise,
        tone=payload.tone,
        target_word_count=payload.target_word_count,
        target_chapter_count=payload.target_chapter_count,
        chapter_word_count_min=payload.chapter_word_count_min,
        chapter_word_count_max=payload.chapter_word_count_max,
        status="draft",
        version=1,
        metadata_=payload.metadata,
    )
    session.add(blueprint)
    session.commit()
    session.refresh(blueprint)
    return blueprint


def get_book_blueprint(session: Session, blueprint_id: int) -> BookBlueprint:
    """按主键读取 Blueprint。"""

    blueprint = session.get(BookBlueprint, blueprint_id)
    if blueprint is None:
        raise BlueprintNotFoundError("Blueprint 不存在。")
    return blueprint


def lock_book_blueprint(session: Session, blueprint_id: int) -> BookBlueprint:
    """锁定 Blueprint，使其可作为章节规划器输入。"""

    blueprint = get_book_blueprint(session, blueprint_id)
    if blueprint.status != "locked":
        blueprint.status = "locked"
        blueprint.version += 1
        session.commit()
        session.refresh(blueprint)
    return blueprint


def trigger_chapter_plan(session: Session, blueprint_id: int) -> ChapterPlanTriggerRead:
    """校验章节规划前置条件，并把 deterministic 计划写回现有章节表。"""

    blueprint = get_book_blueprint(session, blueprint_id)
    if blueprint.status != "locked":
        raise BlueprintPlanningBlockedError("Blueprint 尚未锁定，不能触发章节规划。")
    arcs_by_chapter = _planning_arcs_by_chapter(blueprint)
    for item in _plan_blueprint_chapters(blueprint):
        chapter = _get_or_create_chapter(session, blueprint, item["chapter_index"])
        chapter.title = item["title"]
        chapter.summary = item["goal"]
        chapter.status = "planned"
        chapter.blueprint_id = blueprint.id
        chapter.planning_source = "blueprint_planner"
        chapter.pov = item["pov"]
        chapter.location = item["location"]
        chapter.required_beats = _required_beats_with_arc_refs(
            item["required_beats"],
            arcs_by_chapter.get(item["chapter_index"], []),
        )
        chapter.expected_word_count = item["expected_word_count"]
    blueprint.metadata_ = _metadata_with_planning_summary(blueprint, arcs_by_chapter)
    session.commit()
    return ChapterPlanTriggerRead(
        blueprint_id=blueprint.id,
        book_id=blueprint.book_id,
        status="planned",
        chapter_count=blueprint.target_chapter_count,
    )


def _get_or_create_chapter(session: Session, blueprint: BookBlueprint, chapter_index: int) -> Chapter:
    chapter = (
        session.query(Chapter)
        .filter(Chapter.book_id == blueprint.book_id, Chapter.ordinal == chapter_index)
        .order_by(Chapter.id)
        .first()
    )
    if chapter is not None:
        return chapter
    chapter = Chapter(book_id=blueprint.book_id, ordinal=chapter_index, title=f"第 {chapter_index} 章", status="planned")
    session.add(chapter)
    return chapter


def _plan_blueprint_chapters(blueprint: BookBlueprint) -> list[dict]:
    """API 侧保持与 workflow deterministic planner 等价的最小输出，避免 9A 引入跨服务运行依赖。"""

    expected_word_count = min(
        max(blueprint.target_word_count // blueprint.target_chapter_count, blueprint.chapter_word_count_min),
        blueprint.chapter_word_count_max,
    )
    pov = str(blueprint.metadata_.get("pov") or "全知视角")
    location = str(blueprint.metadata_.get("location") or "待定地点")
    title_seed = str(blueprint.metadata_.get("title_seed") or ("雾港航线" if "雾港" in blueprint.premise else "章节计划"))
    return [
        _chapter_plan_item(blueprint, index, title_seed, pov, location, expected_word_count)
        for index in range(1, blueprint.target_chapter_count + 1)
    ]


def _chapter_plan_item(
    blueprint: BookBlueprint, index: int, title_seed: str, pov: str, location: str, expected_word_count: int
) -> dict:
    """为单章生成计划项，根据章节序号给出不同的目标与节拍。"""

    total = blueprint.target_chapter_count
    if total == 1:
        goal = f"{blueprint.premise}"
        beats = [
            f"建立核心冲突：{blueprint.premise}",
            f"保持语气：{blueprint.tone}。",
            "完整呈现故事起承转合。",
        ]
    elif total == 3:
        if index == 1:
            goal = f"发现异常并开始调查：{blueprint.premise}"
            beats = [
                f"建立核心冲突：{blueprint.premise}",
                f"保持语气：{blueprint.tone}。",
                "主角接触第一手证据，发现问题不简单。",
                "结尾留下悬念或新线索，推向下一章。",
            ]
        elif index == 2:
            goal = f"深入追查，找到关键人物或物证：{blueprint.premise}"
            beats = [
                "承接上一章结尾的线索或悬念。",
                f"保持语气：{blueprint.tone}。",
                "主角获得关键突破（人证、物证或新发现）。",
                "揭示更深层的幕后力量或动机。",
            ]
        else:  # index == 3
            goal = f"收网或揭示真相：{blueprint.premise}"
            beats = [
                "承接上一章的突破，推向最终对峙或真相。",
                f"保持语气：{blueprint.tone}。",
                "主角完成调查闭环，证据链完整。",
                "给出结局或为后续留伏笔。",
            ]
    else:
        goal = f"第 {index} 章推进：{blueprint.premise}"
        beats = [
            f"建立核心冲突：{blueprint.premise}",
            f"保持语气：{blueprint.tone}。",
            f"推进第 {index}/{total} 章的阶段目标。",
        ]
    return {
        "chapter_index": index,
        "title": f"{title_seed} {index}",
        "goal": goal,
        "pov": pov,
        "location": location,
        "required_beats": beats,
        "expected_word_count": expected_word_count,
    }


def _planning_arcs_by_chapter(blueprint: BookBlueprint) -> dict[int, list[dict[str, str]]]:
    """把 Blueprint 结构化弧线压缩为按章节索引的轻量引用。"""

    metadata = blueprint.metadata_ if isinstance(blueprint.metadata_, dict) else {}
    raw_arcs = metadata.get("planning_arcs")
    if not isinstance(raw_arcs, list):
        return {}
    arcs_by_chapter: dict[int, list[dict[str, str]]] = {}
    for raw_arc in raw_arcs:
        if not isinstance(raw_arc, dict):
            continue
        arc_id = raw_arc.get("arc_id")
        title = raw_arc.get("title")
        if not isinstance(arc_id, str) or not arc_id.strip():
            continue
        if not isinstance(title, str) or not title.strip():
            title = arc_id
        for chapter_index in _arc_target_chapters(raw_arc, blueprint.target_chapter_count):
            arcs_by_chapter.setdefault(chapter_index, []).append(
                {
                    "arc_id": arc_id.strip(),
                    "title": title.strip(),
                }
            )
    return arcs_by_chapter


def _arc_target_chapters(raw_arc: dict, target_chapter_count: int) -> list[int]:
    raw_targets = raw_arc.get("target_chapters")
    chapters: list[int] = []
    if isinstance(raw_targets, list):
        chapters.extend(item for item in raw_targets if isinstance(item, int))
    payoff_chapter = raw_arc.get("payoff_chapter")
    if isinstance(payoff_chapter, int):
        chapters.append(payoff_chapter)
    unique_chapters = sorted({chapter for chapter in chapters if 1 <= chapter <= target_chapter_count})
    return unique_chapters


def _required_beats_with_arc_refs(required_beats: list[str], arc_refs: list[dict[str, str]]) -> list[str]:
    beats = list(required_beats)
    for arc_ref in arc_refs:
        beats.append(f"弧线推进：{arc_ref['title']}")
    return beats


def _metadata_with_planning_summary(blueprint: BookBlueprint, arcs_by_chapter: dict[int, list[dict[str, str]]]) -> dict:
    metadata = dict(blueprint.metadata_ if isinstance(blueprint.metadata_, dict) else {})
    chapter_arc_links = {
        str(chapter_index): [arc_ref["arc_id"] for arc_ref in arc_refs]
        for chapter_index, arc_refs in sorted(arcs_by_chapter.items())
        if arc_refs
    }
    linked_chapter_count = len(chapter_arc_links)
    target_chapter_count = blueprint.target_chapter_count
    metadata["planning_summary"] = {
        "schema_version": 1,
        "arc_count": _planning_arc_count(metadata.get("planning_arcs")),
        "linked_chapter_count": linked_chapter_count,
        "target_chapter_count": target_chapter_count,
        "arc_completion_ratio": round(linked_chapter_count / target_chapter_count, 2)
        if target_chapter_count
        else 0,
        "chapter_arc_links": chapter_arc_links,
    }
    return metadata


def _planning_arc_count(raw_arcs: object) -> int:
    if not isinstance(raw_arcs, list):
        return 0
    return sum(
        1
        for raw_arc in raw_arcs
        if isinstance(raw_arc, dict) and isinstance(raw_arc.get("arc_id"), str) and raw_arc["arc_id"].strip()
    )
