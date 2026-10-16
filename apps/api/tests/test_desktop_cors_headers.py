from __future__ import annotations

import re
from pathlib import Path

import pytest

FRONTEND_SRC = Path(__file__).resolve().parents[3] / "apps" / "desktop" / "frontend" / "src"
DESKTOP_ORIGINS = ["http://localhost:3007", "http://tauri.localhost", "tauri://localhost"]


def desktop_custom_headers() -> set[str]:
    """桌面端源码里出现的每个 X-StoryForge-* 请求头（浏览器跨域发它们之前都要先过预检）。"""

    found: set[str] = set()
    for path in FRONTEND_SRC.rglob("*"):
        if path.suffix in {".ts", ".tsx"} and ".test." not in path.name:
            found.update(re.findall(r"X-StoryForge-[A-Za-z-]+", path.read_text(encoding="utf-8")))
    return {header.lower() for header in found}


def preflight(client, path: str, origin: str, headers: str):
    return client.options(path, headers={
        "Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": headers,
    })


def test_the_desktop_sends_the_headers_this_test_knows_about():
    # 扫描本身没有失效：至少认得现有的三个头。
    assert {"x-storyforge-api-key", "x-storyforge-host-generation", "x-storyforge-shadow"} <= desktop_custom_headers()


@pytest.mark.parametrize("origin", DESKTOP_ORIGINS)
def test_every_custom_header_the_desktop_sends_passes_the_preflight(client, origin):
    for header in sorted(desktop_custom_headers()):
        response = preflight(client, "/api/assistant/revise", origin, f"content-type,{header}")
        assert response.status_code == 200, header
        assert header in response.headers["access-control-allow-headers"].lower()


@pytest.mark.parametrize("path", ["/api/assistant/revise", "/api/assistant/continue"])
@pytest.mark.parametrize("origin", DESKTOP_ORIGINS)
def test_inline_revise_and_continue_with_the_shadow_header_pass_the_preflight(client, origin, path):
    response = preflight(client, path, origin, "content-type,x-storyforge-api-key,x-storyforge-shadow")
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
