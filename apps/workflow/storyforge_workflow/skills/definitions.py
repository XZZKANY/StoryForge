from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType

FORBIDDEN_STATUS_VALUES = frozenset(
    {
        "repair_required",
        "repair_limit_exceeded",
        "provider_failed",
        "budget_exceeded",
    }
)

_SKILL_ORDER = ("generate", "judge", "repair", "approve", "memory_extract", "export")


def _normalize_values(values: Sequence[str]) -> tuple[str, ...]:
    """清理字符串序列，保持技能契约稳定且无空项。"""

    return tuple(value.strip() for value in values if value.strip())


@dataclass(frozen=True)
class NovelSkillDefinition:
    """Novel Skill Framework 阶段一的静态技能契约。"""

    name: str
    version: str
    description: str
    trigger_conditions: Sequence[str] = field(default_factory=tuple)
    required_inputs: Sequence[str] = field(default_factory=tuple)
    produced_outputs: Sequence[str] = field(default_factory=tuple)
    allowed_statuses: Sequence[str] = field(default_factory=tuple)
    audit_fields: Sequence[str] = field(default_factory=tuple)
    next_skills: Sequence[str] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        name = self.name.strip()
        version = self.version.strip()
        description = self.description.strip()
        if not name:
            raise ValueError("技能名称不能为空。")
        if not version:
            raise ValueError("技能版本不能为空。")
        if not description:
            raise ValueError("技能描述不能为空。")

        object.__setattr__(self, "name", name)
        object.__setattr__(self, "version", version)
        object.__setattr__(self, "description", description)
        for field_name in (
            "trigger_conditions",
            "required_inputs",
            "produced_outputs",
            "allowed_statuses",
            "audit_fields",
            "next_skills",
        ):
            object.__setattr__(self, field_name, _normalize_values(getattr(self, field_name)))

        forbidden = FORBIDDEN_STATUS_VALUES.intersection(self.allowed_statuses)
        if forbidden:
            joined = "、".join(sorted(forbidden))
            raise ValueError(f"禁止的技能状态：{joined}")


class NovelSkillRegistry:
    """固定顺序的小说技能注册表，不做动态发现或外部代码执行。"""

    def __init__(self, skills: Iterable[NovelSkillDefinition]) -> None:
        self._skills = tuple(skills)
        index: dict[str, NovelSkillDefinition] = {}
        for skill in self._skills:
            if skill.name in index:
                raise ValueError(f"小说技能名称重复：{skill.name}")
            index[skill.name] = skill
        self._by_name = MappingProxyType(index)

    def list(self) -> tuple[NovelSkillDefinition, ...]:
        """按默认技能链顺序返回全部技能定义。"""

        return self._skills

    def names(self) -> tuple[str, ...]:
        """返回稳定技能名称序列，供测试和审计报告排序使用。"""

        return tuple(skill.name for skill in self._skills)

    def get(self, name: str) -> NovelSkillDefinition:
        """按名称读取技能；缺失时抛出包含技能名的明确错误。"""

        normalized_name = name.strip()
        try:
            return self._by_name[normalized_name]
        except KeyError as exc:
            raise KeyError(f"小说技能不存在：{normalized_name}") from exc


def _skill(
    *,
    name: str,
    description: str,
    trigger_conditions: Sequence[str],
    required_inputs: Sequence[str],
    produced_outputs: Sequence[str],
    allowed_statuses: Sequence[str],
    audit_fields: Sequence[str],
    next_skills: Sequence[str],
) -> NovelSkillDefinition:
    """用统一默认版本构造首批静态技能定义。"""

    return NovelSkillDefinition(
        name=name,
        version="1.0.0",
        description=description,
        trigger_conditions=trigger_conditions,
        required_inputs=required_inputs,
        produced_outputs=produced_outputs,
        allowed_statuses=allowed_statuses,
        audit_fields=audit_fields,
        next_skills=next_skills,
    )


