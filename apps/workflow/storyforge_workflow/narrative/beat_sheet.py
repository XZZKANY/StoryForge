"""Beat-sheet level gates for long-form narrative control."""

from __future__ import annotations

from storyforge_workflow.narrative.plan import ChapterBeat, NarrativePlan
from storyforge_workflow.narrative.verdict import GateVerdict, issue, verdict_from_issues


class BeatSheetGate:
    def validate(self, plan: NarrativePlan) -> GateVerdict:
        beats = sorted(plan.chapter_beats, key=lambda beat: beat.chapter)
        issues: list[dict[str, str]] = []
        issues.extend(_check_tracking_runs(beats))
        issues.extend(_check_late_expansion(beats))
        issues.extend(_check_five_chapter_turns(beats))
        issues.extend(_check_chapter_30_closes(beats))
        return verdict_from_issues(issues)


def _check_tracking_runs(beats: list[ChapterBeat]) -> list[dict[str, str]]:
    for first, second, third in zip(beats, beats[1:], beats[2:], strict=False):
        if (
            second.chapter == first.chapter + 1
            and third.chapter == second.chapter + 1
            and first.function == second.function == third.function == "追踪线索"
        ):
            return [
                issue(
                    "节拍表",
                    "consecutive 3 chapters function='追踪线索'",
                    snippet=f"{first.chapter},{second.chapter},{third.chapter}",
                )
            ]
    return []


def _check_late_expansion(beats: list[ChapterBeat]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    for beat in beats:
        if beat.chapter >= 20 and beat.new_core_entities.get("locations"):
            issues.append(
                issue(
                    "节拍表",
                    "chapter 20+ new core locations",
                    snippet=", ".join(beat.new_core_entities["locations"]),
                )
            )
        late_entities = [
            *beat.new_core_entities.get("characters", ()),
            *beat.new_core_entities.get("equipment", ()),
            *beat.new_core_entities.get("mysteries", ()),
        ]
        if beat.chapter >= 25 and late_entities:
            issues.append(
                issue(
                    "节拍表",
                    "chapter 25+ new core characters/equipment/mysteries",
                    snippet=", ".join(late_entities),
                )
            )
    return issues


def _check_five_chapter_turns(beats: list[ChapterBeat]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    for beat in beats:
        if beat.chapter % 5 == 0 and (not beat.relationship_change or not beat.irreversible_consequence):
            issues.append(
                issue(
                    "节拍表",
                    "every 5 chapters has relationship change and irreversible consequence",
                    snippet=str(beat.chapter),
                )
            )
    return issues


def _check_chapter_30_closes(beats: list[ChapterBeat]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    closing_terms = ("收束", "关闭", "终局", "结局", "close", "closing")
    for beat in beats:
        if beat.chapter == 30:
            expands = any(values for values in beat.new_core_entities.values())
            closes = any(term in beat.function for term in closing_terms)
            if expands or not closes:
                issues.append(issue("节拍表", "chapter 30 only closes", snippet=beat.function))
    return issues
