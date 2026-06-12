from __future__ import annotations

from storyforge_workflow.narrative.beat_sheet import BeatSheetGate
from storyforge_workflow.narrative.collapse_judge import NarrativeCollapseJudge
from storyforge_workflow.narrative.extract import NarrativeSceneFact
from storyforge_workflow.narrative.gate_harness import NarrativeGateHarness, NarrativeGateInput
from storyforge_workflow.narrative.plan import ChapterBeat, NarrativePhasePolicy, NarrativePlan


def test_collapse_judge_fails_process_only_deletable_chapter() -> None:
    verdict = NarrativeCollapseJudge().judge(
        chapter=12,
        function="追踪线索",
        beats=["到场", "取证", "保存", "转场"],
        emotion_before="怀疑",
        emotion_after="怀疑",
        irreversible_consequence="",
        deletable=True,
    )

    assert verdict.status == "fail"
    messages = " / ".join(issue["message"] for issue in verdict.issues)
    assert "deletable chapter" in messages
    assert "process-only 到场-取证-保存-转场" in messages
    assert "no emotion change" in messages
    assert "no irreversible consequence" in messages


def test_collapse_judge_fails_concluding_phase_that_expands() -> None:
    verdict = NarrativeCollapseJudge().judge(
        chapter=29,
        function="收束",
        beats=["林岚打开旧门"],
        phase_policy=NarrativePhasePolicy(phase="收束", allowed_expansion=False),
        new_core_entities={"characters": ["新证人"]},
        emotion_before="迟疑",
        emotion_after="决绝",
        irreversible_consequence="新证人被公开保护",
    )

    assert verdict.status == "fail"
    assert any("phase says收束 but chapter expands" in issue["message"] for issue in verdict.issues)


def test_collapse_judge_fact_warns_on_weighted_fetch_loop_without_cost() -> None:
    fact = NarrativeSceneFact(
        chapter=8,
        primary_scene_mode="investigation_fetch_loop",
        action_sequence=("来到档案室", "询问管理员", "查看记录", "收进口袋"),
        conflict_type="新增取证",
        clue_usage_mode="introduce_new",
        new_evidence=("登记表",),
    )

    verdict = NarrativeCollapseJudge().judge_fact(fact)

    assert verdict.status == "warn"
    assert any("正文调查模板" in issue["message"] for issue in verdict.issues)
    assert any(issue["revision_strategy"] == "convert_process_to_scene" for issue in verdict.issues)
    assert all(
        issue["severity"] != "高" for issue in verdict.issues if "正文调查模板" in issue["message"]
    )


def test_collapse_judge_fact_passes_fetch_actions_with_real_cost_and_relationship_delta() -> None:
    fact = NarrativeSceneFact(
        chapter=9,
        primary_scene_mode="misjudgment_cost",
        action_sequence=("查看旧账本", "误信记录", "与周砚争执", "失去通行口令"),
        conflict_type="主角误判造成实际代价",
        protagonist_mistake="林岚误信灯塔账本",
        cost="通行口令被撤销",
        relationship_delta="林岚与周砚信任破裂",
        irreversible_consequence="通行口令被撤销",
        clue_usage_mode="reinterpret_existing",
        existing_clues_reinterpreted=("旧账本",),
    )

    verdict = NarrativeCollapseJudge().judge_fact(fact)

    assert verdict.status == "pass"


def test_collapse_judge_fact_extraction_failure_warns_for_manual_review() -> None:
    fact = NarrativeSceneFact.failed(chapter=8, error="invalid_json")

    verdict = NarrativeCollapseJudge().judge_fact(fact)

    assert verdict.status == "warn"
    assert any(
        issue["revision_strategy"] == "manual_review" and "invalid_json" in issue["message"]
        for issue in verdict.issues
    )


def test_collapse_judge_fact_extraction_failure_does_not_mask_closing_phase_expansion() -> None:
    fact = NarrativeSceneFact.failed(chapter=29, error="invalid_json")

    verdict = NarrativeCollapseJudge().judge_fact(
        fact,
        phase_policy=NarrativePhasePolicy(phase="收束", allowed_expansion=False),
        new_core_entities={"evidence": ("登记表",)},
    )

    assert verdict.status == "fail"
    assert any("phase says收束 but chapter expands" in issue["message"] for issue in verdict.issues)
    assert any(issue["revision_strategy"] == "manual_review" for issue in verdict.issues)


