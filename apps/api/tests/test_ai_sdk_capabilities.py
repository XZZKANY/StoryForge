from __future__ import annotations

from app.platform.ai_sdk import CapabilitySource, ProviderCapabilities, resolve_capabilities


def test_capability_resolution_uses_configured_verified_static_fallback_order() -> None:
    configured = ProviderCapabilities(streaming=False, reason="disabled locally")
    verified = ProviderCapabilities(native_tools=True, max_context_tokens=200_000)
    static = ProviderCapabilities(streaming=True, native_tools=False)
    fallback = ProviderCapabilities(reason="unknown model")

    assert resolve_capabilities(
        "model-a",
        configured={"model-a": configured},
        verified={"model-a": verified},
        static=static,
        fallback=fallback,
    ).source is CapabilitySource.CONFIGURED
    assert resolve_capabilities(
        "model-a", verified={"model-a": verified}, static=static, fallback=fallback
    ).source is CapabilitySource.PROBED
    assert resolve_capabilities("model-a", static=static, fallback=fallback).source is CapabilitySource.STATIC
    assert resolve_capabilities("model-a", fallback=fallback).source is CapabilitySource.FALLBACK


def test_capability_fallback_keeps_unknown_values_explicit() -> None:
    result = resolve_capabilities("unknown")
    assert result.streaming is None
    assert result.native_tools is None
    assert result.reason == "No capability information is available for this model."
    assert result.source is CapabilitySource.FALLBACK


def test_capability_resolution_supports_wildcard_local_configuration() -> None:
    result = resolve_capabilities(
        "new-model",
        configured={"*": ProviderCapabilities(json_response=False)},
        static=ProviderCapabilities(json_response=True),
    )
    assert result.json_response is False
    assert result.source is CapabilitySource.CONFIGURED
