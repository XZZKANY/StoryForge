from __future__ import annotations

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


def test_main_registers_domain_router_surface() -> None:
    """主应用必须暴露仍在计划范围内的 live / background API 域。"""

    registered_paths = {route.path for route in app.routes}

    assert any(path.startswith("/api/agent-runs") for path in registered_paths)
    assert any(path.startswith("/api/studio") for path in registered_paths)
    assert any(path.startswith("/api/retrieval") for path in registered_paths)
    assert any(path.startswith("/api/model-runs") for path in registered_paths)
    assert any(path.startswith("/api/judge") for path in registered_paths)
    assert any(path.startswith("/api/quality") for path in registered_paths)


def test_frozen_domain_routers_stay_unmounted() -> None:
    """W4 冻结域的 router 不得注册进 app.routes（回滚护栏，可证伪）。

    过滤 `/__test__/` 限流探针路由：test_api_middleware 会向全局 app 注入
    `/api/batch-refinery/__test__/rate-batch`，那是限流分层测试载体，非域 router。"""

    registered_paths = {route.path for route in app.routes if "/__test__/" not in route.path}
    for prefix in FROZEN_UNMOUNTED_PREFIXES:
        assert not any(path.startswith(prefix) for path in registered_paths), (
            f"{prefix} 属 W4 冻结域，不应重新 include_router（见 app/domains/DOMAINS.md）。"
        )
