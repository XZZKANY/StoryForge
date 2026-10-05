"""A paused Brief retains the sources it consumed, not later disk baselines."""

from __future__ import annotations

import json
from copy import deepcopy

import pytest
from agent_run_test_support import _seed_agent_run
from chapter_check_test_support import chapter_check_reply
from sqlalchemy import select
from test_continue_knowledge_recovery import knowledge_entry

from app.common.exceptions import ConflictError
from app.common.generation_sources import MAX_MANIFEST_BYTES
from app.domains.agent_runs.adapters import chapter_writing_pipeline
from app.domains.agent_runs.adapters.chapter_source_guard import (
    assert_chapter_sources,
    capture_chapter_sources,
    prepare_chapter_writing_context,
)
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.event_sink import _AgentRunEventSink
from app.domains.agent_runs.fs import render_knowledge_entry
from app.domains.agent_runs.llm_context import build_llm_context_snapshot, llm_context_snapshot_to_prompt_context_bundle
from app.domains.agent_runs.models import AgentArtifact
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.agent_runs.runtime_recovery import RUNTIME_PENDING_CALL_ARTIFACT_KIND
from app.domains.agent_runs.service import AgentRuntimeError, handle_agent_control_message
from app.domains.assistant import service as assistant_service
from app.domains.assistant.models import AssistantToolCall


def begin(session, project, target, bundle):
    run = _seed_agent_run(session, public_id="brief-source-run")
    run.permission_profile = "ask"
    session.commit()
    initial = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message={
            "intent": "chapter.write",
            "user_message": "写第一章，门锁只能由铜钥匙开启",
            "args": {"project_path": str(project), "file_path": str(target), "context_bundle": bundle},
        },
    )
    return run, initial


@pytest.mark.parametrize("root_mode", ["foreign", "missing"])
def test_brief_reads_only_the_admitted_project(session, tmp_path, monkeypatch, root_mode):
    project, foreign = tmp_path / "novel", tmp_path / "other"
    for root, content in [(project, "ADMITTED_A：门锁。"), (foreign, "FOREIGN_B：门锁。")]:
        root.mkdir()
        (root / "setting.txt").write_text(content, encoding="utf-8")
    target = project / "第001章.md"
    target.write_text("", encoding="utf-8")
    chats = []

    def chat(_session, *, user_message, context_block, assistant_session_id):
        chats.append(context_block)
        assert "ADMITTED_A" in context_block
        assert "FOREIGN_B" not in context_block
        return {"reply": '{"goal":"建立冲突"}'}

    monkeypatch.setattr(assistant_service, "chat_reply", chat)
    bundle = {"files": [{"relative_path": "setting.txt", "kind": "setting"}]}
    if root_mode == "foreign":
        bundle["project_root"] = str(foreign)
    _, initial = begin(session, project, target, bundle)
    assert initial["runtime_interruption"]["status"] == "paused" and len(chats) == 1
    assert target.read_text(encoding="utf-8") == ""


def test_brief_cannot_adopt_a_new_baseline_after_ordinary_collection(session, tmp_path, monkeypatch):
    source = tmp_path / "setting.txt"
    source.write_text("OLD_CONSUMED：铜钥匙。", encoding="utf-8")
    target = tmp_path / "第001章.md"
    target.write_text("", encoding="utf-8")
    original_projector = chapter_writing_pipeline.llm_context_snapshot_to_prompt_context_bundle
    chats = []

    def mutate_after_capture(snapshot):
        projected = original_projector(snapshot)
        assert "OLD_CONSUMED" in json.dumps(projected, ensure_ascii=False)
        source.write_text("NEW_BASELINE：银钥匙。", encoding="utf-8")
        return projected

    monkeypatch.setattr(chapter_writing_pipeline, "llm_context_snapshot_to_prompt_context_bundle", mutate_after_capture)
    monkeypatch.setattr(
        assistant_service, "chat_reply", lambda *_args, **kwargs: chats.append(kwargs) or {"reply": "{}"}
    )
    with pytest.raises(AgentOrchestrationError, match="来源"):
        begin(
            session,
            tmp_path,
            target,
            {"project_root": str(tmp_path), "files": [{"relative_path": "setting.txt", "kind": "setting"}]},
        )
    assert not chats and target.read_text(encoding="utf-8") == ""


