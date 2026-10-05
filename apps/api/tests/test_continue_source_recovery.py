"""Recover a real continuation only while its independently consumed sources still match."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.common import generation_sources
from app.common.generation_delivery import generation_delivery_reference
from app.common.manuscript import previous_chapter_tail
from app.db.base import Base
from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.canon_context import build_scene_constraint_block
from app.domains.agent_runs.loop.checkpoint_store import latest_checkpoint_artifact
from app.domains.agent_runs.loop.generation_recovery import (
    checkpoint_generation_receipts,
    generation_outcome_covered,
    generation_sources_unchanged,
)
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.models import AssistantToolCall
from app.domains.assistant.schemas import (
    AssistantContinueRequest,
    AssistantSessionCreate,
    AssistantToolCallCreate,
)
from app.platform.ai_sdk import ChatResponse, ToolCall


@pytest.mark.parametrize("drift", ["none", "canon", "hooks", "previous", "style", "new_chapter"])
@pytest.mark.parametrize("timing", ["after_checkpoint", "before_checkpoint"])
@pytest.mark.parametrize("recovery_mode", ["reopen", "fresh_process"])
def test_reopened_resume_rejects_independent_continuation_source_drift(
    tmp_path, monkeypatch, drift, timing, recovery_mode
):
    project = tmp_path / "novel"
    project.mkdir()
    settings = project / ".storyforge"
    (settings / "canon").mkdir(parents=True)
    (settings / "agent-instructions.md").write_text("保持限知视角，不要写总结。", encoding="utf-8")
    canon_file = settings / "canon/canon.json"
    canon_file.write_text(
        json.dumps(
            {
                "version": 1,
                "entities": [],
                "invariants": {
                    "single_holder": [
                        {"item": "钥匙", "holder": "林岚", "from_chapter": 1},
                    ]
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    hooks_file = settings / "canon/hooks.json"
    hooks_file.write_text(
        json.dumps(
            {
                "version": 1,
                "hooks": [
                    {"id": "h1", "description": "门后留下两道痕迹", "status": "active"},
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    chapters = []
    for index in range(1, 5):
        chapter = project / f"第{index:02d}章.md"
        chapter.write_text("他把灯芯捻短了一寸。" * 60, encoding="utf-8")
        chapters.append(chapter)
    original = chapters[-1].read_bytes()
    original_previous_sha = hashlib.sha256(chapters[-2].read_bytes()).hexdigest()
    original_canon_sha = hashlib.sha256(canon_file.read_bytes()).hexdigest()
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'resume.sqlite3'}", poolclass=NullPool)
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(connection)
    requests, writers = [], []

    def mutate():
        if drift == "canon":
            canon_file.write_text(canon_file.read_text(encoding="utf-8").replace("林岚", "陈默"), encoding="utf-8")
        elif drift == "hooks":
            hooks_file.write_text(hooks_file.read_text(encoding="utf-8").replace("两道", "三道"), encoding="utf-8")
        elif drift == "previous":
            chapters[-2].write_text("PREVIOUS_CHANGED：门后是一片雪原。", encoding="utf-8")
        elif drift == "style":
            chapters[0].write_text("STYLE_CHANGED：他没有回头。" * 80, encoding="utf-8")
        elif drift == "new_chapter":
            (project / "第03章续.md").write_text("NEW_PREVIOUS：门内已经有人。", encoding="utf-8")

    class Provider:
        def complete(self, request):
            requests.append(request)
            if len(requests) == 1:
                return ChatResponse(
                    "", tool_calls=(ToolCall("continue", "prose_continue", '{"path":"第04章.md","anchor_line":1}'),)
                )
            return ChatResponse("续写提案已经保留。")

    def writer(_source, *, system_prompt, user_prompt):
        writers.append((system_prompt, user_prompt))
        return {"content": "他握紧钥匙，朝门边挪了一步。"}

    def pause_after_tool(event):
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
    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
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
                on_event=pause_after_tool,
            )
            assert initial.run.status == "paused"
            run_id = initial.run.id
            saved = latest_checkpoint_artifact(worker, initial.run).payload
            assert saved["outcome"]["proposed_patch"] is not None
            receipt = saved["sources"]["generation_receipts"][0]
            manifest = receipt["manifest"]
            assert manifest["writing_context"]["current_file"] == "第04章.md"
            assert {item["purpose"] for item in manifest["selections"]} == {"previous_chapter", "canon_chapter_order"}
            assert (
                next(s for s in manifest["sources"] if s["purpose"] == "previous_chapter")["file_bytes_sha256"]
                == original_previous_sha
            )
            assert (
                next(s for s in manifest["sources"] if s["purpose"] == "canon_declaration")["file_bytes_sha256"]
                == original_canon_sha
            )
            assert len(writers) == 1 and len(requests) == 1
        engine.dispose()
        if timing == "after_checkpoint":
            mutate()
        if recovery_mode == "fresh_process":
            resumed, diagnostic, child_calls = resume_in_fresh_process(tmp_path / "resume.sqlite3")
            model_calls = len(requests) + child_calls
        else:
            with Session(engine) as restarted:
                control = service.handle_agent_control_message(
                    restarted, public_id="source-run", session_id="source-session", control_type="resume_run"
                )
                resumed, diagnostic = control.resumed_result, control.resume_diagnostic
            model_calls = len(requests)
        with Session(engine) as restarted:
            if drift == "none":
                assert resumed is not None, diagnostic
                assert resumed["proposed_patch"]["kind"] == "prose_continue"
                assert resumed["proposed_patch"]["requires_confirmation"] is True
                assert model_calls == 2 and len(writers) == 1
            else:
                assert resumed is None, "independent source drift reused a stale continuation"
                assert diagnostic["reason"] == "source_version_changed"
                assert diagnostic["can_resume"] is False
                assert model_calls == 1 and len(writers) == 1
            assert chapters[-1].read_bytes() == original
            assert service.get_agent_run(restarted, "source-run").id == run_id
    finally:
        engine.dispose()


def resume_in_fresh_process(database):
    cold = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import json,sys
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app import models
from app.domains.agent_runs import loop_runtime, service
from app.domains.assistant import service as assistant_service
from app.platform.ai_sdk import ChatResponse
calls=[]
class Provider:
    def complete(self, request):
        calls.append('provider')
        return ChatResponse('续写提案已经保留。')
def forbid_writer(*args, **kwargs):
    raise AssertionError('completed continuation was regenerated')
assistant_service.missing_book_generation_env=lambda: []
assistant_service.resolved_llm_env=lambda: {'STORYFORGE_LLM_MODEL':'fake-model'}
assistant_service._call_llm_streamed=forbid_writer
loop_runtime.build_llm_provider=lambda source: Provider()
engine=create_engine(sys.argv[1])
with Session(engine) as session:
    control=service.handle_agent_control_message(session, public_id='source-run', session_id='source-session', control_type='resume_run')
    print('RECOVERY_JSON='+json.dumps({'result':control.resumed_result, 'diagnostic':control.resume_diagnostic, 'calls':len(calls)}))
engine.dispose()
""",
            f"sqlite+pysqlite:///{database}",
        ],
        capture_output=True,
        text=True,
        timeout=40,
    )
    assert cold.returncode == 0, cold.stderr
    line = next(line for line in cold.stdout.splitlines() if line.startswith("RECOVERY_JSON="))
    result = json.loads(line.split("=", 1)[1])
    return result["result"], result["diagnostic"], result["calls"]


