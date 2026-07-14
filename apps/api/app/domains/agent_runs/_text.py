"""Agent runtime 内部通用文本/集合原语。

从 runtime.py 抽出的无状态小工具，供 runtime 与 revise_scope 共用，避免循环依赖。"""

from __future__ import annotations


def _optional_string(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _string_arg_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _ordered_unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _compact_text(value: object, *, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    return text if len(text) <= limit else f"{text[:limit].rstrip()}..."


optional_string = _optional_string
string_arg_list = _string_arg_list
ordered_unique = _ordered_unique
compact_text = _compact_text
