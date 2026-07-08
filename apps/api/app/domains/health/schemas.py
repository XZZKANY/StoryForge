from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class LivenessResponse(BaseModel):
    status: Literal["alive"]


class ReadinessResponse(BaseModel):
    status: Literal["ready", "degraded"]
    app_version: str
    checks: dict[str, str]