@pytest.fixture()
def receipt_fixture(session, tmp_path, monkeypatch):
    chapter = tmp_path / "第02章.md"
    chapter.write_text("他推开门。", encoding="utf-8")
    (tmp_path / "第01章.md").write_text("他把灯芯捻短了一寸。" * 60, encoding="utf-8")
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})
    monkeypatch.setattr(
        assistant_service, "_call_llm_streamed", lambda *_args, **_kwargs: {"content": "门后传来两声叩响。"}
    )
    assistant_service.draft_continuation(
        session,
        AssistantContinueRequest(
            file_path=str(chapter),
            project_root=str(tmp_path),
            content="他推开门。",
            cursor_line=1,
        ),
    )
    inner = session.scalars(select(AssistantToolCall)).one()
    manifest = inner.input_summary["generation_sources"]
    ref = generation_delivery_reference(inner.id, manifest).as_dict()
    outer = assistant_service.create_assistant_tool_call(
        session,
        inner.session_id,
        AssistantToolCallCreate(
            tool_name="prose.continue",
            status="completed",
            input_summary={"generation_delivery_refs": [ref]},
        ),
    )
    trace = AgentToolTrace(
        "prose.continue", "completed", {"generation_delivery_refs": [ref]}, assistant_tool_call_id=outer.id
    )
    return inner, outer, trace, {"reference": ref, "manifest": manifest}


@pytest.mark.parametrize(
    "corruption",
    [
        "missing_outer",
        "missing_inner",
        "wrong_session",
        "wrong_tool",
        "missing_manifest",
        "manifest_changed",
        "outer_refs_changed",
    ],
)
def test_checkpoint_collection_does_not_guess_or_adopt_corrupt_receipts(session, receipt_fixture, tmp_path, corruption):
    inner, outer, trace, _receipt = receipt_fixture
    session_id = inner.session_id
    if corruption == "missing_outer":
        session.delete(outer)
    elif corruption == "missing_inner":
        session.delete(inner)
    elif corruption == "wrong_session":
        other = assistant_service.create_assistant_session(
            session, AssistantSessionCreate(title="other", task_type="test")
        )
        inner.session_id = other.id
    elif corruption == "wrong_tool":
        inner.tool_name = "assistant.draft"
    elif corruption == "missing_manifest":
        inner.input_summary = {}
    elif corruption == "manifest_changed":
        inner.input_summary = {
            "generation_sources": {
                **inner.input_summary["generation_sources"],
                "request": {"system_sha256": "changed", "user_sha256": "changed"},
            }
        }
    else:
        outer.input_summary = {"generation_delivery_refs": []}
    session.commit()
    values = checkpoint_generation_receipts(session, session_id, [trace])
    assert len(values) == 1 and "unverified_reason" in values[0]
    assert not generation_sources_unchanged(values, tmp_path.resolve())


