from __future__ import annotations

import json
from pathlib import Path

from storyforge_workflow.quality import check_prose_static_quality


def _dimensions(text: str) -> set[str]:
    return {issue.dimension for issue in check_prose_static_quality(text)}


def test_static_check_detects_cliche_phrases() -> None:
    issues = check_prose_static_quality("\u5979\u4e0d\u7981\u505c\u4f4f\uff0c\u5fc3\u4e2d\u4e00\u9707\uff0c\u4e94\u5473\u6742\u9648\u5730\u671b\u5411\u706f\u5854\u3002")
    assert any(issue.dimension == "\u5957\u8bdd" for issue in issues)


def test_static_check_detects_direct_emotion_telling() -> None:
    assert {"\u8bf4\u660e\u8154", "\u60c5\u7eea\u76f4\u8ff0"} & _dimensions("\u6797\u5c9a\u5f88\u6124\u6012\uff0c\u4e5f\u5f88\u5bb3\u6015\uff0c\u5979\u4e0d\u77e5\u9053\u8be5\u600e\u4e48\u529e\u3002")


def test_static_check_detects_dialogue_density_extremes() -> None:
    narration = "\u96fe\u6c14\u538b\u4f4e\u4e86\u6e2f\u53e3\u7684\u706f\uff0c\u94c1\u9508\u5473\u8d34\u7740\u8237\u68af\u5f80\u4e0a\u722c\u3002" * 18
    dialogue = "\u201c\u7ef4\u4fee\u7a97\u53e3\u53ea\u5269\u4e09\u5206\u949f\u3002\u201d\n\u201c\u4ee3\u4ef7\u5462\uff1f\u201d\n\u201c\u4ea4\u51fa\u706f\u5854\u5bc6\u94a5\u3002\u201d\n" * 8
    assert any(issue.dimension == "\u5bf9\u767d\u5bc6\u5ea6" and "\u5bf9\u767d\u4e0d\u8db3" in issue.message for issue in check_prose_static_quality(narration))
    assert any(issue.dimension == "\u5bf9\u767d\u5bc6\u5ea6" and "\u53d9\u8ff0\u4e0d\u8db3" in issue.message for issue in check_prose_static_quality(dialogue))


def test_quality_case_fixtures_report_expected_issues() -> None:
    fixture_dir = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "quality_cases"
    for path in sorted(fixture_dir.glob("*.json")):
        case = json.loads(path.read_text(encoding="utf-8"))
        expected = set(case.get("expected_issue_dimensions", []))
        if not expected:
            continue
        actual = _dimensions(case["draft"])
        assert expected & actual, f"{path.name} \u672a\u547d\u4e2d\u9884\u671f\u7ef4\u5ea6\uff1a{expected}\uff0c\u5b9e\u9645\uff1a{actual}"
