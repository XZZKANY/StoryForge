"""project.prose_check 文笔气味静态检查：确定性、无 LLM、无 key 可验。

覆盖坏味道检测（套话 / 说明腔 / 情绪直述）、path-scoped 只读边界、空文件显式报错、
结果结构，以及从 workflow 抢救来的 check_prose_static_quality 纯函数关键分支。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.domains.agent_runs.fs_tools import FsToolError
from app.domains.agent_runs.prose_scan import check_prose_static_quality, prose_static_scan


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    return tmp_path


def _write(project: Path, name: str, content: str) -> str:
    (project / "正文" / name).write_text(content, encoding="utf-8")
    return f"正文/{name}"


# --- 1. 坏味道检测 ---


def test_detects_cliches(project: Path) -> None:
    rel = _write(project, "第01章.md", "他不禁停下脚步，心中五味杂陈。")
    result = prose_static_scan(str(project), rel)

    assert result["issue_count"] == 1
    assert result["dimension_counts"] == {"套话": 1}
    issue = result["issues"][0]
    assert issue["dimension"] == "套话"
    assert issue["severity"] == "中"  # 命中 ≥2 条陈词
    assert "不禁" in issue["snippet"] and "五味杂陈" in issue["snippet"]


def test_detects_telling_and_emotion(project: Path) -> None:
    rel = _write(project, "第01章.md", "林岚非常害怕。她感到十分绝望。")
    result = prose_static_scan(str(project), rel)

    dims = result["dimension_counts"]
    assert dims.get("说明腔") == 1  # 「非常害怕」直述情绪
    assert dims.get("情绪直述") == 1  # 害怕 + 绝望 两个抽象情绪词


def test_clean_action_prose_has_no_prose_smell(project: Path) -> None:
    rel = _write(project, "第01章.md", "他推开门，握紧刀，转身，看向巷口，又停下。")
    result = prose_static_scan(str(project), rel)

    # 动作密集、无陈词 / 情绪直述 / 超长句：应无坏味道信号。
    assert result["issue_count"] == 0
    assert result["issues"] == []


# --- 2. path-scoped 只读边界 ---


def test_path_escape_is_rejected(project: Path) -> None:
    (project.parent / "outside.md").write_text("不禁五味杂陈", encoding="utf-8")
    with pytest.raises(FsToolError):
        prose_static_scan(str(project), "../outside.md")


def test_missing_file_is_rejected(project: Path) -> None:
    with pytest.raises(FsToolError):
        prose_static_scan(str(project), "正文/不存在.md")


def test_empty_file_is_rejected(project: Path) -> None:
    rel = _write(project, "空.md", "   \n\n  ")
    with pytest.raises(FsToolError):
        prose_static_scan(str(project), rel)


# --- 3. 结果结构与预算 ---


def test_result_shape_and_rollups(project: Path) -> None:
    rel = _write(project, "第01章.md", "他不禁停下，心中五味杂陈。")
    result = prose_static_scan(str(project), rel)

    assert result["path"] == "正文/第01章.md"
    assert set(result) >= {
        "path",
        "content_chars",
        "content_truncated",
        "issue_count",
        "issues",
        "dimension_counts",
        "severity_counts",
        "note",
    }
    assert result["content_truncated"] is False
    for issue in result["issues"]:
        assert set(issue) == {
            "dimension",
            "severity",
            "snippet",
            "message",
            "suggestion",
            "revision_strategy",
        }
    assert sum(result["dimension_counts"].values()) == result["issue_count"]
    assert sum(result["severity_counts"].values()) == result["issue_count"]


def test_content_budget_truncates(project: Path) -> None:
    rel = _write(project, "长.md", "啊" * 25_000)
    result = prose_static_scan(str(project), rel)

    assert result["content_truncated"] is True
    assert result["content_chars"] == 24_000


# --- 4. 抢救来的纯函数关键分支（补 slice-1 工具入口不触达的约束维度） ---


def test_check_prose_static_quality_empty_returns_completeness_issue() -> None:
    issues = check_prose_static_quality("")
    assert len(issues) == 1
    assert issues[0].dimension == "正文完整性"
    assert issues[0].severity == "严重"


def test_character_forbidden_trait_flags_ooc() -> None:
    issues = check_prose_static_quality(
        "他突然放声大笑，语气轻佻。",
        character_constraints=[{"forbidden_traits": ["轻佻"]}],
    )
    assert any(issue.dimension == "角色一致性" and issue.severity == "严重" for issue in issues)
