from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from enum import StrEnum


class CapabilitySource(StrEnum):
    STATIC = "static"
    CONFIGURED = "configured"
    PROBED = "probed"
    FALLBACK = "fallback"


@dataclass(frozen=True)
class ProviderCapabilities:
    streaming: bool | None = None
    native_tools: bool | None = None
    prompt_tool_fallback: bool = False
    parallel_tool_calls: bool | None = None
    tool_choice: bool | None = None
    system_messages: bool = True
    reasoning: bool | None = None
    usage: bool | None = None
    json_response: bool | None = None
    max_context_tokens: int | None = None
    max_output_tokens: int | None = None
    source: CapabilitySource = CapabilitySource.FALLBACK
    reason: str | None = None


def resolve_capabilities(
    model: str,
    *,
    configured: Mapping[str, ProviderCapabilities] | None = None,
    verified: Mapping[str, ProviderCapabilities] | None = None,
    static: ProviderCapabilities | None = None,
    fallback: ProviderCapabilities | None = None,
) -> ProviderCapabilities:
    """Resolve one model descriptor without guessing unknown capabilities."""

    for source, candidates in (
        (CapabilitySource.CONFIGURED, configured),
        (CapabilitySource.PROBED, verified),
    ):
        if not candidates:
            continue
        match = candidates.get(model) or candidates.get("*")
        if match is not None:
            return replace(match, source=source)
    if static is not None:
        return replace(static, source=CapabilitySource.STATIC)
    default = fallback or ProviderCapabilities(
        reason="No capability information is available for this model."
    )
    return replace(default, source=CapabilitySource.FALLBACK)
