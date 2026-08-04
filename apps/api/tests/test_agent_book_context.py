"""作品底座（`book_context`）：对话循环每轮必须知道「这是一本什么书、现在在第几章」。

背景（2026-07-30 诊断）：live 工具循环的 system prompt 里全书事实几乎为零——文件树、
人物 / 设定索引、总章数、上一章结尾一概不进；唯一的全书事实源 `canon_context` 在作者
没声明 invariants 时整块返回 None。作者的原话是「不应该 agent 统御这整个作品吗」。

本文件的红线：
- 底座报的章序与 canon 硬约束头报的章序**必须同口径**（错开比没有更糟）；
- 非正文目录不占章号；
- 底座真的进了 `run_chat_loop` 发出去的 messages（护栏打在接线上，不是只测纯函数）。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script
from agent_transport import stream_agent_message
from fastapi.testclient import TestClient

from app.domains.agent_runs import book_context, canon_context

pytest_plugins = ("agent_loop_runtime_test_fixtures",)

_HEADING = "[作品底座 · 确定性]"


@pytest.fixture()
def serial(tmp_path: Path) -> Path:
    """两章正文 + 三份非正文骨架的连载项目。"""

    (tmp_path / "正文").mkdir()
    (tmp_path / "正文" / "第001章.md").write_text("旧城的雨下了三天。\n" * 40, encoding="utf-8")
    (tmp_path / "正文" / "第002章.md").write_text("陈默把玄铁令扣回腰间。\n" * 40, encoding="utf-8")
    (tmp_path / "大纲").mkdir()
    (tmp_path / "大纲" / "总纲.md").write_text("三卷结构。\n" * 20, encoding="utf-8")
    (tmp_path / "人物").mkdir()
    (tmp_path / "人物" / "主角.md").write_text("陈默：退役守夜人。\n" * 20, encoding="utf-8")
    (tmp_path / "设定").mkdir()
    (tmp_path / "设定" / "世界观.md").write_text("玄铁令是唯一凭信。\n" * 20, encoding="utf-8")
    return tmp_path


def _write_canon(project: Path, payload: dict) -> None:
    canon_dir = project / ".storyforge" / "canon"
    canon_dir.mkdir(parents=True, exist_ok=True)
    (canon_dir / "canon.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _write_presence(project: Path, payload: dict) -> None:
    derived = project / ".storyforge" / "canon" / "derived"
    derived.mkdir(parents=True, exist_ok=True)
    (derived / "presence.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


# --- 章序口径：底座与 canon 硬约束头不得错开 ---


def test_chapter_ordinal_matches_canon_constraint_header(serial: Path) -> None:
    """底座说的第几章 == canon 硬约束头说的第几章。

    两处各自扫盘算章序，口径一旦漂移，模型会同时收到「第 2 章」和「第 3 章」两个数字——
    比没有数字更糟。这条红线锁住二者共用 `canon_rebuild.chapter_ordinals`。
    """

    _write_canon(
        serial,
        {
            "version": 1,
            "entities": [{"id": "chen-mo", "canonical_name": "陈默", "aliases": ["老陈"]}],
            "invariants": {"lifespan": [{"entity": "chen-mo", "exits_after_chapter": 1}]},
        },
    )
    current = str(serial / "正文" / "第002章.md")

    block = book_context.build_book_context_block(str(serial), current)
    scene = canon_context.build_scene_constraint_block(str(serial), current)

    assert block is not None and scene is not None
    assert "当前打开的是第 2 章" in block
    assert "本文件 = 第 2 章" in scene


def test_non_manuscript_dirs_do_not_consume_chapter_numbers(serial: Path) -> None:
    """大纲 / 人物 / 设定 不占章号：全书是 2 章，不是 5 章。"""

    block = book_context.build_book_context_block(str(serial), None)
    assert block is not None
    assert "全书 2 章正文" in block


def test_current_file_outside_reading_order_is_stated_not_faked(serial: Path) -> None:
    """打开的是设定文件时如实说明它不计入阅读序，绝不硬派一个章号。"""

    block = book_context.build_book_context_block(str(serial), str(serial / "设定" / "世界观.md"))
    assert block is not None
    assert "不计入阅读序" in block
    assert "当前打开的是第" not in block


# --- 骨架索引与人物台账 ---


def test_skeleton_index_lists_scaffolding_not_manuscript(serial: Path) -> None:
    """索引给的是大纲 / 人物 / 设定的路径，不把正文也铺进来（正文有阅读序坐标即可）。"""

    block = book_context.build_book_context_block(str(serial), None)
    assert block is not None
    assert "大纲/总纲.md" in block
    assert "人物/主角.md" in block
    assert "设定/世界观.md" in block
    assert "正文/第001章.md" not in block


def test_roster_carries_aliases(serial: Path) -> None:
    """台账带别名——作者管陈默叫「老陈」时，模型得知道说的是同一个人。"""

    _write_canon(
        serial,
        {
            "version": 1,
            "entities": [{"id": "chen-mo", "canonical_name": "陈默", "aliases": ["老陈", "默哥"]}],
        },
    )
    block = book_context.build_book_context_block(str(serial), None)
    assert block is not None
    assert "陈默（又称 老陈 / 默哥）" in block


def test_roster_uses_presence_cache_for_span_without_rescan(serial: Path) -> None:
    """出场跨度取自已落盘的 presence.json；缓存缺失时只给名字，不在每轮对话里重扫全书。"""

    canon = {
        "version": 1,
        "entities": [{"id": "chen-mo", "canonical_name": "陈默", "aliases": ["老陈"]}],
    }
    _write_canon(serial, canon)
    assert "在场" not in (book_context.build_book_context_block(str(serial), None) or "")

    _write_presence(
        serial,
        {
            "entities": [
                {"id": "chen-mo", "canonical_name": "陈默", "first_chapter": 1, "last_chapter": 2, "missing": False}
            ]
        },
    )
    block = book_context.build_book_context_block(str(serial), None)
    assert block is not None
    assert "第 1–2 章在场" in block


def test_project_knowledge_index_includes_author_files_but_not_derived_cache(serial: Path) -> None:
    _write_canon(serial, {"version": 1, "entities": [{"id": "chen-mo", "canonical_name": "陈默"}]})
    materials = serial / ".资料"
    materials.mkdir()
    (materials / "黄金三章spec.md").write_text("开篇约束", encoding="utf-8")

    derived = serial / ".storyforge" / "canon" / "derived"
    derived.mkdir(parents=True, exist_ok=True)
    (derived / "dossier.md").write_text("# 陈默\n", encoding="utf-8")

    block = book_context.build_book_context_block(str(serial), None)
    assert block is not None
    assert "Project Knowledge 索引" in block
    assert ".资料/黄金三章spec.md" in block
    assert ".storyforge/canon/canon.json" in block
    assert ".storyforge/canon/derived/dossier.md" not in block
    assert "project_knowledge read" in block


# --- 上一章结尾 ---


def test_previous_chapter_tail_enters_the_block(serial: Path) -> None:
    """写第 2 章时，第 1 章怎么收的必须在场——此前只有续写 / 起草子调用看得到。"""

    (serial / "正文" / "第001章.md").write_text("旧城的雨下了三天。\n他终于推开那扇门。", encoding="utf-8")
    block = book_context.build_book_context_block(str(serial), str(serial / "正文" / "第002章.md"))
    assert block is not None
    assert "[上一章结尾 · 正文/第001章.md]" in block
    assert "他终于推开那扇门。" in block


def test_first_chapter_has_no_previous_tail(serial: Path) -> None:
    """第 1 章没有上一章，不能拿别的文件冒充。"""

    block = book_context.build_book_context_block(str(serial), str(serial / "正文" / "第001章.md"))
    assert block is not None
    assert "上一章结尾" not in block


# --- 失败静默：底座是加分项，不能拖垮对话 ---


def test_missing_project_returns_none(tmp_path: Path) -> None:
    """项目目录不存在时返回 None，不抛异常。"""

    assert book_context.build_book_context_block(str(tmp_path / "nope"), None) is None


def test_empty_project_returns_none(tmp_path: Path) -> None:
    """空项目没有可报事实，不占一个 system 位。"""

    assert book_context.build_book_context_block(str(tmp_path), None) is None


# --- 接线护栏：底座真的发出去了 ---


def test_book_context_block_reaches_the_llm_messages(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    serial: Path,
) -> None:
    """底座必须出现在 `run_chat_loop` 实际发给模型的 messages 里。

    只测纯函数会假绿：模块拼得再对，`loop_runtime` 不接线，作者机器上的 agent 依旧
    对整本书一无所知。这条断言打在接线上。
    """

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(monkeypatch, [{"content": "读到了。", "tool_calls": []}])

    stream_agent_message(
        client,
        "session-book-context",
        run_id="run-book-context",
        user_message="这本书现在写到哪了？",
        args={
            "project_path": str(serial),
            "file_path": str(serial / "正文" / "第002章.md"),
            "context_bundle": {"files": []},
        },
    )

    assert calls, "工具循环没有发起模型调用。"
    systems = [
        message["content"]
        for message in calls[0]["messages"]
        if message.get("role") == "system" and isinstance(message.get("content"), str)
    ]
    book_blocks = [content for content in systems if _HEADING in content]
    assert book_blocks, f"发给模型的 system 块里没有作品底座：{systems}"
    assert "全书 2 章正文" in book_blocks[0]
    assert "当前打开的是第 2 章" in book_blocks[0]
