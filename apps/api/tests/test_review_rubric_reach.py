"""审稿判据触达护栏：检查侧必须有判断标准，且与产字侧同一把尺。

背景（2026-07-28 诊断）：三个 LLM 审稿子代理此前拿到的全部判断标准就是 `ReviewSkill.focus`
那一句——「剧情结构、冲突推进、章尾钩子」共 13 字，三视角合计 36 字。同期产字侧（场景纪律
落地后）有 522 字。判据本身躺在退役批量管线 `book_runs/prompts/builder.py` 的 10 维评分表里，
桌面永远走不到。本刀把判据打捞进真正跑的三个子代理。

同时修一个可证伪的真 bug：写侧让作者避开「忽然」这类套话，审侧却把「忽然」当成冲突与钩子的
存在证据——套话反过来成了通过检查的凭据。

本文件的红线：
1. **判据必须真进 system prompt**，且三视角各不相同（一份通用判据等于没判据）。
2. **写与审同源**：plot 判据的承重条由 `SCENE_DISCIPLINE_ITEMS` 派生、末条就是 `SCENE_COLLAPSE_TEST`。
3. **「缺席即问题」的探测词不得与软禁用套话相交**（上面那个真 bug 的回归闸）。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.common.craft import (
    CLICHE_PHRASES,
    REVIEW_RUBRICS,
    SCENE_COLLAPSE_TEST,
    SCENE_DISCIPLINE_ITEMS,
    review_rubric_clause,
)
from app.domains.ide import review_reasoning
from app.domains.ide.review_skills import (
    CONFLICT_MARKERS,
    ENDING_HOOK_MARKERS,
    MOTIVATION_MARKERS,
    REVIEW_SKILLS,
    _absence_markers,
    character_agent_issues,
    plot_agent_issues,
)

_REVIEW_SKILLS_SOURCE = Path(review_reasoning.__file__).resolve().parent / "review_skills.py"

# 「缺席即问题」的三张词表：没命中就报 issue，故它们等价于「好文的正面证据」。
_ABSENCE_MARKER_SETS = {
    "conflict": CONFLICT_MARKERS,
    "ending_hook": ENDING_HOOK_MARKERS,
    "motivation": MOTIVATION_MARKERS,
}


def test_cliche_alone_no_longer_passes_as_conflict_or_hook_evidence() -> None:
    """本刀修的真 bug，行为级证伪：套话不能再充当「有冲突 / 有钩子」的证据。

    下面这段全是套话、没有任何真实阻碍与悬念。修复前它含「忽然」，而「忽然」同时躺在
    conflict_markers 与 hook_markers 里，于是两条检查都被骗过去，稿件"干净通过"。
    修复后两条都必须报出来。把 `_absence_markers` 的过滤删掉，本测试即红。
    """

    prose = "他忽然站了起来，忽然又坐下。" * 20
    assert len(prose) >= 240, "必须够长，否则先命中 plot.too_short_for_scene 掩盖本测试"

    codes = {issue["code"] for issue in plot_agent_issues(prose, [prose])}
    assert "plot.conflict_signal_missing" in codes
    assert "plot.ending_hook_weak" in codes


def test_absence_markers_never_overlap_the_cliche_list() -> None:
    """判据不得自相矛盾：写侧让作者避开的词，审侧不能当成好文的正面证据。"""

    for name, markers in _ABSENCE_MARKER_SETS.items():
        overlap = set(markers) & set(CLICHE_PHRASES)
        assert not overlap, f"{name} 词表与软禁用套话相交：{overlap}"


def test_the_cliche_filter_is_load_bearing_not_decoration() -> None:
    """上一条若靠「手工把词删干净」维持，删掉过滤器不会变红——那就是空洞护栏。

    这里钉死：源码字面量里仍留着「忽然」，是 `_absence_markers` 在运行期把它剔掉的。
    """

    source = _REVIEW_SKILLS_SOURCE.read_text(encoding="utf-8")
    assert '"忽然"' in source, "字面量里应保留历史词条，让过滤器承重"
    assert "忽然" in CLICHE_PHRASES
    assert "忽然" not in CONFLICT_MARKERS
    assert "忽然" not in ENDING_HOOK_MARKERS
    assert _absence_markers("忽然", "但") == ("但",)


def test_each_llm_review_agent_gets_its_own_rubric() -> None:
    """判据必须真进 system prompt，且三视角各不相同。

    一份通用判据 = 三个子代理用同一把粗尺，等于没拆视角。
    """

    prompts = {key: review_reasoning._review_system_prompt(key) for key in review_reasoning.REVIEW_AGENT_KEYS}
    for key, prompt in prompts.items():
        assert review_rubric_clause(key) in prompt, f"{key} 视角的判据没进 system prompt"
    assert len(set(prompts.values())) == len(prompts), "三视角 system prompt 不能雷同"


def test_plot_rubric_shares_the_writers_load_bearing_test() -> None:
    """写与审同尺：写侧被要求满足的承重判据，审侧必须用同一条去验。

    两处各写一份措辞相近的判据即会漂移——写的时候按 A 尺，审的时候按 B 尺，作者永远
    不知道该信谁。
    """

    plot = review_rubric_clause("plot")
    assert SCENE_COLLAPSE_TEST in plot
    for name, _ in SCENE_DISCIPLINE_ITEMS:
        assert name in plot, f"承重结构条漏了「{name}」"


def test_scene_discipline_items_flow_into_the_rubric_automatically() -> None:
    """承重条是派生的，不是抄的：往 SCENE_DISCIPLINE_ITEMS 加一项，审侧自动跟上。"""

    expected = "承重结构：" + "、".join(name for name, _ in SCENE_DISCIPLINE_ITEMS)
    assert any(item.startswith(expected) for item in REVIEW_RUBRICS["plot"])


def test_rubric_keys_cover_exactly_the_llm_review_agents() -> None:
    """缺 key 会在组 prompt 时抛 KeyError；多 key 是死判据，两种都要挡。"""

    assert set(REVIEW_RUBRICS) == set(review_reasoning.REVIEW_AGENT_KEYS)
    assert set(REVIEW_RUBRICS) <= set(REVIEW_SKILLS)


def test_unknown_perspective_raises_instead_of_returning_empty() -> None:
    """不创建假数据兜底：少了判据的子代理照样返回 issue，静默降级看起来像正常工作。"""

    with pytest.raises(KeyError):
        review_rubric_clause("continuity")


def test_plot_rubric_carries_no_genre_specific_template() -> None:
    """打捞时的类型适配：原 narrative_collapse 维带推理小说专有模板，不能照搬。

    原文是「到新地点、问询、取得物证、收好、转向下一处」——本项目 n=1 是末世 / 系统 /
    进化流，照搬会把正常的战斗与升级场按「不是调查流程」放过、把赶路场按模板误伤。
    """

    plot = review_rubric_clause("plot")
    for template_word in ("物证", "问询", "调查"):
        assert template_word not in plot


def test_prose_rubric_shares_the_one_cliche_list() -> None:
    """套话表只有一份：审侧点名的词必须就是写侧禁的词，不能各留一份。"""

    prose = review_rubric_clause("prose")
    for phrase in CLICHE_PHRASES:
        assert phrase in prose


def test_motivation_check_still_fires_on_prose_without_visible_motive() -> None:
    """剔套话不得把「缺席即问题」的检查整条剔空——词表被清空时本测试变红。"""

    prose = "他站在原地。风吹过屋檐。远处有人走动。" * 15
    assert len(prose.strip()) >= 240
    codes = {issue["code"] for issue in character_agent_issues(prose, None)}
    assert "character.motivation_underexplained" in codes
