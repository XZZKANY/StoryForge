from __future__ import annotations

import os
from collections.abc import Mapping

from app.domains.book_runs.book_generation_llm import _env_value
from app.domains.book_runs.errors import BookGenerationPreflightError

REQUIRED_REAL_LLM_ENV = (
    "STORYFORGE_LLM_API_KEY",
    "STORYFORGE_LLM_BASE_URL",
    "STORYFORGE_LLM_MODEL",
    "STORYFORGE_LLM_PROVIDER",
)

LLM_SETTINGS_ENV_KEYS = (
    "STORYFORGE_LLM_API_KEY",
    "STORYFORGE_LLM_BASE_URL",
    "STORYFORGE_LLM_API_BASE_URL",
    "STORYFORGE_LLM_MODEL",
    "STORYFORGE_LLM_PROVIDER",
    "STORYFORGE_LLM_TEMPERATURE",
    "STORYFORGE_LLM_TIMEOUT_SECONDS",
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


def _apply_llm_config_file(source: dict[str, str | None], path: str) -> None:
    """桌面端把本机 llm-provider.json 视为实时真相：切换模型/服务商后无需重启后端即可生效。"""

    import json

    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return
    if not isinstance(data, dict):
        return
    file_to_env = {
        "provider": "STORYFORGE_LLM_PROVIDER",
        "baseUrl": "STORYFORGE_LLM_BASE_URL",
        "model": "STORYFORGE_LLM_MODEL",
        "apiKey": "STORYFORGE_LLM_API_KEY",
    }
    for file_key, env_key in file_to_env.items():
        value = data.get(file_key)
        if isinstance(value, str) and value.strip():
            source[env_key] = value.strip()


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
        if not _env_value(source, key) and value not in (None, ""):
            source[key] = str(value)

    config_file = os.environ.get("STORYFORGE_LLM_CONFIG_FILE", "").strip()
    if config_file:
        _apply_llm_config_file(source, config_file)

    if not _env_value(source, "STORYFORGE_LLM_BASE_URL"):
        source["STORYFORGE_LLM_BASE_URL"] = _env_value(source, "STORYFORGE_LLM_API_BASE_URL")
    if not _env_value(source, "STORYFORGE_LLM_API_BASE_URL"):
        source["STORYFORGE_LLM_API_BASE_URL"] = _env_value(source, "STORYFORGE_LLM_BASE_URL")

    return source


def missing_book_generation_env(env: Mapping[str, str | None] | None = None) -> list[str]:
    """列出真实 LLM 生成所需但尚未配置的环境变量名。"""

    source = resolved_llm_env(env)
    return [name for name in REQUIRED_REAL_LLM_ENV if not _env_value(source, name)]


def _assert_preflight(
    source: Mapping[str, str | None],
    chapter_count: int,
    token_budget: int,
    target_word_count: int | None = None,
    chapter_word_count_min: int = 600,
    chapter_word_count_max: int = 1600,
    *,
    max_chapter_count: int = 10,
) -> None:
    missing = missing_book_generation_env(source)
    if missing:
        joined = ", ".join(missing)
        raise BookGenerationPreflightError(f"缺少真实 LLM 生成环境变量：{joined}。")
    if max_chapter_count <= 0:
        raise BookGenerationPreflightError("真实 LLM 生成章节上限必须为正数。")
    if chapter_count < 1 or chapter_count > max_chapter_count:
        raise BookGenerationPreflightError(f"真实 LLM 生成只允许 1 到 {max_chapter_count} 章。")
    if token_budget <= 0:
        raise BookGenerationPreflightError("真实 LLM 生成必须设置正数 token_budget。")
    if target_word_count is not None and target_word_count <= 0:
        raise BookGenerationPreflightError("真实 LLM 生成必须设置正数 target_word_count。")
    if chapter_word_count_min <= 0 or chapter_word_count_max <= 0:
        raise BookGenerationPreflightError("真实 LLM 生成章节字数上下限必须为正数。")
    if chapter_word_count_min > chapter_word_count_max:
        raise BookGenerationPreflightError("真实 LLM 生成章节最小字数不能大于最大字数。")
