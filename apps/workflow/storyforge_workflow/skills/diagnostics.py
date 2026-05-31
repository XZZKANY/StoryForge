from __future__ import annotations

from typing import Any

from storyforge_workflow.skills.definitions import DEFAULT_NOVEL_SKILL_REGISTRY

REQUIRED_SKILLS = ("generate", "judge", "repair", "approve", "memory_extract", "export")
_CHAPTER_CHAIN = ("generate", "judge", "repair", "approve", "memory_extract")
_BOOK_CHAIN = ("export",)
_STATUS_CONTRACT = {
    "chapter_terminal": ("approved", "awaiting_review"),
    "book_terminal": ("completed", "awaiting_review", "paused_by_budget", "paused_by_provider_degradation"),
}


def validate_novel_skill_registry() -> dict[str, Any]:
    """校验默认小说技能注册表的静态完整性，不触发任何动态执行。"""

    skills = DEFAULT_NOVEL_SKILL_REGISTRY.all()
    skill_names = tuple(skill.name for skill in skills)
    missing_required_skills = tuple(name for name in REQUIRED_SKILLS if name not in skill_names)
    duplicate_count = len(skill_names) - len(set(skill_names))

    return {
        "status": "ready" if not missing_required_skills and duplicate_count == 0 else "invalid",
        "skill_count": len(skills),
        "missing_required_skills": missing_required_skills,
        "duplicate_count": duplicate_count,
        "dynamic_execution": False,
    }


def list_novel_skill_diagnostics() -> tuple[dict[str, Any], ...]:
    """按注册顺序返回可由工具直接消费的小说技能静态诊断行。"""

    return tuple(_skill_diagnostic_row(skill) for skill in DEFAULT_NOVEL_SKILL_REGISTRY.all())


def explain_bookrun_skill_chain() -> dict[str, Any]:
    """说明 BookRun 使用的固定技能链与终态契约，明确禁用动态插件。"""

    return {
        "chapter_chain": _CHAPTER_CHAIN,
        "book_chain": _BOOK_CHAIN,
        "dynamic_plugins": "disabled",
        "status_contract": dict(_STATUS_CONTRACT),
    }


def _skill_diagnostic_row(skill: Any) -> dict[str, Any]:
    """把冻结的技能定义投影为普通诊断字典，避免调用方依赖 dataclass 细节。"""

    return {
        "name": skill.name,
        "version": skill.version,
        "stage": skill.stage,
        "required_capabilities": tuple(skill.required_capabilities),
        "input_refs": tuple(skill.input_refs),
        "output_refs": tuple(skill.output_refs),
        "gates": tuple(skill.gates),
        "audit_fields": tuple(skill.audit_fields),
        "status_mapping": dict(skill.status_mapping),
    }
