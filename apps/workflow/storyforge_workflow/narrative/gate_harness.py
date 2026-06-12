"""Minimal narrative gate harness."""

from __future__ import annotations

from dataclasses import dataclass

from storyforge_workflow.narrative.collapse_judge import NarrativeCollapseJudge
from storyforge_workflow.narrative.extract import NarrativeSceneFact
from storyforge_workflow.narrative.plan import NarrativePlan
from storyforge_workflow.narrative.verdict import GateVerdict


@dataclass(frozen=True)
class NarrativeGateInput:
    narrative_fact: NarrativeSceneFact | None = None


class NarrativeGateHarness:
    def __init__(self, plan: NarrativePlan) -> None:
        self.plan = plan
        self.collapse_judge = NarrativeCollapseJudge()

    def evaluate(self, gate_input: NarrativeGateInput) -> GateVerdict:
        if gate_input.narrative_fact is None:
            return GateVerdict(status="pass", issues=[])

        fact = gate_input.narrative_fact
        return self.collapse_judge.judge_fact(
            fact,
            phase_policy=self.plan.phase_policy,
            new_core_entities={"evidence": fact.new_evidence} if fact.new_evidence else None,
        )
