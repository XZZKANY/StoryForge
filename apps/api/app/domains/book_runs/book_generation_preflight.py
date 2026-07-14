from __future__ import annotations

from collections.abc import Mapping

from app.common.llm_env import (  # noqa: F401  facade re-export（覆盖链已下沉 app/common/llm_env.py）
    LLM_SETTINGS_ENV_KEYS,
    resolved_llm_env,
)
from app.domains.book_runs.book_generation_llm import env_value as _env_value
from app.domains.book_runs.errors import BookGenerationPreflightError

REQUIRED_REAL_LLM_ENV = (
    "STORYFORGE_LLM_API_KEY",
    "STORYFORGE_LLM_BASE_URL",
    "STORYFORGE_LLM_MODEL",
    "STORYFORGE_LLM_PROVIDER",
)


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


assert_preflight = _assert_preflight
