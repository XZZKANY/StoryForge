"""GenerationState → 结构化 prompt 输入的适配层。

提供干净的注入缝：节点只持有引用型 state，Phase 9 的角色 / 风格 / 节奏 / 连续性数据
由上游（API adapter 编译上下文后）以可选键写入 state，本层负责归一成构建器输入。
本层不读数据库，缺数据时退化为只用引用字段，保证单章 NovelLoop 仍可运行。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from storyforge_workflow.prompts._continuity_budget import (  # noqa: F401  private compatibility re-export
    _continuity_sort_key,
    _env_positive_int,
    _estimated_fact_tokens,
    _fact_chapter,
    _matches_pov,
    _positive_int,
    _prioritized_continuity_entries,
    _state_pov,
    _within_continuity_budget,
)
from storyforge_workflow.prompts.models import (
    CharacterConstraint,
    ContinuityFact,
    NarrativeContext,
    PacingDirective,
    SceneQualityPlan,
    StyleDirective,
)


def _str(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ("" if value is None else str(value))


def _str_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, Sequence):
        return [_str(item) for item in value if _str(item)]
    return []


def _characters_from_state(state: Mapping[str, Any]) -> tuple[CharacterConstraint, ...]:
    raw = state.get("character_constraints")
    constraints: list[CharacterConstraint] = []
    if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
        for entry in raw:
            if not isinstance(entry, Mapping):
                continue
            name = _str(entry.get("name") or entry.get("canonical_name"))
            if not name:
                continue
            constraints.append(
                CharacterConstraint(
                    name=name,
                    aliases=tuple(_str_list(entry.get("aliases"))),
                    voice_traits=tuple(_str_list(entry.get("voice_traits"))),
                    forbidden_traits=tuple(_str_list(entry.get("forbidden_traits"))),
                    role=_str(entry.get("role")),
                )
            )
    if not constraints:
        protagonist = _str(state.get("protagonist_ref"))
        if protagonist and protagonist != "主角":
            constraints.append(CharacterConstraint(name=protagonist, role="主角"))
    return tuple(constraints)


def _style_from_state(state: Mapping[str, Any]) -> StyleDirective:
    raw = state.get("style_directive")
    tone_default = _str(state.get("strategy_tone_ref"))
    if isinstance(raw, Mapping):
        fingerprint = raw.get("fingerprint")
        avg_len, dialogue_ratio, restraint = _fingerprint_targets(fingerprint)
        return StyleDirective(
            tone=_str(raw.get("tone")) or tone_default,
            rules=tuple(_str_list(raw.get("rules") or raw.get("规则"))),
            forbidden_phrases=tuple(_str_list(raw.get("forbidden_phrases") or raw.get("禁用表达"))),
            example_sentences=tuple(_str_list(raw.get("example_sentences") or raw.get("示例句"))),
            pov=_str(raw.get("pov")),
            tense=_str(raw.get("tense")),
            target_avg_sentence_length=avg_len,
            target_dialogue_ratio=dialogue_ratio,
            restraint=restraint,
        )
    return StyleDirective(tone=tone_default)


def _fingerprint_targets(fingerprint: Any) -> tuple[float | None, float | None, bool]:
    """把 judge 的 StyleFingerprint 基线 dict 映射成 StyleDirective 的目标字段。"""

    if not isinstance(fingerprint, Mapping):
        return None, None, False
    avg_len = _positive_float(fingerprint.get("average_sentence_length"))
    dialogue_ratio = _positive_float(fingerprint.get("dialogue_ratio"))
    restraint = _positive_float(fingerprint.get("restraint_density")) is not None
    return avg_len, dialogue_ratio, restraint


def _positive_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value > 0:
        return float(value)
    return None


def _pacing_from_state(state: Mapping[str, Any]) -> PacingDirective:
    raw = state.get("pacing_directive")
    if isinstance(raw, Mapping):
        target = raw.get("target_chars")
        return PacingDirective(
            intensity=_str(raw.get("intensity")),
            target_chars=int(target) if isinstance(target, int) and target > 0 else None,
            beat_density=_str(raw.get("beat_density")),
            hook_required=bool(raw.get("hook_required", False)),
            notes=tuple(_str_list(raw.get("notes"))),
        )
    return PacingDirective()


def _continuity_from_state(state: Mapping[str, Any]) -> tuple[ContinuityFact, ...]:
    raw = state.get("continuity_facts")
    entries: list[tuple[int, Mapping[str, Any] | None, ContinuityFact]] = []
    if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
        for index, entry in enumerate(raw):
            if isinstance(entry, Mapping):
                statement = _str(entry.get("statement"))
                if not statement:
                    continue
                entries.append(
                    (
                        index,
                        entry,
                        ContinuityFact(
                            statement=statement,
                            must_appear=bool(entry.get("must_appear", False)),
                            source_ref=_str(entry.get("source_ref")),
                        ),
                    )
                )
            elif _str(entry):
                entries.append((index, None, ContinuityFact(statement=_str(entry))))
    facts = _prioritized_continuity_entries(entries, state)
    return tuple(_within_continuity_budget(facts))


def _scene_quality_plan_from_state(state: Mapping[str, Any]) -> SceneQualityPlan:
    raw = state.get("scene_quality_plan")
    if not isinstance(raw, Mapping):
        return SceneQualityPlan()
    return SceneQualityPlan(
        emotional_shift=_str(raw.get("emotional_shift")),
        conflict_turn=_str(raw.get("conflict_turn")),
        sensory_anchors=tuple(_str_list(raw.get("sensory_anchors"))),
        dialogue_purpose=_str(raw.get("dialogue_purpose")),
        reveal_or_payoff=_str(raw.get("reveal_or_payoff")),
        ending_hook=_str(raw.get("ending_hook")),
    )


def _chapter_beat_from_state(state: Mapping[str, Any]) -> Any | None:
    raw = state.get("current_chapter_beat") or state.get("chapter_beat_directive")
    return raw or None


def narrative_context_from_state(state: Mapping[str, Any]) -> NarrativeContext:
    """从引用型 GenerationState（含可选注入键）构造构建器输入。"""

    ctx = NarrativeContext(
        premise=_str(state.get("premise")),
        user_intent=_str(state.get("user_intent")),
        strategy_title=_str(state.get("strategy_title_ref")),
        central_question=_str(state.get("strategy_question_ref")),
        reader_promise=_str(state.get("strategy_reader_promise_ref")),
        chapter_title=_str(state.get("chapter_title_ref")),
        chapter_goal=_str(state.get("chapter_goal_ref")),
        conflict_axis=_str(state.get("conflict_axis_ref")),
        scene_goal=_str(state.get("scene_goal_ref")),
        scene_beats=tuple(_str_list(state.get("scene_beat_refs"))),
        previous_summary=_str(state.get("previous_summary_ref")),
        characters=_characters_from_state(state),
        style=_style_from_state(state),
        pacing=_pacing_from_state(state),
        continuity=_continuity_from_state(state),
        required_facts=tuple(_str_list(state.get("required_fact_refs"))),
        scene_quality_plan=_scene_quality_plan_from_state(state),
        current_chapter_beat=_chapter_beat_from_state(state),
        target_word_count_min=_positive_int(state.get("target_word_count_min")),
        target_word_count_max=_positive_int(state.get("target_word_count_max")),
    )
    return ctx
