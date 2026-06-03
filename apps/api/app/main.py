from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from limits import parse as parse_limit
from limits.storage import MemoryStorage
from limits.strategies import FixedWindowRateLimiter
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.common.auth import InvalidTokenError, verify_access_token
from app.common.config import ensure_production_settings
from app.common.exceptions import DomainError
from app.common.logging_config import configure_logging, get_logger
from app.common.metrics import setup_metrics
from app.common.middleware import RequestLoggingMiddleware, SecurityHeadersMiddleware
from app.common.sentry_config import init_sentry
from app.domains.analytics.router import router as analytics_router
from app.domains.artifacts.router import router as artifacts_router
from app.domains.assets.router import router as assets_router
from app.domains.assistant.router import router as assistant_router
from app.domains.batch_refinement.router import router as batch_refinement_router
from app.domains.batch_refinery.router import router as batch_refinery_router
from app.domains.blueprints.router import router as blueprints_router
from app.domains.book_runs.router import router as book_runs_router
from app.domains.character_bible.router import router as character_bible_router
from app.domains.collaboration.router import router as collaboration_router
from app.domains.commercial.router import router as commercial_router
from app.domains.continuity.router import router as continuity_router
from app.domains.evaluations.router import router as evaluations_router
from app.domains.events.router import router as events_router
from app.domains.exports.router import router as exports_router
from app.domains.health.router import router as health_router
from app.domains.ide.router import router as ide_router
from app.domains.judge.router import router as judge_router
from app.domains.model_runs.router import router as model_runs_router
from app.domains.prompt_packs.router import router as prompt_packs_router
from app.domains.provider_gateway.router import router as provider_gateway_router
from app.domains.quality.router import router as quality_router
from app.domains.repair.router import router as repair_router
from app.domains.retrieval.router import router as retrieval_router
from app.domains.runtime_tools.router import router as runtime_tools_router
from app.domains.scene_packets.router import router as scene_packets_router
from app.domains.series.router import router as series_router
from app.domains.studio.router import router as studio_router
from app.domains.style_packs.router import router as style_packs_router
from app.domains.timeline.router import router as timeline_router
from app.domains.workspaces.router import router as workspaces_router
from app.domains.worldbuilding.router import router as worldbuilding_router

logger = get_logger(__name__)

_PUBLIC_PATHS = {"/health", "/health/live", "/health/ready", "/metrics", "/openapi.json", "/docs", "/redoc"}
_API_KEY_HEADER = "x-storyforge-api-key"


def _expected_api_key() -> str:
    """读取本地和部署环境共用的 API Key，未配置时使用开发默认值。"""

    return os.getenv("STORYFORGE_API_KEY", "local-dev-key")


def warn_default_credentials() -> None:
    """非开发环境使用本地默认 API Key 时写入启动告警。"""

    if os.getenv("STORYFORGE_ENV", "development") != "development" and _expected_api_key() == "local-dev-key":
        logger.warning("STORYFORGE_API_KEY is set to default value in non-development environment!")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    ensure_production_settings()
    init_sentry()
    configure_logging()
    warn_default_credentials()
    logger.info("storyforge_api_started")
    yield


app = FastAPI(title="StoryForge API", version="0.1.0", lifespan=lifespan)

setup_metrics(app)


def _cors_origins() -> list[str]:
    """从环境变量读取允许的 Web 来源，默认覆盖本地开发端口。"""

    raw_value = os.getenv("STORYFORGE_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    return [origin.strip() for origin in raw_value.split(",") if origin.strip()]


def _rate_limit_key(request: Request) -> str:
    """优先按 API Key 聚合限流，缺少时回退到客户端地址。"""

    return request.headers.get(_API_KEY_HEADER) or get_remote_address(request)


def _request_timeout_seconds() -> float:
    """读取请求处理超时上限，配置无效时回退到默认值。"""

    raw_value = os.getenv("STORYFORGE_REQUEST_TIMEOUT_SECONDS", "120")
    try:
        timeout = float(raw_value)
    except ValueError:
        return 120.0
    return timeout if timeout > 0 else 120.0


limiter = Limiter(key_func=_rate_limit_key)

_rate_store = MemoryStorage()
_rate_strategy = FixedWindowRateLimiter(_rate_store)
_READ_LIMIT = parse_limit("120/minute")
_WRITE_LIMIT = parse_limit("60/minute")
_BATCH_LIMIT = parse_limit("10/minute")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["content-type", "x-storyforge-api-key", "authorization"],
)
app.state.limiter = limiter


