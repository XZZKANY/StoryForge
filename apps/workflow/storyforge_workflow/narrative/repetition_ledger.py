"""Track repeated motifs and action patterns."""

from __future__ import annotations

from collections import defaultdict

from storyforge_workflow.narrative.verdict import GateVerdict, issue


class RepetitionLedger:
    def __init__(self) -> None:
        self._static_motif_counts: defaultdict[str, int] = defaultdict(int)
        self._action_counts: defaultdict[str, int] = defaultdict(int)

    def record_motif(self, *, chapter: int, motif: str, changes_action: bool) -> GateVerdict:
        if changes_action:
            return GateVerdict(status="pass", issues=[])
        self._static_motif_counts[motif] += 1
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
        key = _action_key(pattern)
        self._action_counts[key] += 1
        if key == "save/encrypt/sync" and self._action_counts[key] > 3:
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
