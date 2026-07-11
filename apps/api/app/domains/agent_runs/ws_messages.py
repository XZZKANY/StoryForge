from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# Agent 实时帧的 Pydantic 单一事实源（历史模块名保留作兼容）。
#
# 帧形状只在这里定义：event_encoders 只做 run/event → 帧的字段装配，
# agent-ws.schema.json 从这些模型的 model_json_schema() 派生，前端 SSE/control
# 类型据此生成。改一个字段名即三处（后端模型 / schema / 前端类型）联动，漂移即红。
#
# 字段顺序、可空性、None 键的保留都是硬契约——历史 dict 编码器一律带 None 键
# （前端按 type 判别式解码后按需取键），故 to_wire() 不得 exclude_none。


class WsFrame(BaseModel):
    model_config = ConfigDict(extra="forbid")

    def to_wire(self) -> dict[str, Any]:
        """编码成前端消费的 Agent 帧 dict。保留 None 键、按字段定义顺序输出。"""

        return self.model_dump()


class AgentRunStartedFrame(WsFrame):
    type: Literal["agent_run_started"] = "agent_run_started"
    session_id: str
    run_id: str
    user_message: str
    event_id: int
    agent_role_hints: list[str] = Field(default_factory=list)
    agent_role_mentions: list[str] = Field(default_factory=list)


class AgentStepFrame(WsFrame):
    type: Literal["agent_step"] = "agent_step"
    session_id: str
    run_id: str
    assistant_session_id: int | None = None
    event_id: int
    sequence: int
    index: int
    step: str | None = None
    detail: str | None = None
    status: str | None = None


class ToolTraceFrame(WsFrame):
    type: Literal["tool_trace"] = "tool_trace"
    session_id: str
    run_id: str
    assistant_session_id: int | None = None
    event_id: int
    sequence: int
    index: int
    trace: dict[str, Any] = Field(default_factory=dict)


class PermissionRequiredFrame(WsFrame):
    type: Literal["permission_required"] = "permission_required"
    session_id: str
    run_id: str
    assistant_session_id: int | None = None
    event_id: int
    sequence: int
    permission_profile: str
    reason: str
    proposed_patch: dict[str, Any] | None = None
    confirmation_action: str | dict[str, Any] | None = None
    blocked_tool: str | None = None


class TerminalFrame(WsFrame):
    """AGENT_RUN_COMPLETED / FAILED 落进实时帧：流中止后前端拉事件表重放即可
    重建终态（F10）。payload 必须原样带出（含 assistant_session_id），否则重建拿不回结果。"""

    type: Literal["agent_run_completed", "agent_run_failed"]
    session_id: str
    run_id: str
    assistant_session_id: int | None = None
    event_id: int
    sequence: int
    status: str
    message: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class ControlAckFrame(WsFrame):
    """控制回执帧。回执的 type 是「映射后」的值（approve_permission → permission_approved），
    前端 isAgentControlAckMessage 认的是这个值集合；status 恒为 recorded。"""

    type: Literal[
        "permission_approved",
        "permission_denied",
        "pause_run",
        "resume_run",
        "stop_run",
        "retry_from_checkpoint",
    ]
    session_id: str
    run_id: str
    event_id: int
    status: Literal["recorded"] = "recorded"
