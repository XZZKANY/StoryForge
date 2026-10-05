"""Actual continuation receipts remain identifiable after the worker session closes."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.common import generation_delivery
from app.common.generation_delivery import GenerationDeliveryCapture, record_generation_delivery
from app.common.generation_sources import GenerationSourceCapture
from app.common.llm_control import LLMRunInterrupted
from app.db.base import Base
from app.domains.agent_runs import loop_runtime, service
from app.domains.assistant import service as assistant_service
from app.domains.assistant.models import AssistantToolCall
from app.domains.book_runs.book_generation import BookGenerationError
from app.platform.ai_sdk import ChatResponse, ToolCall


def digest(value):
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


@pytest.mark.parametrize("outcome", ["completed", "failed", "paused"])
def test_continue_trace_links_exact_committed_writer_receipt_after_reopen(tmp_path, monkeypatch, outcome):
    project = tmp_path / "novel"
    project.mkdir()
    chapter = project / "chapter.md"
    original = "他推开门。\n门外已有足迹。"
    chapter.write_text(original, encoding="utf-8")
    (project / ".storyforge").mkdir()
    author = project / ".storyforge/agent-instructions.md"
    author.write_text("SOURCE_A：保持限知视角。", encoding="utf-8")
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'links.sqlite3'}", poolclass=NullPool)
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(connection)
    requests = []
    writer_requests = []

    class Provider:
        def complete(self, request):
            requests.append(request)
            if len(requests) == 1:
                return ChatResponse(
                    "",
                    tool_calls=(
                        ToolCall(
                            "continue-1",
                            "prose_continue",
                            json.dumps(
                                {
                                    "path": "chapter.md",
                                    "anchor_line": 1,
                                    "generation_delivery_refs": [
                                        {"assistant_tool_call_id": 999999, "manifest_sha256": "forged"}
                                    ],
                                }
                            ),
                        ),
                    ),
                )
            return ChatResponse("完成。")

    def writer(_source, *, system_prompt, user_prompt):
        # An independent physical connection sees the receipt before the provider.
        with Session(engine) as reader:
            inner = reader.scalars(
                select(AssistantToolCall).where(AssistantToolCall.tool_name == "assistant.continue")
            ).one()
            writer_requests.append((inner.id, inner.input_summary["generation_sources"]))
            assert inner.status == "running"
            assert writer_requests[-1][1]["request"] == {
                "system_sha256": hashlib.sha256(system_prompt.encode()).hexdigest(),
                "user_sha256": hashlib.sha256(user_prompt.encode()).hexdigest(),
            }
            outer = reader.scalars(
                select(AssistantToolCall).where(AssistantToolCall.tool_name == "prose.continue")
            ).one()
            assert outer.status == "running"
            refs = outer.input_summary["generation_delivery_refs"]
            assert refs[0]["assistant_tool_call_id"] == inner.id
            assert refs[0]["manifest_sha256"] == digest(inner.input_summary["generation_sources"])
        if outcome == "failed":
            raise BookGenerationError("isolated provider failure")
        if outcome == "paused":
            raise LLMRunInterrupted("paused")
        return {"content": "他蹲下身，摸了摸那道泥痕。"}

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", writer)
    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
    try:
        with Session(engine) as worker:
            result = service.run_agent_user_message(
                worker,
                agent_session_id="link-session",
                message={
                    "run_id": "link-run",
                    "user_message": "在光标处接着写",
                    "intent": "chat.explain",
                    "args": {"project_path": str(project)},
                },
            )
            trace = next(item for item in result.result["tool_trace"] if item["tool_name"] == "prose.continue")
            assert trace["status"] == outcome
            assert "generation_delivery_refs" in trace["input_summary"], "outer trace lost the actual writer receipt"
            refs = trace["input_summary"]["generation_delivery_refs"]
            assert len(refs) == 1
            expected_id, manifest = writer_requests[0]
            assert refs[0]["assistant_tool_call_id"] == expected_id
            assert refs[0]["manifest_sha256"] == digest(manifest)
            assert refs[0]["request"] == manifest["request"]
            assert trace["assistant_tool_call_id"] != expected_id  # Outer call identity must stay intact.
            outer_id = trace["assistant_tool_call_id"]
        engine.dispose()
        author.write_text("SOURCE_B：不要给旧回执重新背书。", encoding="utf-8")
        with Session(engine) as reopened:
            outer = reopened.get(AssistantToolCall, outer_id)
            inner = reopened.get(AssistantToolCall, expected_id)
            assert outer.input_summary["generation_delivery_refs"] == refs
            assert inner.status == outcome
            assert digest(inner.input_summary["generation_sources"]) == refs[0]["manifest_sha256"]
            events = service.list_agent_run_events(reopened, "link-run")
            saved = next(
                e.payload["trace"]
                for e in events
                if e.event_type == "tool_trace" and e.payload.get("trace", {}).get("tool_name") == "prose.continue"
            )
            assert saved["input_summary"]["generation_delivery_refs"] == refs
        assert len(writer_requests) == 1
        assert chapter.read_text(encoding="utf-8") == original
        # Fresh process, stdlib SQLite reader only: no ORM identity map or source re-read.
        child = subprocess.run(
            [
                sys.executable,
                "-c",
                """
