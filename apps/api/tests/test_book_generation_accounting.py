from __future__ import annotations

import json
from http.server import HTTPServer
from threading import Thread

import pytest
from book_generation_test_support import _BookGenerationChatHandler, _local_provider_base_url
from sqlalchemy import select

from app.common import llm_client
from app.domains.book_runs.book_context import clear_book_context_cache
from app.domains.book_runs.book_generation import run_book_generation
from app.domains.book_runs.errors import BookGenerationError
from app.domains.book_runs.models import BookRun
from app.domains.model_runs.models import ModelRun
from app.platform.ai_sdk import TokenUsage


def _configure(monkeypatch, base_url):
    source = {
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
        "STORYFORGE_LLM_API_KEY": "test-accounting-private-credential",
        "STORYFORGE_LLM_BASE_URL": base_url,
        "STORYFORGE_LLM_MODEL": "accounting-model",
        "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "3",
        "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "6",
    }
    for key, value in source.items():
        monkeypatch.setenv(key, value)
    for suffix in ("API_KEY", "BASE_URL", "MODEL", "REASONING_EFFORT"):
        monkeypatch.delenv(f"STORYFORGE_JUDGE_LLM_{suffix}", raising=False)
    clear_book_context_cache()
    return source


def test_all_actual_calls_are_persisted_once_and_counted_in_budget(session, monkeypatch):
    _BookGenerationChatHandler.requests = []
    server = HTTPServer(("127.0.0.1", 0), _BookGenerationChatHandler)
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    source = _configure(monkeypatch, _local_provider_base_url(server.server_port))
    try:
        result = run_book_generation(session, chapter_count=1, token_budget=10000, env=source)
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)
    rows = session.scalars(select(ModelRun).order_by(ModelRun.id)).all()
    assert len(rows) == len(_BookGenerationChatHandler.requests) == 3
    assert [row.payload["operation"] for row in rows] == ["book.generate", "judge.semantic", "story_state.grounding"]
    assert {row.book_run_id for row in rows} == {result.book_run.id}
    assert len({row.chapter_id for row in rows}) == 1
    assert all(row.chapter_id and row.status == "completed" for row in rows)
    assert sum(row.token_usage for row in rows) == result.book_run.tokens_used == 969
    assert sum(row.cost_estimate for row in rows) == pytest.approx(0.004905)
    assert result.book_run.estimated_cost == pytest.approx(0.004905)
    assert result.book_run.cost_summary["cost_complete"] is True
    completed = result.book_run.progress["completed_chapters"][0]
    assert completed["model_run_id"] == rows[0].id
    assert rows[0].scene_id == completed["approved_scene_id"]
    assert completed["token_usage"] == 969
    assert completed["cost_estimate"] == pytest.approx(0.004905)
    assert all("test-accounting-private-credential" not in json.dumps(row.payload) for row in rows)


@pytest.mark.parametrize("known", [False, True])
def test_generation_failure_before_scene_preserves_usage_and_unknown_cost(session, monkeypatch, known):
    source = _configure(monkeypatch, "https://fixture.invalid/v1")
    usage = TokenUsage(11, 7, 18, source="provider_usage")

    def fail(*args, **kwargs):
        raise llm_client.LLMError("fixture failure", usage=usage if known else None)

    monkeypatch.setattr(llm_client, "_request_chat_completions", fail)
    with pytest.raises(BookGenerationError, match="fixture failure"):
        run_book_generation(session, chapter_count=1, token_budget=10000, env=source)
    row = session.scalars(select(ModelRun)).one()
    run = session.scalars(select(BookRun)).one()
    assert row.scene_id is None
    assert row.status == "failed"
    assert row.token_usage == run.tokens_used == (18 if known else 0)
    assert row.payload["token_usage_source"] == ("provider_usage" if known else "unavailable")
    assert row.payload["cost_cny_estimated"] == (pytest.approx(0.000075) if known else None)
    assert run.estimated_cost == (pytest.approx(0.000075) if known else 0)
    assert run.cost_summary["cost_complete"] is known
    assert run.cost_summary["unknown_usage_count"] == (0 if known else 1)
    assert run.status == "failed"


