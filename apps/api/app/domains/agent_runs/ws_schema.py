from __future__ import annotations

from typing import Any

from app.domains.agent_runs.ws_messages import (
    AgentRunStartedFrame,
    AgentStepFrame,
    ControlAckFrame,
    PermissionRequiredFrame,
    TerminalFrame,
    ToolTraceFrame,
    WsFrame,
)

# Agent 实时帧的 JSON Schema 契约文档构建器（历史模块名保留作兼容）。
#
# 从 ws_messages 的 Pydantic 模型派生一份 draft 2020-12 schema，落到
# packages/shared/src/contracts/agent-ws.schema.json（pnpm openapi 生成、drift 门禁校验），
# 前端 SSE/control 帧类型据此派生。单一事实源仍是 Pydantic 模型；本模块只做 model → schema 的确定性投影，
# 不手写字段，故不会成为「第二份手写镜像」。

# 出线顺序即前端判别式解码顺序；新增帧追加到末尾，不要重排（golden/drift 顺序敏感）。
_FRAMES: tuple[type[WsFrame], ...] = (
    AgentRunStartedFrame,
    AgentStepFrame,
    ToolTraceFrame,
    PermissionRequiredFrame,
    TerminalFrame,
    ControlAckFrame,
)


def build_agent_ws_schema() -> dict[str, Any]:
    """装配 Agent 实时帧的 JSON Schema 契约文档（函数名为历史兼容名）。

    每类帧的 model_json_schema() 落到 $defs[帧名]，顶层 oneOf 引用全部帧，
    前端按各帧 type 字段（const / enum）判别解码。
    """

    defs: dict[str, Any] = {}
    for frame in _FRAMES:
        defs[frame.__name__] = frame.model_json_schema(ref_template="#/$defs/{model}")

    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://storyforge.local/contracts/agent-ws.schema.json",
        "title": "StoryForge Agent 实时帧契约",
        "description": (
            "Agent SSE stream 与 REST control 帧的单一事实源（由 app.domains.agent_runs.ws_messages 的 "
            "Pydantic 模型派生）。改字段名 / 增删字段须走后端模型，pnpm openapi 重新生成本文件，"
            "前端派生类型据此漂移即门禁红；agent-ws.schema.json 是保留的历史兼容路径。"
        ),
        "oneOf": [{"$ref": f"#/$defs/{frame.__name__}"} for frame in _FRAMES],
        "$defs": defs,
    }
