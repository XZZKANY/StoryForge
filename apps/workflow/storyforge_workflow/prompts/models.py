"""Prompt 工程层的结构化输入模型。

全部为冻结 dataclass，承载从角色规范、风格包、记忆原子等真相源提取出的硬约束。
构建器只消费这些对象，因此该层可单测、可复用，且不与任何具体存储耦合。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field


def _clean(value: str | None) -> str:
    return value.strip() if isinstance(value, str) else ""


def _clean_list(values: Sequence[str] | None) -> list[str]:
    if not values:
        return []
    seen: list[str] = []
    for raw in values:
        item = _clean(raw)
        if item and item not in seen:
            seen.append(item)
    return seen


@dataclass(frozen=True)
class CharacterConstraint:
    """单个角色的硬约束，来源对应 Character Bible 条目。

    voice_traits / forbidden_traits 是正反两面：前者要在正文中体现，后者绝不能出现，
    用于把"角色不能 OOC"这条长篇一致性要求显式写进 prompt，而不是寄希望于模型自觉。
    """

    name: str
    aliases: Sequence[str] = field(default_factory=tuple)
    voice_traits: Sequence[str] = field(default_factory=tuple)
    forbidden_traits: Sequence[str] = field(default_factory=tuple)
    role: str = ""

    def describe(self) -> str:
        """渲染成一行角色约束，省略空字段。"""

        parts: list[str] = [self.name]
        role = _clean(self.role)
        if role:
            parts.append(f"（{role}）")
        segments = ["".join(parts)]
        aliases = _clean_list(self.aliases)
        if aliases:
            segments.append(f"别名：{('、'.join(aliases))}")
        voice = _clean_list(self.voice_traits)
        if voice:
            segments.append(f"声音/性格：{('、'.join(voice))}")
        forbidden = _clean_list(self.forbidden_traits)
        if forbidden:
            segments.append(f"禁止表现：{('、'.join(forbidden))}")
        return "；".join(segments)


@dataclass(frozen=True)
class StyleDirective:
    """文风注入，对应 Style Pack 的规则 / 禁用表达 / 示例句。

    示例句以 few-shot 锚点形式注入，比抽象形容词（"优美""紧凑"）更能稳定模型文风。
    target_* / restraint 来自已批准章节的 StyleFingerprint 基线，把"事后检出漂移"前馈成
    "生成时主动对齐"，让续写贴合既定声音。
    """

    tone: str = ""
    rules: Sequence[str] = field(default_factory=tuple)
    forbidden_phrases: Sequence[str] = field(default_factory=tuple)
    example_sentences: Sequence[str] = field(default_factory=tuple)
    pov: str = ""
    tense: str = ""
    target_avg_sentence_length: float | None = None
    target_dialogue_ratio: float | None = None
    restraint: bool = False

    def has_content(self) -> bool:
        return bool(
            _clean(self.tone)
            or _clean_list(self.rules)
            or _clean_list(self.forbidden_phrases)
            or _clean_list(self.example_sentences)
            or _clean(self.pov)
            or _clean(self.tense)
            or self.target_avg_sentence_length
            or self.target_dialogue_ratio
            or self.restraint
        )


@dataclass(frozen=True)
class PacingDirective:
    """章节/场景节奏控制。

    把"这一段该快还是该慢、张力推到哪"变成可注入的显式指令，
    避免长篇里每段都是同一个匀速叙事腔。
    """

    intensity: str = ""
    target_chars: int | None = None
    beat_density: str = ""
    hook_required: bool = False
    notes: Sequence[str] = field(default_factory=tuple)

    def has_content(self) -> bool:
        return bool(
            _clean(self.intensity)
            or self.target_chars
            or _clean(self.beat_density)
            or self.hook_required
            or _clean_list(self.notes)
        )


@dataclass(frozen=True)
class ContinuityFact:
    """必须在本段被尊重或体现的连续性事实，来源 Story Memory / Timeline。"""

    statement: str
    must_appear: bool = False
    source_ref: str = ""

    def describe(self) -> str:
        text = _clean(self.statement)
        if self.must_appear:
            return f"{text}（本段必须体现）"
        return text


@dataclass(frozen=True)
class SceneQualityPlan:
    """生成前的场景质量意图，用于把好场景应具备的推进点前馈给 Draft Writer。"""

    emotional_shift: str = ""
    conflict_turn: str = ""
    sensory_anchors: Sequence[str] = field(default_factory=tuple)
    dialogue_purpose: str = ""
    reveal_or_payoff: str = ""
    ending_hook: str = ""

    def has_content(self) -> bool:
        return bool(
            _clean(self.emotional_shift)
            or _clean(self.conflict_turn)
            or _clean_list(self.sensory_anchors)
            or _clean(self.dialogue_purpose)
            or _clean(self.reveal_or_payoff)
            or _clean(self.ending_hook)
        )


@dataclass(frozen=True)
class QualityScore:
    """多维质量评分，服务 Judge 输出、审计汇总和后续趋势对比。"""

    prose_quality: float | None = None
    show_dont_tell: float | None = None
    character_consistency: float | None = None
    continuity_consistency: float | None = None
    scene_progression: float | None = None
    pacing_control: float | None = None
    hook_strength: float | None = None
    ai_artifact_penalty: float | None = None


@dataclass(frozen=True)
class RevisionStrategy:
    """问题修订策略，约束 Reviser 是局部改句、场景补丁还是整段重写。"""

    mode: str = "line_edit"
    must_keep: Sequence[str] = field(default_factory=tuple)
    must_remove: Sequence[str] = field(default_factory=tuple)
    target_effect: str = ""


@dataclass(frozen=True)
class QualityIssue:
    """可执行的质量问题条目，连接静态检查、LLM Judge 和 Repair prompt。"""

    dimension: str = ""
    severity: str = "低"
    snippet: str = ""
    reason: str = ""
    suggestion: str = ""
    revision_strategy: RevisionStrategy = field(default_factory=RevisionStrategy)

    def to_contract_line(self) -> str:
        """渲染为 revision prompt 可消费的单行契约。"""

        strategy = self.revision_strategy
        return "｜".join(
            (
                _clean(self.dimension),
                _clean(self.severity),
                _clean(self.snippet),
                _clean(self.reason),
                _clean(strategy.mode),
                "、".join(_clean_list(strategy.must_keep)),
                "、".join(_clean_list(strategy.must_remove)),
                _clean(strategy.target_effect) or _clean(self.suggestion),
            )
        )


@dataclass(frozen=True)
class QualityReport:
    """一次场景质量评审结果，可由静态检查和 LLM Judge 共同填充。"""

    decision: str = "pass"
    score: QualityScore = field(default_factory=QualityScore)
    issues: Sequence[QualityIssue] = field(default_factory=tuple)
    summary: str = ""

@dataclass(frozen=True)
class NarrativeContext:
    """一次生成请求的叙事上下文聚合，构建器的主输入。

    premise/strategy 等是项目级长程信息；chapter/scene 是当前位置；
    previous_summary 提供上一段落的衔接锚点，保证叙事连续。
    """

    premise: str = ""
    user_intent: str = ""
    strategy_title: str = ""
    central_question: str = ""
    reader_promise: str = ""
    chapter_title: str = ""
    chapter_goal: str = ""
    conflict_axis: str = ""
    scene_goal: str = ""
    scene_beats: Sequence[str] = field(default_factory=tuple)
    previous_summary: str = ""
    characters: Sequence[CharacterConstraint] = field(default_factory=tuple)
    style: StyleDirective = field(default_factory=StyleDirective)
    pacing: PacingDirective = field(default_factory=PacingDirective)
    continuity: Sequence[ContinuityFact] = field(default_factory=tuple)
    required_facts: Sequence[str] = field(default_factory=tuple)
    scene_quality_plan: SceneQualityPlan = field(default_factory=SceneQualityPlan)
    target_word_count_min: int | None = None
    target_word_count_max: int | None = None