def _scripted_response(monkeypatch, *, schema_retry=False, fail_stage=None):
    calls = []
    change = {"change_type": "character.status", "entity_kind": "character", "entity_id": "沈砚",
              "canonical_name": "沈砚", "surface_forms": ["沈砚"], "payload": {"status": "沈砚完成调查。"}}
    prose = "沈砚完成调查。" + "她核对线索，把证据登记入册。" * 65

    def transport(source, payload, **kwargs):
        system = payload["messages"][0]["content"]
        stage = "judge" if "评审员" in system else "grounding" if "grounding" in system else "schema" if "schema" in system else "generate"
        calls.append(stage)
        if stage == fail_stage:
            raise llm_client.LLMError("paid partial failure", usage=TokenUsage(11, 7, 18, source="provider_usage"))
        if stage == "generate":
            changes = [{"canonical_name": "沈砚"}] if schema_retry else [change]
            content = prose + "\n【STORY_STATE_CHANGES】\n" + json.dumps(changes, ensure_ascii=False) + "\n【/STORY_STATE_CHANGES】"
        else:
            content = json.dumps([change] if stage == "schema" else [{"seq": 1, "score": 90}] if stage == "grounding" else [], ensure_ascii=False)
        return {"choices": [{"message": {"content": content}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}}, 0.0

    monkeypatch.setattr(llm_client, "_request_chat_completions", transport)
    return calls


@pytest.mark.parametrize("fails", [False, True])
def test_schema_repair_usage_is_not_lost_or_folded_into_draft(session, monkeypatch, fails):
    source = _configure(monkeypatch, "https://fixture.invalid/v1")
    calls = _scripted_response(monkeypatch, schema_retry=True, fail_stage="schema" if fails else None)
    result = run_book_generation(session, chapter_count=1, token_budget=10000, env=source)
    rows = session.scalars(select(ModelRun).order_by(ModelRun.id)).all()
    assert calls == ["generate", "schema", "judge", "grounding"]
    assert len(rows) == 4
    assert rows[0].token_usage == 30
    assert rows[1].payload["operation"] == "book.schema_repair"
    assert rows[1].token_usage == (18 if fails else 30)
    assert rows[1].status == ("failed" if fails else "completed")
    assert result.book_run.tokens_used == (108 if fails else 120)
    assert result.book_run.estimated_cost == pytest.approx(0.000525 if fails else 0.0006)


def test_judge_override_does_not_inherit_another_models_prices(session, monkeypatch):
    source = _configure(monkeypatch, "https://fixture.invalid/v1")
    monkeypatch.setenv("STORYFORGE_JUDGE_LLM_MODEL", "other-judge-model")
    calls = _scripted_response(monkeypatch)
    result = run_book_generation(session, chapter_count=1, token_budget=10000, env=source)
    rows = session.scalars(select(ModelRun).order_by(ModelRun.id)).all()
    assert len(calls) == len(rows) == 3
    assert [row.model_name for row in rows] == ["accounting-model", "other-judge-model", "other-judge-model"]
    assert rows[0].payload["cost_cny_estimated"] == pytest.approx(0.00015)
    assert all(row.payload["cost_cny_estimated"] is None for row in rows[1:])
    assert result.book_run.cost_summary["unknown_cost_count"] == 2
    assert result.book_run.cost_summary["cost_complete"] is False
    assert result.book_run.cost_summary["cost_estimate"] is None
    assert result.book_run.estimated_cost == pytest.approx(0.00015)


def test_resume_keeps_failed_attempt_in_same_chapter_denominator(session, monkeypatch):
    from app.domains.book_runs.book_generation import resume_book_generation

    source = _configure(monkeypatch, "https://fixture.invalid/v1")
    _scripted_response(monkeypatch, fail_stage="generate")
    with pytest.raises(BookGenerationError):
        run_book_generation(session, chapter_count=1, token_budget=10000, env=source)
    run = session.scalars(select(BookRun)).one()
    run.status = "running"
    session.commit()
    session.expire_all()
    calls = _scripted_response(monkeypatch)
    result = resume_book_generation(session, book_run_id=run.id, chapter_count=1, token_budget=10000, env=source)
    rows = session.scalars(select(ModelRun).order_by(ModelRun.id)).all()
    assert len(calls) == 3
    assert len(rows) == 4
    assert rows[0].status == "failed"
    assert result.book_run.tokens_used == 108
    assert result.book_run.estimated_cost == pytest.approx(0.000525)
    assert result.book_run.progress["completed_chapters"][0]["token_usage"] == 108
    assert result.book_run.status == "completed"


@pytest.mark.parametrize("reason, expected_status", [("stopped", "stopped"), ("paused", "paused_by_user"), ("deadline_exceeded", "failed")])
def test_grounding_interrupt_retains_usage_without_committing_story_state(session, monkeypatch, reason, expected_status):
    from app.common.llm_control import LLMRunInterrupted
    from app.domains.books.models import Chapter, Scene
    from app.domains.story_state.models import StoryStateEvent, StoryStateLedger

    source = _configure(monkeypatch, "https://fixture.invalid/v1")
    calls = _scripted_response(monkeypatch)
    original = llm_client._request_chat_completions

    def interrupted(source, payload, **kwargs):
        if "grounding" in payload["messages"][0]["content"]:
            raise LLMRunInterrupted(reason, usage=TokenUsage(11, 7, 18, source="provider_usage"))
        return original(source, payload, **kwargs)

    monkeypatch.setattr(llm_client, "_request_chat_completions", interrupted)
    with pytest.raises(LLMRunInterrupted):
        run_book_generation(session, chapter_count=1, token_budget=10000, env=source)
    rows = session.scalars(select(ModelRun).order_by(ModelRun.id)).all()
    run = session.scalars(select(BookRun)).one()
    assert calls == ["generate", "judge"]
    assert len(rows) == 3
    assert rows[-1].status == "interrupted"
    assert rows[-1].error_kind == reason
    assert run.tokens_used == 78
    assert run.estimated_cost == pytest.approx(0.000375)
    assert run.status == expected_status
    assert session.query(StoryStateEvent).count() == session.query(StoryStateLedger).count() == 0
    assert session.scalars(select(Scene)).one().status != "approved"
    assert session.scalars(select(Chapter)).one().status != "approved"


def test_completed_cost_summary_never_presents_unknown_as_free(session, monkeypatch):
    from app.domains.book_runs.book_generation import _evidence_summary

    source = _configure(monkeypatch, "https://fixture.invalid/v1")
    source.pop("STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS")
    source.pop("STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS")
    monkeypatch.delenv("STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS")
    monkeypatch.delenv("STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS")
    _scripted_response(monkeypatch)
    result = run_book_generation(session, chapter_count=1, token_budget=10000, env=source)
    summary = _evidence_summary(result, target_word_count=1000, chapter_word_count_min=600, chapter_word_count_max=1600)
    assert result.book_run.tokens_used == 90
    assert summary["cost_cny_estimated"] is None
    assert summary["accounting"]["unknown_cost_count"] == 3
    assert summary["accounting"]["cost_complete"] is False
    assert summary["accounting"]["known_cost_subtotal_cny"] == 0
    assert result.audit_artifact.payload["accounting"]["cost_complete"] is False


@pytest.mark.parametrize("failure_boundary", ["prepare", "settle"])
def test_accounting_storage_failure_is_not_hidden_or_retried(session, monkeypatch, failure_boundary):
    from sqlalchemy.exc import SQLAlchemyError

    source = _configure(monkeypatch, "https://fixture.invalid/v1")
    calls = _scripted_response(monkeypatch)
    original_flush = session.flush
    injected = False

    def fail_once(*args, **kwargs):
        nonlocal injected
        candidates = session.new if failure_boundary == "prepare" else session.dirty
        if not injected and any(isinstance(row, ModelRun) and row.status == ("running" if failure_boundary == "prepare" else "completed") for row in candidates):
            injected = True
            raise SQLAlchemyError("fixture storage failure")
        return original_flush(*args, **kwargs)

    monkeypatch.setattr(session, "flush", fail_once)
    with pytest.raises(BookGenerationError, match="could not be") as caught:
        run_book_generation(session, chapter_count=1, token_budget=10000, env=source)
    assert injected
    assert calls == ([] if failure_boundary == "prepare" else ["generate"])
    rows = session.scalars(select(ModelRun)).all()
    assert len(rows) == (0 if failure_boundary == "prepare" else 1)
    if rows:
        assert rows[0].payload["request_state"] == "prepared"
        assert rows[0].payload["token_usage_source"] == "unavailable"
        assert caught.value.usage.total_tokens == 30
    run = session.scalars(select(BookRun)).one()
    assert run.status == "failed"


def test_http_retry_cost_is_marked_incomplete_without_double_counting_known_response(session, monkeypatch):
    from http.server import BaseHTTPRequestHandler

    class RetryHandler(BaseHTTPRequestHandler):
        calls = 0

        def do_POST(self):  # noqa: N802
            type(self).calls += 1
            self.rfile.read(int(self.headers["content-length"]))
            if self.calls == 1:
                self.send_response(500)
                body = b'{"error":"fixture"}'
            else:
                self.send_response(200)
                body = b'{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}'
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), RetryHandler)
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    source = _configure(monkeypatch, _local_provider_base_url(server.server_port))
    source.update({"STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS": "0", "STORYFORGE_LLM_RETRY_JITTER_SECONDS": "0"})
    try:
        with pytest.raises(BookGenerationError):
            run_book_generation(session, chapter_count=1, token_budget=10000, env=source)
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)
    row = session.scalars(select(ModelRun)).one()
    run = session.scalars(select(BookRun)).one()
    assert RetryHandler.calls == 2
    assert row.retry_count == 1
    assert row.token_usage == run.tokens_used == 30
    assert run.estimated_cost == pytest.approx(0.00015)
    assert run.cost_summary["unaccounted_retry_count"] == 1
    assert run.cost_summary["cost_complete"] is False


