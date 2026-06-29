from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from storyforge_workflow.prompts._render import _clean, _section
from storyforge_workflow.prompts.models import (
    CharacterConstraint,
    NarrativeContext,
    PacingDirective,
    StyleDirective,
)

# 软禁用套话：与 StyleDirective.forbidden_phrases（硬禁用）分开，这里是高频陈词，
# 措辞为"避免滥用"而非"绝不出现"，否则会误伤正常用词。
_CLICHE_PHRASES = (
    "忽然",
    "仿佛",
    "不禁",
    "情不自禁",
    "无法言喻",
    "五味杂陈",
    "心中一震",
    "莫名",
    "缓缓",
    "深深地",
)

# 创作准则：把"什么是好文笔"显式写进 prompt，配好坏对照锚定模型。
_CRAFT_GUIDELINES = (
    "用具体的动作、对话和感官细节呈现，而非直接说明或概括（show, don't tell）。",
    "不要用情绪词直接收尾（如“他很愤怒”“她感到害怕”）；用身体反应、动作或语言让情绪自然显形。",
    "每个场景至少落地两种具体感官细节（视觉之外的声音、触感、气味、温度等）。",
    "对白与叙述大致按 4:6 配比推进信息，避免大段内心独白与解释性旁白。",
    "优先具体名词与有力动词，避免抽象形容词与副词堆叠。",
    "避免滥用陈词套话：" + "、".join(_CLICHE_PHRASES) + " 等，确有必要才用。",
)

# 好坏对照锚点：正例画面化、可直接模仿；反例只描述"说明腔"反模式，
# 不复述任何被禁词条（避免在 prompt 里既禁止又示范同一串，给模型混淆信号）。
_CRAFT_EXAMPLE_BAD = "反例（说明腔，禁止）：直接用情绪形容词概括人物状态、堆叠抽象副词、用旁白解释心理，而不落到动作与感官。"
_CRAFT_EXAMPLE_GOOD = "正例（画面化，模仿）：他把茶杯按在桌上，瓷底磕出一声脆响，指节泛白，半天没松开。"


def _strategy_section(ctx: NarrativeContext) -> str:
    lines = []
    if _clean(ctx.strategy_title):
        lines.append(f"作品标题：{_clean(ctx.strategy_title)}")
    if _clean(ctx.premise):
        lines.append(f"故事前提：{_clean(ctx.premise)}")
    if _clean(ctx.central_question):
        lines.append(f"核心问题：{_clean(ctx.central_question)}")
    if _clean(ctx.reader_promise):
        lines.append(f"读者承诺：{_clean(ctx.reader_promise)}")
    if _clean(ctx.user_intent):
        lines.append(f"用户意图：{_clean(ctx.user_intent)}")
    return _section("作品策略", lines)


def _character_section(characters: Iterable[CharacterConstraint]) -> str:
    described = [character.describe() for character in characters]
    return _section("角色约束（必须严格遵守，禁止 OOC）", described)


def _craft_section() -> str:
    """固定创作准则段：把好文笔的判定标准显式注入，配好坏对照锚定模型。

    好坏对照锚点从 ``builder`` facade 读取，使诊断脚本可通过 patch
    ``builder._CRAFT_EXAMPLE_BAD/_GOOD`` 做 A/B 开关（缺省回落到本模块常量）。
    """

    from storyforge_workflow.prompts import builder as _builder

    example_bad = getattr(_builder, "_CRAFT_EXAMPLE_BAD", _CRAFT_EXAMPLE_BAD)
    example_good = getattr(_builder, "_CRAFT_EXAMPLE_GOOD", _CRAFT_EXAMPLE_GOOD)
    lines = [*_CRAFT_GUIDELINES, example_bad, example_good]
    return _section("创作准则（高于个人发挥，逐条遵守）", lines)


def _style_section(style: StyleDirective) -> str:
    if not style.has_content():
        return ""
    lines = []
    if _clean(style.tone):
        lines.append(f"语气：{_clean(style.tone)}")
    if _clean(style.pov):
        lines.append(f"叙事视角：{_clean(style.pov)}")
    if _clean(style.tense):
        lines.append(f"时态/时序：{_clean(style.tense)}")
    for rule in style.rules:
        if _clean(rule):
            lines.append(f"规则：{_clean(rule)}")
    forbidden = [_clean(item) for item in style.forbidden_phrases if _clean(item)]
    if forbidden:
        lines.append(f"禁用表达（绝不能出现）：{('、'.join(forbidden))}")
    if style.target_avg_sentence_length:
        lines.append(
            f"目标句长：平均约 {style.target_avg_sentence_length:.0f} 字/句，贴合已批准章节的节奏，避免明显变长或变碎。"
        )
    if style.target_dialogue_ratio:
        lines.append(
            f"目标对白密度：与已批准章节相当（参考占比 {style.target_dialogue_ratio:.2f}），不要突然大段独白或全是旁白。"
        )
    if style.restraint:
        lines.append("保持克制叙述：少解释、多呈现，延续既定章节的冷静质感。")
    examples = [_clean(item) for item in style.example_sentences if _clean(item)]
    if examples:
        lines.append("风格示例句（模仿其句式与质感，不要照抄内容）：")
        lines.extend(f"  - {example}" for example in examples)
    return _section("文风要求", lines)


