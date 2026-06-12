"""Entity budget gates for long-form narrative plans."""

from __future__ import annotations

from dataclasses import dataclass, field

from storyforge_workflow.narrative.plan import EntityBudget
from storyforge_workflow.narrative.verdict import GateVerdict, issue, verdict_from_issues


@dataclass(frozen=True)
class ChapterEntityDelta:
    chapter: int
    new_key_characters: list[str] = field(default_factory=list)
    new_core_locations: list[str] = field(default_factory=list)
    new_core_evidence: list[str] = field(default_factory=list)
    new_major_reversals: list[str] = field(default_factory=list)
    new_mysteries: list[str] = field(default_factory=list)
    new_equipment: list[str] = field(default_factory=list)


class EntityBudgetGate:
    def __init__(self, budget: EntityBudget | None = None) -> None:
        self.budget = budget or EntityBudget()

    def validate(self, delta: ChapterEntityDelta) -> GateVerdict:
        issues: list[dict[str, str]] = []
        chapter = delta.chapter
        if chapter >= 20 and delta.new_core_locations:
            issues.append(
                issue(
                    "实体预算",
                    f"chapter 20+新增核心地点: {', '.join(delta.new_core_locations)}",
                    snippet=", ".join(delta.new_core_locations),
                )
            )
        if chapter >= 25 and delta.new_mysteries:
            issues.append(
                issue(
                    "实体预算",
                    f"chapter 25+新增新谜题: {', '.join(delta.new_mysteries)}",
                    snippet=", ".join(delta.new_mysteries),
                )
            )
        if chapter >= 30 and (delta.new_core_evidence or delta.new_equipment):
            hits = [*delta.new_core_evidence, *delta.new_equipment]
            issues.append(
                issue(
                    "实体预算",
                    f"chapter 30新增设备型号/core evidence: {', '.join(hits)}",
                    snippet=", ".join(hits),
                )
            )
        if len(delta.new_key_characters) > self.budget.key_characters:
            issues.append(issue("实体预算", "新增关键人物超过默认预算。", snippet=", ".join(delta.new_key_characters)))
        if len(delta.new_core_locations) > self.budget.core_locations:
            issues.append(issue("实体预算", "新增核心地点超过默认预算。", snippet=", ".join(delta.new_core_locations)))
        if len(delta.new_core_evidence) > self.budget.core_evidence:
            issues.append(issue("实体预算", "新增核心证据超过默认预算。", snippet=", ".join(delta.new_core_evidence)))
        if len(delta.new_major_reversals) > self.budget.major_reversals:
            issues.append(issue("实体预算", "重大反转超过默认预算。", snippet=", ".join(delta.new_major_reversals)))
        return verdict_from_issues(issues)
