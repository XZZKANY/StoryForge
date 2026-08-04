from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class CapabilitySource(StrEnum):
    STATIC = "static"
    CONFIGURED = "configured"
    PROBED = "probed"
    FALLBACK = "fallback"


@dataclass(frozen=True)
class ProviderCapabilities:
    streaming: bool = True
    native_tools: bool = True
    prompt_tool_fallback: bool = False
    parallel_tool_calls: bool | None = None
    tool_choice: bool | None = None
    system_messages: bool = True
    reasoning: bool | None = None
    usage: bool | None = None
    json_response: bool | None = None
    max_context_tokens: int | None = None
    max_output_tokens: int | None = None
    source: CapabilitySource = CapabilitySource.STATIC