DEFAULT_NOVEL_SKILL_REGISTRY = NovelSkillRegistry(
    [
        _skill(
            name="generate",
            description="章节目标和上下文引用齐备时生成候选正文，并记录 ModelRun 引用。",
            trigger_conditions=("Blueprint 已锁定", "章节目标存在", "上下文编译完成"),
            required_inputs=(
                "book_id",
                "chapter_id",
                "chapter_index",
                "chapter_goal",
                "scene_packet_id",
                "compiled_context_id",
                "prompt_pack_id",
            ),
            produced_outputs=("draft_summary", "draft_hash", "model_run_id"),
            allowed_statuses=("generated",),
            audit_fields=(
                "skill_name",
                "skill_version",
                "model_run_id",
                "compiled_context_id",
                "token_usage",
                "elapsed_time_sec",
                "fallback_metadata",
            ),
            next_skills=("judge",),
        ),
        _skill(
            name="judge",
            description="对候选草稿执行静态质量门与结构化评审，决定通过、修复或人工审查。",
            trigger_conditions=("草稿已生成", "章节目标存在", "质量约束存在"),
            required_inputs=(
                "draft_summary",
                "draft_hash",
                "scene_packet_id",
                "compiled_context_id",
                "character_bible_ref",
                "timeline_ref",
                "style_guide_ref",
            ),
            produced_outputs=("judge_report_id", "repair_patch_id", "issue_count", "decision"),
            allowed_statuses=("static_gate_pass", "static_gate_blocked", "pass", "repair", "awaiting_review", "judge_failed"),
            audit_fields=("skill_name", "skill_version", "judge_report_id", "issue_count", "max_severity", "decision"),
            next_skills=("repair", "approve"),
        ),
        _skill(
            name="repair",
            description="根据评审报告执行定向修复，并把修订稿送回 judge 重判。",
            trigger_conditions=("judge 返回 repair", "attempt 小于 max_repairs"),
            required_inputs=("draft_summary", "draft_hash", "judge_report_id", "issues", "revision_strategy", "compiled_context_id"),
            produced_outputs=("revised_draft_summary", "revised_draft_hash"),
            allowed_statuses=("repaired",),
            audit_fields=("skill_name", "skill_version", "source_judge_report_id", "repair_patch_id", "attempt", "revision_strategy"),
            next_skills=("judge",),
        ),
        _skill(
            name="approve",
            description="评审通过后把最终草稿写回作品真相源，形成 approved scene 引用。",
            trigger_conditions=("judge 返回 pass", "可批准草稿存在", "目标章节匹配"),
            required_inputs=("book_id", "chapter_id", "chapter_index", "final_draft_hash", "source_model_run_id", "judge_report_id"),
            produced_outputs=("approved_scene_id", "chapter_writeback_summary"),
            allowed_statuses=("approved",),
            audit_fields=("skill_name", "skill_version", "approved_scene_id", "source_model_run_id", "judge_report_id", "repair_patch_id"),
            next_skills=("memory_extract",),
        ),
        _skill(
            name="memory_extract",
            description="仅从已批准章节抽取长期记忆引用，并区分真实更新、跳过和失败。",
            trigger_conditions=("章节已 approved", "approve_scene 写回成功"),
            required_inputs=("approved_scene_id", "final_draft_hash", "chapter_goal", "story_memory_ref", "character_bible_ref", "timeline_ref"),
            produced_outputs=("memory_atom_ids", "timeline_event_ids", "character_state_delta"),
            allowed_statuses=("memory_updated", "memory_extract_skipped", "memory_extract_failed"),
            audit_fields=("skill_name", "skill_version", "approved_scene_id", "memory_atom_ids", "timeline_event_ids", "character_state_delta"),
            next_skills=("export",),
        ),
        _skill(
            name="export",
            description="BookRun 完成后导出 Markdown、EPUB 与审计报告制品引用。",
            trigger_conditions=("BookRun completed", "已批准章节列表存在"),
            required_inputs=("book_run_id", "book_id", "approved_chapters", "checkpoint", "skill_chain_summary"),
            produced_outputs=("markdown_artifact_id", "epub_artifact_id", "audit_artifact_id"),
            allowed_statuses=("exported", "export_failed"),
            audit_fields=("skill_name", "skill_version", "artifact_ids", "chapter_count", "audit_completeness"),
            next_skills=(),
        ),
    ]
)

if DEFAULT_NOVEL_SKILL_REGISTRY.names() != _SKILL_ORDER:
    raise RuntimeError("默认小说技能注册顺序与阶段一契约不一致。")


def list_novel_skills() -> tuple[NovelSkillDefinition, ...]:
    """返回默认小说技能注册表中的全部定义。"""

    return DEFAULT_NOVEL_SKILL_REGISTRY.list()


def get_novel_skill(name: str) -> NovelSkillDefinition:
    """从默认小说技能注册表按名称读取定义。"""

    return DEFAULT_NOVEL_SKILL_REGISTRY.get(name)
