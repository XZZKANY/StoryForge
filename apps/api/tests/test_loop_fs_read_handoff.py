"""C01：工具读取不自动交接——循环内 fs.read 的独特事实必须进后续 writer 的 snapshot。

报告 §3 C01（旧第 4 页）：模型先用 fs.read 读到独特事实，事件只被记作省略；
随后调用 writer（file.create/file.revise）时内层 context_bundle 不含该事实，
外层模型可能复述但 writer 的送达没有保证。修法：循环内成功的 fs.read 结果
作为附加 context_files 交接给后续 trusted writer 的 snapshot。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script, _send_chat_message
from fastapi.testclient import TestClient

from app.domains.agent_runs.fs import (
    KnowledgeEntry,
    KnowledgeSource,
    knowledge_claim_fingerprint,
    render_knowledge_entry,
)
from app.domains.assistant import service as assistant_service

pytest_plugins = ("agent_loop_runtime_test_fixtures",)

# 循环内 fs.read 读到的独特事实：不在前端 bundle、不在选中文稿里。
LOOP_READ_SENTINEL = "LOOP_READ_FACT_SENTINEL：灯塔守护人每三十三年换一次血。"


def _patch_assistant_writer(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    prompts: list[str] = []

    def fake_inner_call(source, *, system_prompt, user_prompt):  # noqa: ANN001
        prompts.append(user_prompt)
        return {"content": "林岚在夜里登上船。", "completion_tokens": 10, "latency_ms": 5}

    for seam in ("_call_llm", "_call_llm_streamed"):
        monkeypatch.setattr(assistant_service, seam, fake_inner_call)
    return prompts


def test_fs_read_fact_reaches_later_writer_prompt(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """模型先 fs.read 独特事实、再 file.create：writer 最终 prompt 必须含该事实。"""
    (novel_project / "设定" / "灯塔秘史.md").write_text(LOOP_READ_SENTINEL, encoding="utf-8")

    prompts = _patch_assistant_writer(monkeypatch)
    _enable_loop_env(monkeypatch)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "read-fact",
                        "type": "function",
                        "function": {
                            "name": "fs_read",
                            "arguments": json.dumps({"path": "设定/灯塔秘史.md"}),
                        },
                    }
                ],
                "completion_tokens": 4,
            },
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "create-with-fact",
                        "type": "function",
                        "function": {
                            "name": "file_create",
                            "arguments": json.dumps(
                                {"path": "正文/第02章.md", "instruction": "写第二章，用上灯塔秘密"}
                            ),
                        },
                    }
                ],
                "completion_tokens": 4,
            },
            {"content": "补丁等你确认。", "tool_calls": [], "completion_tokens": 4},
        ],
    )
    received = _send_chat_message(
        client,
        run_id="run-fs-read-handoff",
        project_path=str(novel_project),
        message="查一下灯塔的设定然后写第二章",
        # 前端 bundle 不含该文件——事实只能靠循环内交接。
        context_bundle={"files": []},
    )
    result = received[-1]
    assert result["type"] == "agent_result", result
    read_trace = next(item for item in result["tool_trace"] if item["tool_name"] == "fs.read")
    assert read_trace["status"] == "completed", read_trace
    assert len(prompts) == 1
    # 循环内 fs.read 读到的独特事实必须到达 writer 的最终 prompt（送达保证）。
    assert LOOP_READ_SENTINEL in prompts[0]
    assert not (novel_project / "正文" / "第02章.md").exists()
    assert result["proposed_patch"]["requires_confirmation"] is True


def test_fs_read_fact_not_duplicated_when_already_in_bundle(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """同一文件已在 bundle 时，循环交接不重复注入（按路径去重）。"""
    (novel_project / "设定" / "灯塔秘史.md").write_text(LOOP_READ_SENTINEL, encoding="utf-8")

    prompts = _patch_assistant_writer(monkeypatch)
    _enable_loop_env(monkeypatch)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "read-fact",
                        "type": "function",
                        "function": {
                            "name": "fs_read",
                            "arguments": json.dumps({"path": "设定/灯塔秘史.md"}),
                        },
                    }
                ],
                "completion_tokens": 4,
            },
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "create-with-fact",
                        "type": "function",
                        "function": {
                            "name": "file_create",
                            "arguments": json.dumps({"path": "正文/第02章.md", "instruction": "写第二章"}),
                        },
                    }
                ],
                "completion_tokens": 4,
            },
            {"content": "补丁等你确认。", "tool_calls": [], "completion_tokens": 4},
        ],
    )
    received = _send_chat_message(
        client,
        run_id="run-fs-read-handoff-dedup",
        project_path=str(novel_project),
        message="查一下灯塔的设定然后写第二章",
        context_bundle={
            "files": [
                {
                    "relative_path": "设定/灯塔秘史.md",
                    "kind": "setting",
                    "excerpt": LOOP_READ_SENTINEL,
                }
            ]
        },
    )
    result = received[-1]
    assert result["type"] == "agent_result", result
    assert len(prompts) == 1
    assert prompts[0].count(LOOP_READ_SENTINEL) == 1, "同一事实不得重复注入"


@pytest.mark.parametrize(
    "status,excluded,corrupt",
    [
        ("retired", False, False),
        ("disputed", False, False),
        ("superseded", False, False),
        ("active", True, False),
        ("retired", False, True),
        ("active", False, False),
    ],
)
def test_loop_read_obeys_knowledge_admission_at_actual_writer(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
    status: str,
    excluded: bool,
    corrupt: bool,
) -> None:
    claim = "LOOP_ADMISSION_SENTINEL：灯塔只在冬季开放。"
    note = "LOOP_AUTHOR_NOTE_SENTINEL：这条备注须保留。"
    entry = KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440010",
        status=status,
        kind="world_rule",
        evidence_state="current",
        title="灯塔规则",
        claim=claim,
        sources=(KnowledgeSource(type="author_statement", agent_event_id="ake_1"),),
        claim_fingerprint=knowledge_claim_fingerprint("灯塔规则", claim),
        created_at="2026-10-04T00:00:00Z",
        updated_at="2026-10-04T00:00:00Z",
        superseded_by="pk_550e8400-e29b-41d4-a716-446655440011" if status == "superseded" else None,
    )
    raw = render_knowledge_entry(entry)
    if corrupt:
        raw = raw.replace(claim, claim + "手改")
    source = novel_project / "设定" / "灯塔秘史.md"
    source.write_bytes((raw + "\n" + note).encode("utf-8"))
    original_bytes = source.read_bytes()
    prompts = _patch_assistant_writer(monkeypatch)
    _enable_loop_env(monkeypatch)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "read",
                        "type": "function",
                        "function": {"name": "fs_read", "arguments": json.dumps({"path": "设定/灯塔秘史.md"})},
                    }
                ],
            },
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "write",
                        "type": "function",
                        "function": {
                            "name": "file_create",
                            "arguments": json.dumps({"path": "正文/第02章.md", "instruction": "按灯塔规则写第二章"}),
                        },
                    }
                ],
            },
            {"content": "候选等待确认。", "tool_calls": []},
        ],
    )
    received = _send_chat_message(
        client,
        run_id="run-loop-knowledge-admission",
        project_path=str(novel_project),
        message="先读灯塔资料，再写第二章",
        context_bundle={
            "project_root": str(novel_project),
            "files": [],
            "knowledge_exclusions": {"ids": [entry.id] if excluded else []},
        },
    )
    result = received[-1]
    assert result["type"] == "agent_result", result
    assert len(prompts) == 1
    allowed = status == "active" and not excluded and not corrupt
    assert (claim in prompts[0]) is allowed
    if allowed:
        assert prompts[0].count(claim) == 1
    assert prompts[0].count(note) == 1
    assert "storyforge-knowledge:v1" not in prompts[0]
    assert claim not in str(result["tool_trace"])
    assert note not in str(result["tool_trace"])
    assert str(novel_project) not in str(result["tool_trace"])
    assert source.read_bytes() == original_bytes
    assert not (novel_project / "正文" / "第02章.md").exists()
    assert result["proposed_patch"]["requires_confirmation"] is True