@app.middleware("http")
async def enforce_request_timeout(request: Request, call_next):
    """限制单个请求的处理时长，避免下游永久占用工作线程。"""

    try:
        return await asyncio.wait_for(call_next(request), timeout=_request_timeout_seconds())
    except TimeoutError:
        return JSONResponse(status_code=504, content={"detail": "请求处理超时。"})


@app.middleware("http")
async def enforce_tiered_rate_limit(request: Request, call_next):
    """按 API Key 实施分层限流：批量 10/min、写入 60/min、读取 120/min。"""

    if request.method == "OPTIONS" or request.url.path in _PUBLIC_PATHS:
        return await call_next(request)

    key = _rate_limit_key(request)
    path = request.url.path

    if path.startswith("/api/batch-refinery"):
        limit = _BATCH_LIMIT
    elif request.method in ("POST", "PATCH", "DELETE"):
        limit = _WRITE_LIMIT
    else:
        limit = _READ_LIMIT

    if not _rate_strategy.hit(limit, "rate", key):
        return JSONResponse(status_code=429, content={"detail": "请求频率超限，请稍后重试。"})

    return await call_next(request)


@app.middleware("http")
async def require_authentication(request: Request, call_next):
    """双模认证：服务间通信密钥头或用户会话头。"""

    if request.method == "OPTIONS" or request.url.path in _PUBLIC_PATHS:
        return await call_next(request)

    api_key = request.headers.get(_API_KEY_HEADER)
    if api_key:
        if api_key != _expected_api_key():
            return JSONResponse(status_code=401, content={"detail": "无效的 API Key。"})
        return await call_next(request)

    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        try:
            payload = verify_access_token(token)
            request.state.user_id = payload.user_id
            request.state.user_role = payload.role
        except InvalidTokenError as exc:
            return JSONResponse(status_code=401, content={"detail": str(exc)})
        return await call_next(request)

    return JSONResponse(status_code=401, content={"detail": "缺少认证凭据。"})


app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(SecurityHeadersMiddleware)


@app.get(
    "/health",
    tags=["运行状态"],
    summary="顶层健康检查",
)
@limiter.exempt
def health_check() -> dict[str, str]:
    """提供无需认证的本地和部署健康检查；仅证明进程存活，不检查外部依赖。"""

    return {"status": "ok", "service": "storyforge-api"}

app.include_router(health_router)
app.include_router(ide_router)
for _route in health_router.routes:
    if hasattr(_route, "endpoint"):
        limiter.exempt(_route.endpoint)
app.include_router(artifacts_router)
app.include_router(assistant_router)
app.include_router(analytics_router)
app.include_router(assets_router)
app.include_router(blueprints_router)
app.include_router(book_runs_router)
app.include_router(character_bible_router)
app.include_router(evaluations_router)
app.include_router(events_router)
app.include_router(batch_refinement_router)
app.include_router(batch_refinery_router)
app.include_router(collaboration_router)
app.include_router(commercial_router)
app.include_router(continuity_router)
app.include_router(exports_router)
app.include_router(judge_router)
app.include_router(model_runs_router)
app.include_router(provider_gateway_router)
app.include_router(prompt_packs_router)
app.include_router(quality_router)
app.include_router(repair_router)
app.include_router(retrieval_router)
app.include_router(runtime_tools_router)
app.include_router(scene_packets_router)
app.include_router(style_packs_router)
app.include_router(studio_router)
app.include_router(series_router)
app.include_router(timeline_router)
app.include_router(workspaces_router)
app.include_router(worldbuilding_router)


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})
