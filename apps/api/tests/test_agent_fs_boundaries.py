from __future__ import annotations

import io
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.domains.agent_runs import fs_safety
from app.domains.agent_runs.fs import project_knowledge
from app.domains.agent_runs.fs_tools import FsToolError, fs_list, fs_read, fs_search, read_text_file


def _link(link: Path, target: Path, *, directory: bool = False) -> None:
    try:
        link.symlink_to(target, target_is_directory=directory)
    except OSError as exc:
        pytest.skip(f"symlink unavailable: {exc}")


def test_search_and_list_cannot_follow_external_or_hidden_file_links(tmp_path: Path) -> None:
    root = tmp_path / "project"
    root.mkdir()
    outside = tmp_path / "private.md"
    outside.write_text("private sentinel", encoding="utf-8")
    hidden = root / ".private.md"
    hidden.write_text("private sentinel", encoding="utf-8")
    _link(root / "outside.md", outside)
    _link(root / "hidden.md", hidden)
    assert fs_list(str(root))["entries"] == []
    assert fs_search(str(root), "sentinel")["matches"] == []
    with pytest.raises(FsToolError):
        fs_read(str(root), "outside.md")
    with pytest.raises(FsToolError):
        fs_read(str(root), "hidden.md")


def test_directory_links_do_not_expand_or_loop(tmp_path: Path) -> None:
    root = tmp_path / "project"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.md").write_text("secret", encoding="utf-8")
    _link(root / "escape", outside, directory=True)
    _link(root / "loop", root, directory=True)
    assert fs_list(str(root))["entries"] == []


def test_hidden_path_cannot_be_read_through_visible_target_link(tmp_path: Path) -> None:
    (tmp_path / "public.md").write_text("text", encoding="utf-8")
    _link(tmp_path / ".hidden.md", tmp_path / "public.md")
    with pytest.raises(FsToolError):
        fs_read(str(tmp_path), ".hidden.md")


def test_prefix_read_does_not_load_entire_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "chapter.md"
    path.write_bytes(b"a" * 100_000)
    original_open = Path.open

    class GuardedReader(io.FileIO):
        def read(self, size: int = -1) -> bytes:
            assert 0 <= size <= 9, "read must be bounded before allocating the file"
            return super().read(size)

    def guarded_open(target: Path, mode: str = "r", *args, **kwargs):
        if target == path and mode == "rb":
            return GuardedReader(target, mode)
        return original_open(target, mode, *args, **kwargs)

    monkeypatch.setattr(Path, "open", guarded_open)
    assert read_text_file(path, max_bytes=8) == "a" * 8


def test_prefix_read_does_not_invent_utf8_replacement_character(tmp_path: Path) -> None:
    path = tmp_path / "chapter.md"
    path.write_text("a中b", encoding="utf-8")
    assert read_text_file(path, max_bytes=3) == "a"


def test_full_read_rejects_oversized_file(tmp_path: Path) -> None:
    (tmp_path / "large.md").write_bytes(b"a" * (2 * 1024 * 1024 + 1))
    with pytest.raises(FsToolError):
        fs_read(str(tmp_path), "large.md", limit=1)


def test_search_marks_file_prefix_as_incomplete(tmp_path: Path) -> None:
    (tmp_path / "large.md").write_bytes(b"a" * 512_000 + b"needle")
    result = fs_search(str(tmp_path), "needle")
    assert result["matches"] == []
    assert result["truncated"] is True


@pytest.mark.parametrize("value", [0, -1, True, "10"])
def test_invalid_result_limits_are_rejected(tmp_path: Path, value) -> None:
    with pytest.raises(FsToolError):
        fs_list(str(tmp_path), max_entries=value)
    with pytest.raises(FsToolError):
        fs_search(str(tmp_path), "text", max_matches=value)


@pytest.mark.skipif(sys.platform != "win32", reason="Windows junction behavior")
def test_windows_junction_is_not_traversed(tmp_path: Path) -> None:
    root = tmp_path / "project"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "private.md").write_text("sentinel", encoding="utf-8")
    junction = root / "linked"
    result = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(junction), str(outside)], capture_output=True, timeout=10,
    )
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    try:
        assert fs_list(str(root))["entries"] == []
        assert fs_search(str(root), "sentinel")["matches"] == []
        with pytest.raises(FsToolError):
            fs_read(str(root), "linked/private.md")
    finally:
        junction.rmdir()


def test_directory_budget_stops_enumeration_and_counts_ignored_entries(tmp_path: Path, monkeypatch) -> None:
    for index in range(10):
        (tmp_path / f".hidden{index}").touch()
    monkeypatch.setattr(fs_safety, "MAX_DIRECTORY_ENTRIES", 3)
    real_scandir = os.scandir
    visited = []

    class CountedEntries:
        def __init__(self, path):
            self.iterator = real_scandir(path)

        def __enter__(self):
            return self

        def __exit__(self, *_):
            self.iterator.close()

        def __iter__(self):
            return self

        def __next__(self):
            entry = next(self.iterator)
            visited.append(entry.name)
            return entry

    monkeypatch.setattr(os, "scandir", CountedEntries)
    with pytest.raises(FsToolError, match="遍历预算"):
        fs_list(str(tmp_path))
    assert len(visited) == 4  # One extra directory entry proves there is unfinished work.


