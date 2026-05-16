from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.provider_gateway.schemas import ProviderConfigCreate, ProviderConfigRead, ProviderResolutionRead
from app.domains.provider_gateway.service import ProviderGatewayError, create_provider_config, list_provider_configs, resolve_provider

router = APIRouter(prefix="/api/provider-gateway", tags=["模型接入层"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("/providers", response_model=ProviderConfigRead, status_code=status.HTTP_201_CREATED)
def create_provider_config_endpoint(payload: ProviderConfigCreate, session: SessionDependency) -> ProviderConfigRead:
    try:
        return create_provider_config(session, payload)
    except ProviderGatewayError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/providers", response_model=list[ProviderConfigRead])
def list_provider_configs_endpoint(
    session: SessionDependency,
    workspace_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[ProviderConfigRead]:
    return list(list_provider_configs(session, workspace_id))


@router.get("/resolve", response_model=ProviderResolutionRead)
def resolve_provider_endpoint(
    capability: Annotated[str, Query(min_length=1)],
    session: SessionDependency,
    workspace_id: Annotated[int | None, Query(gt=0)] = None,
) -> ProviderResolutionRead:
    try:
        return resolve_provider(session, capability, workspace_id)
    except ProviderGatewayError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
