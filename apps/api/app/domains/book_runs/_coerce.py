"""BookRun 域叶子类型转换工具。

纯函数，无数据库依赖，被 progression / timeline / dispatch 等模块单向引用。
"""
from __future__ import annotations


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _positive_int(value: object) -> int | None:
    return value if isinstance(value, int) and value > 0 else None


def _non_negative_int(value: object) -> int:
    return value if isinstance(value, int) and value > 0 else 0


def _non_negative_float(value: object) -> float:
    return float(value) if isinstance(value, int | float) and value > 0 else 0.0


def _bounded_ratio(value: object) -> float:
    ratio = _non_negative_float(value)
    return min(ratio, 1.0)


def _nested_progress_int(progress: dict, key: str, nested_key: str) -> object:
    value = progress.get(key)
    return value.get(nested_key) if isinstance(value, dict) else None


def _compact_text(value: object, *, max_length: int = 500) -> str:
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    if len(text) <= max_length:
        return text
    return text[:max_length].rstrip()


def _compact_text_list(value: object, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        text = _compact_text(item, max_length=120)
        if text and text not in items:
            items.append(text)
        if len(items) >= limit:
            break
    return items
