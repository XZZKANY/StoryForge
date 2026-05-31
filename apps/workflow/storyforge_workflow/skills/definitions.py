from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType

StatusMapping = Mapping[str, str]
_ALLOWED_STAGES = {"chapter", "book"}


def _normalize_text(value: str, field_name: str) -> str:
    """规范化必填文本字段，并在缺失时给出明确错误。"""

    normalized = value.strip()
    if not normalized:
        raise ValueError(f"小说技能{field_name}不能为空。")
    return normalized


def _normalize_values(values: Sequence[str]) -> tuple[str, ...]:
    """清理字符串序列，保持静态字段稳定且无空项。"""

    return tuple(str(value).strip() for value in values if str(value).strip())


def _freeze_status_mapping(mapping: Mapping[str, str]) -> StatusMapping:
    """复制并冻结状态映射，避免调用方保留原始 dict 后污染注册表。"""

    frozen = {
        str(key).strip(): str(value).strip()
        for key, value in mapping.items()
        if str(key).strip() and str(value).strip()
    }
    return MappingProxyType(frozen)


@dataclass(frozen=True)
class NovelSkillReferences:
    """小说技能与页面、API、workflow 节点和事实源之间的静态对应关系。"""

    page_refs: Sequence[str] = field(default_factory=tuple)
    api_paths: Sequence[str] = field(default_factory=tuple)
    workflow_nodes: Sequence[str] = field(default_factory=tuple)
    source_refs: Sequence[str] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        object.__setattr__(self, "page_refs", _normalize_values(self.page_refs))
        object.__setattr__(self, "api_paths", _normalize_values(self.api_paths))
        object.__setattr__(self, "workflow_nodes", _normalize_values(self.workflow_nodes))
        object.__setattr__(self, "source_refs", _normalize_values(self.source_refs))


@dataclass(frozen=True)
class NovelSkillDefinition:
    """StoryForge 小说技能的静态契约，只描述既有 NovelLoop 与 BookLoop 步骤。"""

    name: str
    version: str
    stage: str
    description: str
    input_refs: Sequence[str]
    output_refs: Sequence[str]
    gates: Sequence[str]
    audit_fields: Sequence[str]
    status_mapping: StatusMapping
    required_capabilities: Sequence[str] = field(default_factory=tuple)
    references: NovelSkillReferences = field(default_factory=NovelSkillReferences)

    def __post_init__(self) -> None:
        name = _normalize_text(self.name, "名称")
        version = _normalize_text(self.version, "版本")
        stage = _normalize_text(self.stage, " stage")
        if stage not in _ALLOWED_STAGES:
            raise ValueError("小说技能 stage 只能是 chapter 或 book。")
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "version", version)
        object.__setattr__(self, "stage", stage)
        object.__setattr__(self, "description", self.description.strip())
        object.__setattr__(self, "input_refs", _normalize_values(self.input_refs))
        object.__setattr__(self, "output_refs", _normalize_values(self.output_refs))
        object.__setattr__(self, "gates", _normalize_values(self.gates))
        object.__setattr__(self, "audit_fields", _normalize_values(self.audit_fields))
        object.__setattr__(self, "status_mapping", _freeze_status_mapping(self.status_mapping))
        object.__setattr__(self, "required_capabilities", _normalize_values(self.required_capabilities))


class NovelSkillRegistry:
    """静态小说技能注册表，负责按名称、阶段和能力查询技能元数据。"""

    def __init__(self, skills: Iterable[NovelSkillDefinition]) -> None:
        self._skills = tuple(skills)
        index: dict[str, NovelSkillDefinition] = {}
        for skill in self._skills:
            if skill.name in index:
                raise ValueError(f"小说技能名称重复：{skill.name}")
            index[skill.name] = skill
        self._by_name = MappingProxyType(index)

    @classmethod
    def default(cls) -> NovelSkillRegistry:
        """返回只包含通用技能链的默认注册表。"""

        return DEFAULT_NOVEL_SKILL_REGISTRY

    @classmethod
    def with_genre_pack(cls, genre: str) -> NovelSkillRegistry:
        """显式加载单个题材技能包，默认链路不自动携带题材技能。"""

        normalized_genre = genre.strip().lower()
        pack = GENRE_NOVEL_SKILL_PACKS.get(normalized_genre)
        if pack is None:
            raise ValueError(f"未知题材技能包：{genre}")
        return cls((*DEFAULT_NOVEL_SKILLS, *pack))

    def all(self) -> tuple[NovelSkillDefinition, ...]:
        """按注册顺序返回全部小说技能说明。"""

        return self._skills

    def names(self) -> tuple[str, ...]:
        """按注册顺序返回全部技能名称。"""

        return tuple(skill.name for skill in self._skills)

    def get(self, name: str) -> NovelSkillDefinition | None:
        """按名称读取小说技能；缺失时返回 None，便于调用方自行降级。"""

        return self._by_name.get(name)

    def require(self, name: str) -> NovelSkillDefinition:
        """按名称读取小说技能；缺失时抛出明确中文错误。"""

        skill = self.get(name)
        if skill is None:
            raise KeyError(f"小说技能不存在：{name}")
        return skill

    def by_stage(self, stage: str) -> tuple[NovelSkillDefinition, ...]:
        """返回指定执行阶段下的全部小说技能。"""

        normalized_stage = stage.strip()
        return tuple(skill for skill in self._skills if skill.stage == normalized_stage)

    def by_capability(self, capability: str) -> tuple[NovelSkillDefinition, ...]:
        """返回声明需要指定能力的全部小说技能。"""

        normalized_capability = capability.strip()
        return tuple(skill for skill in self._skills if normalized_capability in skill.required_capabilities)


