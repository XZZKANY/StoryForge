"""Independent alias-role compatibility and fail-closed review."""

import errno

import pytest
from agent_canon_test_support import _write_canon

from app.common.manuscript import iter_manuscript_files
from app.domains.agent_runs import canon_context, canon_rebuild
from app.domains.agent_runs.fs_tools import FsToolError


def write(root, relative, text="manuscript"):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def link(alias, target):
    alias.parent.mkdir(parents=True, exist_ok=True)
    try:
        alias.symlink_to(target)
    except NotImplementedError:
        pytest.skip("Symlinks are unsupported")
    except OSError as exc:
        if (
            exc.errno in {errno.EPERM, errno.EACCES, errno.ENOSYS, errno.ENOTSUP}
            or getattr(exc, "winerror", None) == 1314
        ):
            pytest.skip("Symlink creation is unavailable")
        raise


@pytest.mark.parametrize(
    "relative", ["设定/world.md", "大纲/plan.md", "人物/person.md", "资料/note.md", "导出/export.md", "灵感.md"]
)
def test_resolved_non_manuscript_never_consumes_ordinal(tmp_path, relative):
    material = write(tmp_path, relative)
    link(tmp_path / "正文/001.md", material)
    write(tmp_path, "正文/002.md")
    assert canon_rebuild.chapter_ordinals(str(tmp_path), "*.md") == {"正文/002.md": 1}
    assert [p.relative_to(tmp_path).as_posix() for p in iter_manuscript_files(tmp_path)] == ["正文/002.md"]


def test_manuscript_aliases_preserve_lexical_positions_and_duplicates(tmp_path):
    original = write(tmp_path, "正文/020.md")
    link(tmp_path / "正文/010.md", original)
    link(tmp_path / "030.md", original)
    expected = {"030.md": 1, "正文/010.md": 2, "正文/020.md": 3}
    assert canon_rebuild.chapter_ordinals(str(tmp_path), "*.md") == expected
    assert [p.relative_to(tmp_path).as_posix() for p in iter_manuscript_files(tmp_path)] == list(expected)


def test_excluded_lexical_alias_stays_excluded_when_target_is_manuscript(tmp_path):
    original = write(tmp_path, "正文/020.md")
    link(tmp_path / "设定/alias.md", original)
    assert canon_rebuild.chapter_ordinals(str(tmp_path), "*.md") == {"正文/020.md": 1}


def test_lexical_extension_remains_authoritative_for_alias(tmp_path):
    original = write(tmp_path, "正文/original.txt")
    link(tmp_path / "正文/010.md", original)
    assert canon_rebuild.chapter_ordinals(str(tmp_path), "*.md") == {"正文/010.md": 1}


def test_custom_glob_remains_supported_with_resolved_role_filter(tmp_path):
    original = write(tmp_path, "正文/original.txt")
    material = write(tmp_path, "设定/reference.txt")
    link(tmp_path / "正文/010.txt", original)
    link(tmp_path / "正文/000.txt", material)
    assert canon_rebuild.chapter_ordinals(str(tmp_path), "*.txt") == {"正文/010.txt": 1, "正文/original.txt": 2}


