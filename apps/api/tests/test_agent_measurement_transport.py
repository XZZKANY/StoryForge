from __future__ import annotations

import asyncio
import hashlib
import json
import threading
from contextlib import suppress
from types import SimpleNamespace

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script, _send_chat_message
from agent_transport import stream_agent_message
from authoring_measurement_support import SyntheticPolishProvider, fixture_resolution, fixture_text
from starlette.responses import StreamingResponse

from app.common.llm_client import LLMError
from app.common.performance import current_measurement, measure_stage
from app.domains.agent_runs.patches import polishing_service
from app.domains.assistant import service as assistant_service
from app.domains.ide import router as ide_router
from app.domains.ide import stream_measurement
from app.platform.ai_sdk.providers.anthropic import AnthropicProvider

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


@pytest.fixture
def measurements(monkeypatch):
    collected = []
    monkeypatch.setattr(stream_measurement, "log_measurement", collected.append)
    return collected


@pytest.mark.parametrize("feature", ["file.revise", "chapter.polish"])
@pytest.mark.parametrize("entry", ["intent", "chat"])
@pytest.mark.parametrize("failure", [False, True])
def test_real_sse_capabilities_share_stages_without_writing_original(
    client,
    monkeypatch,
    novel_project,
    measurements,
    feature,
    entry,
    failure,
):
    _enable_loop_env(monkeypatch)
    target = novel_project / "正文" / "第01章.md"
    original = fixture_text(2)
    target.write_text(original, encoding="utf-8")
    provider = SyntheticPolishProvider("provider_failure" if failure else "success")
    monkeypatch.setattr(polishing_service, "resolve_polish_llm", lambda **_: fixture_resolution())
    monkeypatch.setattr(AnthropicProvider, "complete", lambda _self, request: provider.complete(request))

    def generate(_source, **_kwargs):
        if failure:
            raise LLMError("synthetic generation failed")
        return {"content": original + "\n她收起刀。", "completion_tokens": 0}

    monkeypatch.setattr(assistant_service, "_call_llm_streamed", generate)
    run_id = f"measure-{feature}-{entry}-{failure}"
    if entry == "intent":
        frames = stream_agent_message(
            client,
            "session-" + run_id,
            run_id=run_id,
            intent=feature,
            user_message="保守修订",
            permission_profile="full",
            args={
                "project_path": str(novel_project),
                "file_path": "正文/第01章.md",
                "content": original,
                "instruction": "保守修订",
                "context_bundle": {"files": []},
            },
        )
    else:
        _fake_llm_script(
            monkeypatch,
            [
                {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "measurement-tool",
                            "type": "function",
                            "function": {
                                "name": feature.replace(".", "_"),
                                "arguments": json.dumps({"path": "正文/第01章.md", "instruction": "保守修订"}),
                            },
                        }
                    ],
                },
                {"content": "已处理，请查看结果。", "tool_calls": []},
            ],
        )
        frames = _send_chat_message(
            client, run_id=run_id, project_path=str(novel_project), message="保守修订", permission_profile="full"
        )
    assert target.read_text(encoding="utf-8") == original
    assert len(measurements) == 2
    assert {m["phase"] for m in measurements} == {"worker_finished", "transport_finished"}
    assert {m["run_key"] for m in measurements} == {hashlib.sha256(run_id.encode()).hexdigest()}
    complete = max(measurements, key=lambda item: len(item["stages"]))
    names = {s["name"] for s in complete["stages"]}
    assert {
        "agent.run",
        "agent.tool",
        "context.collect",
        "context.select",
        "store.event",
        "sse.first_yield",
        "sse.end",
    } <= names
    if not (failure and feature == "file.revise" and entry == "intent"):
        assert "store.plan" in names
    if entry == "chat":
        assert {"agent.model", "store.tool_create", "store.tool_update"} <= names
    prefix = "revision" if feature == "file.revise" else "polish"
    model = [s for s in complete["stages"] if s["name"] == prefix + ".model"]
    assert len(model) == 1
    assert model[0]["status"] == ("error" if failure else "ok")
    if feature == "chapter.polish":
        assert provider.calls == 1
        selection = next(s for s in complete["stages"] if s["name"] == "polish.select")
        assert selection["status"] == ("degraded" if failure else "ok")
        assert frames[-1]["proposed_patch"]["requires_confirmation"] is failure
    elif not failure:
        assert frames[-1]["proposed_patch"]["after"].endswith("她收起刀。")
    assert "PRIVATE" not in json.dumps(measurements)
    assert str(novel_project) not in json.dumps(measurements)
    assert original not in json.dumps(measurements, ensure_ascii=False)
    assert complete["pending_spans"] == 0


def test_actual_error_response_retains_failed_stages_and_no_readable_marker(client, measurements):
    frames = stream_agent_message(
        client,
        "measure-error",
        assistant_session_id=999999,
        user_message="继续",
        intent="chat.explain",
        args={"context": "正文"},
    )
    assert frames[-1]["type"] == "error"
    summary = max(measurements, key=lambda item: len(item["stages"]))
    stages = {s["name"]: s for s in summary["stages"]}
    assert stages["agent.run"]["status"] == "error"
    assert stages["sse.worker"]["status"] == "error"
    assert stages["sse.end"]["status"] == "error"
    assert "sse.first_readable_yield" not in stages


