"""Chapter path identity and creation-order context must agree before/after placeholders."""

from __future__ import annotations

import pytest
from agent_canon_test_support import _write_canon

from app.domains.agent_runs import canon_context
from app.domains.assistant import service
from app.domains.assistant.schemas import AssistantDraftRequest


def project_with_windows(root):
    first = root / "卷一"
    second = root / "卷二"
    first.mkdir()
    second.mkdir()
    (first / "第001章.md").write_text("第一章已写。")
    (first / "第002章.md").write_text("第二章已写。")
    _write_canon(
        root,
        {
            "version": 1,
            "entities": [],
            "invariants": {
                "single_holder": [
                    {"item": "铜钥匙", "holder": "EARLY_OWNER", "from_chapter": 1, "to_chapter": 2},
                    {"item": "铜钥匙", "holder": "LATE_OWNER", "from_chapter": 3},
                ]
            },
        },
    )
    return second / "第001章.md"


def test_unwritten_same_basename_chapter_uses_same_window_as_created_placeholder(tmp_path):
    target = project_with_windows(tmp_path)
    before = canon_context.build_scene_constraint_block(str(tmp_path), str(target))
    target.write_text("")
    after = canon_context.build_scene_constraint_block(str(tmp_path), str(target))
    assert "LATE_OWNER" in before and "EARLY_OWNER" not in before
    assert before == after


@pytest.mark.parametrize("spelling", ["relative", "backslash", "absolute"])
def test_existing_target_relative_and_absolute_paths_select_identical_context(tmp_path, spelling):
    target = project_with_windows(tmp_path)
    target.write_text("第三章正文。")
    relative = target.relative_to(tmp_path).as_posix()
    path = {"relative": relative, "backslash": relative.replace("/", "\\"), "absolute": str(target)}[spelling]
    block = canon_context.build_scene_constraint_block(str(tmp_path), path)
    assert "LATE_OWNER" in block and "EARLY_OWNER" not in block
    assert "本文件 = 第 3 章" in block


@pytest.mark.parametrize("existing", [False, True])
def test_actual_draft_provider_gets_correct_same_basename_window(session, tmp_path, monkeypatch, existing):
    target = project_with_windows(tmp_path)
    if existing:
        target.write_text("")
    calls = []
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {})

    def writer(_source, *, system_prompt, user_prompt):
        calls.append(user_prompt)
        return {"content": "新章正文。"}

    monkeypatch.setattr(service, "_call_llm_streamed", writer)
    service.draft_file_content(
        session,
        AssistantDraftRequest(
            file_path=str(target), project_root=str(tmp_path), instruction="写下一章，遵守本章铜钥匙的持有人。"
        ),
    )
    assert len(calls) == 1
    assert "LATE_OWNER" in calls[0] and "EARLY_OWNER" not in calls[0]
    assert not target.exists() or target.read_text() == ""


def test_actual_continue_http_relative_path_does_not_fall_back_to_all_chapter_windows(client, tmp_path, monkeypatch):
    target = project_with_windows(tmp_path)
    target.write_text("第三章正文。")
    calls = []
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "controlled-fixture")
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "controlled-fixture"})

    def streamed(_source, payload, **_kwargs):
        calls.append(payload["messages"])
        yield {"type": "delta", "text": "续写正文。"}
        yield {"type": "done", "content": "续写正文。", "latency_ms": 0}

    monkeypatch.setattr(service, "stream_chat_completions", streamed)
    response = client.post(
        "/api/assistant/continue",
        json={
            "file_path": target.relative_to(tmp_path).as_posix(),
            "project_root": str(tmp_path),
            "content": target.read_text(),
            "cursor_line": 1,
            "instruction": "接着写。",
        },
    )
    assert response.status_code == 200, response.text
    assert len(calls) == 1
    prompt = calls[0][-1]["content"]
    assert "LATE_OWNER" in prompt and "EARLY_OWNER" not in prompt
    assert "本文件 = 第 3 章" in prompt
    assert target.read_text() == "第三章正文。"


def test_renamed_chapter_uses_current_global_order_and_same_basename_stays_distinct(tmp_path):
    target = project_with_windows(tmp_path)
    target.write_text("卷二当前正文。")
    block = canon_context.build_scene_constraint_block(str(tmp_path), str(target))
    assert "本文件 = 第 3 章" in block and "LATE_OWNER" in block
    moved = tmp_path / "000_序章" / target.name
    moved.parent.mkdir()
    target.rename(moved)
    after = canon_context.build_scene_constraint_block(str(tmp_path), moved.relative_to(tmp_path).as_posix())
    assert "本文件 = 第 1 章" in after and "EARLY_OWNER" in after and "LATE_OWNER" not in after
    other = tmp_path / "卷一/第002章.md"
    other_block = canon_context.build_scene_constraint_block(str(tmp_path), str(other))
    assert "本文件 = 第 3 章" in other_block and "LATE_OWNER" in other_block
    assert moved.read_text() == "卷二当前正文。"
    assert other.read_text() == "第二章已写。"


@pytest.mark.parametrize("mode", ["renamed", "same_basename"])
def test_live_continue_does_not_reuse_a_cursor_from_another_chapter_after_rename(client, tmp_path, monkeypatch, mode):
    import json

    from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script
    from agent_transport import stream_agent_message

    from app.common.manuscript import previous_chapter_tail

    first = tmp_path / "甲卷"
    second = tmp_path / "乙卷"
    first.mkdir()
    second.mkdir()
    old = first / "第001章.md"
    target = second / "第001章.md"
    old.write_text("旧章开头。\n旧章中段。\n旧章后文。")
    if mode == "renamed":
        old.rename(target)
    else:
        target.write_text("目标开头。\n目标中段。\n目标后文。")
    original = target.read_bytes()
    _enable_loop_env(monkeypatch)
    calls = []

    def writer(_source, **kwargs):
        calls.append(kwargs)
        return {"content": "新的续写段。", "latency_ms": 0}

    monkeypatch.setattr(service, "_call_llm_streamed", writer)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "continue",
                        "type": "function",
                        "function": {
                            "name": "prose_continue",
                            "arguments": json.dumps({"path": target.relative_to(tmp_path).as_posix()}),
                        },
                    }
                ],
            },
            {"content": "续写提案已生成，等待确认。", "tool_calls": []},
        ],
    )
    frames = stream_agent_message(
        client,
        "identity-session",
        run_id="identity-" + mode,
        user_message="请续写指定目标章节。",
        permission_profile="ask",
        args={
            "project_path": str(tmp_path),
            "author_view": {"file_path": str(old), "cursor_line": 1},
            "context_bundle": {"files": []},
        },
    )
    result = frames[-1]
    assert result["type"] == "agent_result", result
    patch = result["proposed_patch"]
    assert patch["file_path"] == str(target)
    assert patch["before"] == original.decode()
    assert patch["continue_audit"]["anchor_line"] == 3
    assert patch["after"].startswith(original.decode()) and patch["after"].endswith("新的续写段。")
    assert patch["requires_confirmation"] is True
    assert len(calls) == 1 and target.read_bytes() == original
    if mode == "same_basename":
        assert old.read_text() == "旧章开头。\n旧章中段。\n旧章后文。"
    else:
        assert not old.exists()
    predecessor = previous_chapter_tail(str(tmp_path), str(target))
    if predecessor is not None:
        assert predecessor[0] != target.relative_to(tmp_path).as_posix()