def _refs(
    *,
    page_refs: Sequence[str] = (),
    api_paths: Sequence[str] = (),
    workflow_nodes: Sequence[str] = (),
    source_refs: Sequence[str] = (),
) -> NovelSkillReferences:
    """用简短工厂保持默认技能条目可读。"""

    return NovelSkillReferences(
        page_refs=page_refs,
        api_paths=api_paths,
        workflow_nodes=workflow_nodes,
        source_refs=source_refs,
    )


GENERATE_SKILL = NovelSkillDefinition(
    name="generate",
    version="1.0.0",
    stage="chapter",
    description="基于已编译上下文生成单章草稿，并记录模型运行引用。",
    input_refs=("book_id", "chapter_id", "chapter_index", "chapter_goal", "compiled_context_id"),
    output_refs=("draft_ref", "model_run_id"),
    gates=("compiled_context_id",),
    audit_fields=("token_usage", "elapsed_time_sec", "cost_estimate", "fallback_metadata"),
    status_mapping={"success": "generated", "fallback": "generated"},
    required_capabilities=("llm",),
    references=_refs(
        workflow_nodes=("NovelLoopPorts.compile_context", "NovelLoopPorts.generate_scene", "NovelLoopPorts.record_model_run"),
        source_refs=(
            "apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:67",
            "apps/workflow/storyforge_workflow/orchestrators/book_loop.py:94",
        ),
    ),
)

JUDGE_SKILL = NovelSkillDefinition(
    name="judge",
    version="1.0.0",
    stage="chapter",
    description="审阅单章草稿，输出通过、修复或等待人工审阅的判定引用。",
    input_refs=("chapter_id", "draft_ref", "model_run_id"),
    output_refs=("judge_report_id", "repair_patch_id", "static_quality_issues"),
    gates=("draft_ref", "model_run_id"),
    audit_fields=("judge_report_id", "repair_patch_id", "static_quality_issues"),
    status_mapping={"pass": "pass", "repair": "repair", "awaiting_review": "awaiting_review"},
    required_capabilities=("llm",),
    references=_refs(
        workflow_nodes=("NovelLoopPorts.check_static_quality", "NovelLoopPorts.judge_scene"),
        source_refs=(
            "apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:75",
            "apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:85",
        ),
    ),
)

REPAIR_SKILL = NovelSkillDefinition(
    name="repair",
    version="1.0.0",
    stage="chapter",
    description="根据 judge 报告修复草稿，并保留修复补丁引用供后续审计。",
    input_refs=("chapter_id", "draft_ref", "judge_report_id", "repair_attempt"),
    output_refs=("draft_ref", "repair_patch_id"),
    gates=("judge_report_id",),
    audit_fields=("repair_patch_id", "repair_attempt", "static_quality_issues"),
    status_mapping={"success": "repaired", "awaiting_review": "awaiting_review"},
    required_capabilities=("llm",),
    references=_refs(
        workflow_nodes=("NovelLoopPorts.repair_scene",),
        source_refs=(
            "apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:82",
            "apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:105",
        ),
    ),
)

APPROVE_SKILL = NovelSkillDefinition(
    name="approve",
    version="1.0.0",
    stage="chapter",
    description="在 judge 通过后固化批准场景引用，形成单章 approved 结果。",
    input_refs=("chapter_id", "draft_ref", "model_run_id", "judge_report_id"),
    output_refs=("approved_scene_id",),
    gates=("model_run_id", "judge_report_id"),
    audit_fields=("approved_scene_id", "source_model_run_id", "judge_report_id"),
    status_mapping={"success": "approved"},
    required_capabilities=(),
    references=_refs(
        workflow_nodes=("NovelLoopPorts.approve_scene", "NovelLoopResult.status"),
        source_refs=(
            "apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:87",
            "apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:94",
        ),
    ),
)

MEMORY_EXTRACT_SKILL = NovelSkillDefinition(
    name="memory_extract",
    version="1.0.0",
    stage="chapter",
    description="从已批准场景抽取记忆原子引用；未注入 adapter 时按现有默认返回空列表。",
    input_refs=("chapter_id", "draft_ref", "approved_scene_id"),
    output_refs=("memory_atom_ids",),
    gates=("approved_scene_id",),
    audit_fields=("memory_atom_ids",),
    status_mapping={"success": "memory_updated", "skipped": "memory_extract_skipped"},
    required_capabilities=(),
    references=_refs(
        workflow_nodes=("NovelLoopPorts.extract_memory", "_skip_memory_extraction"),
        source_refs=(
            "apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:35",
            "apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:93",
        ),
    ),
)