import json, sqlite3, sys
with sqlite3.connect(sys.argv[1]) as connection:
    rows = [connection.execute('SELECT input_summary FROM assistant_tool_calls WHERE id=?', (int(i),)).fetchone()[0]
            for i in sys.argv[2:]]
print(json.dumps([json.loads(row) for row in rows]))
""",
                str(tmp_path / "links.sqlite3"),
                str(outer_id),
                str(expected_id),
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
        assert child.returncode == 0, child.stderr
        cold_outer, cold_inner = json.loads(child.stdout)
        assert cold_outer["generation_delivery_refs"] == refs
        assert digest(cold_inner["generation_sources"]) == refs[0]["manifest_sha256"]
    finally:
        engine.dispose()


def test_delivery_scope_is_nested_immutable_and_cannot_accept_forged_refs():
    manifest = GenerationSourceCapture(None).manifest("system", "user")
    outer, inner = GenerationDeliveryCapture(), GenerationDeliveryCapture()
    forged = {"generation_delivery_refs": [{"assistant_tool_call_id": 999}], "path": "chapter.md"}
    assert outer.bind(forged) == {"path": "chapter.md"}
    with outer.collecting():
        record_generation_delivery(12, manifest)
        with inner.collecting():
            record_generation_delivery(34, manifest)
        record_generation_delivery(56, manifest)
    record_generation_delivery(99, manifest)  # No active observer: no leaked scope.
    bound = outer.bind(forged)
    assert [r["assistant_tool_call_id"] for r in bound["generation_delivery_refs"]] == [12, 56]
    assert inner.bind({})["generation_delivery_refs"][0]["assistant_tool_call_id"] == 34
    manifest["request"]["system_sha256"] = "mutated"
    bound["generation_delivery_refs"][0]["request"]["user_sha256"] = "mutated"
    assert outer.bind({})["generation_delivery_refs"][0]["request"] != manifest["request"]
    assert outer.bind({})["generation_delivery_refs"][0]["request"]["user_sha256"] != "mutated"


def test_delivery_scope_resets_after_exception():
    capture = GenerationDeliveryCapture()
    manifest = GenerationSourceCapture(None).manifest("system", "user")
    with pytest.raises(RuntimeError, match="scope failure"), capture.collecting():
        record_generation_delivery(1, manifest)
        raise RuntimeError("scope failure")
    record_generation_delivery(2, manifest)
    assert [r["assistant_tool_call_id"] for r in capture.bind({})["generation_delivery_refs"]] == [1]


def test_writer_receipt_commit_failure_never_publishes_delivery_or_calls_provider(session, tmp_path, monkeypatch):
    from app.domains.assistant.schemas import AssistantContinueRequest

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})
    update = assistant_service.update_assistant_tool_call
    calls = []

    def reject_receipt(session, tool_call_id, payload):
        if payload.input_summary and "generation_sources" in payload.input_summary:
            raise RuntimeError("isolated receipt commit failure")
        return update(session, tool_call_id, payload)

    monkeypatch.setattr(assistant_service, "update_assistant_tool_call", reject_receipt)
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", lambda *_args, **_kwargs: calls.append("provider"))
    capture = GenerationDeliveryCapture()
    with capture.collecting(), pytest.raises(RuntimeError, match="receipt commit failure"):
        assistant_service.draft_continuation(
            session,
            AssistantContinueRequest(
                file_path="chapter.md",
                project_root=str(tmp_path),
                content="已有正文。",
                cursor_line=1,
            ),
        )
    assert calls == []
    assert capture.bind({}) == {}
    inner = session.scalars(select(AssistantToolCall)).one()
    assert "generation_sources" not in inner.input_summary


@pytest.mark.parametrize("failure", ["budget", "acknowledgement"])
def test_delivery_link_failure_marks_writer_failed_without_provider(session, tmp_path, monkeypatch, failure):
    from app.domains.assistant.schemas import AssistantContinueRequest

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})
    calls = []
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", lambda *_args, **_kwargs: calls.append("provider"))

    def fail_acknowledgement(_refs):
        raise RuntimeError("isolated link acknowledgement failure")

    if failure == "budget":
        monkeypatch.setattr(generation_delivery, "MAX_DELIVERY_REFS", 0)
    capture = GenerationDeliveryCapture(on_record=fail_acknowledgement if failure == "acknowledgement" else None)
    with capture.collecting(), pytest.raises(assistant_service.AssistantReviseError, match="未调用模型"):
        assistant_service.draft_continuation(
            session,
            AssistantContinueRequest(
                file_path="chapter.md",
                project_root=str(tmp_path),
                content="已有正文。",
                cursor_line=1,
            ),
        )
    assert calls == []
    inner = session.scalars(select(AssistantToolCall)).one()
    assert inner.status == "failed"
    assert "generation_sources" in inner.input_summary  # Receipt is already acknowledged, not rolled back.
    assert "isolated" not in inner.error_message  # Fixed, safe public error.