def test_checkpoint_collection_returns_detached_verified_values(session, receipt_fixture, tmp_path):
    inner, _outer, trace, receipt = receipt_fixture
    values = checkpoint_generation_receipts(session, inner.session_id, [trace])
    assert values == [receipt]
    assert generation_sources_unchanged(values, tmp_path.resolve())
    values[0]["manifest"]["request"]["system_sha256"] = "mutated"
    session.refresh(inner)
    assert inner.input_summary["generation_sources"]["request"]["system_sha256"] != "mutated"
    assert not generation_sources_unchanged(values, tmp_path.resolve())


def test_receipt_reads_neither_flush_nor_overwrite_pending_tool_state(session, receipt_fixture):
    inner, outer, trace, receipt = receipt_fixture
    inner.input_summary = {"pending_inner": True}
    outer.input_summary = {"pending_outer": True}
    assert checkpoint_generation_receipts(session, inner.session_id, [trace]) == [receipt]
    assert inner.input_summary == {"pending_inner": True} and inner in session.dirty
    assert outer.input_summary == {"pending_outer": True} and outer in session.dirty
    session.rollback()


@pytest.mark.parametrize("change", ["legacy", "missing_proof", "different_ref"])
def test_old_or_unbound_outcome_cannot_claim_generation_coverage(receipt_fixture, change):
    _inner, _outer, trace, receipt = receipt_fixture
    payload = {"outcome": {"traces": [trace.as_dict()]}, "sources": {"generation_receipts": [receipt]}}
    assert generation_outcome_covered(payload)
    if change == "legacy":
        payload["outcome"]["traces"][0]["input_summary"] = {}
    elif change == "missing_proof":
        payload["sources"] = {}
    else:
        payload["sources"]["generation_receipts"][0]["reference"] = {"assistant_tool_call_id": 999999}
    assert not generation_outcome_covered(payload)
    assert generation_outcome_covered({"outcome": {"traces": []}, "sources": {}})


def test_selection_observers_do_no_hash_work_without_scope(tmp_path, monkeypatch):
    chapter = tmp_path / "第02章.md"
    chapter.write_text("当前章。", encoding="utf-8")
    (tmp_path / "第01章.md").write_text("上一章尾。", encoding="utf-8")

    def forbid_hash(_value):
        raise AssertionError("inactive generation observer calculated selection hashes")

    monkeypatch.setattr(generation_sources, "selection_sha256", forbid_hash)
    assert previous_chapter_tail(str(tmp_path), str(chapter))[1] == "上一章尾。"
    assert build_scene_constraint_block(str(tmp_path), str(chapter)) is None


def test_changed_selection_digest_is_not_ignored_even_when_file_bytes_match(receipt_fixture, tmp_path):
    inner, _outer, _trace, receipt = receipt_fixture
    assert generation_sources_unchanged([receipt], tmp_path.resolve())
    manifest = receipt["manifest"]
    assert manifest["selections"]
    manifest["selections"][0]["value"]["ordered_paths_sha256"] = "changed"
    receipt["reference"] = generation_delivery_reference(inner.id, manifest).as_dict()
    assert not generation_sources_unchanged([receipt], tmp_path.resolve())


def test_style_prefix_replay_does_not_claim_unread_tail_bytes(session, tmp_path, monkeypatch):
    samples = []
    for index in range(3):
        sample = tmp_path / f"第00{index}章.md"
        sample.write_text("他把灯芯捻短了一寸。" * 10_000, encoding="utf-8")
        samples.append(sample)
    current = tmp_path / "第01章.md"
    current.write_text("他推开门。", encoding="utf-8")
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})
    monkeypatch.setattr(
        assistant_service, "_call_llm_streamed", lambda *_args, **_kwargs: {"content": "门后传来两声叩响。"}
    )
    assistant_service.draft_continuation(
        session,
        AssistantContinueRequest(
            file_path=str(current),
            project_root=str(tmp_path),
            content="他推开门。",
            cursor_line=1,
        ),
    )
    inner = session.scalars(select(AssistantToolCall)).one()
    manifest = inner.input_summary["generation_sources"]
    receipt = {"reference": generation_delivery_reference(inner.id, manifest).as_dict(), "manifest": manifest}
    sample_ref = next(
        s for s in manifest["sources"] if s["purpose"] == "style_sample" and s["relative_path"] == samples[0].name
    )
    assert sample_ref["source_complete"] is False and sample_ref["file_bytes_sha256"] is None
    assert generation_sources_unchanged([receipt], tmp_path.resolve())
    samples[0].write_bytes(samples[0].read_bytes() + b"UNREAD_TAIL_CHANGED")
    assert generation_sources_unchanged(
        [receipt], tmp_path.resolve()
    )  # Only the bounded statistics prefix was consumed.
    raw = samples[0].read_bytes()
    samples[0].write_bytes(b"CHANGED_PREFIX" + raw[14:])
    assert not generation_sources_unchanged([receipt], tmp_path.resolve())
