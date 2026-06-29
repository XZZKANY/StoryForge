from __future__ import annotations


def _int_or_none(value: object) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _string_or_none(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value
    return None


def _context_href(compiled_context_id: str | None) -> str | None:
    return f"/ide?inspector={compiled_context_id}" if compiled_context_id else None
