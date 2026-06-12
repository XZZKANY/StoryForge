"""Rule-based narrative collapse judge."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from storyforge_workflow.narrative.extract import NarrativeSceneFact
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

    def judge_fact(
        self,
        fact: NarrativeSceneFact,
        *,
        phase_policy: NarrativePhasePolicy | None = None,
        new_core_entities: Mapping[str, Sequence[str]] | None = None,
    ) -> GateVerdict:
        if fact.extraction_failed:
            return verdict_from_issues(
                [
                    issue(
                        "叙事塌缩",
                        f"fact extraction failed: {fact.extraction_error}",
                        severity="低",
                        revision_strategy="manual_review",
                    )
                ],
                warn_only=True,
            )

        hard_issues: list[dict[str, str]] = []
        soft_issues: list[dict[str, str]] = []
        if (
            phase_policy
            and phase_policy.phase == "收束"
            and not phase_policy.allowed_expansion
            and any(values for values in (new_core_entities or {}).values())
        ):
            hard_issues.append(issue("叙事塌缩", "phase says收束 but chapter expands"))

        if fact.deletable:
            soft_issues.append(
                issue(
                    "叙事塌缩",
                    f"deletable chapter: chapter {fact.chapter}",
                    severity="低",
                    revision_strategy="delete_or_merge_recommendation",
                )
            )

        has_advancement = bool(fact.cost or fact.relationship_delta or fact.irreversible_consequence)
        template_score = _investigation_template_score(fact)
        if template_score >= 3 and not has_advancement:
            soft_issues.append(
                issue(
                    "叙事塌缩",
                    "正文调查模板: investigation actions lack cost, relationship delta, or irreversible consequence",
                    snippet="-".join(fact.action_sequence),
                    revision_strategy="convert_process_to_scene",
                )
            )

        if not fact.irreversible_consequence:
            soft_issues.append(issue("叙事塌缩", "no irreversible consequence", severity="低"))

        if hard_issues:
            return verdict_from_issues(hard_issues + soft_issues)
        return verdict_from_issues(soft_issues, warn_only=True)


def _is_process_only(beats: Sequence[str]) -> bool:
    normalized = [beat.strip() for beat in beats if beat.strip()]
    return normalized == ["到场", "取证", "保存", "转场"]


def _investigation_template_score(fact: NarrativeSceneFact) -> int:
    if fact.primary_scene_mode == "investigation_fetch_loop" or (
        fact.clue_usage_mode == "introduce_new" and fact.new_evidence
    ):
        return 3

    actions = "".join(fact.action_sequence)
    buckets = (
        ("来到", "到达", "进入", "档案室", "码头", "灯塔", "现场"),
        ("询问", "追问", "问", "管理员", "证人"),
        ("查看", "翻看", "调查", "记录", "账本", "登记表", "线索", "证据"),
        ("收进", "保存", "带走", "放进", "口袋"),
        ("离开", "转场", "赶往", "回到"),
    )
    return sum(1 for bucket in buckets if any(term in actions for term in bucket))