def test_resume_exhausted_budget_dispatches_no_more_models(session, monkeypatch):
    from app.domains.book_runs.book_generation import resume_book_generation

    source = _configure(monkeypatch, "https://fixture.invalid/v1")
    _scripted_response(monkeypatch, fail_stage="generate")
    with pytest.raises(BookGenerationError):
        run_book_generation(session, chapter_count=1, token_budget=10000, env=source)
    run = session.scalars(select(BookRun)).one()
    run.status = "running"
    session.commit()
    calls = _scripted_response(monkeypatch)
    with pytest.raises(BookGenerationError, match="预算"):
        resume_book_generation(session, book_run_id=run.id, chapter_count=1, token_budget=10, env=source)
    assert calls == []
    assert run.tokens_used == 18
    assert session.query(ModelRun).count() == 1
    assert run.status == "paused_by_budget"


def test_committed_usage_survives_lost_ack_without_second_model_request(session, monkeypatch):
    from sqlalchemy.exc import SQLAlchemyError
    from sqlalchemy.orm import Session

    source = _configure(monkeypatch, "https://fixture.invalid/v1")
    calls = _scripted_response(monkeypatch)
    original_commit = session.commit
    injected = False

    def lost_ack():
        nonlocal injected
        completed = session.scalar(select(ModelRun.id).where(ModelRun.status == "completed"))
        original_commit()
        if completed is not None and not injected:
            injected = True
            raise SQLAlchemyError("fixture commit ack lost")

    monkeypatch.setattr(session, "commit", lost_ack)
    with pytest.raises(BookGenerationError):
        run_book_generation(session, chapter_count=1, token_budget=10000, env=source)
    assert injected
    assert calls == ["generate"]
    with Session(session.get_bind()) as reader:
        row = reader.scalars(select(ModelRun)).one()
        run = reader.scalars(select(BookRun)).one()
        assert row.status == "completed"
        assert row.token_usage == run.tokens_used == 30
        assert run.estimated_cost == pytest.approx(0.00015)
        assert run.status == "failed"


