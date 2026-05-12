from __future__ import annotations

from fastapi import FastAPI

from app.domains.assets.router import router as assets_router
from app.domains.continuity.router import router as continuity_router
from app.domains.scene_packets.router import router as scene_packets_router

app = FastAPI(title="StoryForge API", version="0.1.0")
app.include_router(assets_router)
app.include_router(continuity_router)
app.include_router(scene_packets_router)
