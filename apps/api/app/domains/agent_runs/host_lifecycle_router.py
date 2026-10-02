from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.db.deps import SessionDependency
from app.domains.agent_runs.host_lifecycle import HOST_LIFECYCLE, host_close_status, require_owned_generation
from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict

router = APIRouter()


class HostCloseRead(BaseModel):
    closing: bool
    in_flight_owners: int
    settled: bool


HostHeader = Annotated[str | None, Header(alias="X-StoryForge-Host-Generation")]


@router.post("/host/closing", response_model=HostCloseRead, summary="封闭受管宿主新执行准入")
def close_host_endpoint(session: SessionDependency, host_generation: HostHeader = None):
    try:
        require_owned_generation(host_generation)
        HOST_LIFECYCLE.begin_close()
        return host_close_status(session)
    except ExternalWritebackConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/host/closing", response_model=HostCloseRead, summary="只读检查受管宿主执行结算")
def read_close_endpoint(session: SessionDependency, host_generation: HostHeader = None):
    try:
        require_owned_generation(host_generation)
        return host_close_status(session)
    except ExternalWritebackConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