def test_no_semantic_configuration_produces_only_the_actual_draft_attempt(session, monkeypatch):
    from app.domains.judge import semantic as judge_semantic
    from app.domains.story_state import semantic as story_semantic

    source = _configure(monkeypatch, "https://fixture.invalid/v1")
    calls = _scripted_response(monkeypatch)
    monkeypatch.setattr(judge_semantic, "resolved_llm_env", lambda _: {})
    monkeypatch.setattr(story_semantic, "resolved_llm_env", dict)
    result = run_book_generation(session, chapter_count=1, token_budget=10000, env=source)
    assert calls == ["generate"]
    assert session.query(ModelRun).count() == 1
    assert result.book_run.tokens_used == 30
    assert result.book_run.estimated_cost == pytest.approx(0.00015)
    assert result.book_run.cost_summary["attempt_count"] == 1


def test_legacy_accounting_is_preserved_but_not_declared_complete(session, monkeypatch):
    from app.domains.book_runs.book_generation_accounting import generation_usage_summary

    source = _configure(monkeypatch, "https://fixture.invalid/v1")
    _scripted_response(monkeypatch, fail_stage="generate")
    with pytest.raises(BookGenerationError):
        run_book_generation(session, chapter_count=1, token_budget=10000, env=source)
    row = session.scalars(select(ModelRun)).one()
    run_id = row.book_run_id
    row.book_run_id = None
    row.chapter_id = None
    payload = dict(row.payload)
    payload.pop("accounting_version")
    payload["mode"] = "phase9b_real_llm_smoke"
    row.payload = payload
    session.commit()
    summary = generation_usage_summary(session, run_id)
    assert summary["tokens_used"] == 18
    assert summary["estimated_cost"] == pytest.approx(0.000075)
    assert summary["legacy_attempt_count"] == 1
    assert summary["cost_complete"] is False
    assert summary["usage_complete"] is False


