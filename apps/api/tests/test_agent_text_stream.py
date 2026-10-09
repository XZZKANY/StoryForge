from __future__ import annotations

import asyncio
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import pytest
from agent_transport import parse_agent_sse

from app.domains.agent_runs.ws_messages import AgentTextDeltaFrame, AgentTextStreamStartedFrame
from app.domains.assistant import service as assistant_service
from app.domains.ide import router as ide_router
from app.domains.ide.stream_queue import WorkerStreamQueue

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


@pytest.mark.parametrize('tool_round', [False, True])
def test_live_text_arrives_before_provider_terminal(session, novel_project, monkeypatch, tool_round):
    release = threading.Event()
    finished = threading.Event()
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            requests.append(json.loads(self.rfile.read(int(self.headers["content-length"]))))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()

            def emit(data):
                self.wfile.write(("data: " + json.dumps(data, ensure_ascii=False) + "\n\n").encode())
                self.wfile.flush()

            if tool_round and len(requests) == 1:
                for fragment in (
                    {"index": 0, "id": "read-1", "type": "function",
                     "function": {"name": "fs_read", "arguments": '{"path":'}},
                    {"index": 0, "function": {"arguments": '"正文/第01章.md"}'}},
                ):
                    emit({"choices": [{"delta": {"tool_calls": [fragment]}}]})
                emit({"choices": [{"delta": {}, "finish_reason": "tool_calls"}]})
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
                return
            emit({"choices": [{"delta": {"content": "第一块正文。"}}]})
            release.wait(5)
            emit({"choices": [{"delta": {}, "finish_reason": "stop"}],
                  "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12}})
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            finished.set()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    source = {
        "STORYFORGE_LLM_PROVIDER": "openai", "STORYFORGE_LLM_MODEL": "fixture",
        "STORYFORGE_LLM_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1",
        "STORYFORGE_LLM_API_KEY": "fixture-key",
        "STORYFORGE_LLM_TIMEOUT_SECONDS": "5", "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "1",
    }
    monkeypatch.setattr(assistant_service, "missing_llm_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: source)

    async def scenario():
        response = await ide_router.stream_agent_user_message_endpoint(
            session_id="token-barrier",
            request=ide_router.AgentUserMessageStreamRequest(
                run_id="token-barrier", user_message="解释这段文字", permission_profile="read",
                args={"project_path": str(novel_project), "context_bundle": {"files": []}},
            ),
            session=session, host_generation=None,
        )
        iterator = response.body_iterator
        frames = []
        try:
            while True:
                chunk = await asyncio.wait_for(anext(iterator), timeout=4)
                frames.extend(parse_agent_sse(chunk.decode() if isinstance(chunk, bytes) else chunk))
                if any(frame["type"] == "agent_text_delta" for frame in frames):
                    break
                assert frames[-1]["type"] not in ("agent_result", "error"), frames[-1]["type"]
            assert not finished.is_set()
            assert all(item["stream"] is True for item in requests)
            assert len(requests) == (2 if tool_round else 1)
            if tool_round:
                tool_messages = [item for item in requests[1]["messages"] if item["role"] == "tool"]
                assert len(tool_messages) == 1
                assert tool_messages[0]["tool_call_id"] == "read-1"
            assert not any(frame["type"] == "agent_result" for frame in frames)
            release.set()
            async for chunk in iterator:
                frames.extend(parse_agent_sse(chunk.decode() if isinstance(chunk, bytes) else chunk))
            assert frames[-1]["type"] == "agent_result"
            assert frames[-1]["agent_result"]["summary"] == "第一块正文。"
            deltas = [frame for frame in frames if frame["type"] == "agent_text_delta"]
            assert "".join(frame["text_delta"] for frame in deltas) == "第一块正文。"
            assert [frame["chunk_sequence"] for frame in deltas] == list(range(1, len(deltas) + 1))
        finally:
            release.set()
            await iterator.aclose()

    try:
        asyncio.run(scenario())
    finally:
        release.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_many_small_deltas_coalesce_with_contiguous_renumbering(session, novel_project, monkeypatch):
    """Consumer-side coalescing merges a burst of small deltas, keeps the joined text,
    renumbers chunk_sequence contiguously, and still flushes before the terminal frame."""
    release = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            self.rfile.read(int(self.headers["content-length"]))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()

            def emit(data):
                self.wfile.write(("data: " + json.dumps(data, ensure_ascii=False) + "\n\n").encode())
                self.wfile.flush()

            pieces = ["风", "起", "，", "万", "叶", "摇", "。"]
            for piece in pieces:
                emit({"choices": [{"delta": {"content": piece}}]})
            release.wait(5)
            emit({"choices": [{"delta": {}, "finish_reason": "stop"}],
                  "usage": {"prompt_tokens": 7, "completion_tokens": 7, "total_tokens": 14}})
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    source = {
        "STORYFORGE_LLM_PROVIDER": "openai", "STORYFORGE_LLM_MODEL": "fixture",
        "STORYFORGE_LLM_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1",
        "STORYFORGE_LLM_API_KEY": "fixture-key",
        "STORYFORGE_LLM_TIMEOUT_SECONDS": "5", "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "1",
    }
    monkeypatch.setattr(assistant_service, "missing_llm_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: source)

    async def scenario():
        response = await ide_router.stream_agent_user_message_endpoint(
            session_id="coalesce-burst",
            request=ide_router.AgentUserMessageStreamRequest(
                run_id="coalesce-burst", user_message="写一句", permission_profile="read",
                args={"project_path": str(novel_project), "context_bundle": {"files": []}},
            ),
            session=session, host_generation=None,
        )
        iterator = response.body_iterator
        frames = []
        try:
            while True:
                chunk = await asyncio.wait_for(anext(iterator), timeout=4)
                frames.extend(parse_agent_sse(chunk.decode() if isinstance(chunk, bytes) else chunk))
                if any(frame["type"] == "agent_text_delta" for frame in frames):
                    break
                assert frames[-1]["type"] not in ("agent_result", "error"), frames[-1]["type"]
            # The first delta arrives before the provider terminal is released.
            release.set()
            async for chunk in iterator:
                frames.extend(parse_agent_sse(chunk.decode() if isinstance(chunk, bytes) else chunk))
            assert frames[-1]["type"] == "agent_result"
            assert frames[-1]["agent_result"]["summary"] == "风起，万叶摇。"
            deltas = [frame for frame in frames if frame["type"] == "agent_text_delta"]
            # Joined text is preserved exactly; sequence is contiguous from 1 regardless of merge.
            assert "".join(frame["text_delta"] for frame in deltas) == "风起，万叶摇。"
            assert [frame["chunk_sequence"] for frame in deltas] == list(range(1, len(deltas) + 1))
            # The burst coalesced into at most one frame per provider delta, no gap or dup.
            assert 1 <= len(deltas) <= 7
            assert all(
                frame["run_id"] == deltas[0]["run_id"]
                and frame["stream_id"] == deltas[0]["stream_id"]
                for frame in deltas
            )
        finally:
            release.set()
            await iterator.aclose()

    try:
        asyncio.run(scenario())
    finally:
        release.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)



def test_steady_deltas_flush_before_the_provider_finishes_generating(session, novel_project, monkeypatch):
    """A continuous stream must flush during generation, not only after 40ms of silence."""
    release = threading.Event()
    generation_finished = threading.Event()
    pieces = ["字"] * 30

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            self.rfile.read(int(self.headers["content-length"]))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()

            def emit(data):
                self.wfile.write(("data: " + json.dumps(data, ensure_ascii=False) + "\n\n").encode())
                self.wfile.flush()

            for piece in pieces:
                emit({"choices": [{"delta": {"content": piece}}]})
                time.sleep(0.015)
            generation_finished.set()
            release.wait(5)
            emit({"choices": [{"delta": {}, "finish_reason": "stop"}]})
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    source = {
        "STORYFORGE_LLM_PROVIDER": "openai", "STORYFORGE_LLM_MODEL": "fixture",
        "STORYFORGE_LLM_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1",
        "STORYFORGE_LLM_API_KEY": "fixture-key",
        "STORYFORGE_LLM_TIMEOUT_SECONDS": "5", "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "1",
    }
    monkeypatch.setattr(assistant_service, "missing_llm_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: source)

    async def scenario():
        response = await ide_router.stream_agent_user_message_endpoint(
            session_id="coalesce-steady",
            request=ide_router.AgentUserMessageStreamRequest(
                run_id="coalesce-steady", user_message="继续输出", permission_profile="read",
                args={"project_path": str(novel_project), "context_bundle": {"files": []}},
            ),
            session=session, host_generation=None,
        )
        iterator = response.body_iterator
        frames = []
        deltas = []
        try:
            while len(deltas) < 2:
                chunk = await asyncio.wait_for(anext(iterator), timeout=4)
                batch = parse_agent_sse(chunk.decode() if isinstance(chunk, bytes) else chunk)
                frames.extend(batch)
                deltas.extend(frame for frame in batch if frame["type"] == "agent_text_delta")
                assert frames[-1]["type"] not in ("agent_result", "error")
            second_arrived_during_generation = not generation_finished.is_set()
            assert not release.is_set()
            release.set()
            async for chunk in iterator:
                batch = parse_agent_sse(chunk.decode() if isinstance(chunk, bytes) else chunk)
                frames.extend(batch)
                deltas.extend(frame for frame in batch if frame["type"] == "agent_text_delta")
            assert second_arrived_during_generation, "Continuous deltas postponed the flush until silence."
            assert len(deltas) >= 3
            assert "".join(frame["text_delta"] for frame in deltas) == "".join(pieces)
            assert [frame["chunk_sequence"] for frame in deltas] == list(range(1, len(deltas) + 1))
            assert frames[-1]["type"] == "agent_result"
            assert frames[-1]["agent_result"]["summary"] == "".join(pieces)
        finally:
            release.set()
            await iterator.aclose()

    try:
        asyncio.run(scenario())
    finally:
        release.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.mark.parametrize("terminal_type", ["agent_result", "error"])
def test_backlogged_deltas_flush_without_waiting_for_an_empty_queue(session, monkeypatch, terminal_type):
    """A busy queue cannot starve the deadline; both terminal paths retain its final tail."""
    release = threading.Event()
    pieces = ["字"] * 30
    original_get = WorkerStreamQueue.get

    async def delayed_read(queue, timeout=None):
        item = await original_get(queue, timeout=timeout)
        # Simulate scheduling latency while the worker already queued the complete burst.
        await asyncio.sleep(0.015)
        return item

    def producer(thread_session, *, on_text, **kwargs):
        identity = {"run_id": "coalesce-backlog", "stream_id": "fixture", "round_index": 1}
        on_text(AgentTextStreamStartedFrame(**identity))
        for sequence, piece in enumerate(pieces, 1):
            on_text(AgentTextDeltaFrame(**identity, chunk_sequence=sequence, text_delta=piece))
        assert release.wait(5)
        if terminal_type == "error":
            raise RuntimeError("fixture producer failure")
        return SimpleNamespace(result={"type": "agent_result", "agent_result": {"summary": "".join(pieces)}})

    monkeypatch.setattr(WorkerStreamQueue, "get", delayed_read)
    monkeypatch.setattr(ide_router, "run_agent_user_message", producer)

    async def scenario():
        response = await ide_router.stream_agent_user_message_endpoint(
            session_id="coalesce-backlog",
            request=ide_router.AgentUserMessageStreamRequest(run_id="coalesce-backlog", user_message="继续输出"),
            session=session, host_generation=None,
        )
        iterator = response.body_iterator
        frames = []
        deltas = []
        try:
            while len(deltas) < 2:
                chunk = await asyncio.wait_for(anext(iterator), timeout=4)
                batch = parse_agent_sse(chunk.decode() if isinstance(chunk, bytes) else chunk)
                frames.extend(batch)
                deltas.extend(frame for frame in batch if frame["type"] == "agent_text_delta")
                assert frames[-1]["type"] not in ("agent_result", "error")
            second_frame_size = len(deltas[1]["text_delta"])
            release.set()
            async for chunk in iterator:
                batch = parse_agent_sse(chunk.decode() if isinstance(chunk, bytes) else chunk)
                frames.extend(batch)
                deltas.extend(frame for frame in batch if frame["type"] == "agent_text_delta")
            assert second_frame_size < len(pieces) - 1, "A nonempty queue kept postponing the deadline."
            assert len(deltas) >= 3
            assert "".join(frame["text_delta"] for frame in deltas) == "".join(pieces)
            assert [frame["chunk_sequence"] for frame in deltas] == list(range(1, len(deltas) + 1))
            assert frames[-1]["type"] == terminal_type
        finally:
            release.set()
            await iterator.aclose()

    asyncio.run(scenario())
