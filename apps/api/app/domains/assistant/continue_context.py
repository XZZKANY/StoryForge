"""Public continuation requests cross the same admission seam as loop writers."""

from __future__ import annotations

from app.domains.assistant.schemas import AssistantContextBundle, AssistantContinueRequest
from app.domains.assistant.writing_context import admit_writing_request


def admitted_continue_context(payload: AssistantContinueRequest) -> AssistantContextBundle | None:
    return admit_writing_request(payload, intent="prose.continue").context_bundle
