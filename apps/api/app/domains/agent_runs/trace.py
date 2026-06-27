from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AgentToolTrace:
    """WebSocket 响应中的轻量工具调用轨迹。"""

    tool_name: str
    status: str
    input_summary: dict[str, Any]
    output_summary: dict[str, Any] | None = None
    audit_event_id: str | None = None
    assistant_tool_call_id: int | None = None
    error_message: str | None = None

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "tool_name": self.tool_name,
            "status": self.status,
            "input_summary": self.input_summary,
        }
        if self.output_summary is not None:
            payload["output_summary"] = self.output_summary
        if self.audit_event_id is not None:
            payload["audit_event_id"] = self.audit_event_id
        if self.assistant_tool_call_id is not None:
            payload["assistant_tool_call_id"] = self.assistant_tool_call_id
        if self.error_message is not None:
            payload["error_message"] = self.error_message
        return payload