def _position_section(ctx: NarrativeContext) -> str:
    lines = []
    if _clean(ctx.chapter_title):
        lines.append(f"当前章节：{_clean(ctx.chapter_title)}")
    if _clean(ctx.chapter_goal):
        lines.append(f"章节目标：{_clean(ctx.chapter_goal)}")
    if _clean(ctx.conflict_axis):
        lines.append(f"冲突轴：{_clean(ctx.conflict_axis)}")
    if _clean(ctx.scene_goal):
        lines.append(f"场景目标：{_clean(ctx.scene_goal)}")
    beats = [_clean(beat) for beat in ctx.scene_beats if _clean(beat)]
    if beats:
        lines.append("场景 beat：" + " / ".join(beats))
    return _section("叙事位置", lines)


def _scene_quality_section(ctx: NarrativeContext) -> str:
    plan = ctx.scene_quality_plan
    if not plan.has_content():
        return ""
    lines = []
    if _clean(plan.emotional_shift):
        lines.append(f"情绪变化：{_clean(plan.emotional_shift)}")
    if _clean(plan.conflict_turn):
        lines.append(f"冲突转折：{_clean(plan.conflict_turn)}")
    anchors = [_clean(anchor) for anchor in plan.sensory_anchors if _clean(anchor)]
    if anchors:
        lines.append(f"感官锚点：{'、'.join(anchors)}")
    if _clean(plan.dialogue_purpose):
        lines.append(f"对白目的：{_clean(plan.dialogue_purpose)}")
    if _clean(plan.reveal_or_payoff):
        lines.append(f"伏笔/兑现：{_clean(plan.reveal_or_payoff)}")
    if _clean(plan.ending_hook):
        lines.append(f"结尾钩子：{_clean(plan.ending_hook)}")
    return _section("场景质量计划", lines)


def _beat_value(beat: Any, key: str) -> Any:
    if isinstance(beat, Mapping):
        return beat.get(key)
    return getattr(beat, key, None)


def _chapter_beat_section(ctx: NarrativeContext) -> str:
    beat = getattr(ctx, "chapter_beat", None) or getattr(ctx, "current_chapter_beat", None)
    if not beat:
        return ""
    fields = (
        "primary_scene_mode",
        "forbidden_action_pattern",
        "required_conflict_type",
        "required_turning_point",
        "protagonist_mistake",
        "irreversible_consequence",
        "relationship_shift",
        "clue_usage_mode",
        "new_evidence_allowed",
    )
    lines = []
    for field in fields:
        value = _beat_value(beat, field)
        if value is None or value == "":
            continue
        lines.append(f"{field}：{value}")
    if _beat_value(beat, "primary_scene_mode") != "investigation_fetch_loop":
        pattern = _beat_value(beat, "forbidden_action_pattern") or "到新地点/问询/取得小物证/收入口袋/转向下一处"
        lines.append(f"禁止使用默认调查推进模板：{pattern}")
        lines.append("不得把本章写成到新地点/问询/取得小物证/收入口袋/转向下一处的流程。")
        lines.append("生成前先在内部确认：误判、主动阻碍、代价、旧线索重释和不可逆变化都已成立；最终只输出正文。")
    return _section("ChapterBeat 结构门槛", lines)


def _continuity_section(ctx: NarrativeContext) -> str:
    lines = [fact.describe() for fact in ctx.continuity if _clean(fact.statement)]
    required = [_clean(item) for item in ctx.required_facts if _clean(item)]
    if required:
        lines.append("必含事实（缺一不可）：" + "、".join(required))
    return _section("连续性约束", lines)


def _previous_section(ctx: NarrativeContext) -> str:
    summary = _clean(ctx.previous_summary)
    if not summary:
        return ""
    return _section("上文衔接（保持连续，不要重复已写内容）", [summary])


def _pacing_section(pacing: PacingDirective) -> str:
    if not pacing.has_content():
        return ""
    lines = []
    if _clean(pacing.intensity):
        lines.append(f"张力强度：{_clean(pacing.intensity)}")
    if _clean(pacing.beat_density):
        lines.append(f"节奏密度：{_clean(pacing.beat_density)}")
    if pacing.target_chars:
        lines.append(f"目标篇幅：约 {pacing.target_chars} 个中文字符，允许上下浮动 15%。")
    for note in pacing.notes:
        if _clean(note):
            lines.append(_clean(note))
    if pacing.hook_required:
        lines.append("段末必须留下推动下一段的钩子，不要收束或提前完结。")
    return _section("节奏控制", lines)
