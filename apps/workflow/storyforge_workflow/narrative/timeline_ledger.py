"""Minimal timeline ledger for availability contradictions."""

from __future__ import annotations

from dataclasses import dataclass

from storyforge_workflow.narrative.verdict import GateVerdict, issue


@dataclass(frozen=True)
class _Availability:
    chapter: int
    available_in_days: int


class TimelineLedger:
    def __init__(self) -> None:
        self._availability: dict[str, _Availability] = {}

    def record_availability(self, *, chapter: int, item: str, available_in_days: int) -> GateVerdict:
        self._availability[item] = _Availability(chapter=chapter, available_in_days=available_in_days)
        return GateVerdict(status="pass", issues=[])
    def claim_available_today(self, *, chapter: int, item: str, days_elapsed_since_last: int = 0) -> GateVerdict:
        previous = self._availability.get(item)
        if previous and days_elapsed_since_last < previous.available_in_days:
            return GateVerdict(
                status="fail",
                issues=[
                    issue(
                        "时间账本",
                        (
                            f"chapter {previous.chapter} records {item} available in "
                            f"{previous.available_in_days} days; chapter {chapter} says available today without time jump"
                        ),
                        snippet=item,
                    )
                ],
            )
        return GateVerdict(status="pass", issues=[])
