"""Track repeated motifs and action patterns."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping

from storyforge_workflow.narrative.plan import RepetitionPattern, RepetitionPolicy
from storyforge_workflow.narrative.verdict import GateVerdict, issue


class RepetitionLedger:
    def __init__(self, *, policy: RepetitionPolicy | None = None) -> None:
        self.policy = policy or RepetitionPolicy()
        self._static_motif_counts: defaultdict[str, int] = defaultdict(int)
        self._action_counts: defaultdict[str, int] = defaultdict(int)

    @classmethod
    def from_dict(cls, data: dict[str, object], *, policy: RepetitionPolicy | None = None) -> RepetitionLedger:
        ledger = cls(policy=policy)
        ledger._static_motif_counts.update(_count_mapping(data.get("static_motif_counts")))
        ledger._action_counts.update(_count_mapping(data.get("action_counts")))
        return ledger

    def to_dict(self) -> dict[str, dict[str, int]]:
        return {
            "static_motif_counts": dict(self._static_motif_counts),
            "action_counts": dict(self._action_counts),
        }

    def record_motif(self, *, chapter: int, motif: str, changes_action: bool) -> GateVerdict:
        if changes_action:
            return GateVerdict(status="pass", issues=[])
        self._static_motif_counts[motif] += 1
        policy_pattern = _matching_pattern(motif, self.policy.tracked_motifs)
        if policy_pattern and self._static_motif_counts[motif] > policy_pattern.threshold:
            return GateVerdict(
                status="fail",
                issues=[
                    issue(
                        "重复账本",
                        f"{policy_pattern.key} motif repeated >{policy_pattern.threshold}",
                        snippet=motif,
                    )
                ],
            )
        if _is_left_arm_old_injury(motif) and self._static_motif_counts[motif] > 5:
            return GateVerdict(
                status="fail",
                issues=[
                    issue(
                        "重复账本",
                        f"Left arm old injury >5 without action-changing uses: {motif}",
                        snippet=motif,
                    )
                ],
            )
        return GateVerdict(status="pass", issues=[])

    def record_action_pattern(self, *, chapter: int, pattern: str) -> GateVerdict:
        policy_pattern = _matching_pattern(pattern, self.policy.tracked_action_patterns)
        key = policy_pattern.key if policy_pattern else _action_key(pattern)
        self._action_counts[key] += 1
        if policy_pattern and self._action_counts[key] > policy_pattern.threshold:
            return GateVerdict(
                status="fail",
                issues=[
                    issue(
                        "重复账本",
                        f"{policy_pattern.key} action repeated >{policy_pattern.threshold}",
                        snippet=pattern,
                    )
                ],
            )
        if not policy_pattern and key == "save/encrypt/sync" and self._action_counts[key] > 3:
            return GateVerdict(
                status="fail",
                issues=[
                    issue(
                        "重复账本",
                        "Save/encrypt/sync action repeated >3",
                        snippet=pattern,
                    )
                ],
            )
        return GateVerdict(status="pass", issues=[])


def _is_left_arm_old_injury(motif: str) -> bool:
    normalized = motif.lower()
    return ("左臂" in motif or "left arm" in normalized) and ("旧伤" in motif or "old injury" in normalized)


def _action_key(pattern: str) -> str:
    normalized = pattern.lower().replace("，", "/").replace(",", "/").replace("、", "/")
    if all(term in normalized for term in ("save", "encrypt", "sync")) or all(
        term in pattern for term in ("保存", "加密", "同步")
    ):
        return "save/encrypt/sync"
    return normalized


def _matching_pattern(text: str, patterns: tuple[RepetitionPattern, ...]) -> RepetitionPattern | None:
    normalized = text.lower()
    for pattern in patterns:
        if pattern.terms and all(term in text or term.lower() in normalized for term in pattern.terms):
            return pattern
    return None


def _count_mapping(value: object) -> dict[str, int]:
    if not isinstance(value, Mapping):
        return {}
    counts: dict[str, int] = {}
    for key, count in value.items():
        try:
            counts[str(key)] = max(0, int(count))
        except (TypeError, ValueError):
            continue
    return counts
