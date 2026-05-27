from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class BlueprintPlanInput:
    """章节规划器只依赖 locked Blueprint 的最小字段。"""

    blueprint_id: int
    book_id: int
    premise: str
    tone: str
    target_word_count: int
    target_chapter_count: int
    chapter_word_count_min: int
    chapter_word_count_max: int
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ChapterPlanItem:
    """单章计划写回 API 章节目标所需的稳定结构。"""

    chapter_index: int
    title: str
    goal: str
    pov: str
    location: str
    required_beats: list[str]
    expected_word_count: int


def plan_chapters_deterministic(blueprint: BlueprintPlanInput) -> list[ChapterPlanItem]:
    """根据 Blueprint 生成可重复章节计划，供 9A 测试和 mock provider 使用。"""

    if blueprint.target_chapter_count <= 0:
        raise ValueError("目标章节数必须大于 0。")
    expected_word_count = _bounded_chapter_word_count(blueprint)
    pov = str(blueprint.metadata.get("pov") or "全知视角")
    location = str(blueprint.metadata.get("location") or "待定地点")
    title_seed = _title_seed(blueprint)
    return [
        ChapterPlanItem(
            chapter_index=index,
            title=f"{title_seed} {index}",
            goal=f"第 {index} 章推进：{blueprint.premise}",
            pov=pov,
            location=location,
            required_beats=_required_beats(blueprint, index),
            expected_word_count=expected_word_count,
        )
        for index in range(1, blueprint.target_chapter_count + 1)
    ]


def _bounded_chapter_word_count(blueprint: BlueprintPlanInput) -> int:
    average = max(1, blueprint.target_word_count // blueprint.target_chapter_count)
    return min(max(average, blueprint.chapter_word_count_min), blueprint.chapter_word_count_max)


def _title_seed(blueprint: BlueprintPlanInput) -> str:
    explicit_title = blueprint.metadata.get("title_seed")
    if isinstance(explicit_title, str) and explicit_title.strip():
        return explicit_title.strip()
    if "雾港" in blueprint.premise:
        return "雾港航线"
    return "章节计划"


def _required_beats(blueprint: BlueprintPlanInput, chapter_index: int) -> list[str]:
    return [
        f"建立核心冲突：{blueprint.premise}",
        f"保持语气：{blueprint.tone}。",
        f"推进第 {chapter_index}/{blueprint.target_chapter_count} 章的阶段目标。",
    ]
