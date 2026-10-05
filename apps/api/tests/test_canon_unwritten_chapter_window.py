"""C09：新章未知章序——目标尚不存在时互斥时间窗同时变当前约束。

报告 §3 C09（旧第 16 页）：新目标尚不存在时，两段时间窗口的唯一持有人同时变
当前约束；建空占位后只剩正确一条。根因：当前文件不在 ordinals → cur=None →
退化全书模式，_window_covers 对每条 single_holder 都判覆盖（含互斥的另一段窗口）。
"""

from __future__ import annotations

from pathlib import Path

from agent_canon_test_support import _QINGYAN, _write_canon

from app.domains.agent_runs import canon_context

pytest_plugins = ("agent_canon_test_fixtures",)


def test_unwritten_new_chapter_only_future_window_active(project: Path) -> None:
    """写第 3 章（文件尚不存在）：只有「第 3 章起」的窗口是当前约束，
    「第 1-2 章」的互斥旧窗口不能同时出现。"""
    _write_canon(
        project,
        {
            "version": 1,
            "entities": [_QINGYAN],
            "invariants": {
                "single_holder": [
                    {"item": "归零权限", "holder": "char_old", "from_chapter": 1, "to_chapter": 2},
                    {"item": "归零权限", "holder": "char_new", "from_chapter": 3, "to_chapter": None},
                ]
            },
        },
    )
    # 目标第 3 章尚不存在（作者正要写它）。
    current_file = str(project / "正文" / "第03章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    assert block is not None
    assert "char_new" in block
    # 互斥旧窗口（第 1-2 章持有者）不能与新窗口同时变当前约束。
    assert "char_old" not in block


def test_placeholder_file_resolves_correctly(project: Path) -> None:
    """建空占位后只剩正确一条——回归护栏（旧行为本就正确）。"""
    _write_canon(
        project,
        {
            "version": 1,
            "entities": [_QINGYAN],
            "invariants": {
                "single_holder": [
                    {"item": "归零权限", "holder": "char_old", "from_chapter": 1, "to_chapter": 2},
                    {"item": "归零权限", "holder": "char_new", "from_chapter": 3, "to_chapter": None},
                ]
            },
        },
    )
    (project / "正文" / "第03章.md").write_text("", encoding="utf-8")
    current_file = str(project / "正文" / "第03章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    assert block is not None
    assert "char_new" in block
    assert "char_old" not in block
    assert "本文件 = 第 3 章" in block


def test_existing_chapter_windows_unchanged(project: Path) -> None:
    """既有章的窗口判定不变——回归护栏。"""
    _write_canon(
        project,
        {
            "version": 1,
            "entities": [_QINGYAN],
            "invariants": {
                "single_holder": [
                    {"item": "归零权限", "holder": "char_old", "from_chapter": 1, "to_chapter": 2},
                    {"item": "归零权限", "holder": "char_new", "from_chapter": 3, "to_chapter": None},
                ]
            },
        },
    )
    # 第 2 章：旧窗口覆盖。
    block_two = canon_context.build_scene_constraint_block(str(project), str(project / "正文" / "第02章.md"))
    assert block_two is not None
    assert "char_old" in block_two
    assert "char_new" not in block_two


def test_unwritten_chapter_without_future_window_keeps_none(project: Path) -> None:
    """只有旧窗口、无未来窗口时，未写章不应伪造约束。"""
    _write_canon(
        project,
        {
            "version": 1,
            "entities": [],
            "invariants": {
                "single_holder": [
                    {"item": "断魂刀", "holder": "char_a", "from_chapter": 1, "to_chapter": 2},
                ]
            },
        },
    )
    current_file = str(project / "正文" / "第03章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    # 无任何窗口覆盖第 3 章 → 不推 single_holder 约束。
    assert block is None or "断魂刀" not in block
