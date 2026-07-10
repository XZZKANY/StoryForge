from __future__ import annotations

from app.common.redaction import REDACTED, redact_sensitive, redact_sensitive_text, redact_validation_errors


def test_redact_sensitive_preserves_diagnostic_shape_without_secret_values() -> None:
    value = {
        "api_key": "secret-value",
        "nested": {"authorization": "Bearer sk-private-token"},
        "token_usage": 42,
        "credential_status": "configured",
        "has_api_key": True,
    }

    assert redact_sensitive(value) == {
        "api_key": REDACTED,
        "nested": {"authorization": REDACTED},
        "token_usage": 42,
        "credential_status": "configured",
        "has_api_key": True,
    }


def test_redact_sensitive_text_removes_provider_tokens_and_configured_secrets() -> None:
    text = "provider failed: Bearer sk-secret-upstream-value api_key=plain-secret local-runtime-key"

    redacted = redact_sensitive_text(text, extra_secrets=["local-runtime-key"])

    assert "sk-secret-upstream-value" not in redacted
    assert "plain-secret" not in redacted
    assert "local-runtime-key" not in redacted
    assert REDACTED in redacted


def test_validation_error_keeps_sensitive_field_name_but_drops_rejected_value() -> None:
    errors = [
        {
            "type": "extra_forbidden",
            "loc": ("body", "api_key"),
            "msg": "Extra inputs are not permitted",
            "input": "secret-should-not-enter-response",
        }
    ]

    redacted = redact_validation_errors(errors)

    assert redacted[0]["loc"] == ("body", "api_key")
    assert redacted[0]["input"] == REDACTED
