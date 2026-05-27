from __future__ import annotations

from storyforge_workflow.planners.chapter_planner import (
    BlueprintPlanInput,
    plan_chapters_deterministic,
)


def test_chapter_planner_returns_stable_three_chapter_plan() -> None:
    """相同 Blueprint 输入应稳定产出三章章节计划。"""

    blueprint = BlueprintPlanInput(
        blueprint_id=7,
        book_id=3,
        premise="林岚在雾港追查失真的灯塔信号。",
        tone="克制悬疑",
        target_word_count=4500,
        target_chapter_count=3,
        chapter_word_count_min=1000,
        chapter_word_count_max=1800,
        metadata={"pov": "林岚", "location": "雾港"},
    )

    first = plan_chapters_deterministic(blueprint)
    second = plan_chapters_deterministic(blueprint)

    assert first == second
    assert [item.chapter_index for item in first] == [1, 2, 3]
    assert [item.expected_word_count for item in first] == [1500, 1500, 1500]
    assert first[0].title == "雾港航线 1"
    assert first[0].pov == "林岚"
    assert first[0].location == "雾港"
    assert first[0].required_beats == [
        "建立核心冲突：林岚在雾港追查失真的灯塔信号。",
        "保持语气：克制悬疑。",
        "推进第 1/3 章的阶段目标。",
    ]
