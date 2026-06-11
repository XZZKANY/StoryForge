"""Filter system/process terms out of draft prose."""

from __future__ import annotations

from dataclasses import dataclass, field

from storyforge_workflow.narrative.verdict import issue

FORBIDDEN_DRAFT_TERMS = (
    "Phase",
    "冒烟",
    "真实 LLM",
    "测试",
    "workflow",
    "pipeline",
    "审计链",
    "工具调用",
    "模型",
    "生成器",
    "系统提示",
)


@dataclass(frozen=True)
class ForbiddenTermsVerdict:
    status: str
    terms: list[str] = field(default_factory=list)
    issues: list[dict[str, str]] = field(default_factory=list)
    repair_type: str = ""


class ForbiddenDraftTermsFilter:
    def scan(self, text: str) -> ForbiddenTermsVerdict:
        prose = text or ""
        terms = [term for term in FORBIDDEN_DRAFT_TERMS if term in prose]
        if not terms:
            return ForbiddenTermsVerdict(status="pass")
        issues = [
            issue(
                "正文系统词",
                f"正文包含系统/流程词：{term}",
                snippet=term,
                suggestion="把流程说明改成可见动作、场景物件和人物反应。",
                revision_strategy="regenerate",
            )
            for term in terms
        ]
        return ForbiddenTermsVerdict(
            status="fail",
            terms=terms,
            issues=issues,
            repair_type="convert_process_to_scene",
        )
