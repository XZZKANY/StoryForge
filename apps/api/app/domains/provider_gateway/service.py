from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.provider_gateway.models import ProviderConfig
from app.domains.provider_gateway.schemas import ProviderConfigCreate, ProviderResolutionRead
from app.domains.workspaces.models import Workspace


class ProviderGatewayError(ValueError):
    """Provider Gateway 输入缺失或无法解析时抛出。"""


def create_provider_config(session: Session, payload: ProviderConfigCreate) -> ProviderConfig:
    if payload.workspace_id is not None and session.get(Workspace, payload.workspace_id) is None:
        raise ProviderGatewayError("工作区不存在，无法创建 provider 配置。")
    provider = ProviderConfig(**payload.model_dump())
    session.add(provider)
    session.commit()
    session.refresh(provider)
    return provider


def list_provider_configs(session: Session, workspace_id: int | None = None) -> Sequence[ProviderConfig]:
    statement = select(ProviderConfig)
    if workspace_id is None:
        statement = statement.where(ProviderConfig.workspace_id.is_(None))
    else:
        statement = statement.where((ProviderConfig.workspace_id == workspace_id) | (ProviderConfig.workspace_id.is_(None)))
    return session.scalars(statement.order_by(ProviderConfig.priority, ProviderConfig.id)).all()


def resolve_provider(session: Session, capability: str, workspace_id: int | None = None) -> ProviderResolutionRead:
    providers = [provider for provider in list_provider_configs(session, workspace_id) if provider.status == "active" and capability in provider.capabilities]
    if not providers:
        raise ProviderGatewayError("没有可用 provider 支持该能力。")
    provider = sorted(providers, key=lambda item: (item.priority, item.id))[0]
    return ProviderResolutionRead(
        provider_id=provider.id,
        provider_name=provider.provider_name,
        capability=capability,
        model_aliases=provider.model_aliases,
        resolution_summary=f"能力 {capability} 已解析到 {provider.provider_name}。",
    )
