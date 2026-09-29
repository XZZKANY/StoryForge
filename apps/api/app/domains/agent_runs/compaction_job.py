"""One model call through the configured facade; no independent runtime or retry loop."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.common.llm_client import LLMConfigError, LLMError, build_llm_provider, error_usage_summary, resolved_llm_model
from app.common.llm_control import LLMRunInterrupted
from app.domains.agent_runs.compaction import CompactionRejected, create_compaction_checkpoint
from app.domains.agent_runs.compaction_sources import (
    COMPACTION_CHAR_THRESHOLD,
    COMPACTION_MESSAGE_THRESHOLD,
    COMPACTION_RETAINED_MESSAGE_COUNT,
    ContextBudgetError,
    message_sources,
)
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantToolCallCreate
from app.platform.ai_sdk import ChatResponse, ProviderError


def prepare_conversation_compaction(session: Session, assistant_session_id: int) -> dict[str, Any] | None:
    messages = message_sources(session, assistant_session_id)
    if (len(messages) <= COMPACTION_MESSAGE_THRESHOLD
            and sum(len(source["content"]) for source in messages) <= COMPACTION_CHAR_THRESHOLD):
        return None

    response_recorded = False

    def record_usage(response: ChatResponse) -> None:
        nonlocal response_recorded
        assistant_service.create_assistant_tool_call(session, assistant_session_id, AssistantToolCallCreate(
            tool_name="conversation.compact", status="completed" if response.finish_reason == "stop" else "failed",
            input_summary={"purpose": "context_checkpoint", "source_message_count": len(messages)},
            output_summary={"finish_reason": response.finish_reason, **response.usage.to_legacy(),
                            "checkpoint_publication": "separate_artifact"},
        ))
        response_recorded = True

    def record_failed_usage(exc: Exception, *, status: str) -> None:
        if response_recorded:
            return
        assistant_service.create_assistant_tool_call(session, assistant_session_id, AssistantToolCallCreate(
            tool_name="conversation.compact", status=status,
            input_summary={"purpose": "context_checkpoint", "source_message_count": len(messages)},
            output_summary={**error_usage_summary(exc), "checkpoint_publication": "not_published"},
        ))

    try:
        source = assistant_service.resolved_llm_env()
        return create_compaction_checkpoint(
            session, assistant_session_id, provider=build_llm_provider(source),
            model=resolved_llm_model(source), on_response=record_usage,
        )
    except LLMRunInterrupted as exc:
        record_failed_usage(exc, status="paused")
        raise
    except (LLMConfigError, LLMError, ProviderError, CompactionRejected, ContextBudgetError) as exc:
        if isinstance(exc, (LLMError, ProviderError)):
            record_failed_usage(exc, status="failed")
        # Do not store model response/error text or fabricate a deterministic successful summary.
        return {
            "status": "failed", "assistant_session_id": assistant_session_id,
            "code": "context_budget" if isinstance(exc, ContextBudgetError) else "compaction_rejected",
            "message_count": len(messages),
            "compacted_message_count": max(0, len(messages) - COMPACTION_RETAINED_MESSAGE_COUNT),
            "retained_message_count": min(len(messages), COMPACTION_RETAINED_MESSAGE_COUNT),
        }
