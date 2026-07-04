"""Book generation 异常定义。

W3 起 chat/completions 出网通道下沉到 `app/common/llm_client.py`，异常也随之成为该通道的
一等公民（`LLMError` / `LLMConfigError`）。此处保留 `BookGenerationError` /
`BookGenerationPreflightError` 作为**别名**（同一类对象），使既有 `except` / `isinstance`
判定与 502/422 状态码全部零改动，同时让 `common` 不再反向依赖 book_runs 域。
"""
from __future__ import annotations

from app.common.llm_client import LLMConfigError, LLMError

BookGenerationPreflightError = LLMConfigError
BookGenerationError = LLMError

__all__ = ["BookGenerationError", "BookGenerationPreflightError"]
