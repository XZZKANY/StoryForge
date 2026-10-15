"""影子档的 prompt 捕获（TS 迁移计划 §4.2、P5-1）：只在迁移期存在，Python 删除时一并删除。

桌面端带上 `X-StoryForge-Shadow: prompts` 时，把这次派发给模型的请求快照交回去，与 TS 引擎
对同一输入组出的请求比对。快照与 agent run 本地请求证据是同一个函数（已脱敏）；不落库，也不改
派发本身。
"""
from __future__ import annotations

import json
from collections.abc import Iterator, Mapping
from typing import Any

from app.common.llm_observation import model_observation_scope
from app.platform.ai_sdk import ChatRequest

SHADOW_HEADER = "X-StoryForge-Shadow"
SHADOW_PROMPTS = "prompts"


class ShadowPromptCapture:
    """返回 None 而不是派发记录：ObservedProvider 因此走未观察的路径，不在流式生成器里跨 yield
    设 ContextVar（Starlette 每一步换一个 Context，跨步 reset 会抛错、打断作者的续写流）。"""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    def begin(self, request: ChatRequest, *, source: Mapping[str, str | None], streaming: bool,
              operation: str, provenance: Mapping[str, Any]) -> None:
        # assistant 不顶层 import agent_runs（file.create 反向依赖 assistant，会成环）。
        from app.domains.agent_runs.request_evidence import request_snapshot

        entry: dict[str, Any] = {"step": operation, "streaming": streaming}
        try:
            snapshot = request_snapshot(request, source)
        except Exception:  # noqa: BLE001 - 影子比对绝不影响作者这次请求
            entry["error"] = "snapshot_failed"
        else:
            entry["request"] = snapshot["request"]
            entry["request_digest"] = snapshot["request_digest"]
        self.requests.append(entry)


def captured_stream(frames: Iterator[str], capture: ShadowPromptCapture) -> Iterator[str]:
    """逐步在观察范围里推进原来的 SSE 流（范围的进入与退出落在同一步），流尽后补一帧 `shadow`。"""

    try:
        while True:
            with model_observation_scope(capture):
                try:
                    frame = next(frames)
                except StopIteration:
                    break
            yield frame
    finally:
        close = getattr(frames, "close", None)
        if callable(close):
            close()
    data = json.dumps({"requests": capture.requests}, ensure_ascii=False)
    yield f"event: shadow\ndata: {data}\n\n"
