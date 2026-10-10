from __future__ import annotations

from starlette.routing import WebSocketRoute

from app.main import app

# W4：死域冻结隔离——已卸载 router 的冻结域。见 app/domains/DOMAINS.md。
# 本断言即回滚护栏：任何一域被重新 include_router 即变红。
FROZEN_UNMOUNTED_PREFIXES = (
    "/api/analytics",
    "/api/assets",
    "/api/batch-refinery",
    "/api/collaboration",
    "/api/commercial",
    "/api/evaluations",
    "/api/prompt-packs",
    "/api/series",
    "/api/workspaces",
    "/api/worldbuilding",
)

# 2026-10：桌面端是唯一客户端，实际只调这三个 /api 前缀（加 /health）。
LIVE_MOUNTED_PREFIXES = ("/api/agent-runs", "/api/assistant", "/api/ide")

# 2026-10：桌面端零调用，router 已卸载；service/models 保留（judge / repair / studio
# 的 live 可达函数经 agent loop 与 /api/ide/commands 进程内调用，覆盖见各自 service 测试）。
# 回滚 = 把对应 include_router 加回 main.py。
DESKTOP_UNUSED_UNMOUNTED_PREFIXES = (
    "/api/artifacts",
    "/api/blueprints",
    "/api/character-bible",
    "/api/continuity",
    "/api/events",
    "/api/judge",
    "/api/model-runs",
    "/api/provider-gateway",
    "/api/quality",
    "/api/repair",
    "/api/retrieval",
    "/api/runtime-tools",
    "/api/scene-packets",
    "/api/studio",
    "/api/style-packs",
    "/api/timeline-events",
)


def test_main_registers_domain_router_surface() -> None:
    """主应用必须暴露桌面端真正调用的 live API 域。"""

    registered_paths = {route.path for route in app.routes}

    for prefix in LIVE_MOUNTED_PREFIXES:
        assert any(path.startswith(prefix) for path in registered_paths), prefix


def test_api_surface_is_limited_to_desktop_consumed_prefixes() -> None:
    """/api 下不得出现桌面端用不到的前缀（可证伪：任挂回一个 router 即红）。"""

    prefixes = {
        "/api/" + path.removeprefix("/api/").split("/", 1)[0].split("{", 1)[0]
        for path in {route.path for route in app.routes if "/__test__/" not in route.path}
        if path.startswith("/api/")
    }

    assert prefixes == set(LIVE_MOUNTED_PREFIXES), sorted(prefixes)


def test_desktop_unused_domain_routers_stay_unmounted() -> None:
    """2026-10 卸载的 16 个桌面端零调用域不得重新 include_router（回滚护栏）。"""

    registered_paths = {route.path for route in app.routes if "/__test__/" not in route.path}
    for prefix in DESKTOP_UNUSED_UNMOUNTED_PREFIXES:
        assert not any(path.startswith(prefix) for path in registered_paths), (
            f"{prefix} 桌面端零调用、router 已于 2026-10 卸载，不应重新 include_router"
            "（见 app/domains/DOMAINS.md）。"
        )


def test_agent_websocket_route_stays_retired() -> None:
    """Desktop Agent 已收口到本地 SSE/REST，旧双向路由不得重新注册。"""

    websocket_paths = {route.path for route in app.routes if isinstance(route, WebSocketRoute)}

    assert "/api/ide/agent/sessions/{session_id}" not in websocket_paths


def test_frozen_domain_routers_stay_unmounted() -> None:
    """W4 冻结域的 router 不得注册进 app.routes（回滚护栏，可证伪）。

    过滤 `/__test__/` 限流探针路由：test_api_middleware 会向全局 app 注入
    `/api/batch-refinery/__test__/rate-batch`，那是限流分层测试载体，非域 router。"""

    registered_paths = {route.path for route in app.routes if "/__test__/" not in route.path}
    for prefix in FROZEN_UNMOUNTED_PREFIXES:
        assert not any(path.startswith(prefix) for path in registered_paths), (
            f"{prefix} 属 W4 冻结域，不应重新 include_router（见 app/domains/DOMAINS.md）。"
        )
