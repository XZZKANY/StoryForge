from __future__ import annotations

import asyncio
import base64

from fastapi import status

from app.domains.ide import router


def _protocol_for(api_key: str) -> str:
    encoded = base64.urlsafe_b64encode(api_key.encode("utf-8")).decode("ascii").rstrip("=")
    return f"storyforge-api-key.{encoded}"


def test_agent_websocket_auth_accepts_api_key_subprotocol() -> None:
    assert router._api_key_from_websocket_protocol(_protocol_for("local-dev-key")) == "local-dev-key"


def test_agent_websocket_auth_ignores_unrelated_or_malformed_subprotocols() -> None:
    header = f"chat.v1, storyforge-api-key.not-base64$, {_protocol_for('fallback-key')}"

    assert router._api_key_from_websocket_protocol(header) == "fallback-key"


class FakeWebSocket:
    def __init__(self, headers: dict[str, str], query_params: dict[str, str] | None = None) -> None:
        self.headers = headers
        self.query_params = query_params or {}
        self.accepted_protocol: str | None = None
        self.closed_code: int | None = None

    async def accept(self, *, subprotocol: str | None = None) -> None:
        self.accepted_protocol = subprotocol

    async def close(self, *, code: int) -> None:
        self.closed_code = code


def test_agent_websocket_auth_echoes_browser_subprotocol(monkeypatch) -> None:
    monkeypatch.setattr(router, "_expected_api_key", lambda: "private-runtime-key")
    protocol = _protocol_for("private-runtime-key")
    websocket = FakeWebSocket({"sec-websocket-protocol": protocol})

    accepted = asyncio.run(router._accept_or_reject_agent_socket(websocket))

    assert accepted is True
    assert websocket.accepted_protocol == protocol
    assert websocket.closed_code is None


def test_agent_websocket_auth_rejects_query_key(monkeypatch) -> None:
    monkeypatch.setattr(router, "_expected_api_key", lambda: "private-runtime-key")
    websocket = FakeWebSocket({}, {"api_key": "private-runtime-key"})

    accepted = asyncio.run(router._accept_or_reject_agent_socket(websocket))

    assert accepted is False
    assert websocket.accepted_protocol is None
    assert websocket.closed_code == status.WS_1008_POLICY_VIOLATION
