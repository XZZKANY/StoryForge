from __future__ import annotations

import pytest


@pytest.mark.parametrize("origin", ["http://localhost:3007", "http://tauri.localhost", "tauri://localhost"])
def test_managed_host_header_is_allowed_from_desktop_but_arbitrary_headers_are_not(client, origin):
    headers = {"Origin": origin, "Access-Control-Request-Method": "POST",
               "Access-Control-Request-Headers": "content-type,x-storyforge-api-key,x-storyforge-host-generation"}
    response = client.options("/api/ide/agent/sessions/live-session/stream", headers=headers)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert "x-storyforge-host-generation" in response.headers["access-control-allow-headers"].lower()
    denied = client.options("/api/ide/agent/sessions/live-session/stream", headers={
        **headers, "Access-Control-Request-Headers": "x-arbitrary-host-authority",
    })
    assert denied.status_code == 400


def test_managed_host_header_does_not_expand_allowed_origins(client):
    response = client.options("/api/ide/agent/sessions/live-session/stream", headers={
        "Origin": "http://unexpected.example", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-storyforge-host-generation",
    })
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