EXPORT_SKILL = NovelSkillDefinition(
    name="export",
    version="1.0.0",
    stage="book",
    description="汇总 BookLoop 的已完成章节、checkpoint 与预算信息，形成整书导出所需引用。",
    input_refs=("book_run_id", "book_id", "completed_chapters", "checkpoint"),
    output_refs=("book_artifact_ref", "checkpoint", "budget"),
    gates=("completed_chapters", "checkpoint"),
    audit_fields=("completed_chapters", "checkpoint", "budget", "current_chapter_index"),
    status_mapping={"success": "completed", "awaiting_review": "awaiting_review", "paused": "paused_by_budget"},
    required_capabilities=(),
    references=_refs(
        workflow_nodes=("run_book_loop", "BookLoopResult.status"),
        source_refs=(
            "apps/workflow/storyforge_workflow/orchestrators/book_loop.py:36",
            "apps/workflow/storyforge_workflow/orchestrators/book_loop.py:87",
        ),
    ),
)

CLUE_FAIRNESS_JUDGE_SKILL = NovelSkillDefinition(
    name="clue_fairness_judge",
    version="1.0.0",
    stage="chapter",
    description="检查悬疑章节是否公平埋设线索、误导与揭示，只输出题材审计引用。",
    input_refs=("chapter_id", "draft_ref", "judge_report_id", "clue_map_ref"),
    output_refs=("clue_fairness_report_id", "unfair_clue_refs"),
    gates=("draft_ref", "judge_report_id"),
    audit_fields=("clue_fairness_report_id", "unfair_clue_refs", "fairness_score"),
    status_mapping={"pass": "clue_fair", "warn": "clue_warning", "fail": "clue_unfair"},
    required_capabilities=("llm",),
    references=_refs(
        workflow_nodes=("NovelLoopPorts.judge_scene",),
        source_refs=("apps/workflow/storyforge_workflow/skills/genre_mystery/clue_fairness_judge/SKILL.md",),
    ),
)

POWER_SCALE_GUARD_SKILL = NovelSkillDefinition(
    name="power_scale_guard",
    version="1.0.0",
    stage="chapter",
    description="检查玄幻章节战力等级、突破代价与胜负因果是否自洽。",
    input_refs=("chapter_id", "draft_ref", "power_system_ref", "character_power_refs"),
    output_refs=("power_scale_report_id", "power_violation_refs"),
    gates=("draft_ref", "power_system_ref"),
    audit_fields=("power_scale_report_id", "power_violation_refs", "scale_consistency_score"),
    status_mapping={"pass": "scale_consistent", "warn": "scale_warning", "fail": "scale_broken"},
    required_capabilities=("llm",),
    references=_refs(
        workflow_nodes=("NovelLoopPorts.judge_scene",),
        source_refs=("apps/workflow/storyforge_workflow/skills/genre_xuanhuan/power_scale_guard/SKILL.md",),
    ),
)

RELATIONSHIP_ARC_JUDGE_SKILL = NovelSkillDefinition(
    name="relationship_arc_judge",
    version="1.0.0",
    stage="chapter",
    description="检查言情章节关系推进、情绪转折和互动边界是否连续可信。",
    input_refs=("chapter_id", "draft_ref", "relationship_state_ref", "emotional_beats_ref"),
    output_refs=("relationship_arc_report_id", "arc_issue_refs"),
    gates=("draft_ref", "relationship_state_ref"),
    audit_fields=("relationship_arc_report_id", "arc_issue_refs", "arc_progress_score"),
    status_mapping={"pass": "arc_coherent", "warn": "arc_warning", "fail": "arc_broken"},
    required_capabilities=("llm",),
    references=_refs(
        workflow_nodes=("NovelLoopPorts.judge_scene",),
        source_refs=("apps/workflow/storyforge_workflow/skills/genre_romance/relationship_arc_judge/SKILL.md",),
    ),
)

DEFAULT_NOVEL_SKILLS = (
    GENERATE_SKILL,
    JUDGE_SKILL,
    REPAIR_SKILL,
    APPROVE_SKILL,
    MEMORY_EXTRACT_SKILL,
    EXPORT_SKILL,
)
GENRE_NOVEL_SKILL_PACKS = MappingProxyType(
    {
        "mystery": (CLUE_FAIRNESS_JUDGE_SKILL,),
        "xuanhuan": (POWER_SCALE_GUARD_SKILL,),
        "romance": (RELATIONSHIP_ARC_JUDGE_SKILL,),
    }
)
DEFAULT_NOVEL_SKILL_REGISTRY = NovelSkillRegistry(DEFAULT_NOVEL_SKILLS)


def list_novel_skills() -> tuple[NovelSkillDefinition, ...]:
    """返回默认静态小说技能注册表中的全部技能。"""

    return DEFAULT_NOVEL_SKILL_REGISTRY.all()


def get_novel_skill(name: str) -> NovelSkillDefinition | None:
    """从默认静态小说技能注册表按名称读取技能。"""

    return DEFAULT_NOVEL_SKILL_REGISTRY.get(name)
