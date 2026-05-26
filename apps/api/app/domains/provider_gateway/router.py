from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.db.deps import SessionDependency
from app.domains.provider_gateway.schemas import ProviderConfigCreate, ProviderConfigRead, ProviderResolutionRead
from app.domains.provider_gateway.service import (
    ProviderGatewayError,
    create_provider_config,
    list_provider_configs,
    resolve_provider,
)

router = APIRouter(prefix="/api/provider-gateway", tags=["模型接入层"])


@router.post(
    "/providers",
    response_model=ProviderConfigRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建 Provider 配置",
)
def create_provider_config_endpoint(payload: ProviderConfigCreate, session: SessionDependency) -> ProviderConfigRead:
    """登记一条模型 Provider 配置，密钥仅记录引用而不入库明文。"""

    try:
        return create_provider_config(session, payload)
    except ProviderGatewayError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/providers",
    response_model=list[ProviderConfigRead],
    summary="读取 Provider 配置列表",
)
def list_provider_configs_endpoint(
    session: SessionDependency,
    workspace_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[ProviderConfigRead]:
    """按工作区维度列出全部 Provider 配置；不返回明文密钥。"""

    return list(list_provider_configs(session, workspace_id))


@router.get(
    "/resolve",
    response_model=ProviderResolutionRead,
    summary="按能力解析 Provider",
)
def resolve_provider_endpoint(
    capability: Annotated[str, Query(min_length=1)],
    session: SessionDependency,
    workspace_id: Annotated[int | None, Query(gt=0)] = None,
) -> ProviderResolutionRead:
    """按 capability（如 chat、embedding、rerank）解析出当前生效的 Provider。"""

    try:
        return resolve_provider(session, capability, workspace_id)
    except ProviderGatewayError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
