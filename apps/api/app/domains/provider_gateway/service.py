from __future__ import annotations

from collections.abc import Sequence
import os

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.common.exceptions import InputError
from app.common.redis_cache import cache_delete_pattern, cache_get_json, cache_set_json

from app.domains.provider_gateway.models import ProviderConfig
from app.domains.provider_gateway.runtime_config import ProviderCapability, load_runtime_provider_config
from app.domains.provider_gateway.schemas import ProviderConfigCreate, ProviderResolutionRead
from app.domains.workspaces.models import Workspace


class ProviderGatewayError(InputError):
    """Provider Gateway 输入缺失或无法解析时抛出。"""


def _provider_cache_ttl_seconds() -> int:
    raw_value = os.getenv("STORYFORGE_PROVIDER_CACHE_TTL_SECONDS", "60")
    try:
        value = int(raw_value)
    except ValueError:
        return 60
    return value if value > 0 else 60


def _provider_resolution_cache_key(capability: ProviderCapability, workspace_id: int | None) -> str:
    scope = "global" if workspace_id is None else f"workspace:{workspace_id}"
    return f"storyforge:provider-resolution:{scope}:{capability}"


def _invalidate_provider_resolution_cache(workspace_id: int | None) -> None:
    cache_delete_pattern("storyforge:provider-resolution:global:*")
    if workspace_id is not None:
        cache_delete_pattern(f"storyforge:provider-resolution:workspace:{workspace_id}:*")
    else:
        cache_delete_pattern("storyforge:provider-resolution:workspace:*")


def create_provider_config(session: Session, payload: ProviderConfigCreate) -> ProviderConfig:
    if payload.workspace_id is not None and session.get(Workspace, payload.workspace_id) is None:
        raise ProviderGatewayError("工作区不存在，无法创建 provider 配置。")
    provider = ProviderConfig(**payload.model_dump())
    session.add(provider)
    session.commit()
    session.refresh(provider)
    _invalidate_provider_resolution_cache(provider.workspace_id)
    return provider


def list_provider_configs(session: Session, workspace_id: int | None = None) -> Sequence[ProviderConfig]:
    statement = select(ProviderConfig)
    if workspace_id is None:
        statement = statement.where(ProviderConfig.workspace_id.is_(None))
    else:
        statement = statement.where((ProviderConfig.workspace_id == workspace_id) | (ProviderConfig.workspace_id.is_(None)))
    return session.scalars(statement.order_by(ProviderConfig.priority, ProviderConfig.id)).all()


def resolve_provider(session: Session, capability: str, workspace_id: int | None = None) -> ProviderResolutionRead:
    normalized_capability = _normalize_capability(capability)
    cache_key = _provider_resolution_cache_key(normalized_capability, workspace_id)
    cached_resolution = cache_get_json(cache_key)
    if cached_resolution is not None:
        return ProviderResolutionRead(**cached_resolution)
    providers = [
        provider
        for provider in list_provider_configs(session, workspace_id)
        if provider.status == "active" and normalized_capability in provider.capabilities
    ]
    if not providers:
        resolution = _resolve_runtime_fallback(normalized_capability)
    else:
        provider = sorted(providers, key=lambda item: (item.priority, item.id))[0]
        resolution = ProviderResolutionRead(
            provider_id=provider.id,
            provider_name=provider.provider_name,
            capability=normalized_capability,
            model_aliases=provider.model_aliases,
            resolution_summary=f"能力 {normalized_capability} 已解析到 {provider.provider_name}。",
            resolution_source="database",
            credential_status="reference_configured" if provider.credential_ref else "reference_missing",
        )
    cache_set_json(cache_key, resolution.model_dump(), _provider_cache_ttl_seconds())
    return resolution


def _normalize_capability(capability: str) -> ProviderCapability:
    normalized = capability.strip().lower()
    if normalized not in {"llm", "embedding", "reranker"}:
        raise ProviderGatewayError("Provider 能力仅支持 llm、embedding、reranker。")
    return normalized  # type: ignore[return-value]


def _resolve_runtime_fallback(capability: ProviderCapability) -> ProviderResolutionRead:
    runtime_config = load_runtime_provider_config(capability)
    if runtime_config.resolution_source == "fallback":
        summary = (
            f"能力 {capability} 未找到数据库 provider，且配置的 "
            f"{runtime_config.configured_provider_name} 缺少密钥，已回退到 {runtime_config.provider_name}。"
        )
    else:
        summary = f"能力 {capability} 未找到数据库 provider，已使用环境配置 {runtime_config.provider_name}。"
    return ProviderResolutionRead(
        provider_id=None,
        provider_name=runtime_config.provider_name,
        capability=capability,
        model_aliases=runtime_config.model_aliases,
        resolution_summary=summary,
        resolution_source=runtime_config.resolution_source,
        credential_status=runtime_config.credential_status,
    )
