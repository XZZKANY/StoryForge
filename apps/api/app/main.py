from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from limits import parse as parse_limit
from limits.storage import MemoryStorage, storage_from_string
from limits.strategies import FixedWindowRateLimiter
from starlette.requests import Request

from app.common.auth import InvalidTokenError, verify_access_token
from app.common.config import ensure_production_settings, get_settings
from app.common.exceptions import DomainError
from app.common.logging_config import configure_logging, get_logger
from app.common.metrics import setup_metrics
from app.common.middleware import RequestLoggingMiddleware, SecurityHeadersMiddleware
from app.common.redaction import redact_validation_errors
from app.common.sentry_config import init_sentry
from app.common.version import APP_VERSION
from app.db.session import SessionLocal, bootstrap_sqlite_database, get_engine
from app.domains.agent_runs.router import router as agent_runs_router
from app.domains.agent_runs.service import reap_non_terminal_agent_runs
from app.domains.artifacts.router import router as artifacts_router
from app.domains.assets.router import router as assets_router
from app.domains.assistant.router import router as assistant_router
from app.domains.blueprints.router import router as blueprints_router
from app.domains.book_runs.router import router as book_runs_router
from app.domains.character_bible.router import router as character_bible_router
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

_PUBLIC_PATHS = {"/health/live", "/health/ready", "/metrics", "/openapi.json", "/docs", "/redoc"}
_API_KEY_HEADER = "x-storyforge-api-key"


def _expected_api_key() -> str:
    """认证与 ensure_production_settings 必须共用 settings 事实源：
    否则只写在 .env 里的生产 key 能通过启动校验，运行时却仍接受默认值。"""

    return get_settings().storyforge_api_key


def warn_default_credentials() -> None:
    """非开发环境使用本地默认 API Key 时写入启动告警。"""

    settings = get_settings()
    if settings.storyforge_env != "development" and settings.storyforge_api_key == "local-dev-key":
        logger.warning("STORYFORGE_API_KEY is set to default value in non-development environment!")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    ensure_production_settings()
    init_sentry()
    configure_logging()
    warn_default_credentials()
    bootstrap_sqlite_database()
    _log_sqlite_schema_state()
    _log_prompt_layer_state()
    _reap_stale_agent_runs()
    logger.info("storyforge_api_started")
    yield


def _log_sqlite_schema_state() -> None:
    """起服后记录 sqlite schema 纳管状态；sidecar-smoke 以此判定 alembic 收口是否生效
    （冻结 exe 未打进 alembic 脚本时会回退 create_all，此处 managed=False 即暴露）。"""

    try:
        engine = get_engine()
        if engine.dialect.name != "sqlite":
            return
        from app.db import migrations

        revision = migrations.current_revision(engine)
        logger.info(
            "sqlite_schema_ready",
            revision=revision,
            head=migrations.head_revision(engine),
            managed=revision is not None,
        )
    except Exception:  # noqa: BLE001 - 观测性日志失败不应影响起服
        logger.warning("sqlite_schema_state_log_failed", exc_info=True)


def _log_prompt_layer_state() -> None:
    """起服后确认进程内分层 prompt 构建器可用；sidecar-smoke 以此判定 F05 死路是否收口
    （旧版按文件路径桥接相邻 apps/workflow，装机 exe 内该目录不存在会在 bookrun.start 才炸；
    现 prompts 迁入 app.domains.book_runs.prompts 随 collect_submodules('app') 打包，此处即证其装配可达）。"""

    try:
        from app.domains.book_runs.prompts import build_draft_prompt_from_state

        logger.info("prompt_layer_bundled", callable=callable(build_draft_prompt_from_state))
    except Exception:  # noqa: BLE001 - 观测性日志失败不应影响起服
        logger.warning("prompt_layer_state_log_failed", exc_info=True)


def _reap_stale_agent_runs() -> None:
    """起服收尸非终态 AgentRun（进程重启遗留的 running/paused）；失败只告警不阻断起服。

    仅在单进程 sqlite sidecar 下收尸：多 worker 的 Postgres 部署里，本 worker 起服
    绝不能把别的 worker 正在跑的 run 误判为孤儿收掉；且非 sqlite 时不触库连接，
    避免测试/CI 无 DB 时卡在连接超时（与 bootstrap_sqlite_database 同一守卫）。"""

    try:
        if get_engine().dialect.name != "sqlite":
            return
        with SessionLocal() as session:
            count = reap_non_terminal_agent_runs(session)
        logger.info("agent_runs_reaped", count=count)
    except Exception:  # noqa: BLE001 - 起服路径，收尸失败不应让 sidecar 无法启动
        logger.warning("agent_runs_reap_failed", exc_info=True)


app = FastAPI(title="StoryForge API", version=APP_VERSION, lifespan=lifespan)

setup_metrics(app)


def _cors_origins() -> list[str]:
    """从环境变量读取允许的前端来源，默认覆盖桌面和 Web 本地端口。"""

    raw_value = os.getenv(
        "STORYFORGE_CORS_ORIGINS",
        "http://localhost:3007,http://127.0.0.1:3007",
    )
    return [origin.strip() for origin in raw_value.split(",") if origin.strip()]


def _rate_limit_key(request: Request) -> str:
    """优先按 API Key 聚合限流，缺少时回退到客户端地址。"""

    return request.headers.get(_API_KEY_HEADER) or (request.client.host if request.client else "unknown")


def _request_timeout_seconds() -> float:
    """读取请求处理超时上限，配置无效时回退到默认值。"""

    raw_value = os.getenv("STORYFORGE_REQUEST_TIMEOUT_SECONDS", "120")
    try:
        timeout = float(raw_value)
    except ValueError:
        return 120.0
    return timeout if timeout > 0 else 120.0


def _rate_limit_storage_url() -> str | None:
    """生产限流必须使用共享存储，避免多 worker 分片。"""

    redis_url = os.getenv("STORYFORGE_RATE_LIMIT_REDIS_URL") or os.getenv("REDIS_URL")
    if os.getenv("STORYFORGE_ENV", "development") == "production":
        if not redis_url:
            raise RuntimeError("生产环境必须配置 REDIS_URL 或 STORYFORGE_RATE_LIMIT_REDIS_URL 用于共享限流。")
        return redis_url
    return redis_url or None


def _build_rate_limit_storage():
    storage_url = _rate_limit_storage_url()
    if storage_url:
        return storage_from_string(storage_url)
    return MemoryStorage()


_rate_store = _build_rate_limit_storage()
_rate_strategy = FixedWindowRateLimiter(_rate_store)
_READ_LIMIT = parse_limit("120/minute")
_WRITE_LIMIT = parse_limit("60/minute")
_BATCH_LIMIT = parse_limit("10/minute")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    # 打包桌面 app 的 webview 源固定为 tauri://localhost 或 http(s)://tauri.localhost，
    # 与开发 Vite 端口不同，必须放行，否则前端 fetch 后端会 CORS 失败（Failed to fetch）。
    allow_origin_regex=r"^(tauri://localhost|https?://tauri\.localhost)$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["content-type", "x-storyforge-api-key", "authorization"],
)


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


app.include_router(health_router)
app.include_router(agent_runs_router)
app.include_router(ide_router)
app.include_router(artifacts_router)
app.include_router(assistant_router)
app.include_router(assets_router)
app.include_router(blueprints_router)
app.include_router(book_runs_router)
app.include_router(character_bible_router)
app.include_router(evaluations_router)
app.include_router(events_router)
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


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content=jsonable_encoder({"detail": redact_validation_errors(exc.errors())}),
    )
