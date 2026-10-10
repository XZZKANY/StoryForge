"""Consumed ordinary context must survive restart with its original source version."""

from __future__ import annotations

import json
from copy import deepcopy

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool
from test_continue_source_recovery import resume_in_fresh_process

from app.common.generation_sources import GenerationSourceCapture, selection_sha256
from app.db.base import Base
from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.llm_context import build_llm_context_snapshot
from app.domains.agent_runs.loop import ordinary_recovery
from app.domains.agent_runs.loop.checkpoint_store import latest_checkpoint_artifact
from app.domains.agent_runs.loop.ordinary_recovery import ordinary_sources_unchanged
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantContinueRequest
from app.domains.assistant.writing_context import admit_writing_request, writing_context_from_snapshot
from app.platform.ai_sdk import ChatResponse, ToolCall


@pytest.mark.parametrize("drift", ["none", "changed", "deleted", "tail", "irrelevant"])
@pytest.mark.parametrize("timing", ["before_checkpoint", "after_checkpoint"])
@pytest.mark.parametrize("recovery_mode", ["reopen", "fresh_process"])
def test_resume_checks_no_excerpt_ordinary_source(tmp_path, monkeypatch, drift, timing, recovery_mode):
    project = tmp_path / "novel"
    (project / "设定").mkdir(parents=True)
    chapter = project / "第04章.md"
    chapter.write_text("他转动钥匙。", encoding="utf-8")
    original = chapter.read_bytes()
    material = project / "设定/门锁.txt"
    material.write_text("ORDINARY_CONSUMED：铜钥匙开启门锁。" + "铜锁。" * 1500, encoding="utf-8")
    requests, writers = [], []

    def mutate():
        if drift == "changed":
            material.write_text("钥匙已损坏。", encoding="utf-8")
        elif drift == "deleted":
            material.unlink()
        elif drift == "tail":
            # The reader consumed the full source although the prompt has a cap.
            material.write_text(material.read_text(encoding="utf-8") + "尾部版本变化。", encoding="utf-8")
        elif drift == "irrelevant":
            (project / "设定/无关.txt").write_text("无关资料变化。", encoding="utf-8")

    class Provider:
        def complete(self, request):
            requests.append(request)
            if len(requests) == 1:
                return ChatResponse("", (ToolCall("continue", "prose_continue", json.dumps({"path": "第04章.md"})),))
            return ChatResponse("续写提案已经保留。")

    def writer(_source, *, system_prompt, user_prompt):
        assert "ORDINARY_CONSUMED" in user_prompt
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

    monkeypatch.setattr(assistant_service, "missing_llm_env", lambda: [])
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
                    "args": {
                        "project_path": str(project),
                        "context_bundle": {
                            "project_root": str(project),
                            "current_file": "第04章.md",
                            # No excerpt: old raw-bundle guard never tracked this read.
                            "files": [{"relative_path": "设定/门锁.txt", "kind": "setting"}],
                        },
                    },
                },
                on_event=pause,
            )
            assert initial.run.status == "paused"
            saved = latest_checkpoint_artifact(worker, initial.run).payload
            assert len(writers) == len(requests) == 1, saved["outcome"]["traces"]
            assert "设定/门锁.txt" not in saved["sources"]["files"]
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
            assert resumed is None, "changed ordinary writer source reused a stale continuation"
            assert diagnostic["reason"] == "source_version_changed"
            assert len(requests) + child_calls == 1
        assert len(writers) == 1 and chapter.read_bytes() == original
    finally:
        engine.dispose()


def captured_context(project, files):
    snapshot = build_llm_context_snapshot(
        run_state=None,
        intent="prose.continue",
        user_message="续写",
        file_path="第04章.md",
        content="他转动钥匙。",
        context_bundle={"project_root": str(project), "current_file": "第04章.md", "files": files},
    )
    prepared = writing_context_from_snapshot(
        snapshot, project_root=str(project), file_path="第04章.md", content="他转动钥匙。", intent="prose.continue"
    )
    capture = GenerationSourceCapture(str(project), current_file="第04章.md")
    with capture.collecting():
        admit_writing_request(
            AssistantContinueRequest(project_root=str(project), file_path="第04章.md", content="他转动钥匙。"),
            intent="prose.continue",
            prepared_context=prepared,
        )
    return snapshot, capture.manifest("system", "user")


