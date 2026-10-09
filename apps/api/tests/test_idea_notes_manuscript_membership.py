"""The application's root idea-note document is not a manuscript chapter."""

from __future__ import annotations

import json
from pathlib import Path

from agent_canon_test_support import _write_canon

from app.domains.agent_runs.canon_rebuild import chapter_ordinals
from app.domains.agent_runs.promise_scan import promise_check
from app.domains.assistant import service
from app.domains.assistant.schemas import AssistantDraftRequest


def _created_project(root: Path) -> None:
    # createNewBookProject creates these files before any manuscript exists.
    (root / "大纲").mkdir()
    (root / "大纲/项目说明.md").write_text("# 项目说明\n- 正文：存放章节正文。")
    (root / "灵感.md").write_text("# 灵感\n\nIDEA_NOTE：她误以为铜钥匙属于自己。\n")
    (root / ".storyforge").mkdir()
    (root / ".storyforge/book.json").write_text(json.dumps({"version": 1, "synopsis": "她误以为铜钥匙属于自己。"}))
    _write_canon(root, {"version": 1, "entities": [], "invariants": {}})


def test_new_book_has_zero_chapters_until_a_manuscript_is_written(tmp_path):
    _created_project(tmp_path)
    assert chapter_ordinals(str(tmp_path), "*.md") == {}
    assert promise_check(str(tmp_path))["current_chapter"] == 0


def test_actual_root_chapter_draft_keeps_chapter_one_window(session, tmp_path, monkeypatch):
    _created_project(tmp_path)
    _write_canon(
        tmp_path,
        {
            "version": 1,
            "entities": [],
            "invariants": {
                "single_holder": [
                    {"item": "铜钥匙", "holder": "CHAPTER_ONE_OWNER", "from_chapter": 1, "to_chapter": 1},
                    {"item": "铜钥匙", "holder": "LATER_OWNER", "from_chapter": 2},
                ]
            },
        },
    )
    calls = []
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {})

    def writer(_source, *, system_prompt, user_prompt):
        calls.append({"system": system_prompt, "user": user_prompt})
        return {"content": "第一章正文。"}

    monkeypatch.setattr(service, "_call_llm_streamed", writer)
    target = tmp_path / "第001章.md"
    service.draft_file_content(
        session, AssistantDraftRequest(file_path=str(target), project_root=str(tmp_path), instruction="写第一章。")
    )
    assert len(calls) == 1
    assert "CHAPTER_ONE_OWNER" in calls[0]["user"]
    assert "LATER_OWNER" not in calls[0]["user"]
    assert not target.exists()


def test_reserved_root_note_does_not_reclassify_other_manuscripts(tmp_path):
    from app.common.manuscript import is_manuscript_path, iter_manuscript_files, previous_chapter_tail

    _created_project(tmp_path)
    for relative in ["第001章.md", "README.md", "worldnotes.md", "未知卷/第001章.md", "正文/灵感.md"]:
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("普通根文件与嵌套同名稿件保持既有行为。")
        assert is_manuscript_path(relative)
    assert not is_manuscript_path("灵感.md")
    assert "灵感.md" not in chapter_ordinals(str(tmp_path), "*.md")
    assert "灵感.md" not in {p.relative_to(tmp_path).as_posix() for p in iter_manuscript_files(tmp_path)}
    assert previous_chapter_tail(str(tmp_path), str(tmp_path / "灵感.md")) is None


def test_idea_notes_remain_visible_readable_and_searchable(tmp_path):
    from app.domains.agent_runs import fs_tools

    _created_project(tmp_path)
    original = (tmp_path / "灵感.md").read_bytes()
    assert "灵感.md" in {item["path"] for item in fs_tools.fs_list(str(tmp_path))["entries"]}
    assert "IDEA_NOTE" in fs_tools.fs_read(str(tmp_path), "灵感.md")["content"]
    assert any(item["path"] == "灵感.md" for item in fs_tools.fs_search(str(tmp_path), "IDEA_NOTE")["matches"])
    assert (tmp_path / "灵感.md").read_bytes() == original


def test_explicit_idea_note_context_is_still_delivered_to_actual_writer(client, tmp_path, monkeypatch):
    _created_project(tmp_path)
    target = tmp_path / "第001章.md"
    target.write_text("第一章当前正文。")
    note = tmp_path / "灵感.md"
    original = note.read_bytes()
    calls = []
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "controlled-fixture")
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "controlled-fixture"})

    def streamed(_source, payload, **_kwargs):
        calls.append(payload["messages"])
        yield {"type": "delta", "text": "新的段落。"}
        yield {"type": "done", "content": "新的段落。", "latency_ms": 0}

    monkeypatch.setattr(service, "stream_chat_completions", streamed)
    response = client.post(
        "/api/assistant/continue",
        json={
            "file_path": str(target),
            "project_root": str(tmp_path),
            "content": target.read_text(),
            "cursor_line": 1,
            "context_bundle": {
                "project_root": str(tmp_path),
                "current_file": str(target),
                "files": [
                    {
                        "path": str(note),
                        "relative_path": "灵感.md",
                        "kind": "other",
                        "title": "灵感.md",
                        "excerpt": note.read_text(),
                    }
                ],
            },
        },
    )
    assert response.status_code == 200, response.text
    assert len(calls) == 1
    prompt = calls[0][-1]["content"]
    assert "IDEA_NOTE" in prompt
    assert "上一章（灵感.md）" not in prompt
    assert note.read_bytes() == original
    assert target.read_text() == "第一章当前正文。"
