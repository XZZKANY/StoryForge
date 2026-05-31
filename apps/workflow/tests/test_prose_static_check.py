from __future__ import annotations

import json
from pathlib import Path

from storyforge_workflow.quality import check_prose_static_quality

FIXTURE_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "quality_cases"


def test_static_check_detects_cliche_phrases() -> None:
    issues = check_prose_static_quality("林岚不禁停住脚步，心中一震，五味杂陈地看向灯塔。")
    assert any(issue.dimension == "套话" for issue in issues)


def test_static_check_detects_telling_emotion() -> None:
    issues = check_prose_static_quality("林岚很愤怒，也很害怕，她不知道该怎么办。")
    assert any(issue.dimension in {"说明腔", "情绪直述"} for issue in issues)


def test_static_check_detects_dialogue_density_extremes() -> None:
    narration = "潮声压过灯塔，铁锈味贴在舌根。林岚沿着湿滑栈桥走了很久，代表始终没有出现。" * 4
    dialogue = "“维修窗口只剩七分钟。”\n“代价翻倍。”\n“你知道舰队撑不到天亮。”\n“那就拿旧航线来换。”"
    narration_issues = check_prose_static_quality(narration)
    dialogue_issues = check_prose_static_quality(dialogue)
    assert any(issue.dimension == "对白密度" and "对白不足" in issue.message for issue in narration_issues)
    assert any(issue.dimension == "对白密度" and "叙述不足" in issue.message for issue in dialogue_issues)


def test_static_check_detects_quality_fixture_cases() -> None:
    for path in sorted(FIXTURE_DIR.glob("*.json")):
        case = json.loads(path.read_text(encoding="utf-8"))
        issues = check_prose_static_quality(
            case["draft"],
            character_constraints=case.get("character_constraints"),
            continuity_facts=case.get("continuity_facts"),
            required_facts=case.get("required_facts"),
            scene_beats=case.get("scene_beats"),
            ending_hook=case.get("ending_hook", ""),
        )
        expected = set(case.get("expected_issue_dimensions", []))
        if case.get("expected_decision") == "pass":
            assert not [issue for issue in issues if issue.severity in {"高", "严重"}]
        else:
            actual = {issue.dimension for issue in issues}
            assert expected & actual, f"{path.name} 未命中预期维度，实际为 {actual}"