def test_outside_alias_hidden_alias_and_hidden_target_stay_excluded(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    original = write(root, "正文/020.md")
    hidden = write(root, ".hidden/reference.md")
    outside = write(tmp_path, "outside.md")
    link(root / "正文/000.md", outside)
    link(root / "正文/001.md", hidden)
    link(root / ".hidden/alias.md", original)
    assert canon_rebuild.chapter_ordinals(str(root), "*.md") == {"正文/020.md": 1}


def test_broken_alias_stays_excluded(tmp_path):
    link(tmp_path / "正文/000.md", tmp_path / "正文/missing.md")
    write(tmp_path, "正文/020.md")
    assert canon_rebuild.chapter_ordinals(str(tmp_path), "*.md") == {"正文/020.md": 1}


def test_scan_failure_keeps_optional_canon_window_unknown(tmp_path, monkeypatch):
    write(tmp_path, "正文/第001章.md")
    _write_canon(
        tmp_path,
        {
            "version": 1,
            "entities": [],
            "invariants": {"single_holder": [{"item": "key", "holder": "OWNER", "from_chapter": 1}]},
        },
    )

    def fail(_root):
        raise FsToolError("Incomplete scan")

    monkeypatch.setattr(canon_rebuild, "_iter_project_files", fail)
    with pytest.raises(FsToolError):
        canon_rebuild.chapter_ordinals(str(tmp_path), "*.md")
    result = canon_context.build_scene_constraint_block(str(tmp_path), str(tmp_path / "正文/第002章.md"))
    assert "章序未知" in result
    assert "本章不得" not in result


def test_target_resolution_failure_does_not_return_partial_ordinals(tmp_path, monkeypatch):
    first = write(tmp_path, "正文/000.md")
    unstable = write(tmp_path, "正文/001.md")
    monkeypatch.setattr(canon_rebuild, "_iter_project_files", lambda _root: [first, unstable])
    resolve = type(unstable).resolve

    def fail_target(self, *args, **kwargs):
        if self == unstable:
            raise OSError("Target became unavailable after enumeration")
        return resolve(self, *args, **kwargs)

    monkeypatch.setattr(type(unstable), "resolve", fail_target)
    with pytest.raises(FsToolError):
        canon_rebuild.chapter_ordinals(str(tmp_path), "*.md")
    _write_canon(
        tmp_path,
        {
            "version": 1,
            "entities": [],
            "invariants": {"single_holder": [{"item": "key", "holder": "OWNER", "from_chapter": 1}]},
        },
    )
    result = canon_context.build_scene_constraint_block(str(tmp_path), str(tmp_path / "正文/第003章.md"))
    assert "章序未知" in result
    assert "本章不得" not in result


def test_alias_target_escape_after_enumeration_fails_closed(tmp_path, monkeypatch):
    root = tmp_path / "project"
    root.mkdir()
    outside = write(tmp_path, "outside.md")
    alias = root / "正文/001.md"
    link(alias, outside)
    # Model a scanner observation followed by an alias retarget before role resolution.
    monkeypatch.setattr(canon_rebuild, "_iter_project_files", lambda _root: [alias])
    with pytest.raises(FsToolError):
        canon_rebuild.chapter_ordinals(str(root), "*.md")


def test_author_instruction_alias_is_not_chapter_but_dedicated_source_remains_available(tmp_path):
    from app.common.author_voice import append_author_instructions_to_system_prompt, read_author_instructions
    from app.common.manuscript import previous_chapter_tail
    from app.domains.agent_runs.fs_tools import fs_list, fs_read

    instructions = write(tmp_path, ".storyforge/agent-instructions.md", "AUTHOR_PREFERENCE_SENTINEL")
    alias = tmp_path / "正文/000.md"
    link(alias, instructions)
    current = write(tmp_path, "正文/001.md")
    assert canon_rebuild.chapter_ordinals(str(tmp_path), "*.md") == {"正文/001.md": 1}
    assert [p.relative_to(tmp_path).as_posix() for p in iter_manuscript_files(tmp_path)] == ["正文/001.md"]
    assert previous_chapter_tail(str(tmp_path), str(current)) is None
    assert ".storyforge/agent-instructions.md" in {entry["path"] for entry in fs_list(str(tmp_path))["entries"]}
    assert fs_read(str(tmp_path), ".storyforge/agent-instructions.md")["content"] == "AUTHOR_PREFERENCE_SENTINEL"
    assert read_author_instructions(str(tmp_path)) == "AUTHOR_PREFERENCE_SENTINEL"
    assert "AUTHOR_PREFERENCE_SENTINEL" in append_author_instructions_to_system_prompt("BASE_SYSTEM", str(tmp_path))
