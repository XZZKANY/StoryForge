from __future__ import annotations

from fastapi import FastAPI

from app.domains.assets.router import router as assets_router

app = FastAPI(title="StoryForge API", version="0.1.0")
app.include_router(assets_router)
