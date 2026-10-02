from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, cast

from app.domains.agent_runs.patches.types import PatchProposal
from app.domains.agent_runs.result_contracts import AgentExecutionOutcome
from app.domains.agent_runs.tools.execution import ToolArtifact
from app.domains.agent_runs.trace import AgentToolTrace

if TYPE_CHECKING:
    from app.domains.agent_runs.loop.external_wait_store import StoredExternalWait


@dataclass(frozen=True)
class LoopRoundResult:
    content: str
    tool_calls: list[dict[str, Any]]
    completion_tokens: int | None
    prompt_tokens: int | None
    token_usage: int | None
    token_usage_source: str | None
    cost_cny_estimated: float | None
    cost_breakdown: object

    @classmethod
    def from_payload(cls, payload: Mapping[str, object]) -> LoopRoundResult:
        raw_tool_calls = payload.get("tool_calls")
        return cls(
            content=str(payload.get("content") or ""),
            tool_calls=cast(list[dict[str, Any]], raw_tool_calls if isinstance(raw_tool_calls, list) else []),
            completion_tokens=_integer(payload.get("completion_tokens")),
            prompt_tokens=_integer(payload.get("prompt_tokens")),
            token_usage=_integer(payload.get("token_usage")),
            token_usage_source=_text(payload.get("token_usage_source")),
            cost_cny_estimated=_number(payload.get("cost_cny_estimated")),
            cost_breakdown=payload.get("cost_breakdown"),
        )


@dataclass(frozen=True)
class LoopToolCall:
    call_id: str
    llm_tool_name: str
    arguments_json: str

    @classmethod
    def from_payload(cls, payload: Mapping[str, object], *, fallback_id: str) -> LoopToolCall:
        function = payload.get("function") if isinstance(payload.get("function"), dict) else {}
        return cls(
            call_id=str(payload.get("id") or fallback_id),
            llm_tool_name=str(function.get("name") or ""),
            arguments_json=str(function.get("arguments") or ""),
        )


@dataclass(frozen=True)
class LoopToolFeedback:
    content: dict[str, Any]
    review_report: dict[str, Any] | None = None
    patch_proposal: PatchProposal | None = None

    @classmethod
    def from_output(
        cls,
        registry_name: str,
        output: dict[str, Any],
        *,
        patch_tools: Sequence[str],
        review_feedback: Callable[[dict[str, Any]], dict[str, Any]],
        revise_feedback: Callable[[dict[str, Any]], dict[str, Any]],
    ) -> LoopToolFeedback:
        if registry_name == "file.review":
            review_report = output.get("review_report") if isinstance(output.get("review_report"), dict) else None
            return cls(content=review_feedback(output), review_report=review_report)
        if registry_name in {
            "project.collapse_check",
            "project.entity_budget_check",
            "project.promise_check",
            "project.canon_delta",
            "project.hooks_delta",
        }:
            return cls(content={"summary": output.get("summary")})
        if registry_name in patch_tools:
            raw_patch = output.get("proposed_patch")
            proposal = PatchProposal.from_payload(raw_patch) if isinstance(raw_patch, dict) else None
            return cls(content=revise_feedback(output), patch_proposal=proposal)
        return cls(content=output)


@dataclass
class ChatLoopOutcome:
    answer: str
    external_wait: StoredExternalWait | None = None
    traces: list[AgentToolTrace] = field(default_factory=list)
    rounds: int = 0
    tool_call_count: int = 0
    completion_tokens: int = 0
    prompt_tokens: int = 0
    token_usage: int = 0
    token_usage_source: str = "unavailable"
    # Known main-loop model charges only; nested calls have their own tool-call evidence.
    # A non-null subtotal does not establish that every round's cost was available.
    cost_cny_estimated: float | None = None
    cost_breakdown: dict[str, Any] = field(default_factory=dict)
    exhausted: bool = False
    execution_outcome: AgentExecutionOutcome | None = None
    review_report: dict[str, Any] | None = None
    patch_proposal: PatchProposal | None = None
    interrupted: bool = False
    interruption: dict[str, Any] | None = None
    artifacts: list[ToolArtifact] = field(default_factory=list)

    def mark_failed(self, code: str, message: str) -> None:
        partial = any(trace.status == "completed" for trace in self.traces) or bool(self.artifacts)
        self.answer = f"本轮未完成：{message[:300]}"
        if partial:
            self.answer += " 已完成的结果已保留。"
        self.execution_outcome = AgentExecutionOutcome(
            status="partial" if partial else "failed", code=code, message=self.answer,
        )
        if self.proposed_patch is not None:
            self.proposed_patch = {**self.proposed_patch, "requires_confirmation": True}
            self.artifacts = [
                ToolArtifact(kind=item.kind, payload={**item.payload, "requires_confirmation": True},
                             requires_confirmation=True)
                if item.kind == "proposed_patch" else item
                for item in self.artifacts
            ]

    @property
    def proposed_patch(self) -> dict[str, Any] | None:
        return self.patch_proposal.to_payload() if self.patch_proposal is not None else None

    @proposed_patch.setter
    def proposed_patch(self, payload: Mapping[str, Any] | None) -> None:
        self.patch_proposal = PatchProposal.from_payload(payload) if payload is not None else None


def _integer(value: object) -> int | None:
    return value if isinstance(value, int) else None


def _number(value: object) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None
