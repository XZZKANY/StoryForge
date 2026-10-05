"""Persist actual BookRun model attempts; progress is a projection of ModelRun rows."""
from __future__ import annotations

import hashlib
import json
import math
import time
from collections.abc import Mapping

from sqlalchemy import or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.common.llm_client import cost_breakdown
from app.common.llm_observation import ModelObservationError
from app.common.metrics import book_generation_cost_cny_total
from app.common.redaction import redact_sensitive, redact_sensitive_text
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Chapter
from app.domains.model_runs.models import ModelRun
from app.domains.model_runs.schemas import ModelRunCreate
from app.domains.model_runs.service import create_model_run
from app.platform.ai_sdk import ChatRequest, TokenUsage


class BookGenerationAccounting:
    def __init__(self, session: Session, book_run: BookRun, chapter: Chapter):
        self.session, self.book_run, self.chapter = session, book_run, chapter
        self.generation_run: ModelRun | None = None

    def begin(self, request: ChatRequest, *, source, streaming, operation, provenance):
        secrets = [value for key, value in source.items() if key.endswith(("_API_KEY", "_AUTH_TOKEN")) and value]
        normalized = {
            "messages": [{"role": item.role.value, "content": item.content} for item in request.messages],
            "tools": [tool.to_openai() for tool in request.tools],
        }
        parameters = {
            "temperature": request.temperature, "max_tokens": request.max_tokens,
            "reasoning_effort": request.reasoning_effort, "tool_choice": request.tool_choice,
        }
        try:
            row = create_model_run(self.session, ModelRunCreate(
                book_id=self.book_run.book_id, book_run_id=self.book_run.id, chapter_id=self.chapter.id,
                provider_name=redact_sensitive_text(str(source.get("STORYFORGE_LLM_PROVIDER") or "openai-compatible"), extra_secrets=secrets),
                model_name=redact_sensitive_text(request.model, extra_secrets=secrets),
                capability="llm", status="running", input_summary=operation,
                prompt_hash=hashlib.sha256(json.dumps(normalized, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
                payload={
                    "book_run_id": self.book_run.id, "accounting_version": 1,
                    "operation": operation, "request_state": "prepared",
                    "parameters": redact_sensitive(parameters, extra_secrets=secrets),
                    "streaming": streaming, "token_usage_source": "unavailable", "cost_cny_estimated": None,
                },
            ))
        except SQLAlchemyError as exc:
            self.session.rollback()
            raise ModelObservationError("BookRun model attempt could not be prepared.") from exc
        if operation == "book.generate":
            self.generation_run = row
        return _StoredBookAttempt(self.session, self.book_run, row, dict(source))


class _StoredBookAttempt:
    def __init__(self, session, book_run, row, source):
        self.session, self.book_run, self.row, self.source = session, book_run, row, source
        self.started_at = time.monotonic()
        self.finished = False
        self.retry_count = 0

    def progress(self, values: Mapping[str, object]) -> None:
        if values.get("phase") == "retry_started":
            self.retry_count += 1

    def finish(self, status, *, usage: TokenUsage, finish_reason=None, error_code=None):
        if self.finished:
            return
        self.finished = True
        breakdown = cost_breakdown(self.source, usage.to_legacy())
        self.row.status = "completed" if status == "response_completed" else "interrupted" if status == "interrupted" else "failed"
        self.row.token_usage = usage.total_tokens
        self.row.input_tokens = usage.input_tokens
        self.row.output_tokens = usage.output_tokens
        self.row.cost_estimate = float(breakdown.get("total_cny") or 0)
        self.row.latency_ms = max(0, int((time.monotonic() - self.started_at) * 1000))
        self.row.finish_reason, self.row.error_kind = finish_reason, error_code
        self.row.retry_count = self.retry_count
        self.row.payload = {
            **self.row.payload, **usage.to_legacy(), "total_tokens": usage.total_tokens,
            "request_state": status, "cost_cny_estimated": breakdown.get("total_cny"),
            "cost_source": breakdown.get("source", "unavailable"), "cost_breakdown": breakdown,
        }
        try:
            self.session.flush()
            summary = generation_usage_summary(self.session, self.book_run.id)
            self.book_run.tokens_used = summary["tokens_used"]
            self.book_run.estimated_cost = summary["estimated_cost"]
            self.book_run.cost_summary = summary
            self.book_run.progress = {
                **self.book_run.progress,
                "budget": {**self.book_run.progress.get("budget", {}), **summary},
            }
            self.session.commit()
        except SQLAlchemyError as exc:
            self.session.rollback()
            raise ModelObservationError("BookRun model usage could not be settled.") from exc
        book_generation_cost_cny_total.inc(self.row.cost_estimate)


def generation_usage_summary(session: Session, book_run_id: int, *, chapter_id: int | None = None) -> dict | None:
    query = select(ModelRun).where(or_(
        ModelRun.book_run_id == book_run_id,
        (ModelRun.book_run_id.is_(None)) & (ModelRun.payload["book_run_id"].as_integer() == book_run_id),
    ))
    query = query.where(or_(ModelRun.payload["accounting_version"].as_integer() == 1,
                            ModelRun.payload["mode"].as_string() == "phase9b_real_llm_smoke"))
    if chapter_id is not None:
        query = query.where(ModelRun.chapter_id == chapter_id)
    rows = session.scalars(query).all()
    if not rows:
        return None
    unknown_usage = sum(row.payload.get("token_usage_source") in {None, "unavailable"} for row in rows)
    estimated_usage = sum(row.payload.get("token_usage_source") == "estimated_split" for row in rows)
    legacy = sum(row.payload.get("accounting_version") != 1 for row in rows)
    costs = [row.payload.get("cost_cny_estimated") for row in rows]
    known_costs = [value for value in costs if isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value) and value >= 0]
    total_cost = sum(known_costs)
    unaccounted_retries = sum(row.retry_count for row in rows)
    complete = len(known_costs) == len(rows) and not legacy and not unaccounted_retries
    breakdown = {
        "currency": "CNY", "source": "all_model_attempts", "total_cny": total_cost,
        "input_cny": sum(float(row.payload.get("cost_breakdown", {}).get("input_cny") or 0) for row in rows),
        "output_cny": sum(float(row.payload.get("cost_breakdown", {}).get("output_cny") or 0) for row in rows),
        "complete": complete,
    }
    return {
        "tokens_used": sum(row.token_usage for row in rows),
        "prompt_tokens": sum(row.input_tokens for row in rows),
        "completion_tokens": sum(row.output_tokens for row in rows),
        "scope": "all_model_attempts", "known_cost_subtotal_cny": total_cost,
        "estimated_cost": total_cost, "cost_estimate": total_cost if complete else None,
        "cost_breakdown": breakdown, "cost_complete": complete,
        "attempt_count": len(rows), "unknown_usage_count": unknown_usage,
        "estimated_usage_count": estimated_usage, "unknown_cost_count": len(rows) - len(known_costs),
        "legacy_attempt_count": legacy, "unaccounted_retry_count": unaccounted_retries,
        "usage_complete": not unknown_usage and not legacy and not unaccounted_retries,
    }
