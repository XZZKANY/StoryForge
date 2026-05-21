from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.requests import Request

from app.domains.artifacts.router import router as artifacts_router
from app.domains.assets.router import router as assets_router
from app.domains.evaluations.router import router as evaluations_router
from app.domains.events.router import router as events_router
from app.domains.batch_refinery.router import router as batch_refinery_router
from app.domains.continuity.router import router as continuity_router
from app.domains.exports.router import router as exports_router
from app.domains.judge.router import router as judge_router
from app.domains.model_runs.router import router as model_runs_router
from app.domains.provider_gateway.router import router as provider_gateway_router
from app.domains.prompt_packs.router import router as prompt_packs_router
from app.domains.repair.router import router as repair_router
from app.domains.retrieval.router import router as retrieval_router
from app.domains.scene_packets.router import router as scene_packets_router
from app.domains.style_packs.router import router as style_packs_router
from app.domains.studio.router import router as studio_router
from app.domains.series.router import router as series_router

from app.common.exceptions import DomainError

app = FastAPI(title="StoryForge API", version="0.1.0")

_PUBLIC_PATHS = {"/health", "/openapi.json", "/docs", "/redoc"}
_API_KEY_HEADER = "x-storyforge-api-key"


def _expected_api_key() -> str:
    """读取本地和部署环境共用的 API Key，未配置时使用开发默认值。"""

    return os.getenv("STORYFORGE_API_KEY", "local-dev-key")


def _cors_origins() -> list[str]:
    """从环境变量读取允许的 Web 来源，默认覆盖本地开发端口。"""

    raw_value = os.getenv("STORYFORGE_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    return [origin.strip() for origin in raw_value.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_storyforge_api_key(request: Request, call_next):
    """保护业务 API；健康检查、文档和浏览器预检保持公开。"""

    if request.method == "OPTIONS" or request.url.path in _PUBLIC_PATHS:
        return await call_next(request)
    if request.headers.get(_API_KEY_HEADER) != _expected_api_key():
        return JSONResponse(status_code=401, content={"detail": "缺少或无效的 API Key。"})
    return await call_next(request)


@app.get("/health", tags=["运行状态"])
def health_check() -> dict[str, str]:
    """提供无需认证的本地和部署健康检查。"""

    return {"status": "ok", "service": "storyforge-api"}

app.include_router(artifacts_router)
app.include_router(assets_router)
app.include_router(evaluations_router)
app.include_router(events_router)
app.include_router(batch_refinery_router)
app.include_router(continuity_router)
app.include_router(exports_router)
app.include_router(judge_router)
app.include_router(model_runs_router)
app.include_router(provider_gateway_router)
app.include_router(prompt_packs_router)
app.include_router(repair_router)
app.include_router(retrieval_router)
app.include_router(scene_packets_router)
app.include_router(style_packs_router)
app.include_router(studio_router)
app.include_router(series_router)


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})