@pytest.mark.parametrize("failure", [False, True])
def test_diagnostic_sink_failure_never_changes_runtime_result(session, monkeypatch, failure):
    def sink(_):
        raise RuntimeError("PRIVATE sink exception")

    def runtime(*_args, **_kwargs):
        if failure:
            raise RuntimeError("expected runtime failure")
        return SimpleNamespace(result={"type": "agent_result", "summary": "done"})

    monkeypatch.setattr(stream_measurement, "log_measurement", sink)
    monkeypatch.setattr(ide_router, "run_agent_user_message", runtime)

    async def consume():
        return [item async for item in ide_router._agent_user_message_payloads(session, session_id="safe", message={})]

    frames = asyncio.run(consume())
    assert frames == (
        [{"type": "error", "session_id": "safe", "detail": "expected runtime failure"}]
        if failure
        else [{"type": "agent_result", "summary": "done"}]
    )


def test_interleaved_workers_have_isolated_context(session, monkeypatch, measurements):
    barrier = threading.Barrier(2)

    def runtime(*_, agent_session_id, **__):
        recorder = current_measurement()
        assert recorder is not None
        recorder.associate_run("actual-" + agent_session_id)
        with measure_stage("agent.model"):
            barrier.wait(timeout=10)
        return SimpleNamespace(result={"type": "agent_result", "summary": "done", "run_id": agent_session_id})

    monkeypatch.setattr(ide_router, "run_agent_user_message", runtime)

    async def consume(name):
        return [item async for item in ide_router._agent_user_message_payloads(session, session_id=name, message={})]

    async def main():
        result = await asyncio.gather(consume("first"), consume("second"))
        assert current_measurement() is None
        return result

    results = asyncio.run(main())
    assert {r[-1]["run_id"] for r in results} == {"first", "second"}
    assert len(measurements) == 4
    assert len({m["measurement_id"] for m in measurements}) == 2
    assert {m["run_key"] for m in measurements} == {
        hashlib.sha256(("actual-" + n).encode()).hexdigest() for n in ("first", "second")
    }
    for summary in measurements:
        assert sum(s["name"] == "agent.model" for s in summary["stages"]) == 1


@pytest.mark.parametrize("termination", ["close", "cancel", "disconnect"])
def test_transport_termination_is_not_worker_cancellation(session, monkeypatch, measurements, termination):
    entered = threading.Event()
    release = threading.Event()
    finished = threading.Event()

    def runtime(*_, on_event, **__):
        on_event({"type": "agent_run_started"})
        with measure_stage("agent.model"):
            entered.set()
            assert release.wait(timeout=10)
        return SimpleNamespace(result={"type": "agent_result", "summary": "finished after transport stopped"})

    def sink(summary):
        measurements.append(summary)
        if summary["phase"] == "worker_finished":
            finished.set()

    monkeypatch.setattr(stream_measurement, "log_measurement", sink)
    monkeypatch.setattr(ide_router, "run_agent_user_message", runtime)
    monkeypatch.setattr(ide_router, "websocket_stream_events_from_agent_event", lambda event: [event])

    async def main():
        frames = ide_router._agent_user_message_payloads(session, session_id="disconnect", message={})
        closer = None
        try:
            if termination == "disconnect":
                first_body = asyncio.Event()

                async def encoded():
                    async for frame in frames:
                        yield json.dumps(frame)

                async def send(message):
                    if message.get("type") == "http.response.body" and message.get("body"):
                        first_body.set()

                async def receive():
                    await first_body.wait()
                    return {"type": "http.disconnect"}

                response = StreamingResponse(encoded())
                closer = asyncio.create_task(response({"type": "http", "asgi": {"spec_version": "2.3"}}, receive, send))
                await asyncio.wait_for(first_body.wait(), timeout=5)
            else:
                assert (await anext(frames))["type"] == "agent_run_started"
                if termination == "close":
                    closer = asyncio.create_task(frames.aclose())
                else:
                    closer = asyncio.create_task(anext(frames))
                    await asyncio.sleep(0)
                    closer.cancel()
            for _ in range(100):
                if any(m["phase"] == "transport_finished" for m in measurements):
                    break
                await asyncio.sleep(0.01)
            assert entered.is_set() and not finished.is_set()
            transport = next(m for m in measurements if m["phase"] == "transport_finished")
            assert next(s for s in transport["stages"] if s["name"] == "sse.end")["status"] == "cancelled"
            assert transport["pending_spans"] > 0  # No false complete summary after disconnect.
        finally:
            release.set()
            if closer is not None:
                with suppress(asyncio.CancelledError):
                    await closer
            assert await asyncio.to_thread(finished.wait, 5)
            await frames.aclose()
        assert sum(m["phase"] == "worker_finished" for m in measurements) == 1
        worker = next(m for m in measurements if m["phase"] == "worker_finished")
        assert next(s for s in worker["stages"] if s["name"] == "agent.model")["status"] == "ok"
        assert current_measurement() is None

    asyncio.run(main())
