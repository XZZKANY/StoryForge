"""project.collapse_check 场景承重静态检查：确定性、无 LLM、无 key 可验。"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.domains.agent_runs.collapse_scan import collapse_scan
from app.domains.agent_runs.fs_tools import FsToolError


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    return tmp_path


def _write(project: Path, content: str, name: str = "第01章.md") -> str:
    (project / "正文" / name).write_text(content, encoding="utf-8")
    return f"正文/{name}"


def _rules(result: dict[str, object]) -> set[str]:
    verdict = result["verdict"]
    assert isinstance(verdict, dict)
    return {issue["rule"] for issue in verdict["issues"]}


def test_process_only_positive_and_negative(project: Path) -> None:
    path = _write(project, "雨落在窗沿，他停下看了一眼。")

    flagged = collapse_scan(str(project), path, beats=[" 到场 ", "取证", "保存", "转场"])
    clean = collapse_scan(str(project), path, beats=["到场", "交锋", "转场"])

    assert "process_only" in _rules(flagged)
    assert "process_only" not in _rules(clean)


def test_unchanged_emotion_positive_and_negative(project: Path) -> None:
    path = _write(project, "她攥紧衣角，又慢慢松开。")

    flagged = collapse_scan(str(project), path, emotion_before="紧张", emotion_after="紧张")
    clean = collapse_scan(str(project), path, emotion_before="紧张", emotion_after="释然")

    assert "emotion_unchanged" in _rules(flagged)
    assert "emotion_unchanged" not in _rules(clean)


def test_missing_and_explicit_empty_consequence_are_distinct(project: Path) -> None:
    path = _write(project, "他推门进屋，桌上的钟正好停了。")

    missing = collapse_scan(str(project), path)
    explicit_empty = collapse_scan(str(project), path, irreversible_consequence="")
    nonempty = collapse_scan(str(project), path, irreversible_consequence="证据被公开")

    assert "no_irreversible_consequence" not in _rules(missing)
    assert "no_irreversible_consequence" in _rules(explicit_empty)
    assert "no_irreversible_consequence" not in _rules(nonempty)


def test_deletable_positive_and_negative(project: Path) -> None:
    path = _write(project, "他把钥匙交给她，转身锁上门。")

    flagged = collapse_scan(str(project), path, deletable=True)
    clean = collapse_scan(str(project), path, deletable=False)

    assert "deletable" in _rules(flagged)
    assert "deletable" not in _rules(clean)


def test_investigation_template_positive_and_advancement_negative(project: Path) -> None:
    path = _write(project, "他来到档案室，询问管理员，翻看登记表，把证据收进口袋后离开。")

    flagged = collapse_scan(str(project), path)
    advanced = collapse_scan(str(project), path, irreversible_consequence="管理员当场销毁了原始账本")

    assert "investigation_template" in _rules(flagged)
    issue = next(item for item in flagged["verdict"]["issues"] if item["rule"] == "investigation_template")
    assert all(term in issue["snippet"] for term in ("来到", "询问", "翻看"))
    assert "investigation_template" not in _rules(advanced)


def test_verdict_and_issue_shape(project: Path) -> None:
    path = _write(project, "他推门进屋，桌上的钟正好停了。")
    result = collapse_scan(str(project), path, deletable=True)

    assert result["path"] == path
    assert result["verdict"]["status"] == "warn"
    assert set(result["verdict"]["issues"][0]) == {"rule", "severity", "detail", "snippet"}
    assert "advisory" in result["summary"]


def test_path_escape_is_rejected(project: Path) -> None:
    (project.parent / "outside.md").write_text("不应读取", encoding="utf-8")
    with pytest.raises(FsToolError):
        collapse_scan(str(project), "../outside.md")


def test_missing_file_is_rejected(project: Path) -> None:
    with pytest.raises(FsToolError):
        collapse_scan(str(project), "正文/不存在.md")
