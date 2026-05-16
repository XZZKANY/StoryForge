from __future__ import annotations

from fastapi import FastAPI

from app.domains.analytics.router import router as analytics_router
from app.domains.assets.router import router as assets_router
from app.domains.collaboration.router import router as collaboration_router
from app.domains.commercial.router import router as commercial_router
from app.domains.events.router import router as events_router
from app.domains.batch_refinery.router import router as batch_refinery_router
from app.domains.continuity.router import router as continuity_router
from app.domains.exports.router import router as exports_router
from app.domains.judge.router import router as judge_router
from app.domains.provider_gateway.router import router as provider_gateway_router
from app.domains.quality.router import router as quality_router
from app.domains.repair.router import router as repair_router
from app.domains.scene_packets.router import router as scene_packets_router
from app.domains.style_packs.router import router as style_packs_router
from app.domains.series.router import router as series_router
from app.domains.workspaces.router import router as workspaces_router
from app.domains.worldbuilding.router import router as worldbuilding_router

app = FastAPI(title="StoryForge API", version="0.1.0")
app.include_router(analytics_router)
app.include_router(assets_router)
app.include_router(collaboration_router)
app.include_router(commercial_router)
app.include_router(events_router)
app.include_router(batch_refinery_router)
app.include_router(continuity_router)
app.include_router(exports_router)
app.include_router(judge_router)
app.include_router(provider_gateway_router)
app.include_router(quality_router)
app.include_router(repair_router)
app.include_router(scene_packets_router)
app.include_router(style_packs_router)
app.include_router(series_router)
app.include_router(workspaces_router)
app.include_router(worldbuilding_router)
