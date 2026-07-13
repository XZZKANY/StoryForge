from __future__ import annotations

from dataclasses import replace
from typing import cast

import pytest
from sqlalchemy.orm import Session

from app.domains.agent_runs.adapters import (
    MANAGED_BOOKRUN_COMMAND_IDS,
    FixedPipelineRequest,
    run_fixed_intent_pipeline,
)
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.tools import list_agent_runtime_tool_specs


class _RecordingFixedRuntime:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def _record(self, name: str) -> dict[str, str]:
        self.calls.append(name)
        return {"handler": name}

    def run_file_review_pipeline(self, _request: FixedPipelineRequest) -> dict[str, str]:
        return self._record("file.review")

    def run_chapter_polish_pipeline(self, _request: FixedPipelineRequest) -> dict[str, str]:
        return self._record("file.revise")

    def run_bookrun_generation_pipeline(self, _request: FixedPipelineRequest) -> dict[str, str]:
        return self._record("bookrun.start")

    def run_chapter_review_pipeline(self, _request: FixedPipelineRequest) -> dict[str, str]:
        return self._record("chapter.review")

    def run_chapter_repair_pipeline(self, _request: FixedPipelineRequest) -> dict[str, str]:
        return self._record("chapter.repair")


def _request(intent: str) -> FixedPipelineRequest:
    return FixedPipelineRequest(
        session=cast(Session, object()),
        run=cast(AgentRun, object()),
        agent_session_id="session-1",
        assistant_session_id=1,
        user_message="测试",
        args={},
        intent=intent,
    )


def test_fixed_intent_adapter_routes_every_explicit_pipeline() -> None:
    runtime = _RecordingFixedRuntime()
    request = _request("file.review")

    for intent in ("file.review", "file.revise", "bookrun.start", "chapter.review", "chapter.repair"):
        result = run_fixed_intent_pipeline(runtime, replace(request, intent=intent))
        assert result == {"handler": intent}

    assert runtime.calls == ["file.review", "file.revise", "bookrun.start", "chapter.review", "chapter.repair"]


def test_fixed_intent_adapter_rejects_unknown_intent() -> None:
    with pytest.raises(AgentOrchestrationError, match="暂不支持的 Agent intent"):
        run_fixed_intent_pipeline(_RecordingFixedRuntime(), _request("unknown.intent"))


def test_managed_bookrun_adapter_covers_declared_bookrun_tools() -> None:
    declared = tuple(spec.name for spec in list_agent_runtime_tool_specs() if spec.name.startswith("bookrun."))

    assert declared == MANAGED_BOOKRUN_COMMAND_IDS
