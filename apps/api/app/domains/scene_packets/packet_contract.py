from __future__ import annotations

from typing import Any, TypedDict

ScenePacketBody = TypedDict(  # noqa: UP013 - Scene Packet 持久化键包含中文，无法用 class syntax 表达。
    "ScenePacketBody",
    {
        "章节目标": str,
        "活跃角色": list[dict[str, Any]],
        "关系状态": list[dict[str, Any]],
        "未回收伏笔": list[dict[str, Any]],
        "风格规则": list[dict[str, Any]],
        "必须包含事实": list[Any],
        "必须规避事实": list[Any],
        "用户意图": str,
        "证据链接": list[dict[str, Any]],
        "上一章摘要": list[Any],
        "章节摘要": str | None,
        "检索片段": list[str],
        "memory_context": list[dict[str, Any]],
        "pacing_directive": dict[str, str],
        "检索命中": list[dict[str, Any]],
        "compiled_context_id": str,
        "上下文注入": list[dict[str, Any]],
        "上下文裁剪": list[dict[str, Any]],
        "上下文预算": dict[str, Any],
        "上下文调试": list[str],
    },
    total=False,
)

SCENE_PACKET_BASE_KEY_ORDER = (
    "章节目标",
    "活跃角色",
    "关系状态",
    "未回收伏笔",
    "风格规则",
    "必须包含事实",
    "必须规避事实",
    "用户意图",
    "证据链接",
    "上一章摘要",
    "章节摘要",
    "检索片段",
)

SCENE_PACKET_CONTEXT_KEY_ORDER = (
    "memory_context",
    "pacing_directive",
    "检索命中",
    "compiled_context_id",
    "上下文注入",
    "上下文裁剪",
    "上下文预算",
    "上下文调试",
)

SCENE_PACKET_REQUIRED_KEYS = (
    "章节目标",
    "活跃角色",
    "关系状态",
    "未回收伏笔",
    "风格规则",
    "必须包含事实",
    "必须规避事实",
    "用户意图",
    "证据链接",
    "检索片段",
)
