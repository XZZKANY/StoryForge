"""prose.continue 循环工具：agent 在对话里按需续写。

可证伪的红线：
1. 工具对循环里的模型可见，且落进「产出待确认补丁」的工具集（受单补丁闸约束）。
2. 落点跳过作者停笔时连敲的空行——新段紧贴上一段，不掉进一片空白里。
3. 插入是纯新增：before 的每一行都还在 after 里，既有正文一字不改。
4. 落点优先级 显式 anchor_line > 作者光标 > 文件末尾。
5. 后端不写盘：补丁 requires_confirmation，磁盘内容不变。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script
from agent_transport import stream_agent_message
from fastapi.testclient import TestClient

from app.domains.agent_runs.patches.types import PatchProposal
from app.domains.agent_runs.tooling import build_loop_tool_name_map, build_loop_tool_schemas, loop_patch_tool_specs
from app.domains.assistant import continuation

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


# --- 纯函数：落点与插入 ---


def test_resolve_anchor_line_skips_trailing_blank_lines() -> None:
    """作者写完一段习惯连敲两下回车再停手，光标落在第二个空行上。"""

    content = "第一段。\n\n\n"
    assert continuation.resolve_anchor_line(content, 3) == 1


def test_resolve_anchor_line_clamps_out_of_range() -> None:
    assert continuation.resolve_anchor_line("一\n二\n", 99) == 2
    assert continuation.resolve_anchor_line("一\n二\n", -3) == 0


def test_insert_at_anchor_is_pure_addition() -> None:
    before = "第一段。\n\n第二段。\n"
    after = continuation.insert_at_anchor(before, 1, "新写的一段。")
    assert "新写的一段。" in after
    # 纯新增：原文每一行都还在
    for line in before.split("\n"):
        if line.strip():
            assert line in after
    assert after.index("第一段。") < after.index("新写的一段。") < after.index("第二段。")


def test_insert_at_anchor_at_file_top() -> None:
    after = continuation.insert_at_anchor("", 0, "开头第一段。")
    assert after.startswith("开头第一段。")


def test_insert_at_anchor_at_file_end_adds_no_trailing_blank_run() -> None:
    after = continuation.insert_at_anchor("已有正文。\n", 1, "续上的一段。")
    assert after == "已有正文。\n\n续上的一段。\n"


# --- spec / schema 接线 ---


def test_prose_continue_visible_to_loop_model() -> None:
    names = {schema["function"]["name"] for schema in build_loop_tool_schemas()}
    assert "prose_continue" in names
    assert build_loop_tool_name_map()["prose_continue"] == "prose.continue"


def test_prose_continue_is_a_patch_tool() -> None:
    """必须落进 write_pending 集合：一次对话最多一个补丁的闸从这里单点派生。"""

    assert "prose.continue" in {spec.name for spec in loop_patch_tool_specs()}


def test_prose_continue_patch_kind_maps_back_to_tool() -> None:
    proposal = PatchProposal.from_payload(
        {"kind": "prose_continue", "file_path": "正文/第01章.md", "before": "a", "after": "a\n\nb"}
    )
    assert proposal.created_by_tool == "prose.continue"


# --- 端到端：对话里说「接着写」 ---


def _tool_call_round(arguments: str) -> dict[str, object]:
    return {
        "content": "",
        "tool_calls": [
            {
                "id": "call-1",
                "type": "function",
                "function": {"name": "prose_continue", "arguments": arguments},
            }
        ],
    }


def test_loop_continue_produces_insertion_patch_without_writing_disk(
    client: TestClient,
    novel_project: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_loop_env(monkeypatch)
    chapter = novel_project / "正文" / "第01章.md"
    chapter.write_text("灯塔第三十三次错误闪光。\n\n", encoding="utf-8")
    on_disk = chapter.read_text(encoding="utf-8")

    monkeypatch.setattr(
        "app.domains.agent_runs.tools.prose_continue_runtime.assistant_service.draft_continuation",
        lambda session, payload: _FakeDraft("林岚合上审计簿，往塔顶去。"),
    )
    _fake_llm_script(
        monkeypatch,
        [
            _tool_call_round('{"path": "正文/第01章.md"}'),
            {"content": "写好了，等你确认。", "tool_calls": []},
        ],
    )

    frames = stream_agent_message(
        client,
        "session-continue",
        run_id="run-continue",
        user_message="接着往下写一段",
        args={
            "project_path": str(novel_project),
            "context_bundle": {"files": []},
            "file_path": "正文/第01章.md",
            "author_view": {"file_path": "正文/第01章.md", "cursor_line": 2, "cursor_column": 1},
        },
    )
    result = frames[-1]
    assert result["type"] == "agent_result", result
    patch = result["proposed_patch"]
    assert patch["kind"] == "prose_continue"
    assert patch["requires_confirmation"] is True
    assert "林岚合上审计簿" in patch["after"]
    # 纯新增：原文仍在，且后端没有写盘。
    assert "灯塔第三十三次错误闪光。" in patch["after"]
    assert chapter.read_text(encoding="utf-8") == on_disk


class _FakeDraft:
    """draft_continuation 的最小替身：只出那一段文字，不出网。"""

    def __init__(self, content: str) -> None:
        self.content = content
        self.summary = "已续写。"
        self.model = "fake-model"
        self.latency_ms = 1
        self.completion_tokens = 7
        self.assistant_session_id = 1