def test_ignored_directories_are_pruned_and_subpath_does_not_visit_siblings(tmp_path: Path, monkeypatch) -> None:
    for name in [".git", ".storyforge", "node_modules", "chapters", "other"]:
        (tmp_path / name).mkdir()
        (tmp_path / name / "a.md").write_text("text", encoding="utf-8")
    (tmp_path / ".storyforge" / "agent-instructions.md").write_text("instruction", encoding="utf-8")
    real_scandir = os.scandir
    visited = []

    def checked_scandir(path):
        visited.append(Path(path).relative_to(tmp_path).as_posix())
        assert Path(path).name not in {".git", ".storyforge", "node_modules"}
        return real_scandir(path)

    monkeypatch.setattr(os, "scandir", checked_scandir)
    paths = {entry["path"] for entry in fs_list(str(tmp_path))["entries"]}
    assert ".storyforge/agent-instructions.md" in paths
    visited.clear()
    assert fs_list(str(tmp_path), "chapters")["entries"][0]["path"] == "chapters/a.md"
    assert visited == ["chapters"]


def test_directory_depth_budget_is_explicit(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "one" / "two").mkdir(parents=True)
    monkeypatch.setattr(fs_safety, "MAX_DIRECTORY_DEPTH", 1)
    with pytest.raises(FsToolError, match="深度"):
        fs_list(str(tmp_path))


def test_search_total_byte_budget_is_not_reported_as_complete(tmp_path: Path, monkeypatch) -> None:
    from app.domains.agent_runs import fs_tools

    monkeypatch.setattr(fs_tools, "MAX_SEARCH_BYTES", 12)
    (tmp_path / "a.md").write_bytes(b"a" * 8)
    (tmp_path / "b.md").write_bytes(b"bbb needle")
    result = fs_search(str(tmp_path), "needle")
    assert result["matches"] == []
    assert result["truncated"] is True


def test_search_regex_timeout_is_enforced_in_both_tools(tmp_path: Path) -> None:
    (tmp_path / "outline").mkdir()
    (tmp_path / "outline" / "a.md").write_text("a" * 100_000 + "!", encoding="utf-8")
    # The parent kills the process if the protection regresses, so CI cannot hang.
    code = """
import sys
from app.domains.agent_runs.fs_tools import FsToolError, fs_search
from app.domains.agent_runs.fs.project_knowledge import project_knowledge_search
for search in (fs_search, project_knowledge_search):
    try:
        search(sys.argv[1], '(a+)+$', use_regex=True)
    except FsToolError as exc:
        assert '超时' in str(exc) or '预算' in str(exc), str(exc)
    else:
        raise AssertionError('expensive regex was not interrupted')
"""
    result = subprocess.run([sys.executable, "-c", code, str(tmp_path)], capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr.decode(errors="replace")


def test_regex_budget_accumulates_across_lines(monkeypatch) -> None:
    ticks = iter([0.0, 0.04, 0.04, 0.08])
    monkeypatch.setattr(fs_safety, "REGEX_TOTAL_SECONDS", 0.06)
    monkeypatch.setattr(fs_safety, "monotonic", lambda: next(ticks))
    matcher = fs_safety.SearchMatcher("a", use_regex=True)
    assert matcher.search("a")
    assert matcher.search("a")
    with pytest.raises(FsToolError, match="累计"):
        matcher.search("a")


def test_long_queries_are_rejected_before_search(tmp_path: Path) -> None:
    for search in (fs_search, project_knowledge.project_knowledge_search):
        with pytest.raises(FsToolError, match="query"):
            search(str(tmp_path), "a" * 2_049)


def test_knowledge_search_does_not_redact_only_a_credential_prefix(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "outline").mkdir()
    (tmp_path / "outline" / "a.md").write_text("secret=not-a-real-credential", encoding="utf-8")
    monkeypatch.setattr(project_knowledge, "MAX_SEARCH_BYTES", 10)
    result = project_knowledge.project_knowledge_search(str(tmp_path), "secret")
    assert result["matches"] == []
    assert result["truncated"] is True
    assert result["warnings"]


def test_full_read_keeps_normalized_offsets_and_empty_files(tmp_path: Path) -> None:
    (tmp_path / "a.md").write_bytes("中\r\nb\rc".encode())
    result = fs_read(str(tmp_path), "a.md", offset=1, limit=3)
    assert result["content"] == "\nb\n"
    assert result["total_chars"] == 5
    (tmp_path / "empty.md").touch()
    assert fs_read(str(tmp_path), "empty.md")["total_chars"] == 0
