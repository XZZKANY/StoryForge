"""作者当前视图注入循环：纯函数解码与端到端 messages 形状。

可证伪的红线：
1. 作者选中一段后发问，那段原文必须进本轮 messages（此前选区根本进不了循环）。
2. 无选区时注入光标窗，且窗口必须以光标行为界（下文不能混进上文块）。
3. 作者 @ 钉的上下文摘录必须进循环（此前只有回落单轮对话在用）。
4. 前端行号越界不得抛错打断作者，一律夹取。
5. 视图正文不进事件表摘要（事件会被导出展示）。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script
from agent_transport import stream_agent_message
from fastapi.testclient import TestClient

from app.domains.agent_runs.loop.author_view import (
    AuthorView,
    author_view_summary,
    build_author_view_block,
    build_pinned_context_block,
    cursor_window,
)
from app.domains.agent_runs.run_payloads import message_input_summary

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


_CHAPTER = "第01章.md"


def _system_texts(calls: list[dict[str, object]]) -> str:
    messages = calls[0]["messages"]
    assert isinstance(messages, list)
    return "\n".join(str(item.get("content") or "") for item in messages)


def _send(
    client: TestClient,
    *,
    project_path: str,
    message: str,
    args_extra: dict[str, object],
) -> list[dict]:
    return stream_agent_message(
        client,
        "session-author-view",
        run_id="run-author-view",
        user_message=message,
        args={"project_path": project_path, "context_bundle": {"files": []}, **args_extra},
    )


# --- 纯函数层 ---


def test_from_payload_clamps_and_prefers_view_file_path() -> None:
    view = AuthorView.from_payload(
        {
            "file_path": "正文/第01章.md",
            "content": "一\n二\n三\n",
            "author_view": {"cursor_line": -5, "cursor_column": 0, "selection_text": " "},
        }
    )
    assert view.cursor_line == 0
    assert view.cursor_column == 0
    assert view.selection_text == " "
    assert view.file_path == "正文/第01章.md"


def test_from_payload_tolerates_missing_author_view() -> None:
    view = AuthorView.from_payload({"content": "一\n"})
    assert view.has_view is False
    assert build_author_view_block(view) is None


def test_cursor_window_splits_at_cursor_line() -> None:
    head, tail = cursor_window("一\n二\n三\n四\n", 2)
    assert head == "一\n二"
    assert tail == "三\n四"


def test_cursor_window_clamps_out_of_range_line() -> None:
    """前端行号可能比后端拿到的内容多一行（未保存的编辑）：夹取而不是抛错。"""

    head, tail = cursor_window("一\n二\n", 99)
    assert head == "一\n二"
    assert tail == ""


def test_selection_wins_over_cursor_window() -> None:
    view = AuthorView.from_payload(
        {
            "content": "上文一\n上文二\n",
            "author_view": {"cursor_line": 1, "selection_text": "被选中的这一句"},
        }
    )
    block = build_author_view_block(view)
    assert block is not None
    assert "被选中的这一句" in block
    assert "BEFORE_CURSOR" not in block


def test_pinned_context_block_empty_is_none() -> None:
    assert build_pinned_context_block("  ") is None
    assert build_pinned_context_block("### 设定/人物.md\n林岚") is not None


def test_event_summary_records_shape_not_prose() -> None:
    summary = message_input_summary(
        {
            "type": "user_message",
            "args": {
                "file_path": _CHAPTER,
                "content": "整章正文" * 10,
                "author_view": {"cursor_line": 3, "selection_text": "机密选区文本"},
            },
        }
    )
    assert summary["author_view"] == {
        "file_path": _CHAPTER,
        "cursor_line": 3,
        "selection_chars": len("机密选区文本"),
        "content_chars": len("整章正文" * 10),
    }
    assert "机密选区文本" not in str(summary)


def test_author_view_summary_is_shape_only() -> None:
    view = AuthorView(file_path=_CHAPTER, cursor_line=2, selection_text="abc", content="abcdef")
    assert author_view_summary(view) == {
        "file_path": _CHAPTER,
        "cursor_line": 2,
        "selection_chars": 3,
        "content_chars": 6,
    }


# --- 端到端：视图真的进了本轮 messages ---


def test_selection_reaches_model_messages(
    client: TestClient,
    novel_project: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """作者选中一段问「这一段怎么改」，那段原文必须进本轮 prompt。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(monkeypatch, [{"content": "看到了。", "tool_calls": []}])
    _send(
        client,
        project_path=str(novel_project),
        message="这一段怎么改",
        args_extra={
            "file_path": _CHAPTER,
            "content": "灯塔第三十三次错误闪光。\n林岚合上审计簿。\n",
            "author_view": {
                "file_path": _CHAPTER,
                "cursor_line": 2,
                "cursor_column": 1,
                "selection_text": "林岚合上审计簿。",
            },
        },
    )
    prompt = _system_texts(calls)
    assert "林岚合上审计簿。" in prompt
    assert "选中" in prompt


def test_cursor_window_reaches_model_when_no_selection(
    client: TestClient,
    novel_project: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(monkeypatch, [{"content": "好。", "tool_calls": []}])
    _send(
        client,
        project_path=str(novel_project),
        message="接着往下会怎么写",
        args_extra={
            "file_path": _CHAPTER,
            "content": "上文这一行。\n下文那一行。\n",
            "author_view": {"file_path": _CHAPTER, "cursor_line": 1, "cursor_column": 3},
        },
    )
    prompt = _system_texts(calls)
    assert "BEFORE_CURSOR" in prompt
    assert "上文这一行。" in prompt
    assert "光标停在第 1 行" in prompt


def test_pinned_context_reaches_model_messages(
    client: TestClient,
    novel_project: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """作者 @ 钉的文件摘录此前在循环路径被静默丢弃，只有回落单轮对话在用。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(monkeypatch, [{"content": "收到。", "tool_calls": []}])
    stream_agent_message(
        client,
        "session-pinned",
        run_id="run-pinned",
        user_message="按设定核对",
        args={
            "project_path": str(novel_project),
            "context_bundle": {
                "files": [{"relative_path": "设定/人物.md", "kind": "character", "excerpt": "林岚：审计员。"}]
            },
        },
    )
    prompt = _system_texts(calls)
    assert "林岚：审计员。" in prompt
    assert "设定/人物.md" in prompt


def test_no_author_view_keeps_message_shape(
    client: TestClient,
    novel_project: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """没视图没 @ 上下文时不得凭空多出 system 块（回归护栏）。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(monkeypatch, [{"content": "好。", "tool_calls": []}])
    _send(client, project_path=str(novel_project), message="项目里有什么", args_extra={})
    prompt = _system_texts(calls)
    assert "BEFORE_CURSOR" not in prompt
    assert "SELECTION" not in prompt
    assert "作者为这轮对话指定了" not in prompt
