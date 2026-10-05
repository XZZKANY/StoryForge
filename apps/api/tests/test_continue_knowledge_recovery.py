"""Actual continuation/resume must retain the knowledge version consumed by its writer."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from dataclasses import replace

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool
from test_continue_source_recovery import resume_in_fresh_process

from app.common.exceptions import ConflictError
from app.common.generation_sources import GenerationSourceCapture, selection_sha256
from app.db.base import Base
from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.fs import (
    KnowledgeEntry,
    KnowledgeSource,
    knowledge_claim_fingerprint,
    render_knowledge_entry,
    retrieve_project_knowledge,
)
from app.domains.agent_runs.fs.knowledge_retrieval import KNOWLEDGE_RETRIEVAL_MAX_CHARS
from app.domains.agent_runs.knowledge_context import collect_project_knowledge_context
from app.domains.agent_runs.llm_context import build_llm_context_snapshot, build_llm_context_snapshot_from_collected
from app.domains.agent_runs.loop.checkpoint_store import latest_checkpoint_artifact
from app.domains.agent_runs.loop.knowledge_recovery import knowledge_sources_unchanged
from app.domains.assistant import service as assistant_service
from app.domains.assistant.models import AssistantToolCall
from app.domains.assistant.schemas import AssistantContinueRequest
from app.domains.assistant.writing_context import admit_writing_request, writing_context_from_snapshot
from app.platform.ai_sdk import ChatResponse, ToolCall


def knowledge_entry(**changes):
    values = {
        "id": "pk_00000000-0000-4000-8000-000000000001",
        "status": "active",
        "kind": "world_rule",
        "evidence_state": "current",
        "title": "接着写一段时的门锁规则",
        "claim": "续写时门锁只能由铜钥匙开启，不允许踹门。",
        "sources": (KnowledgeSource(type="author_statement", agent_event_id="fixture-author-event"),),
        "created_at": "2026-10-05T00:00:00Z",
        "updated_at": "2026-10-05T00:00:00Z",
    }
    values.update(changes)
    values["claim_fingerprint"] = knowledge_claim_fingerprint(values["title"], values["claim"])
    return KnowledgeEntry(**values)


@pytest.mark.parametrize("drift", ["none", "claim", "retired", "evidence", "new_selection", "irrelevant"])
@pytest.mark.parametrize("timing", ["before_checkpoint", "after_checkpoint"])
@pytest.mark.parametrize("recovery_mode", ["reopen", "fresh_process"])
def test_public_resume_checks_auto_selected_knowledge(tmp_path, monkeypatch, drift, timing, recovery_mode):
    project = tmp_path / "novel"
    materials = project / ".资料"
    materials.mkdir(parents=True)
    current = project / "第04章.md"
    current.write_text("他转动钥匙。", encoding="utf-8")
    original = current.read_bytes()
    (project / "设定").mkdir()
    support = project / "设定/证据.txt"
    support.write_text("铜钥匙藏在盒底。", encoding="utf-8")
    entry = knowledge_entry(
        sources=(
            KnowledgeSource(
                type="project_file",
                path="设定/证据.txt",
                content_sha256="sha256:" + hashlib.sha256(support.read_bytes()).hexdigest(),
            ),
        )
    )
    if drift == "irrelevant":
        entry = replace(
            entry,
            title="接着写一段 第04章.md",
            claim_fingerprint=knowledge_claim_fingerprint("接着写一段 第04章.md", entry.claim),
        )
    selected = materials / "门锁.md"
    selected.write_text(render_knowledge_entry(entry), encoding="utf-8")
    if drift == "irrelevant":
        # Query includes '.md', which gives every Markdown candidate a positive
        # score. Fill the real selection budget with stronger matches instead
        # of incorrectly assuming a short unrelated claim cannot be selected.
        related = knowledge_entry(
            id="pk_00000000-0000-4000-8000-000000000002",
            title="门锁补充规则",
            claim=("接着写一段时门锁保持原来的开合方向。" * KNOWLEDGE_RETRIEVAL_MAX_CHARS)[
                : KNOWLEDGE_RETRIEVAL_MAX_CHARS + 500
            ],
        )
        (materials / "龟补充.md").write_text(render_knowledge_entry(related), encoding="utf-8")

    def mutate():
        if drift == "claim":
            selected.write_text(
                render_knowledge_entry(knowledge_entry(claim="续写时门锁只能由银钥匙开启。")), encoding="utf-8"
            )
        elif drift == "retired":
            selected.write_text(render_knowledge_entry(replace(entry, status="retired")), encoding="utf-8")
        elif drift == "evidence":
            support.write_text("铜钥匙已经落入河底。", encoding="utf-8")
        elif drift == "new_selection":
            (materials / "新增.md").write_text(
                render_knowledge_entry(
                    knowledge_entry(
                        id="pk_00000000-0000-4000-8000-000000000002",
                        title="接着写一段的额外约束",
                        claim="接着写一段时，门轴不会响。",
                    )
                ),
                encoding="utf-8",
            )
        elif drift == "irrelevant":
            (materials / "other.md").write_text(
                render_knowledge_entry(
                    knowledge_entry(
                        id="pk_00000000-0000-4000-8000-000000000999",
                        title="ZXQ",
                        claim="ABCXYZ",
                        kind="reference",
                    )
                ),
                encoding="utf-8",
            )
            result = retrieve_project_knowledge(
                str(project),
                query="接着写一段\n第04章.md",
                pinned_paths=[".资料/门锁.md", ".资料/龟补充.md"],
            )
            assert result.total_chars == KNOWLEDGE_RETRIEVAL_MAX_CHARS
            assert all(item.relative_path != ".资料/other.md" for item in result.items)

    requests, writers = [], []

    class Provider:
        def complete(self, request):
            requests.append(request)
            if len(requests) == 1:
                return ChatResponse("", (ToolCall("continue", "prose_continue", json.dumps({"path": "第04章.md"})),))
            return ChatResponse("续写提案已经保留。")

    def writer(_source, *, system_prompt, user_prompt):
        assert entry.claim in user_prompt
        writers.append(user_prompt)
        return {"content": "他握住门把手，停了一会儿。"}

    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'resume.sqlite3'}", poolclass=NullPool)
    Base.metadata.create_all(engine)

    def pause(event):
        if event.event_type == "tool_trace" and event.payload.get("trace", {}).get("tool_name") == "prose.continue":
            if timing == "before_checkpoint":
                mutate()
            with Session(engine) as controller:
                service.record_agent_control_event(
                    controller, public_id="source-run", session_id="source-session", control_type="pause_run"
                )

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", writer)
    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda _source: Provider())
    try:
        with Session(engine) as worker:
            initial = service.run_agent_user_message(
                worker,
                agent_session_id="source-session",
                message={
                    "run_id": "source-run",
                    "user_message": "接着写一段",
                    "intent": "chat.explain",
                    "args": {"project_path": str(project)},
                },
                on_event=pause,
            )
            assert initial.run.status == "paused"
            saved = latest_checkpoint_artifact(worker, initial.run).payload
            assert len(writers) == 1, saved["outcome"]["traces"]
            receipt = saved["sources"]["generation_receipts"][0]
            inner = worker.get(AssistantToolCall, receipt["reference"]["assistant_tool_call_id"])
            assert receipt["manifest"] == inner.input_summary["generation_sources"]
            # The named request file list is empty: this is genuine auto retrieval.
            assert "context_bundle" not in saved["resume_message"]["args"]
            assert len(writers) == len(requests) == 1
        engine.dispose()
        if timing == "after_checkpoint":
            mutate()
        if recovery_mode == "fresh_process":
            resumed, diagnostic, child_calls = resume_in_fresh_process(tmp_path / "resume.sqlite3")
        else:
            with Session(engine) as reopened:
                control = service.handle_agent_control_message(
                    reopened, public_id="source-run", session_id="source-session", control_type="resume_run"
                )
                resumed, diagnostic = control.resumed_result, control.resume_diagnostic
            child_calls = 0
        if drift in {"none", "irrelevant"}:
            assert resumed is not None, diagnostic
            assert resumed["proposed_patch"]["requires_confirmation"] is True
            assert len(requests) + child_calls == 2
        else:
            assert resumed is None, "auto knowledge drift reused a stale continuation"
            assert diagnostic["reason"] == "source_version_changed"
            assert len(requests) + child_calls == 1
        assert len(writers) == 1 and current.read_bytes() == original
        with Session(engine) as reopened:
            assert (
                len(
                    list(
                        reopened.scalars(
                            select(AssistantToolCall).where(AssistantToolCall.tool_name == "assistant.continue")
                        )
                    )
                )
                == 1
            )
    finally:
        engine.dispose()


def prepared_receipt(project, *, excluded=()):
    args = {
        "run_state": None,
        "intent": "prose.continue",
        "user_message": "接着写一段",
        "file_path": "第04章.md",
        "content": "他转动钥匙。",
        "context_bundle": {
            "project_root": str(project),
            "current_file": "第04章.md",
            "knowledge_exclusions": {"ids": list(excluded)},
        },
    }
    snapshot = build_llm_context_snapshot(**args)
    prepared = writing_context_from_snapshot(
        snapshot, project_root=str(project), file_path="第04章.md", content=args["content"], intent="prose.continue"
    )
    capture = GenerationSourceCapture(str(project), current_file="第04章.md")
    with capture.collecting():
        payload = admit_writing_request(
            AssistantContinueRequest(
                project_root=str(project), file_path="第04章.md", content=args["content"], cursor_line=1
            ),
            intent="prose.continue",
            prepared_context=prepared,
        )
    return args, snapshot, prepared, payload, capture.manifest("system", "user")


def test_empty_selection_is_proven_and_new_relevant_entry_invalidates_it(tmp_path):
    (tmp_path / "第04章.md").write_text("他转动钥匙。", encoding="utf-8")
    args, _, _, _, manifest = prepared_receipt(tmp_path)
    assert knowledge_sources_unchanged(manifest, tmp_path.resolve(), user_message=args["user_message"])
    materials = tmp_path / ".资料"
    materials.mkdir()
    (materials / "门锁.md").write_text(render_knowledge_entry(knowledge_entry()), encoding="utf-8")
    assert not knowledge_sources_unchanged(manifest, tmp_path.resolve(), user_message=args["user_message"])


def test_excluded_knowledge_stays_out_of_recovery_selection(tmp_path):
    materials = tmp_path / ".资料"
    materials.mkdir()
    (tmp_path / "第04章.md").write_text("他转动钥匙。", encoding="utf-8")
    entry = knowledge_entry()
    path = materials / "门锁.md"
    path.write_text(render_knowledge_entry(entry), encoding="utf-8")
    args, _, _, payload, manifest = prepared_receipt(tmp_path, excluded=[entry.id])
    assert entry.claim not in str(payload.context_bundle)
    path.write_text(render_knowledge_entry(knowledge_entry(claim="接着写一段时必须保持门关着。")), encoding="utf-8")
    assert knowledge_sources_unchanged(manifest, tmp_path.resolve(), user_message=args["user_message"])


@pytest.mark.parametrize("corruption", ["missing_receipt", "missing_knowledge", "query", "selection", "oversized_pins"])
def test_knowledge_recovery_does_not_bless_missing_or_corrupt_proof(tmp_path, corruption):
    (tmp_path / "第04章.md").write_text("他转动钥匙。", encoding="utf-8")
    args, _, _, _, manifest = prepared_receipt(tmp_path)
    receipt = manifest["context_delivery"]
    if corruption == "missing_receipt":
        manifest.pop("context_delivery")
    elif corruption == "missing_knowledge":
        receipt.pop("knowledge")
    elif corruption == "query":
        receipt["knowledge"]["query_sha256"] = "0" * 64
    elif corruption == "selection":
        receipt["knowledge"]["selection_sha256"] = "0" * 64
    else:
        receipt["knowledge"]["pinned_paths"] = ["设定/未知.md"] * 100
    assert not knowledge_sources_unchanged(manifest, tmp_path.resolve(), user_message=args["user_message"])


def test_prepared_receipt_is_frozen_detached_and_binds_actual_final_files(tmp_path):
    materials = tmp_path / ".资料"
    materials.mkdir()
    (tmp_path / "第04章.md").write_text("他转动钥匙。", encoding="utf-8")
    entry = knowledge_entry()
    (materials / "门锁.md").write_text(render_knowledge_entry(entry), encoding="utf-8")
    _, snapshot, prepared, payload, manifest = prepared_receipt(tmp_path)
    assert entry.claim in str(payload.context_bundle)
    receipt = manifest["context_delivery"]
    assert receipt["prompt_files_sha256"] == selection_sha256(
        [item.model_dump() for item in payload.context_bundle.files]
    )
    encoded = json.dumps(receipt, ensure_ascii=False)
    assert entry.claim not in encoded and entry.title not in encoded and str(tmp_path) not in encoded
    original = prepared.context_receipt_json
    snapshot["knowledge_recovery"]["selection_sha256"] = "changed"
    receipt["knowledge"]["pinned_paths"].append("changed.md")
    assert prepared.context_receipt_json == original
    forged_bundle = prepared.context_bundle
    forged_bundle.files[0].excerpt = "不属于已准备的来源"
    forged = replace(prepared, bundle_json=forged_bundle.model_dump_json())
    with pytest.raises(ConflictError, match="送达版本不匹配"):
        admit_writing_request(payload, intent="prose.continue", prepared_context=forged)


def test_collected_knowledge_replay_is_pure_and_keeps_original_selection(tmp_path, monkeypatch):
    materials = tmp_path / ".资料"
    materials.mkdir()
    path = materials / "门锁.md"
    path.write_text(render_knowledge_entry(knowledge_entry()), encoding="utf-8")
    bundle = {"project_root": str(tmp_path), "current_file": "第04章.md"}
    collected = collect_project_knowledge_context(bundle, context_files=[], query="接着写一段\n第04章.md")
    expected = collected.recovery_json
    path.write_text(render_knowledge_entry(replace(knowledge_entry(), status="retired")), encoding="utf-8")
    from pathlib import Path

    def forbidden(*_args, **_kwargs):
        raise AssertionError("pure replay touched the filesystem")

    monkeypatch.setattr(Path, "open", forbidden)
    replayed = build_llm_context_snapshot_from_collected(
        knowledge=collected,
        run_state=None,
        intent="prose.continue",
        user_message="接着写一段",
        file_path="第04章.md",
        content="他转动钥匙。",
        context_bundle=bundle,
    )
    assert replayed["knowledge_recovery"] == json.loads(expected)
    assert knowledge_entry().claim in str(replayed["context_files"])
    clone = deepcopy(replayed)
    clone["knowledge_recovery"]["selection_sha256"] = "changed"
    assert collected.recovery_json == expected
