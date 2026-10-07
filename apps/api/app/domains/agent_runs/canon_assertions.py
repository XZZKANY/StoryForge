"""Assertion-local metadata shared by canon proposals, tool schemas and projections.

Source references are supplied evidence, not verified entailment or author approval.
"""

from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any

from app.domains.agent_runs.fs_tools import FsToolError

_ASSERTION_LABELS = {
    "author_setting": "作者设定",
    "text_observation": "文本观察",
    "model_inference": "模型推断（待核实）",
    "unknown": "来源类型未知",
}
ASSERTION_METADATA_PROPERTIES: dict[str, Any] = {
    "assertion_type": {
        "type": "string",
        "enum": list(_ASSERTION_LABELS),
        "description": "逐条区分作者设定、文本观察与模型推断；无法判断用 unknown。作者接受不改变来源类型。",
    },
    "evidence": {
        "type": "array",
        "description": "支持本条断言的原文引用，不是实体提及位置或送达记录；没有依据不要编造。工具不验证引文或蕴含关系。",
        "items": {
            "type": "object",
            "properties": {
                "quote": {"type": "string", "minLength": 1},
                "path": {"type": "string", "description": "项目相对路径（可选），不可越界。"},
                "start_line": {"type": "integer", "minimum": 1},
                "end_line": {"type": "integer", "minimum": 1},
            },
            "required": ["quote"],
        },
    },
}


def assertion_metadata(entry: dict[str, Any]) -> dict[str, Any]:
    """Preserve supplied fields without upgrading missing historical provenance."""
    return {key: deepcopy(entry[key]) for key in ASSERTION_METADATA_PROPERTIES if key in entry}


def normalize_assertion_metadata(entry: dict[str, Any], label: str) -> dict[str, Any]:
    metadata = assertion_metadata(entry)
    if "assertion_type" in metadata:
        kind = metadata["assertion_type"]
        if not isinstance(kind, str) or kind not in _ASSERTION_LABELS:
            raise FsToolError(
                f"{label}.assertion_type 必须是 author_setting / text_observation / model_inference / unknown。"
            )
    if "evidence" not in metadata:
        return metadata
    evidence = metadata["evidence"]
    if not isinstance(evidence, list):
        raise FsToolError(f"{label}.evidence 必须是数组。")
    for index, source in enumerate(evidence):
        source_label = f"{label}.evidence[{index}]"
        if not isinstance(source, dict) or not isinstance(source.get("quote"), str) or not source["quote"].strip():
            raise FsToolError(f"{source_label}.quote 必须是非空字符串。")
        # References remain data: validate portable lexical containment, never open paths.
        if "path" in source:
            path = source["path"]
            if not isinstance(path, str) or not path.strip():
                raise FsToolError(f"{source_label}.path 必须是非空项目相对路径。")
            path = path.replace("\\", "/")
            if (
                PurePosixPath(path).is_absolute()
                or PureWindowsPath(path).drive
                or ".." in PurePosixPath(path).parts
                or ":" in path
                or "\x00" in path
            ):
                raise FsToolError(f"{source_label}.path 必须是项目内相对路径。")
        for key in ("start_line", "end_line"):
            if key not in source:
                continue
            line = source[key]
            if not isinstance(line, int) or isinstance(line, bool) or line < 1 or "path" not in source:
                raise FsToolError(f"{source_label}.{key} 必须是带 path 的正整数行号。")
        if "end_line" in source and ("start_line" not in source or source["end_line"] < source["start_line"]):
            raise FsToolError(f"{source_label}.end_line 需要 start_line 且不能早于它。")
    return metadata


def render_assertion_metadata(entry: dict[str, Any]) -> str:
    """Bound only the display, never the declaration; tolerate old author JSON."""
    kind = entry.get("assertion_type")
    label = (
        _ASSERTION_LABELS.get(kind, _ASSERTION_LABELS["unknown"])
        if isinstance(kind, str)
        else _ASSERTION_LABELS["unknown"]
    )
    raw = entry.get("evidence")
    sources = (
        [
            source
            for source in raw
            if isinstance(source, dict) and isinstance(source.get("quote"), str) and source["quote"].strip()
        ]
        if isinstance(raw, list)
        else []
    )
    if not sources:
        return f"{label}；依据未提供"
    refs: list[str] = []
    for source in sources[:2]:
        path = source.get("path")
        location = " ".join(path.split())[:160] if isinstance(path, str) else "位置未提供"
        start, end = source.get("start_line"), source.get("end_line")
        if isinstance(start, int) and not isinstance(start, bool):
            location += f":{start}"
            if isinstance(end, int) and not isinstance(end, bool) and end != start:
                location += f"–{end}"
        quote = " ".join(source["quote"].split())
        snippet = quote[:120] + ("…" if len(quote) > 120 else "")
        refs.append(f"{location}「{snippet}」")
    omitted = f"；另 {len(sources) - 2} 条依据未展开" if len(sources) > 2 else ""
    return f"{label}；声明所附依据（未核验）：{'；'.join(refs)}{omitted}"


def format_chapter_window(entry: dict[str, Any]) -> str:
    """Use the same effective defaults as the scene window filter."""
    start, end = entry.get("from_chapter"), entry.get("to_chapter")
    start = start if isinstance(start, int) and not isinstance(start, bool) else 1
    if isinstance(end, int) and not isinstance(end, bool):
        return f"第 {start}–{end} 章"
    return f"第 {start} 章起（未声明终止）"
