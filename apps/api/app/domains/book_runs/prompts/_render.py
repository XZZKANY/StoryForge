from __future__ import annotations

from collections.abc import Iterable

# 英文任务边界：部分兼容网关模型会忽略纯中文任务说明，这里沿用 longform 已验证的做法。
RETURN_PROSE = (
    "Task: Write part of a Chinese novel. Return only Chinese prose. "
    "Do not ask questions. Do not explain your process. Do not mention code, repository, or workspace."
)
RETURN_STRUCTURED = (
    "Task: Produce a structured Chinese planning result. Return only the requested lines. "
    "Do not add numbering, commentary, or blank lines."
)
RETURN_JSON = (
    "Task: Extract structured facts from a Chinese novel chapter. "
    "Return only a valid JSON array. No markdown fences, no commentary, no blank lines before or after."
)


def _clean(value: str | None) -> str:
    return value.strip() if isinstance(value, str) else ""


def _section(title: str, lines: Iterable[str]) -> str:
    body = [line for line in (_clean(item) for item in lines) if line]
    if not body:
        return ""
    return "【" + title + "】\n" + "\n".join(body)


def _join_sections(sections: Iterable[str]) -> str:
    return "\n\n".join(section for section in sections if section)


clean = _clean
join_sections = _join_sections
section = _section
