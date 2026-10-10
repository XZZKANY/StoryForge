"""进程级 LLM 配置解析：env → .env settings → llm-provider.json 覆盖链。

从 book_runs.book_generation_preflight 下沉：judge 等被 book_runs 依赖的上游域
也需要吃同一覆盖链，放 common 叶子避免 judge → book_runs 反向依赖。
book_generation_preflight 通过 facade re-export 保持可达性（宪法第 5/6 条）。
"""
from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

from app.common.llm_config_file import MANAGED_CONFIG_MODE, apply_config_slot
from app.common.llm_http import env_value

LLM_SETTINGS_ENV_KEYS = (
    "STORYFORGE_LLM_API_KEY",
    "STORYFORGE_LLM_BASE_URL",
    "STORYFORGE_LLM_API_BASE_URL",
    "STORYFORGE_LLM_MODEL",
    "STORYFORGE_LLM_PROVIDER",
    "STORYFORGE_LLM_TEMPERATURE",
    "STORYFORGE_LLM_TIMEOUT_SECONDS",
    "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS",
    "STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS",
    "STORYFORGE_LLM_RETRY_JITTER_SECONDS",
    "STORYFORGE_LLM_MAX_COMPLETION_TOKENS",
    "STORYFORGE_LLM_REASONING_EFFORT",
    "STORYFORGE_LLM_AUTH_HEADER",
    "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS",
    "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS",
    "STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS",
    "STORYFORGE_LLM_SMOKE_TIME_BUDGET_SECONDS",
    "STORYFORGE_LLM_SMOKE_RECAP_FULL_CHAPTERS",
    "STORYFORGE_LLM_SMOKE_FAST_JUDGE",
    "STORYFORGE_LLM_SMOKE_MAX_CHAPTER_COUNT",
)

POLISH_LLM_ENV_KEYS = {
    "STORYFORGE_POLISH_LLM_PROVIDER": "STORYFORGE_LLM_PROVIDER",
    "STORYFORGE_POLISH_LLM_BASE_URL": "STORYFORGE_LLM_BASE_URL",
    "STORYFORGE_POLISH_LLM_MODEL": "STORYFORGE_LLM_MODEL",
    "STORYFORGE_POLISH_LLM_API_KEY": "STORYFORGE_LLM_API_KEY",
}


class PolishLlmNotConfiguredError(RuntimeError):
    """专用润色模型槽位不完整，且作者未授权本次使用主模型。"""


@dataclass(frozen=True)
class ResolvedPolishLlm:
    resolution_source: Literal["dedicated", "explicit_main_model_override"]
    provider: str
    model: str
    source: Mapping[str, str | None] = field(repr=False)


REQUIRED_REAL_LLM_ENV = (
    "STORYFORGE_LLM_API_KEY",
    "STORYFORGE_LLM_BASE_URL",
    "STORYFORGE_LLM_MODEL",
    "STORYFORGE_LLM_PROVIDER",
)


def missing_llm_env(env: Mapping[str, str | None] | None = None) -> list[str]:
    """列出真实 LLM 调用所需但尚未配置的环境变量名。"""

    source = resolved_llm_env(env)
    return [name for name in REQUIRED_REAL_LLM_ENV if not env_value(source, name)]


