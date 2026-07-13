"""桌面 Agent 本地 SSE / REST 传输的测试助手。

WS 客户端退役后，Agent 直播工具循环走 `POST /agent/sessions/{id}/stream`（SSE），
控制走 `POST /agent/sessions/{id}/control`。这些助手把 SSE 帧解出成 list[dict]，
让 WS 测试的 send_json / receive_json 流程可最小改动迁移过来（帧形状不变）。
"""

from __future__ import annotations

import json
from typing import Any, Protocol


class AgentHttpClient(Protocol):
    def post(self, url: str, **kwargs: Any) -> Any: ...


def parse_agent_sse(text: str) -> list[dict[str, Any]]:
    """把一段 SSE 响应体解成前端帧列表（终态帧 agent_result/error 在最后）。"""

    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    frames: list[dict[str, Any]] = []
    for block in normalized.split("\n\n"):
        data_lines = [
            line[len("data:") :].lstrip(" ")
            for line in block.splitlines()
            if line.startswith("data:")
        ]
        if data_lines:
            frames.append(json.loads("\n".join(data_lines)))
    return frames


def stream_agent_message(client: AgentHttpClient, session_id: str, **message: Any) -> list[dict[str, Any]]:
    """POST /stream 并返回全部 SSE 帧（agent_run_started → …steps/traces… → 终态帧）。"""

    response = client.post(
        f"/api/ide/agent/sessions/{session_id}/stream",
        json={key: value for key, value in message.items() if value is not None},
    )
    assert response.status_code == 200, response.text
    content_type = response.headers.get("content-type", "")
    assert content_type.startswith("text/event-stream"), (
        f"Agent stream content-type 不是 text/event-stream：{content_type or '<missing>'}"
    )
    frames = parse_agent_sse(response.text)
    assert frames, "Agent SSE 响应没有 data 帧。"
    assert frames[-1].get("type") in {"agent_result", "error"}, (
        f"Agent SSE 响应缺少终态帧：{frames[-1]}"
    )
    return frames


def agent_result(client: AgentHttpClient, session_id: str, **message: Any) -> dict[str, Any]:
    """跑一轮工具循环，返回终态帧（agent_result 或 error）。"""

    return stream_agent_message(client, session_id, **message)[-1]


def control_agent(
    client: AgentHttpClient,
    session_id: str,
    *,
    control_type: str,
    run_id: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """POST /control 并返回控制回执帧（或 {type:"error"} 帧）。"""

    response = client.post(
        f"/api/ide/agent/sessions/{session_id}/control",
        json={"type": control_type, "run_id": run_id, "payload": payload or {}},
    )
    assert response.status_code == 200, response.text
    return response.json()
