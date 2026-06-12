from __future__ import annotations

from storyforge_workflow.narrative.forbidden_terms import ForbiddenDraftTermsFilter


def test_forbidden_draft_terms_fail_with_static_quality_compatible_issues() -> None:
    verdict = ForbiddenDraftTermsFilter().scan("林岚推开门，像进入 Phase 测试 workflow，等待模型给出答案。")

    assert verdict.status == "fail"
    assert verdict.terms == ["Phase", "测试", "workflow", "模型"]
    assert verdict.repair_type == "convert_process_to_scene"
    assert verdict.issues
    assert verdict.issues[0]["severity"] == "高"
    assert verdict.issues[0]["revision_strategy"] == "regenerate"


def test_forbidden_draft_terms_pass_clean_scene_text() -> None:
    verdict = ForbiddenDraftTermsFilter().scan("林岚把湿透的钥匙塞进袖口，潮声盖住了身后的脚步。")

    assert verdict.status == "pass"
    assert verdict.terms == []
    assert verdict.issues == []
