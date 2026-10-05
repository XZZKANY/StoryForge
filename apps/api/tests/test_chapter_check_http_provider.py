"""Production provider transport -> confirmed pipeline -> public artifact readback."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from agent_run_test_support import _seed_agent_run
from chapter_check_test_support import chapter_check_reply

from app.domains.agent_runs.event_sink import _AgentRunEventSink
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.agent_runs.service import handle_agent_control_message
from app.domains.assistant.schemas import AssistantSessionCreate
from app.domains.assistant.service import create_assistant_session


@pytest.mark.parametrize("mode", ["valid", "invalid", "duplicate", "over-limit", "provider", "length"])
def test_confirmed_chapter_check_over_owned_http_retains_non_writable_candidate(
    session,
    client,
    tmp_path,
    monkeypatch,
    mode,
):
    draft = "他推开门，屋里没有人。\n" + "一" * 1800
    requests = []
    server_errors = []

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            try:
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                prompt = body["messages"][-1]["content"]
                requests.append(body)
                if "整理成 Chapter Brief" in prompt:
                    reply = json.dumps(
                        {
                            "goal": "GOAL_HTTP：推门进入",
                            "pov": "POV_HTTP：第三人称",
                            "setting": "SETTING_HTTP：车站",
                            "required_beats": ["BEAT_HTTP：推门"],
                        },
                        ensure_ascii=False,
                    )
                elif "检查完整正文" in prompt:
                    if mode == "provider":
                        self._send(400, "application/json", b'{"error":{"message":"synthetic unavailable"}}')
                        return
                    hard = {
                        "rule": "goal_violation",
                        "severity": "hard",
                        "message": "需作者确认的判断",
                        "line": 1,
                        "evidence": "他推开门，屋里没有人。",
                    }
                    reply = chapter_check_reply(prompt, [hard] * 101 if mode == "over-limit" else [])["reply"]
                    if mode == "invalid":
                        reply = "{}"
                    elif mode == "duplicate":
                        reply = chapter_check_reply(prompt, [hard])["reply"][:-1] + ',"findings":[]}'
                else:
                    reply = draft
                finish_reason = "length" if mode == "length" and "检查完整正文" in prompt else "stop"
                usage = {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}
                if body.get("stream"):
                    chunks = [
                        {"choices": [{"index": 0, "delta": {"content": reply}, "finish_reason": None}]},
                        {"choices": [{"index": 0, "delta": {}, "finish_reason": finish_reason}], "usage": usage},
                    ]
                    data = "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks)
                    self._send(200, "text/event-stream", (data + "data: [DONE]\n\n").encode("utf-8"))
                else:
                    data = {
                        "choices": [
                            {"message": {"role": "assistant", "content": reply}, "finish_reason": finish_reason}
                        ],
                        "usage": usage,
                    }
                    self._send(200, "application/json", json.dumps(data, ensure_ascii=False).encode("utf-8"))
            except Exception as exc:
                server_errors.append(type(exc).__name__)
                self._send(500, "application/json", b'{"error":{"message":"test provider error"}}')

        def _send(self, status, content_type, data):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    for key, value in {
        "STORYFORGE_LLM_PROVIDER": "openai",
        "STORYFORGE_LLM_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1",
        "STORYFORGE_LLM_API_KEY": "synthetic-owned-test",
        "STORYFORGE_LLM_MODEL": "synthetic-check",
        "STORYFORGE_LLM_TIMEOUT_SECONDS": "5",
    }.items():
        monkeypatch.setenv(key, value)
    target = tmp_path / "正文/第001章.md"
    target.parent.mkdir()
    target.write_text("", encoding="utf-8")
    try:
        conversation = create_assistant_session(
            session,
            AssistantSessionCreate(
                title="HTTP 检查历史", task_type="ide_agent_orchestration", project_path=str(tmp_path)
            ),
        )
        run = _seed_agent_run(session, public_id=f"run-check-http-{mode}")
        run.assistant_session_id = conversation.id
        session.commit()
        initial = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
            session,
            run=run,
            agent_session_id=run.session_id,
            message={
                "intent": "chapter.write",
                "assistant_session_id": conversation.id,
                "user_message": "写第一章",
                "args": {
                    "project_path": str(tmp_path),
                    "file_path": str(target),
                    "context_bundle": {"files": []},
                },
            },
        )
        resumed = handle_agent_control_message(
            session,
            public_id=run.public_id,
            session_id=run.session_id,
            control_type="resume_run",
            payload={"chapter_brief": initial["agent_result"]["chapter_brief"]},
        ).resumed_result
        assert resumed is not None
        check = resumed["agent_result"]["chapter_check"]
        assert check["execution_status"] == (
            "completed" if mode == "valid" else "incomplete" if mode == "over-limit" else "failed"
        )
        assert check["manuscript_status"] == ("pass" if mode == "valid" else "unknown")
        assert check["execution_code"] == (
            "provider_failure"
            if mode in {"provider", "length"}
            else "result_limit_exceeded"
            if mode == "over-limit"
            else None
            if mode == "valid"
            else "invalid_result"
        )
        assert len(requests) == 3
        prompt = requests[-1]["messages"][-1]["content"]
        for sentinel in (draft, "GOAL_HTTP", "POV_HTTP", "SETTING_HTTP", "BEAT_HTTP"):
            assert sentinel in prompt
        assert requests[1]["stream"] is True
        response = client.get(f"/api/agent-runs/{run.public_id}/artifacts")
        assert response.status_code == 200
        candidates = [artifact for artifact in response.json() if artifact["kind"] == "chapter_candidate"]
        if mode == "valid":
            assert resumed["proposed_patch"]["after"] == draft
            assert not candidates
        else:
            assert resumed.get("proposed_patch") is None
            assert len(candidates) == 1
            assert candidates[0]["payload"] == resumed["agent_result"]["chapter_candidate"]
            assert candidates[0]["payload"]["content"] == draft
            assert candidates[0]["requires_confirmation"] is False
            events = client.get(f"/api/agent-runs/{run.public_id}/events")
            assert events.status_code == 200
            settled = next(event for event in reversed(events.json()) if event["event_type"] == "agent_run_completed")
            # CompletedEventPayload is intentionally a compact terminal reference;
            # full bodies survive in the normal artifact API/events, not that row.
            assert settled["payload"]["summary"] == resumed["agent_result"]["summary"]
            assert settled["payload"]["has_proposed_patch"] is False
            artifact_events = [event["payload"] for event in events.json() if event["event_type"] == "agent_artifact"]
            saved = next(event["payload"] for event in artifact_events if event["kind"] == "chapter_candidate")
            assert saved == resumed["agent_result"]["chapter_candidate"]
            saved_check = next(event["payload"] for event in artifact_events if event["kind"] == "chapter_check")
            assert saved_check == {**check, "attempt": 1, "repair_count": 0}
        assert target.read_text(encoding="utf-8") == ""
        history = client.post(
            "/api/agent-runs/chapter-checks/query",
            json={"project_root": str(tmp_path), "assistant_session_id": conversation.id},
        )
        assert history.status_code == 200
        entry = history.json()["entries"][0]
        assert entry["run_id"] == run.public_id
        assert entry["check"] == {**check, "attempt": 1, "repair_count": 0}
        assert entry["target_path"] == "正文/第001章.md"
        assert entry["candidate_error"] is None
        if mode == "valid":
            assert entry["candidate"] is None
        else:
            assert entry["candidate"] == resumed["agent_result"]["chapter_candidate"]
            assert entry["candidate"]["content"] == draft
        assert len(requests) == 3  # History reads never execute the provider again.
        assert target.read_text(encoding="utf-8") == ""
        assert not server_errors
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)
        assert not worker.is_alive()
