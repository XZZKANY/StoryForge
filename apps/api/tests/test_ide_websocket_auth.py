from __future__ import annotations

import asyncio
import base64

from fastapi import status

from app.domains.ide import router


class FakeWebSocket:
    def __init__(self, headers: dict[str, str]) -> None:
        self.headers = headers
        self.accepted_protocol: str | None = None
        self.closed_code: int | None = None

    async def accept(self, *, subprotocol: str | None = None) -> None:
        self.accepted_protocol = subprotocol

    async def close(self, *, code: int) -> None:
        self.closed_code = code


def _protocol(api_key: str) -> str:
    encoded = base64.urlsafe_b64encode(api_key.encode()).decode().rstrip("=")
    return f"storyforge-api-key.{encoded}"


def test_websocket_auth_accepts_browser_subprotocol_without_query_key(monkeypatch) -> None:
    monkeypatch.setattr(router, "_expected_api_key", lambda: "private-runtime-key")
    protocol = _protocol("private-runtime-key")
    websocket = FakeWebSocket({"sec-websocket-protocol": protocol})

    accepted = asyncio.run(router._accept_or_reject_agent_socket(websocket))

    assert accepted is True
    assert websocket.accepted_protocol == protocol
    assert websocket.closed_code is None


def test_websocket_auth_rejects_malformed_or_wrong_subprotocol(monkeypatch) -> None:
    monkeypatch.setattr(router, "_expected_api_key", lambda: "private-runtime-key")
    websocket = FakeWebSocket({"sec-websocket-protocol": "storyforge-api-key.not-valid-utf8___"})

    accepted = asyncio.run(router._accept_or_reject_agent_socket(websocket))

    assert accepted is False
    assert websocket.accepted_protocol is None
    assert websocket.closed_code == status.WS_1008_POLICY_VIOLATION
