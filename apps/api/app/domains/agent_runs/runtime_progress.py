"""Bounded, non-content provider progress recorded alongside the owning run."""
from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

from sqlalchemy.orm import Session

from app.common.llm_observation import observe_http_progress
from app.domains.agent_runs.models import AgentRun, AgentRunEvent

_PHASE_FIELDS = {
    "request_started": "timeout_seconds",
    "retry_wait": "delay_seconds",
    "retry_started": None,
}


def normalize_runtime_progress(progress: Mapping[str, object]) -> dict[str, Any]:
    phase = progress.get("phase")
    if not isinstance(phase, str) or phase not in _PHASE_FIELDS:
        raise ValueError("Unknown runtime progress phase")
    number = progress.get("request_number")
    if isinstance(number, bool) or not isinstance(number, int) or number < 1:
        raise ValueError("Runtime progress requires a positive request number")
    result: dict[str, Any] = {"phase": phase, "request_number": number}
    field = _PHASE_FIELDS[phase]
    if field is not None:
        value = progress.get(field)
        if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value) or value < 0:
            raise ValueError("Runtime progress requires a finite non-negative duration")
        result[field] = value
    # Intentionally omit all arbitrary source keys, paths, prompts, and error bodies.
    return result


def record_runtime_progress(session: Session, run: AgentRun, progress: Mapping[str, object]) -> AgentRunEvent:
    from app.domains.agent_runs.event_types import AGENT_RUNTIME_PROGRESS
    from app.domains.agent_runs.service import record_agent_event

    payload = normalize_runtime_progress(progress)
    observe_http_progress(payload)
    return record_agent_event(
        session, run, event_type=AGENT_RUNTIME_PROGRESS, actor="provider-transport",
        message="模型传输阶段更新。", payload=payload,
    )
