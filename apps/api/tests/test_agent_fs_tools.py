from __future__ import annotations

from pathlib import Path

import pytest

from app.domains.agent_runs.fs_tools import FsToolError, fs_list, fs_read, fs_search


@pytest.fixture()
def project_root(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    (tmp_path / "设定").mkdir()
    (tmp_path / ".git").mkdir()
    (tmp_path / "正文" / "第01章.md").write_text("林岚走进港口。\n灯塔熄灭了。\n", encoding="utf-8")
    (tmp_path / "正文" / "第02章.md").write_text("码头起雾。\n林岚回头。\n", encoding="utf-8")
    (tmp_path / "设定" / "人物.md").write_text("林岚：审计员。\n", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("散落笔记\n", encoding="utf-8")
    (tmp_path / ".git" / "config.md").write_text("不应被看到", encoding="utf-8")
    (tmp_path / "cover.bin").write_bytes(b"\x00\x01\x02binary")
    return tmp_path


def test_fs_list_returns_sorted_relative_paths_and_skips_internal_dirs(project_root: Path) -> None:
    result = fs_list(str(project_root))

    paths = [entry["path"] for entry in result["entries"]]
    assert paths == sorted(paths)
    assert "正文/第01章.md" in paths
    assert "设定/人物.md" in paths
    assert all(not path.startswith(".git") for path in paths)
    assert result["truncated"] is False


def test_fs_list_scopes_to_subpath_and_caps_entries(project_root: Path) -> None:
    scoped = fs_list(str(project_root), "正文")
    assert [entry["path"] for entry in scoped["entries"]] == ["正文/第01章.md", "正文/第02章.md"]

    capped = fs_list(str(project_root), max_entries=2)
    assert len(capped["entries"]) == 2
    assert capped["truncated"] is True


def test_fs_read_returns_slice_with_offset_and_truncation_flag(project_root: Path) -> None:
    full = fs_read(str(project_root), "正文/第01章.md")
    assert full["content"] == "林岚走进港口。\n灯塔熄灭了。\n"
    assert full["truncated"] is False

    sliced = fs_read(str(project_root), "正文/第01章.md", offset=1, limit=3)
    assert sliced["content"] == "岚走进"
    assert sliced["offset"] == 1
    assert sliced["truncated"] is True
    assert sliced["total_chars"] == len(full["content"])


def test_fs_read_rejects_binary_and_missing_files(project_root: Path) -> None:
    with pytest.raises(FsToolError, match="不是文本文件"):
        fs_read(str(project_root), "cover.bin")
    with pytest.raises(FsToolError, match="文件不存在"):
        fs_read(str(project_root), "正文/第99章.md")


def test_fs_search_returns_line_hits_with_glob_filter(project_root: Path) -> None:
    result = fs_search(str(project_root), "林岚")

    hits = {(match["path"], match["line"]) for match in result["matches"]}
    assert ("正文/第01章.md", 1) in hits
    assert ("正文/第02章.md", 2) in hits
    assert ("设定/人物.md", 1) in hits
    # 默认 glob 只扫 *.md，txt 不进结果
    assert all(match["path"].endswith(".md") for match in result["matches"])

    txt_only = fs_search(str(project_root), "笔记", glob="*.txt")
    assert [match["path"] for match in txt_only["matches"]] == ["notes.txt"]


def test_fs_search_supports_regex_and_rejects_invalid_pattern(project_root: Path) -> None:
    result = fs_search(str(project_root), r"第0\d章", use_regex=True, glob="*.md")
    assert result["matches"] == []

    named = fs_search(str(project_root), r"林岚[：:]", use_regex=True)
    assert [match["path"] for match in named["matches"]] == ["设定/人物.md"]

    with pytest.raises(FsToolError, match="正则表达式无效"):
        fs_search(str(project_root), "([", use_regex=True)


def test_fs_search_caps_matches_and_marks_truncated(project_root: Path) -> None:
    result = fs_search(str(project_root), "林岚", max_matches=1)
    assert len(result["matches"]) == 1
    assert result["truncated"] is True


@pytest.mark.parametrize("escape", ["../outside.md", "..", "正文/../../outside.md"])
def test_path_scope_rejects_traversal(project_root: Path, escape: str) -> None:
    (project_root.parent / "outside.md").write_text("外部文件", encoding="utf-8")

    with pytest.raises(FsToolError, match="路径越界"):
        fs_read(str(project_root), escape)


def test_path_scope_rejects_absolute_path_outside_project(project_root: Path) -> None:
    outside = project_root.parent / "outside.md"
    outside.write_text("外部文件", encoding="utf-8")

    with pytest.raises(FsToolError, match="路径越界"):
        fs_read(str(project_root), str(outside))


def test_fs_tools_reject_missing_project_root(tmp_path: Path) -> None:
    with pytest.raises(FsToolError, match="项目目录不存在"):
        fs_list(str(tmp_path / "not-exist"))
    with pytest.raises(FsToolError, match="project_root 不能为空"):
        fs_read("", "a.md")
