from __future__ import annotations

import io
import json

import pytest
import test_llm_run_control as wire
from test_agent_text_adapter import context

from app.common import llm_client
from app.domains.agent_runs.text_stream import complete_with_text_stream
from app.platform.ai_sdk import ChatMessage, ChatRequest, MessageRole


@pytest.mark.parametrize("family", ["anthropic", "gemini"])
def test_native_stream_preserves_signed_continuation_without_displaying_it(monkeypatch, family):
    if family == "anthropic":
        frames = [
            {"type": "message_start", "message": {"id": "msg", "usage": {"input_tokens": 10}}},
            {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": ""}},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "private reasoning"}},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "signed-"}},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "state"}},
            {"type": "content_block_stop", "index": 0},
            {"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}},
            {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "正在读取"}},
            {"type": "content_block_stop", "index": 1},
            {"type": "content_block_start", "index": 2, "content_block": {
                "type": "tool_use", "id": "call", "name": "fs_read", "input": {}}},
            {"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": '{"path":'}},
            {"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": '"chapter.md"}'}},
            {"type": "content_block_stop", "index": 2},
            {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 2}},
            {"type": "message_stop"},
        ]
    else:
        frames = [
            {"candidates": [{"content": {"role": "model", "parts": [
                {"thought": True, "text": "private reasoning"}, {"text": "正在读取"}]}}]},
            {"candidates": [{"content": {"role": "model", "parts": [
                {"functionCall": {"id": "call", "name": "fs_read", "args": {"path": "chapter.md"}},
                 "thoughtSignature": "signed-state"}]}, "finishReason": "STOP"}],
             "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 2, "totalTokenCount": 12}},
        ]
    requests = []
    responses = iter([b"".join(wire.sse_frame(frame) for frame in frames), wire.response_for(family, True).getvalue()])
    def open_response(request, **kwargs):
        requests.append(json.loads(request.data))
        return io.BytesIO(next(responses))
    monkeypatch.setattr(llm_client.request, "urlopen", open_response)
    source = wire.source(family)
    provider = llm_client.build_llm_provider(source)
    visible = []
    response = complete_with_text_stream(provider, wire.chat_request(), context=context(visible, source))
    assert json.loads(response.tool_calls[0].arguments_json) == {"path": "chapter.md"}
    assert response.usage.total_tokens == 12
    assert "".join(frame.text_delta for frame in visible if frame.type == "agent_text_delta") == "正在读取"
    assert "signed-state" not in repr(visible)
    assert "private reasoning" not in repr(visible)
    request = ChatRequest(model="fixture-model", messages=(
        response.to_assistant_message(),
        ChatMessage(MessageRole.TOOL, '{"content":"chapter"}', tool_call_id=response.tool_calls[0].id, name="fs_read"),
    ))
    complete_with_text_stream(provider, request, context=context([], source))
    if family == "anthropic":
        blocks = requests[1]["messages"][0]["content"]
        assert next(block for block in blocks if block["type"] == "thinking")["signature"] == "signed-state"
    else:
        parts = requests[1]["contents"][0]["parts"]
        assert next(part for part in parts if "functionCall" in part)["thoughtSignature"] == "signed-state"
