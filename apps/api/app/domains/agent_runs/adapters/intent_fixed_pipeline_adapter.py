from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from sqlalchemy.orm import Session

from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.models import AgentRun


@dataclass(frozen=True)
class FixedPipelineRequest:
    session: Session
    run: AgentRun
    agent_session_id: str
    assistant_session_id: int
    user_message: str
    args: dict[str, Any]
    intent: str


class FixedPipelineRuntime(Protocol):
    def run_file_review_pipeline(self, request: FixedPipelineRequest) -> dict[str, Any]: ...

    def run_chapter_polish_pipeline(self, request: FixedPipelineRequest) -> dict[str, Any]: ...

    def run_bookrun_generation_pipeline(self, request: FixedPipelineRequest) -> dict[str, Any]: ...

    def run_chapter_review_pipeline(self, request: FixedPipelineRequest) -> dict[str, Any]: ...

    def run_chapter_repair_pipeline(self, request: FixedPipelineRequest) -> dict[str, Any]: ...


def run_fixed_intent_pipeline(runtime: FixedPipelineRuntime, request: FixedPipelineRequest) -> dict[str, Any]:
    handlers = {
        "file.review": runtime.run_file_review_pipeline,
        "file.revise": runtime.run_chapter_polish_pipeline,
        "bookrun.start": runtime.run_bookrun_generation_pipeline,
        "chapter.review": runtime.run_chapter_review_pipeline,
        "chapter.repair": runtime.run_chapter_repair_pipeline,
    }
    handler = handlers.get(request.intent)
    if handler is None:
        raise AgentOrchestrationError(f"暂不支持的 Agent intent：{request.intent}")
    return handler(request)