@pytest.mark.parametrize("drift", ["none", "repair", "new_selection"])
def test_confirmed_brief_qualifies_original_knowledge_selection(session, tmp_path, monkeypatch, drift):
    materials = tmp_path / ".资料"
    materials.mkdir()
    original = knowledge_entry(title="写第一章的门锁规则")
    (materials / "原规则.md").write_text(render_knowledge_entry(original), encoding="utf-8")
    target = tmp_path / "第001章.md"
    target.write_text("", encoding="utf-8")
    chats, writers = [], []

    def chat(_session, *, user_message, context_block, assistant_session_id):
        chats.append(user_message)
        if "整理成 Chapter Brief" in user_message:
            assert original.claim in context_block
            return {"reply": '{"goal":"建立冲突"}'}
        findings = (
            [{"rule": "missing_required_beat", "severity": "hard", "message": "需修复", "line": 1, "evidence": "一"}]
            if drift == "repair" and len(chats) == 2
            else []
        )
        return chapter_check_reply(user_message, findings)

    def writer(_source, *, system_prompt, user_prompt):
        assert original.claim in user_prompt
        writers.append(user_prompt)
        return {"content": "一" * 1800 if len(writers) == 1 else "一" * 1799 + "二"}

    monkeypatch.setattr(assistant_service, "chat_reply", chat)
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", writer)
    run, initial = begin(session, tmp_path, target, {"project_root": str(tmp_path), "files": []})
    assert initial["runtime_interruption"]["status"] == "paused"
    if drift == "new_selection":
        (materials / "新规则.md").write_text(
            render_knowledge_entry(
                knowledge_entry(
                    id="pk_00000000-0000-4000-8000-000000000002",
                    title="写第一章门锁的新限制",
                    claim="写第一章门锁时，门后的人还没有离开。",
                )
            ),
            encoding="utf-8",
        )

    def resume():
        return handle_agent_control_message(
            session,
            public_id=run.public_id,
            session_id=run.session_id,
            control_type="resume_run",
            payload={"chapter_brief": initial["agent_result"]["chapter_brief"]},
        )

    if drift in {"none", "repair"}:
        control = resume()
        assert control.resumed_result is not None, control.resume_diagnostic
        assert control.resumed_result["proposed_patch"]["requires_confirmation"] is True
        assert len(writers) == (2 if drift == "repair" else 1)
        assert len(chats) == (3 if drift == "repair" else 2)
        pending = session.scalars(
            select(AgentArtifact).where(AgentArtifact.kind == RUNTIME_PENDING_CALL_ARTIFACT_KIND)
        ).one()
        draft = session.scalars(select(AssistantToolCall).where(AssistantToolCall.tool_name == "assistant.draft")).one()
        assert (
            draft.input_summary["generation_sources"]["context_delivery"]
            == pending.payload["source_guard"]["context"]["receipt"]
        )
        if drift == "repair":
            repair = session.scalars(
                select(AssistantToolCall).where(AssistantToolCall.tool_name == "assistant.revise")
            ).one()
            assert (
                repair.input_summary["generation_sources"]["context_delivery"]
                == pending.payload["source_guard"]["context"]["receipt"]
            )
    else:
        with pytest.raises(AgentRuntimeError, match="来源.*变化"):
            resume()
        assert not writers and len(chats) == 1
    assert target.read_text(encoding="utf-8") == ""


def frozen_guard(project):
    (project / "setting.txt").write_text("PIN_UNIQUE：门锁。", encoding="utf-8")
    target = project / "第001章.md"
    target.write_text("", encoding="utf-8")
    snapshot = build_llm_context_snapshot(
        run_state=None,
        intent="chapter.write",
        user_message="写第一章",
        file_path="第001章.md",
        content="",
        context_bundle={
            "project_root": str(project),
            "files": [{"relative_path": "setting.txt", "kind": "setting"}],
        },
    )
    bundle = llm_context_snapshot_to_prompt_context_bundle(snapshot)
    guard = capture_chapter_sources(str(project), str(target), bundle, snapshot=snapshot, user_message="写第一章")
    return target, bundle, guard


def test_paused_source_guard_is_metadata_and_rejects_projection_substitution(tmp_path):
    target, bundle, guard = frozen_guard(tmp_path)
    original = deepcopy(guard)
    assert "PIN_UNIQUE" not in json.dumps(guard, ensure_ascii=False)
    assert str(tmp_path) not in json.dumps(guard, ensure_ascii=False)
    safe = {**bundle, "project_root": "."}
    prepared = prepare_chapter_writing_context(
        str(tmp_path), str(target), safe, guard, content="", intent="file.create"
    )
    assert json.loads(prepared.context_receipt_json) == guard["context"]["receipt"]
    safe["files"][0]["excerpt"] = "FORGED_MATERIAL"
    with pytest.raises(ConflictError, match="资料投影"):
        prepare_chapter_writing_context(str(tmp_path), str(target), safe, guard, content="", intent="file.create")
    assert guard == original


@pytest.mark.parametrize("switch", ["project", "target"])
def test_same_contents_do_not_authorize_a_different_brief_identity(tmp_path, switch):
    project = tmp_path / "novel"
    project.mkdir()
    target, _, guard = frozen_guard(project)
    if switch == "project":
        project = tmp_path / "other"
        project.mkdir()
        target, _, _ = frozen_guard(project)
    else:
        target = project / "第002章.md"
        target.write_text("", encoding="utf-8")
    with pytest.raises(AgentOrchestrationError, match="来源.*变化"):
        assert_chapter_sources(str(project), str(target), guard)


@pytest.mark.parametrize("corruption", ["legacy", "context", "receipt", "manifest_hash", "budget"])
def test_brief_unknown_source_proof_requires_regeneration(tmp_path, corruption):
    target, _, guard = frozen_guard(tmp_path)
    if corruption == "legacy":
        guard["version"] = 1
    elif corruption == "context":
        del guard["context"]
    elif corruption == "receipt":
        guard["context"]["receipt"] = None
    elif corruption == "manifest_hash":
        guard["context"]["receipt"]["source_manifest_sha256"] = "f" * 64
    else:
        guard["opaque"] = "x" * MAX_MANIFEST_BYTES
    with pytest.raises(AgentOrchestrationError, match="来源"):
        assert_chapter_sources(str(tmp_path), str(target), guard)