def test_file_database_cold_resume_retains_all_prior_attempts(tmp_path, monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from app.db.base import Base
    from app.domains.book_runs.book_generation import resume_book_generation

    source = _configure(monkeypatch, "https://fixture.invalid/v1")
    url = f"sqlite:///{(tmp_path / 'accounting.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    _scripted_response(monkeypatch, fail_stage="generate")
    with Session(engine) as first:
        with pytest.raises(BookGenerationError):
            run_book_generation(first, chapter_count=1, token_budget=10000, env=source)
        run_id = first.scalars(select(BookRun.id)).one()
    engine.dispose()
    clear_book_context_cache()
    engine = create_engine(url)
    try:
        with Session(engine) as resumed:
            run = resumed.get(BookRun, run_id)
            assert run.tokens_used == 18
            run.status = "running"
            resumed.commit()
            calls = _scripted_response(monkeypatch)
            result = resume_book_generation(resumed, book_run_id=run_id, chapter_count=1, token_budget=10000, env=source)
            assert calls == ["generate", "judge", "grounding"]
            assert result.book_run.tokens_used == 108
        with Session(engine) as independent:
            rows = independent.scalars(select(ModelRun).order_by(ModelRun.id)).all()
            run = independent.get(BookRun, run_id)
            assert len(rows) == 4
            assert rows[0].status == "failed"
            assert run.estimated_cost == pytest.approx(0.000525)
            assert run.cost_summary["attempt_count"] == 4
            assert run.cost_summary["cost_complete"] is True
    finally:
        engine.dispose()


def test_deterministic_span_repair_adds_no_model_charge(session, monkeypatch):
    from app.common.llm_observation import model_observation_scope
    from app.domains.book_runs.book_generation_accounting import BookGenerationAccounting
    from app.domains.books.models import Chapter, Scene
    from app.domains.judge.models import JudgeIssue
    from app.domains.repair.schemas import RepairPatchCreate
    from app.domains.repair.service import create_repair_patch

    source = _configure(monkeypatch, "https://fixture.invalid/v1")
    calls = _scripted_response(monkeypatch)
    result = run_book_generation(session, chapter_count=1, token_budget=10000, env=source)
    scene = session.scalars(select(Scene)).one()
    chapter = session.get(Chapter, scene.chapter_id)
    issue = JudgeIssue(scene_id=scene.id, issue_type="style_drift", severity="low", status="open", description="fixture",
                       payload={"span_start": 0, "span_end": 2, "matched_text": scene.content[:2], "replacement_text": "他"})
    session.add(issue)
    session.commit()
    with model_observation_scope(BookGenerationAccounting(session, result.book_run, chapter)):
        patch = create_repair_patch(session, RepairPatchCreate(issue_id=issue.id, content=scene.content))
    assert patch.patch["replacement_text"] == "他"
    assert calls == ["generate", "judge", "grounding"]
    assert session.query(ModelRun).count() == 3
    assert result.book_run.tokens_used == 90
    assert result.book_run.estimated_cost == pytest.approx(0.00045)
