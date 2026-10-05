"""Automatic results must not become author pins when a writer refreshes its context."""

from __future__ import annotations

import json
from copy import deepcopy

import pytest
from sqlalchemy import select
from test_continue_knowledge_recovery import knowledge_entry

from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.fs import render_knowledge_entry, retrieve_project_knowledge
from app.domains.agent_runs.fs.knowledge_retrieval import KNOWLEDGE_RETRIEVAL_MAX_CHARS
from app.domains.agent_runs.llm_context import build_llm_context_snapshot
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.patches.writing_context import prepare_runtime_writing_context
from app.domains.agent_runs.tools import ToolExecutionContext, prose_continue_runtime
from app.domains.assistant import service as assistant_service
from app.domains.assistant.models import AssistantToolCall
from app.platform.ai_sdk import ChatResponse, ToolCall

MESSAGE = "接着写一段"
TARGET = "第04章.md"
OLD_NOTE = "OLD_AUTO_NOTES：这条旁注只属于原先入选的知识。"
NEW_MARKER = "NEW_RANK_WINNER："


def origin_project(root):
    materials = root / ".资料"
    materials.mkdir()
    (root / TARGET).write_text("他转动钥匙。", encoding="utf-8")
    old = knowledge_entry(title="接着写一段时的门锁规则", claim="旧规则：门锁由铜钥匙开启。" * 400)
    old_path = materials / "a.md"
    old_path.write_text(render_knowledge_entry(old) + "\n" + OLD_NOTE, encoding="utf-8")
    new = knowledge_entry(id="pk_00000000-0000-4000-8000-000000000099", title="ZXQ", claim="ABCXYZ")
    new_path = materials / "b.md"
    new_path.write_text(render_knowledge_entry(new), encoding="utf-8")
    return old, new_path


def promote_new_candidate(path):
    entry = knowledge_entry(
        id="pk_00000000-0000-4000-8000-000000000099",
        title=f"{MESSAGE} {TARGET}",
        claim=(NEW_MARKER + "门锁必须由银钥匙开启。" * KNOWLEDGE_RETRIEVAL_MAX_CHARS)[
            : KNOWLEDGE_RETRIEVAL_MAX_CHARS + 500
        ],
    )
    path.write_text(render_knowledge_entry(entry), encoding="utf-8")
    result = retrieve_project_knowledge(str(path.parent.parent), query=f"{MESSAGE}\n{TARGET}")
    assert result.total_chars == KNOWLEDGE_RETRIEVAL_MAX_CHARS
    assert [item.relative_path for item in result.items] == [".资料/b.md"]


def author_bundle(root):
    return {
        "project_root": str(root),
        "current_file": TARGET,
        "files": [
            {"relative_path": ".资料/a.md", "kind": "knowledge", "title": "作者固定的门锁规则"},
        ],
    }


@pytest.mark.parametrize("author_pin", [False, True])
@pytest.mark.parametrize("rerank", [False, True])
def test_actual_continue_keeps_selection_origin_and_reranks_before_writer(
    session, tmp_path, monkeypatch, author_pin, rerank
):
    _, candidate = origin_project(tmp_path)
    original = (tmp_path / TARGET).read_bytes()
    requests, writers, dispatches = [], [], []

    class Provider:
        def complete(self, request):
            requests.append(request)
            if len(requests) == 1:
                return ChatResponse("", (ToolCall("continue", "prose_continue", json.dumps({"path": TARGET})),))
            return ChatResponse("续写已保留为提案。")

    def before_dispatch(context, payload, *, intent):
        before = deepcopy(payload["llm_context_snapshot"])
        assert next(item for item in before["context_files"] if item.get("knowledge_id"))["selection_source"] == (
            "author_pinned" if author_pin else "auto_retrieved"
        )
        if rerank:
            promote_new_candidate(candidate)
        prepared = prepare_runtime_writing_context(context, payload, intent=intent)
        dispatches.append(payload["llm_context_snapshot"])
        return prepared

    def writer(_source, *, system_prompt, user_prompt):
        manifest = (
            session.scalars(select(AssistantToolCall).where(AssistantToolCall.tool_name == "assistant.continue"))
            .one()
            .input_summary["generation_sources"]
        )
        assert manifest["context_delivery"]["knowledge"]["pinned_paths"] == ([".资料/a.md"] if author_pin else [])
        writers.append(user_prompt)
        return {"content": "他把手收了回来。"}

    monkeypatch.setattr(prose_continue_runtime, "prepare_runtime_writing_context", before_dispatch)
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", writer)
    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda _source: Provider())
    args = {"project_path": str(tmp_path)}
    if author_pin:
        args["context_bundle"] = author_bundle(tmp_path)
    result = service.run_agent_user_message(
        session,
        agent_session_id="origin-session",
        message={
            "run_id": "origin-run",
            "user_message": MESSAGE,
            "intent": "chat.explain",
            "args": args,
        },
    )
    trace = next(item for item in result.result["tool_trace"] if item["tool_name"] == "prose.continue")
    assert trace["status"] == "completed", trace
    assert len(writers) == len(dispatches) == 1 and len(requests) == 2
    assert (NEW_MARKER in writers[0]) == (rerank and not author_pin)
    assert (OLD_NOTE in writers[0]) == (author_pin or not rerank)
    entries = trace["input_summary"]["context_provenance"]["knowledge_entries"]
    assert {item["selection_source"] for item in entries} == {"author_pinned" if author_pin else "auto_retrieved"}
    assert result.result["proposed_patch"]["requires_confirmation"] is True
    assert (tmp_path / TARGET).read_bytes() == original


@pytest.mark.parametrize("intent", ["prose.continue", "file.revise", "file.create", "chapter.polish"])
@pytest.mark.parametrize("author_pin", [False, True])
def test_derived_snapshot_preserves_origin_and_synthetic_channels(session, tmp_path, intent, author_pin):
    _, candidate = origin_project(tmp_path)
    previous = build_llm_context_snapshot(
        run_state=None,
        intent=intent,
        user_message=MESSAGE,
        file_path=TARGET,
        content="他转动钥匙。",
        context_bundle=author_bundle(tmp_path) if author_pin else {"project_root": str(tmp_path)},
    )
    previous["story_memory"] = {"items": [{"text": "作者已交接的记忆。"}]}
    previous["chapter_context"] = {"goal": "保持场景不跳时。"}
    before = deepcopy(previous)
    promote_new_candidate(candidate)
    run = AgentRun(public_id="origin-unit", session_id="origin-session", goal=MESSAGE, events=[], artifacts=[])
    context = ToolExecutionContext(session, run, "origin-session", 1, MESSAGE, {"project_path": str(tmp_path)})
    payload = {
        "file_path": str(tmp_path / TARGET),
        "content": "他转动钥匙。",
        "_trace_file_path": TARGET,
        "llm_context_snapshot": previous,
    }
    prepared = prepare_runtime_writing_context(context, payload, intent=intent)
    assert previous == before
    current = payload["llm_context_snapshot"]
    assert current["knowledge_recovery"]["pinned_paths"] == ([".资料/a.md"] if author_pin else [])
    assert {item["relative_path"] for item in current["context_files"]} == {
        ".资料/a.md" if author_pin else ".资料/b.md"
    }
    encoded = str(prepared.context_bundle)
    assert (NEW_MARKER in encoded) is not author_pin
    assert (OLD_NOTE in encoded) is author_pin
    assert "作者已交接的记忆。" in encoded and "保持场景不跳时。" in encoded
