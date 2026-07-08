from __future__ import annotations

import base64

from app.domains.ide.router import _api_key_from_websocket_protocol


def _protocol_for(api_key: str) -> str:
    encoded = base64.urlsafe_b64encode(api_key.encode("utf-8")).decode("ascii").rstrip("=")
    return f"storyforge-api-key.{encoded}"


def test_agent_websocket_auth_accepts_api_key_subprotocol() -> None:
    assert _api_key_from_websocket_protocol(_protocol_for("local-dev-key")) == "local-dev-key"


def test_agent_websocket_auth_ignores_unrelated_or_malformed_subprotocols() -> None:
    header = f"chat.v1, storyforge-api-key.not-base64$, {_protocol_for('fallback-key')}"

    assert _api_key_from_websocket_protocol(header) == "fallback-key"
