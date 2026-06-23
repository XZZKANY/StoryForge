from __future__ import annotations

from app.main import app


def test_main_registers_domain_router_surface() -> None:
    """主应用必须暴露已进入计划范围的 API 域。"""

    registered_paths = {route.path for route in app.routes}

    assert any(path.startswith("/api/agent-runs") for path in registered_paths)
    assert any(path.startswith("/api/studio") for path in registered_paths)
    assert any(path.startswith("/api/retrieval") for path in registered_paths)
    assert any(path.startswith("/api/model-runs") for path in registered_paths)
    assert any(path.startswith("/api/judge") for path in registered_paths)
    assert any(path.startswith("/api/worldbuilding") for path in registered_paths)
    assert any(path.startswith("/api/analytics") for path in registered_paths)
    assert any(path.startswith("/api/collaboration") for path in registered_paths)
    assert any(path.startswith("/api/commercial") for path in registered_paths)
    assert any(path.startswith("/api/quality") for path in registered_paths)
    assert any(path.startswith("/api/workspaces") for path in registered_paths)