@pytest.mark.parametrize("initial", ["missing", "empty", "unadmitted"])
def test_ordinary_omission_is_not_a_proven_empty_selection(tmp_path, initial):
    source = tmp_path / "setting.txt"
    if initial == "empty":
        source.write_text(" \n", encoding="utf-8")
    elif initial == "unadmitted":
        source.write_text("<!-- storyforge-knowledge:v1", encoding="utf-8")
    _, manifest = captured_context(tmp_path, [{"relative_path": "setting.txt", "kind": "setting"}])
    refs = manifest["context_delivery"]["source_manifest"]
    assert len(refs) == 1 and refs[0]["disposition"] == "omitted"
    assert ordinary_sources_unchanged(manifest, tmp_path.resolve())
    source.write_text("门只能用铜钥匙开启。", encoding="utf-8")
    assert not ordinary_sources_unchanged(manifest, tmp_path.resolve())


def test_context_receipt_is_detached_metadata_and_does_not_adopt_new_disk(tmp_path):
    source = tmp_path / "setting.txt"
    source.write_text("ORDINARY_SECRETLESS_SOURCE", encoding="utf-8")
    snapshot, manifest = captured_context(tmp_path, [{"relative_path": "setting.txt", "kind": "setting"}])
    saved = deepcopy(manifest)
    assert manifest["context_delivery"]["source_manifest"] == snapshot["source_manifest"]
    assert "ORDINARY_SECRETLESS_SOURCE" not in json.dumps(manifest)
    assert str(tmp_path) not in json.dumps(manifest)
    snapshot["source_manifest"][0]["relative_path"] = "fake.txt"
    source.write_text("changed", encoding="utf-8")
    assert manifest == saved
    assert not ordinary_sources_unchanged(manifest, tmp_path.resolve())


@pytest.mark.parametrize("corruption", ["missing", "null", "hash", "row", "unknown_state"])
def test_unknown_ordinary_proof_fails_closed(tmp_path, corruption):
    (tmp_path / "setting.txt").write_text("门锁。", encoding="utf-8")
    _, manifest = captured_context(tmp_path, [{"relative_path": "setting.txt", "kind": "setting"}])
    receipt = manifest["context_delivery"]
    if corruption == "missing":
        del receipt["source_manifest"]
    elif corruption == "null":
        receipt["source_manifest"] = None
    elif corruption == "hash":
        receipt["source_manifest_sha256"] = "f" * 64
    elif corruption == "row":
        receipt["source_manifest"] = [None]
        receipt["source_manifest_sha256"] = selection_sha256([None])
    else:
        receipt["source_manifest"][0]["source_state"] = "invented"
        receipt["source_manifest_sha256"] = selection_sha256(receipt["source_manifest"])
    assert not ordinary_sources_unchanged(manifest, tmp_path.resolve())


def test_selection_budget_omission_does_not_open_an_unconsumed_file(tmp_path, monkeypatch):
    files = [{"relative_path": f"source{index}.txt", "kind": "setting"} for index in range(9)]
    for file in files:
        (tmp_path / file["relative_path"]).write_text("门锁。", encoding="utf-8")
    _, manifest = captured_context(tmp_path, files)
    refs = manifest["context_delivery"]["source_manifest"]
    omitted = [ref for ref in refs if ref.get("omission_reason") == "selection_budget"]
    assert len(omitted) == 1
    (tmp_path / omitted[0]["relative_path"]).unlink()
    real_collect = ordinary_recovery.collect_ordinary_context
    reads = []

    def observed_collect(root, *, context_files):
        reads.extend(item["relative_path"] for item in context_files)
        return real_collect(root, context_files=context_files)

    monkeypatch.setattr(ordinary_recovery, "collect_ordinary_context", observed_collect)
    assert ordinary_sources_unchanged(manifest, tmp_path.resolve())
    assert len(reads) == 8 and omitted[0]["relative_path"] not in reads


@pytest.mark.parametrize("path_kind", ["relative_escape", "absolute_escape"])
def test_ordinary_replay_retains_project_read_boundary(tmp_path, path_kind):
    project = tmp_path / "novel"
    project.mkdir()
    (project / "setting.txt").write_text("门锁。", encoding="utf-8")
    outside = tmp_path / "outside.txt"
    outside.write_text("门锁。", encoding="utf-8")
    _, manifest = captured_context(project, [{"relative_path": "setting.txt", "kind": "setting"}])
    receipt = manifest["context_delivery"]
    receipt["source_manifest"][0]["relative_path"] = (
        "../outside.txt" if path_kind == "relative_escape" else str(outside)
    )
    receipt["source_manifest_sha256"] = selection_sha256(receipt["source_manifest"])
    assert not ordinary_sources_unchanged(manifest, project.resolve())
