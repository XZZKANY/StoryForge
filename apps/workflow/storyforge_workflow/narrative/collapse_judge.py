"""Rule-based narrative collapse judge."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from storyforge_workflow.narrative.plan import NarrativePhasePolicy
from storyforge_workflow.narrative.verdict import GateVerdict, issue, verdict_from_issues


class NarrativeCollapseJudge:
    def judge(
        self,
        *,
        chapter: int,
        function: str,
        beats: Sequence[str],
        emotion_before: str = "",
        emotion_after: str = "",
        irreversible_consequence: str = "",
        deletable: bool = False,
        phase_policy: NarrativePhasePolicy | None = None,
        new_core_entities: Mapping[str, Sequence[str]] | None = None,
    ) -> GateVerdict:
        issues: list[dict[str, str]] = []
        if deletable:
            issues.append(issue("叙事塌缩", f"deletable chapter: chapter {chapter}"))
        if _is_process_only(beats):
            issues.append(issue("叙事塌缩", "process-only 到场-取证-保存-转场", snippet="-".join(beats)))
        if emotion_before and emotion_after and emotion_before == emotion_after:
            issues.append(issue("叙事塌缩", "no emotion change", snippet=emotion_before))
        if not irreversible_consequence:
            issues.append(issue("叙事塌缩", "no irreversible consequence"))
        if (
            phase_policy
            and phase_policy.phase == "收束"
            and not phase_policy.allowed_expansion
            and any(values for values in (new_core_entities or {}).values())
        ):
            issues.append(issue("叙事塌缩", "phase says收束 but chapter expands"))
        return verdict_from_issues(issues)


def _is_process_only(beats: Sequence[str]) -> bool:
    normalized = [beat.strip() for beat in beats if beat.strip()]
    return normalized == ["到场", "取证", "保存", "转场"]
