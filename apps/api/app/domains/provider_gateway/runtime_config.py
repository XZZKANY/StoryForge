from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, Field

ProviderCapability = Literal["llm", "embedding", "reranker"]


class ProviderRuntimeConfig(BaseModel):
    """从环境变量解析出的运行时 provider 配置，不承载真实密钥值。"""

    capability: ProviderCapability
    provider_name: str = Field(min_length=1)
    model_name: str = Field(min_length=1)
    api_base_url: str | None = None
    api_key_configured: bool = False
    timeout_seconds: int | None = Field(default=None, ge=1)
    max_retries: int | None = Field(default=None, ge=0)
    resolution_source: Literal["environment", "fallback"]
    credential_status: Literal["configured", "missing_fallback", "not_required"]
    configured_provider_name: str | None = None
    configured_model_name: str | None = None

    @property
    def model_aliases(self) -> dict[str, str | int | None]:
        """对外暴露统一模型别名，避免调用方直接读取环境变量。"""

        aliases: dict[str, str | int | None] = {
            "default": self.model_name,
            "credential_status": self.credential_status,
        }
        if self.configured_provider_name is not None:
            aliases["configured_provider"] = self.configured_provider_name
        if self.configured_model_name is not None:
            aliases["configured_model"] = self.configured_model_name
        if self.timeout_seconds is not None:
            aliases["timeout_seconds"] = self.timeout_seconds
        if self.max_retries is not None:
            aliases["max_retries"] = self.max_retries
        if self.api_base_url is not None:
            aliases["api_base_url"] = self.api_base_url
        return aliases


@lru_cache(maxsize=3)
def load_runtime_provider_config(capability: ProviderCapability) -> ProviderRuntimeConfig:
    """按能力读取 Phase 5 provider 环境变量，并缓存进程内稳定配置。"""

    if capability == "llm":
        return _load_llm_config()
    if capability == "embedding":
        return _load_embedding_config()
    return _load_reranker_config()


def _load_llm_config() -> ProviderRuntimeConfig:
    provider_name = _env("STORYFORGE_LLM_PROVIDER", "deterministic")
    model_name = _env("STORYFORGE_LLM_MODEL", "storyforge-deterministic-writer")
    api_key_configured = bool(_env("STORYFORGE_LLM_API_KEY", ""))
    if _does_not_need_key(provider_name) or api_key_configured:
        return ProviderRuntimeConfig(
            capability="llm",
            provider_name=provider_name,
            model_name=model_name,
            api_base_url=_optional_env_any("STORYFORGE_LLM_API_BASE_URL", "STORYFORGE_LLM_BASE_URL"),
            api_key_configured=api_key_configured,
            timeout_seconds=_int_env("STORYFORGE_LLM_TIMEOUT_SECONDS"),
            max_retries=_int_env("STORYFORGE_LLM_MAX_RETRIES"),
            resolution_source="environment",
            credential_status="not_required" if _does_not_need_key(provider_name) else "configured",
        )
    return ProviderRuntimeConfig(
        capability="llm",
        provider_name="deterministic",
        model_name="storyforge-deterministic-writer",
        api_key_configured=False,
        resolution_source="fallback",
        credential_status="missing_fallback",
        configured_provider_name=provider_name,
        configured_model_name=model_name,
    )


def _load_embedding_config() -> ProviderRuntimeConfig:
    provider_name = _env("STORYFORGE_EMBEDDING_PROVIDER", "local")
    model_name = _env("STORYFORGE_EMBEDDING_MODEL", "storyforge-fake-embedding")
    api_key_configured = bool(_env("STORYFORGE_EMBEDDING_API_KEY", ""))
    if _does_not_need_key(provider_name) or api_key_configured:
        return ProviderRuntimeConfig(
            capability="embedding",
            provider_name=provider_name,
            model_name=model_name,
            api_base_url=_optional_env("STORYFORGE_EMBEDDING_API_BASE_URL"),
            api_key_configured=api_key_configured,
            resolution_source="environment",
            credential_status="not_required" if _does_not_need_key(provider_name) else "configured",
        )
    return ProviderRuntimeConfig(
        capability="embedding",
        provider_name="local",
        model_name="storyforge-fake-embedding",
        api_key_configured=False,
        resolution_source="fallback",
        credential_status="missing_fallback",
        configured_provider_name=provider_name,
        configured_model_name=model_name,
    )


def _load_reranker_config() -> ProviderRuntimeConfig:
    provider_name = _env("STORYFORGE_RERANKER_PROVIDER", "disabled")
    model_name = _env("STORYFORGE_RERANKER_MODEL", "disabled")
    api_key_configured = bool(_env("STORYFORGE_RERANKER_API_KEY", ""))
    if _does_not_need_key(provider_name) or api_key_configured:
        return ProviderRuntimeConfig(
            capability="reranker",
            provider_name=provider_name,
            model_name=model_name or "disabled",
            api_base_url=_optional_env("STORYFORGE_RERANKER_API_BASE_URL"),
            api_key_configured=api_key_configured,
            resolution_source="environment",
            credential_status="not_required" if _does_not_need_key(provider_name) else "configured",
        )
    return ProviderRuntimeConfig(
        capability="reranker",
        provider_name="disabled",
        model_name="disabled",
        api_key_configured=False,
        resolution_source="fallback",
        credential_status="missing_fallback",
        configured_provider_name=provider_name,
        configured_model_name=model_name,
    )


def _does_not_need_key(provider_name: str) -> bool:
    return provider_name.lower() in {"deterministic", "local", "disabled", "mock"}


def _env(name: str, default: str) -> str:
    value = os.getenv(name)
    return value.strip() if value and value.strip() else default


def _optional_env(name: str) -> str | None:
    value = os.getenv(name)
    return value.strip() if value and value.strip() else None


def _optional_env_any(*names: str) -> str | None:
    """按优先级读取等价环境变量，兼容真实 smoke 与 Provider 预检命名。"""

    for name in names:
        value = _optional_env(name)
        if value is not None:
            return value
    return None


def _int_env(name: str) -> int | None:
    value = _optional_env(name)
    if value is None:
        return None
    return int(value)