def test_beat_sheet_gate_fails_long_tracking_run_and_missing_five_chapter_turn() -> None:
    plan = NarrativePlan(
        premise="旧航线失踪。",
        truth="舰队被藏起。",
        protagonist_arc="承担代价。",
        antagonist_motive="掩盖真相。",
        chapter_beats=[
            ChapterBeat(chapter=1, function="追踪线索", summary="查灯塔"),
            ChapterBeat(chapter=2, function="追踪线索", summary="查码头"),
            ChapterBeat(chapter=3, function="追踪线索", summary="查档案"),
            ChapterBeat(chapter=5, function="对峙", summary="没有关系转折或后果"),
        ],
    )

    verdict = BeatSheetGate().validate(plan)

    assert verdict.status == "fail"
    messages = " / ".join(issue["message"] for issue in verdict.issues)
    assert "consecutive 3 chapters function='追踪线索'" in messages
    assert "every 5 chapters has relationship change and irreversible consequence" in messages


def test_narrative_gate_harness_surfaces_fact_collapse_issues() -> None:
    plan = NarrativePlan(
        premise="旧航线失踪。",
        truth="舰队被藏起。",
        protagonist_arc="承担代价。",
        antagonist_motive="掩盖真相。",
    )
    fact = NarrativeSceneFact(
        chapter=8,
        primary_scene_mode="investigation_fetch_loop",
        action_sequence=("来到档案室", "询问管理员", "查看记录", "收进口袋"),
        conflict_type="新增取证",
        clue_usage_mode="introduce_new",
        new_evidence=("登记表",),
    )

    verdict = NarrativeGateHarness(plan).evaluate(NarrativeGateInput(narrative_fact=fact))

    assert verdict.status == "warn"
    assert any("正文调查模板" in issue["message"] for issue in verdict.issues)


def test_narrative_gate_harness_fails_fact_new_evidence_in_closing_phase() -> None:
    plan = NarrativePlan(
        premise="旧航线失踪。",
        truth="舰队被藏起。",
        protagonist_arc="承担代价。",
        antagonist_motive="掩盖真相。",
        phase_policy=NarrativePhasePolicy(phase="收束", allowed_expansion=False),
    )
    fact = NarrativeSceneFact(
        chapter=29,
        primary_scene_mode="investigation_fetch_loop",
        action_sequence=("来到档案室", "查看记录"),
        clue_usage_mode="introduce_new",
        new_evidence=("登记表",),
    )

    verdict = NarrativeGateHarness(plan).evaluate(NarrativeGateInput(narrative_fact=fact))

    assert verdict.status == "fail"
    assert any("phase says收束 but chapter expands" in issue["message"] for issue in verdict.issues)


def test_beat_sheet_gate_fails_late_expansion_and_chapter_30_not_closing() -> None:
    plan = NarrativePlan(
        premise="旧航线失踪。",
        truth="舰队被藏起。",
        protagonist_arc="承担代价。",
        antagonist_motive="掩盖真相。",
        chapter_beats=[
            ChapterBeat(
                chapter=20,
                function="反击",
                summary="林岚换场",
                new_core_entities={"locations": ["海底档案馆"]},
                relationship_change="林岚与周砚互相信任",
                irreversible_consequence="档案馆封锁",
            ),
            ChapterBeat(
                chapter=25,
                function="揭露",
                summary="新角色带来新谜题",
                new_core_entities={"characters": ["新证人"], "equipment": ["VX-9"], "mysteries": ["谁在敲钟"]},
                relationship_change="林岚与审查官达成交易",
                irreversible_consequence="交易被广播",
            ),
            ChapterBeat(
                chapter=30,
                function="扩展",
                summary="打开新地图",
                new_core_entities={"mysteries": ["禁航区更深处是谁"]},
                relationship_change="林岚独自离开",
                irreversible_consequence="灯塔熄灭",
            ),
        ],
    )

    verdict = BeatSheetGate().validate(plan)

    assert verdict.status == "fail"
    messages = " / ".join(issue["message"] for issue in verdict.issues)
    assert "chapter 20+ new core locations" in messages
    assert "chapter 25+ new core characters/equipment/mysteries" in messages
    assert "chapter 30 only closes" in messages
