"""Independent chapter-identity boundary and ordering review."""

import errno
import json
import os
from pathlib import Path

import pytest
from agent_canon_test_support import _write_canon

from app.domains.agent_runs import canon_context
from app.domains.agent_runs.fs_tools import FsToolError


def directory_symlink(link, target):
    try:
        link.symlink_to(target, target_is_directory=True)
    except NotImplementedError:
        pytest.skip("Directory symlinks are unsupported on this platform")
    except OSError as exc:
        if (
            exc.errno in {errno.EACCES, errno.EPERM, errno.ENOSYS, errno.ENOTSUP}
            or getattr(exc, "winerror", None) == 1314
        ):
            pytest.skip("Directory symlink creation is unavailable in this test environment")
        raise


def setup_project(root):
    (root / "A").mkdir()
    (root / "A" / "第001章.md").write_text("first")
    (root / "A" / "第002章.md").write_text("second")
    _write_canon(
        root,
        {
            "version": 1,
            "entities": [],
            "invariants": {
                "single_holder": [
                    {"item": "key", "holder": "OLD_OWNER", "from_chapter": 1, "to_chapter": 2},
                    {"item": "key", "holder": "NEW_OWNER", "from_chapter": 3},
                ]
            },
        },
    )


def block(root, target):
    return canon_context.build_scene_constraint_block(str(root), str(target))


@pytest.mark.parametrize(
    "relative",
    [
        "设定/第003章.md",
        ".hidden/第003章.md",
        "Z/.hidden/第003章.md",
        "Z/第003章.txt",
        "Z/第003章.md/child.txt",
        pytest.param(
            "Z/第003章.MD",
            marks=pytest.mark.skipif(
                Path("chapter.MD").match("*.md"), reason="Native path matching accepts uppercase extension"
            ),
        ),
        "node_modules/第003章.md",
        "Z/__pycache__/第003章.md",
    ],
)
def test_excluded_missing_targets_never_acquire_hard_current_window(tmp_path, relative):
    setup_project(tmp_path)
    result = block(tmp_path, tmp_path / relative)
    assert "章序未知" in result
    assert "本章不得" not in result


def test_failed_scan_never_synthesizes_rank(tmp_path, monkeypatch):
    setup_project(tmp_path)

    def fail(*args):
        raise FsToolError("controlled incomplete scan")

    monkeypatch.setattr(canon_context, "_chapter_ordinals", fail)
    assert "章序未知" in block(tmp_path, tmp_path / "Z/第003章.md")


@pytest.mark.parametrize("relative", ["../第003章.md", "../outside/第003章.md"])
def test_relative_escape_stays_unknown(tmp_path, relative):
    setup_project(tmp_path)
    assert "章序未知" in block(tmp_path, relative)


def test_symlink_escape_stays_unknown(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    setup_project(root)
    outside = tmp_path / "outside"
    outside.mkdir()
    directory_symlink(root / "Z", outside)
    assert "章序未知" in block(root, root / "Z/第003章.md")


@pytest.mark.skipif(os.name == "nt", reason="Requires POSIX case-sensitive identity")
def test_posix_distinct_case_keeps_distinct_membership(tmp_path):
    setup_project(tmp_path)
    if (tmp_path / "a").exists():
        pytest.skip("Requires a case-sensitive filesystem")
    (tmp_path / "a").mkdir()
    target = tmp_path / "a/第001章.md"
    before = block(tmp_path, target)
    target.write_text("")
    after = block(tmp_path, target)
    assert "第 3 章" in before
    assert before == after


def test_explicit_plan_ordinal_does_not_reorder_canon(tmp_path):
    setup_project(tmp_path)
    target = tmp_path / "Z/第001章.md"
    (tmp_path / ".storyforge/serial-plan.json").write_text(
        json.dumps({"version": 1, "chapters": [{"ordinal": 1, "path": "Z/第001章.md", "status": "pending"}]})
    )
    before = block(tmp_path, target)
    target.parent.mkdir()
    target.write_text("")
    assert before == block(tmp_path, target)
    assert "第 3 章" in before


def test_nonnumeric_missing_target_remains_unknown(tmp_path):
    setup_project(tmp_path)
    assert "章序未知" in block(tmp_path, tmp_path / "Z/Finale.md")


def test_existing_directory_named_like_chapter_is_not_a_chapter(tmp_path):
    setup_project(tmp_path)
    target = tmp_path / "Z/第003章.md"
    target.mkdir(parents=True)
    assert "章序未知" in block(tmp_path, target)


@pytest.mark.parametrize(
    "relative,expected",
    [
        ("A/第000章.md", None),
        ("A/第0001章.md", 1),
        ("A/第0015章.md", 1),
        ("A/第001章-b.md", 1),
        ("A/第001章a.md", 2),
        ("A/第099章.md", 3),
    ],
)
def test_prospective_rank_tracks_literal_path_order_not_filename_number(tmp_path, relative, expected):
    setup_project(tmp_path)
    target = tmp_path / relative
    before = block(tmp_path, target)
    if expected is None:
        assert "章序未知" in before
        return
    target.write_text("")
    assert before == block(tmp_path, target)
    assert f"第 {expected} 章 · 阅读序" in before


@pytest.mark.parametrize("spelling", ["absolute_backslash", "relative_dot", "relative_normalized"])
def test_equivalent_existing_spellings_share_exact_ordinal(tmp_path, spelling):
    setup_project(tmp_path)
    target = tmp_path / "A/第002章.md"
    path = {
        "absolute_backslash": str(target).replace("/", "\\"),
        "relative_dot": "./A/第002章.md",
        "relative_normalized": "A/../A/第002章.md",
    }[spelling]
    assert block(tmp_path, path) == block(tmp_path, target)


@pytest.mark.parametrize("path", ["C:/outside/第003章.md", "C:\\outside\\第003章.md"])
def test_foreign_drive_path_is_not_reinterpreted_as_project_relative(tmp_path, path):
    setup_project(tmp_path)
    assert "章序未知" in block(tmp_path, path)


def test_symlink_loop_fails_closed_without_crashing_context(tmp_path):
    setup_project(tmp_path)
    directory_symlink(tmp_path / "loop", tmp_path / "loop")
    assert "章序未知" in block(tmp_path, tmp_path / "loop/第003章.md")
