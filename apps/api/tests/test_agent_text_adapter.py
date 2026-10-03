from __future__ import annotations

import asyncio
import io
import threading
from types import SimpleNamespace

import pytest
import test_llm_run_control as wire
import test_llm_stream_usage_retention as usage_wire

from app.common import llm_client
from app.domains.agent_runs.text_stream import complete_with_text_stream
from app.domains.ide.stream_queue import WorkerStreamQueue
from app.platform.ai_sdk import (
    ChatResponse,
    ProviderCapabilities,
    ProviderError,
    ProviderErrorCategory,
    ProviderErrorDetails,
    StreamEvent,
    StreamEventKind,
    TokenUsage,
)


def context(frames, source=None):
    return SimpleNamespace(on_text=frames.append, run=SimpleNamespace(public_id="run"),
                           completed_model_rounds=0, source=source or {})


@pytest.mark.parametrize("family", wire.FAMILIES)
@pytest.mark.parametrize("reason", ["stop", "length"])
def test_stream_adapter_uses_real_provider_and_keeps_usage(monkeypatch, family, reason):
    calls = []
    def open_response(*args, **kwargs):
        calls.append(1)
        return io.BytesIO(usage_wire.raw_bytes(family, reason))
    monkeypatch.setattr(llm_client.request, "urlopen", open_response)
    source = wire.source(family)
    frames = []
    response = complete_with_text_stream(
        llm_client.build_llm_provider(source), wire.chat_request(), context=context(frames, source),
    )
    assert len(calls) == 1
    assert response.content == "prefix"
    assert response.finish_reason == reason
    assert response.usage.total_tokens == 12
    preview = "".join(frame.text_delta for frame in frames if frame.type == "agent_text_delta")
    assert preview and response.content.startswith(preview)
    if reason == "stop":
        assert preview == response.content


@pytest.mark.parametrize("reason", ["length", "content_filter"])
def test_openai_truncated_tool_json_is_not_executed_or_parsed(monkeypatch, reason):
    body = (wire.sse_frame({"choices": [{"delta": {"tool_calls": [
        {"index": 0, "id": "call", "function": {"name": "fs_read", "arguments": '{"path":'}}
    ]}}]}) + wire.sse_frame(usage_wire.usage_frame("openai-compatible"))
        + usage_wire.terminal_frame("openai-compatible", reason))
    monkeypatch.setattr(llm_client.request, "urlopen", lambda *a, **kw: io.BytesIO(body))
    response = complete_with_text_stream(
        llm_client.build_llm_provider(wire.source("openai-compatible")),
        wire.chat_request(), context=context([]),
    )
    assert response.tool_calls == ()
    assert response.finish_reason == reason
    assert response.usage.total_tokens == 12


@pytest.mark.parametrize("capability", [False, None])
def test_non_streaming_capability_keeps_complete_path(capability):
    class Provider:
        def capabilities(self, model):
            return ProviderCapabilities(streaming=capability)
        def complete(self, request):
            return ChatResponse(content="完整回复")
        def stream(self, request):
            pytest.fail("must not dispatch streaming")
    frames = []
    assert complete_with_text_stream(Provider(), wire.chat_request(), context=context(frames)).content == "完整回复"
    assert frames == []


@pytest.mark.parametrize("failure", ["missing_terminal", "unsupported_after_text"])
def test_failure_never_falls_back_or_loses_usage(failure):
    class Provider:
        def capabilities(self, model):
            return ProviderCapabilities(streaming=True)
        def complete(self, request):
            pytest.fail("must not replay")
        def stream(self, request):
            yield StreamEvent(StreamEventKind.USAGE, usage=TokenUsage(total_tokens=12, source="provider_usage"))
            yield StreamEvent(StreamEventKind.TEXT_DELTA, text="已收到正文")
            if failure == "unsupported_after_text":
                raise ProviderError(ProviderErrorDetails(ProviderErrorCategory.UNSUPPORTED, "fixture"))
    frames = []
    with pytest.raises(ProviderError) as caught:
        complete_with_text_stream(Provider(), wire.chat_request(), context=context(frames))
    assert caught.value.usage.total_tokens == 12
    assert caught.value.details.category is ProviderErrorCategory.RESPONSE
    assert frames[-1].text_delta == "已收到正文"


def test_only_text_channel_is_visible_and_response_identity_is_preserved():
    opaque = object()
    result = ChatResponse(content="<think>private</think>正文", metadata={"opaque": opaque},
                          response_id="response", finish_reason="stop")
    class Provider:
        def capabilities(self, model):
            return ProviderCapabilities(streaming=True)
        def stream(self, request):
            yield StreamEvent(StreamEventKind.REASONING_DELTA, text="private reasoning")
            yield StreamEvent(StreamEventKind.TOOL_CALL_DELTA, text='{"private":"arguments"}')
            for piece in ["<thi", "nk>private</th", "ink>正", "文"]:
                yield StreamEvent(StreamEventKind.TEXT_DELTA, text=piece)
            yield StreamEvent(StreamEventKind.COMPLETED, response=result)
    frames = []
    response = complete_with_text_stream(Provider(), wire.chat_request(), context=context(frames))
    assert response.content == "正文"
    assert response.response_id == result.response_id
    assert response.metadata["opaque"] is opaque
    assert "".join(frame.text_delta for frame in frames if frame.type == "agent_text_delta") == "正文"
    assert [frame.chunk_sequence for frame in frames] == list(range(len(frames)))


def test_queue_backpressure_detach_unblocks_worker_without_cancelling_it():
    async def scenario():
        queue = WorkerStreamQueue(asyncio.get_running_loop(), capacity=1)
        first_sent = threading.Event()
        second_sent = threading.Event()
        completed = threading.Event()
        def work():
            queue.put({"chunk": 1})
            first_sent.set()
            queue.put({"chunk": 2})
            second_sent.set()
            queue.put({"chunk": 3})
            completed.set()
        worker = asyncio.create_task(asyncio.to_thread(work))
        assert await asyncio.to_thread(first_sent.wait, 1)
        assert not await asyncio.to_thread(second_sent.wait, 0.1)
        assert await queue.get() == {"chunk": 1}
        assert await asyncio.to_thread(second_sent.wait, 1)
        queue.close()
        await asyncio.wait_for(worker, timeout=1)
        assert completed.is_set()
    asyncio.run(scenario())