def resolved_llm_env(env: Mapping[str, str | None] | None = None) -> Mapping[str, str | None]:
    """返回真实 LLM 调用使用的配置源。

    显式传入 ``env`` 时保持原样，便于测试和 CLI 覆盖；否则以进程环境为优先，
    再用 pydantic-settings 从 .env/.env.local 读取的值补齐缺口。这样桌面端
    直接启动 API、没有先 source .env 时，修订和整书生成也能看到同一份配置。
    """

    if env is not None:
        return env

    source: dict[str, str | None] = {key: os.environ.get(key) for key in LLM_SETTINGS_ENV_KEYS}
    from app.common.config import get_settings

    settings = get_settings()
    settings_values: dict[str, object] = {
        "STORYFORGE_LLM_API_KEY": getattr(settings, "storyforge_llm_api_key", ""),
        "STORYFORGE_LLM_BASE_URL": getattr(settings, "storyforge_llm_base_url", ""),
        "STORYFORGE_LLM_API_BASE_URL": getattr(settings, "storyforge_llm_api_base_url", ""),
        "STORYFORGE_LLM_MODEL": getattr(settings, "storyforge_llm_model", ""),
        "STORYFORGE_LLM_PROVIDER": getattr(settings, "storyforge_llm_provider", ""),
        "STORYFORGE_LLM_TEMPERATURE": getattr(settings, "storyforge_llm_temperature", ""),
        "STORYFORGE_LLM_TIMEOUT_SECONDS": getattr(settings, "storyforge_llm_timeout_seconds", ""),
        "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": getattr(settings, "storyforge_llm_max_completion_tokens", ""),
        "STORYFORGE_LLM_REASONING_EFFORT": getattr(settings, "storyforge_llm_reasoning_effort", ""),
        "STORYFORGE_LLM_AUTH_HEADER": getattr(settings, "storyforge_llm_auth_header", ""),
        "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": getattr(settings, "storyforge_llm_input_cny_per_m_tokens", ""),
        "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": getattr(settings, "storyforge_llm_output_cny_per_m_tokens", ""),
        "STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS": getattr(
            settings, "storyforge_llm_cache_hit_input_cny_per_m_tokens", ""
        ),
        "STORYFORGE_LLM_SMOKE_TIME_BUDGET_SECONDS": getattr(
            settings, "storyforge_llm_smoke_time_budget_seconds", ""
        ),
        "STORYFORGE_LLM_SMOKE_RECAP_FULL_CHAPTERS": getattr(
            settings, "storyforge_llm_smoke_recap_full_chapters", ""
        ),
        "STORYFORGE_LLM_SMOKE_FAST_JUDGE": getattr(settings, "storyforge_llm_smoke_fast_judge", ""),
        "STORYFORGE_LLM_SMOKE_MAX_CHAPTER_COUNT": getattr(
            settings, "storyforge_llm_smoke_max_chapter_count", ""
        ),
    }
    for key, value in settings_values.items():
        if not env_value(source, key) and value not in (None, ""):
            source[key] = str(value)

    config_file = os.environ.get("STORYFORGE_LLM_CONFIG_FILE", "").strip()
    apply_config_slot(
        source, config_file, managed=os.environ.get("STORYFORGE_LLM_CONFIG_MODE") == MANAGED_CONFIG_MODE,
    )

    if not env_value(source, "STORYFORGE_LLM_BASE_URL"):
        source["STORYFORGE_LLM_BASE_URL"] = env_value(source, "STORYFORGE_LLM_API_BASE_URL")
    if not env_value(source, "STORYFORGE_LLM_API_BASE_URL"):
        source["STORYFORGE_LLM_API_BASE_URL"] = env_value(source, "STORYFORGE_LLM_BASE_URL")

    return source


def resolve_polish_llm(
    env: Mapping[str, str | None] | None = None,
    *,
    use_main_model: bool = False,
) -> ResolvedPolishLlm:
    """解析专用润色槽位；缺失时只允许作者显式借用本次主模型。"""

    if use_main_model:
        main_source = dict(resolved_llm_env(env))
        provider, model = _required_slot_identity(main_source, label="主模型")
        return ResolvedPolishLlm("explicit_main_model_override", provider, model, main_source)

    raw = env if env is not None else os.environ
    source = {
        target_key: env_value(raw, polish_key)
        for polish_key, target_key in POLISH_LLM_ENV_KEYS.items()
    }
    if env is None:
        config_file = os.environ.get("STORYFORGE_LLM_CONFIG_FILE", "").strip()
        apply_config_slot(
            source, config_file, managed=os.environ.get("STORYFORGE_LLM_CONFIG_MODE") == MANAGED_CONFIG_MODE,
            polish=True,
        )
    try:
        provider, model = _required_slot_identity(source, label="专用润色模型")
    except PolishLlmNotConfiguredError as exc:
        raise PolishLlmNotConfiguredError(
            "尚未配置专用润色模型；请先在设置中配置，或明确选择本次使用主模型。"
        ) from exc
    return ResolvedPolishLlm("dedicated", provider, model, source)


def _required_slot_identity(source: Mapping[str, str | None], *, label: str) -> tuple[str, str]:
    required = (
        "STORYFORGE_LLM_PROVIDER",
        "STORYFORGE_LLM_BASE_URL",
        "STORYFORGE_LLM_MODEL",
        "STORYFORGE_LLM_API_KEY",
    )
    missing = [name for name in required if not env_value(source, name)]
    if missing:
        raise PolishLlmNotConfiguredError(f"{label}配置不完整：缺少 {', '.join(missing)}。")
    return env_value(source, "STORYFORGE_LLM_PROVIDER").lower(), env_value(source, "STORYFORGE_LLM_MODEL")
