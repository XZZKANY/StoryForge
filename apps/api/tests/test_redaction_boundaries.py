from __future__ import annotations

from fastapi.testclient import TestClient

import app.models  # noqa: F401
from app.common.redaction import REDACTED, is_sensitive_key


def test_validation_error_redacts_rejected_secret_input(client: TestClient) -> None:
    """FastAPI 422 响应可暴露字段名，但不得回显被拒绝的凭据值。"""

    response = client.post(
        "/api/assistant/sessions",
        json={
            "title": "错误凭据测试",
            "task_type": "trial_generation",
            "api_key": "secret-validation-value",
            "messages": [{"role": "user", "content": "写一章"}],
        },
    )

    assert response.status_code == 422, response.text
    assert "api_key" in response.text
    assert "secret-validation-value" not in response.text


def test_redaction_key_detection_preserves_budget_and_usage_fields() -> None:
    assert is_sensitive_key("api_key") is True
    assert is_sensitive_key("access_token") is True
    assert is_sensitive_key("token") is True
    assert is_sensitive_key("token_budget") is False
    assert is_sensitive_key("token_usage") is False
    assert is_sensitive_key("credential_status") is False
    assert is_sensitive_key("has_api_key") is False


def test_agent_safe_summary_redacts_sensitive_keys_and_token_text() -> None:
    from app.domains.agent_runs.runtime import _safe_summary

    summary = _safe_summary(
        {
            "api_key": "secret-summary-value",
            "notes": "Bearer sk-secret-summary-token-123456",
            "content": "正文不应进入摘要全文。",
        }
    )

    assert summary["api_key"] == REDACTED
    assert summary["notes"] == f"Bearer {REDACTED}"
    assert summary["content_chars"] == len("正文不应进入摘要全文。")
