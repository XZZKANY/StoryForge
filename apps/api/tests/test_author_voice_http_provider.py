"""Author controls cross real HTTP/SSE SDK boundaries, not LLM method mocks."""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from agent_transport import stream_agent_message
from test_author_voice_policy import TAIL


@dataclass
class VoiceHttpState:
    requests: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    replacements: tuple[tuple[str, str], ...] = ()
    response_mode: str = "valid"
    tool_instruction: str | None = None
    outer_rounds: int = 0

    def transform(self, text: str) -> str:
        for before, after in self.replacements:
            text = text.replace(before, after)
        return text


@pytest.fixture
def voice_http(monkeypatch):
    state = VoiceHttpState()

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            try:
                assert self.path == "/v1/chat/completions"
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                state.requests.append(body)
                if state.response_mode == "provider":
                    self.send_body(400, "application/json", b'{"error":{"message":"PROVIDER_PRIVATE_HTTP"}}')
                    return
                prompt = body["messages"][-1]["content"] or ""
                tool_calls = []
                if body.get("tools"):
                    assert state.tool_instruction is not None
                    state.outer_rounds += 1
                    reply = "请查看修订提案。"
                    if state.outer_rounds == 1:
                        reply = ""
                        tool_calls = [
                            {
                                "id": "voice-http-revise",
                                "type": "function",
                                "function": {
                                    "name": "file_revise",
                                    "arguments": json.dumps(
                                        {"path": "正文.md", "instruction": state.tool_instruction}, ensure_ascii=False
                                    ),
                                },
                            }
                        ]
                elif "<<<FILE\n" in prompt:
                    original = prompt.rsplit("<<<FILE\n", 1)[1].rsplit("\nFILE>>>", 1)[0]
                    reply = state.transform(original)
                else:
                    payload = json.loads(prompt)
                    reply = json.dumps(
                        {"segments": [{**item, "text": state.transform(item["text"])} for item in payload["segments"]]},
                        ensure_ascii=False,
                    )
                if state.response_mode == "invalid":
                    reply = "invalid-json"
                finish = "tool_calls" if tool_calls else "length" if state.response_mode == "length" else "stop"
                usage = {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}
                if body.get("stream"):
                    chunks = [
                        {
                            "choices": [
                                {
                                    "index": 0,
                                    "delta": {
                                        "content": reply,
                                        **(
                                            {
                                                "tool_calls": [
                                                    {"index": index, **item} for index, item in enumerate(tool_calls)
                                                ]
                                            }
                                            if tool_calls
                                            else {}
                                        ),
                                    },
                                    "finish_reason": None,
                                }
                            ]
                        },
                        {"choices": [{"index": 0, "delta": {}, "finish_reason": finish}], "usage": usage},
                    ]
                    data = "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks)
                    self.send_body(200, "text/event-stream", (data + "data: [DONE]\n\n").encode("utf-8"))
                else:
                    payload = {
                        "choices": [
                            {
                                "message": {
                                    "role": "assistant",
                                    "content": reply,
                                    **({"tool_calls": tool_calls} if tool_calls else {}),
                                },
                                "finish_reason": finish,
                            }
                        ],
                        "usage": usage,
                    }
                    self.send_body(200, "application/json", json.dumps(payload, ensure_ascii=False).encode("utf-8"))
            except Exception as exc:
                state.errors.append(type(exc).__name__)
                self.send_body(500, "application/json", b'{"error":{"message":"owned provider fixture failed"}}')

        def send_body(self, status, content_type, data):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    for prefix in ("STORYFORGE_LLM", "STORYFORGE_POLISH_LLM"):
        for suffix, value in {
            "PROVIDER": "openai",
            "BASE_URL": f"http://127.0.0.1:{server.server_port}/v1",
            "API_KEY": "synthetic-owned-voice",
            "MODEL": "synthetic-voice-http",
        }.items():
            monkeypatch.setenv(f"{prefix}_{suffix}", value)
    monkeypatch.setenv("STORYFORGE_LLM_TIMEOUT_SECONDS", "5")
    monkeypatch.setenv("STORYFORGE_LLM_RETRY_MAX_ATTEMPTS", "1")
    try:
        yield state
        assert not state.errors
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)
        assert not worker.is_alive()


@pytest.mark.parametrize("quality_gate", [None, "polish"])
@pytest.mark.parametrize("author_requested", [False, True])
def test_revision_http_writer_retains_authorized_quote_and_typo_edits(
    client, tmp_path, voice_http, quality_gate, author_requested
):
    project = tmp_path / "project"
    (project / ".storyforge").mkdir(parents=True)
    author = "VOICE_HTTP_AUTHOR：把中文引号统一成直引号。"
    (project / ".storyforge/agent-instructions.md").write_text(author, encoding="utf-8")
    original = "“灯还亮着。”她说。\n铜钥匙落在地扳上。\n" + TAIL
    target = project / "正文.md"
    target.write_text(original, encoding="utf-8", newline="")
    voice_http.replacements = (("“", '"'), ("”", '"'), ("地扳", "地板"))
    command = "只修复地扳这个错字。" if author_requested else "只修复地扳这个错字，不改引号。"
    response = client.post(
        "/api/assistant/revise",
        json={
            "project_root": str(project),
            "file_path": "正文.md",
            "content": original,
            "instruction": command,
            "quality_gate": quality_gate,
        },
    )
    assert response.status_code == 200, response.text
    expected = voice_http.transform(original) if author_requested else original.replace("地扳", "地板")
    assert response.json()["after"] == expected
    assert len(voice_http.requests) == 1
    request = voice_http.requests[0]
    assert request["stream"] is True
    assert request["model"] == "synthetic-voice-http"
    assert author in request["messages"][0]["content"]
    prompt = request["messages"][-1]["content"]
    assert command in prompt and original in prompt
    assert (
        '"allowed_punctuation_forms": ["quotes"]' if author_requested else '"allowed_punctuation_forms": []'
    ) in prompt
    assert target.read_text(encoding="utf-8") == original


@pytest.mark.parametrize("author_requested", [False, True])
def test_live_http_tool_hint_cannot_grant_author_edit_permissions(client, tmp_path, voice_http, author_requested):
    project = tmp_path / "project"
    project.mkdir()
    original = "“灯还亮着。”她说。\n铜钥匙落在地扳上。\n" + TAIL
    target = project / "正文.md"
    target.write_text(original, encoding="utf-8", newline="")
    voice_http.tool_instruction = "把中文引号统一成直引号，并修复地扳。"
    voice_http.replacements = (("“", '"'), ("”", '"'), ("地扳", "地板"))
    command = voice_http.tool_instruction if author_requested else "只修复地扳，不改引号。"
    frames = stream_agent_message(
        client,
        "voice-http-live-session",
        run_id=f"voice-live-http-{author_requested}",
        user_message=command,
        permission_profile="ask",
        args={"project_path": str(project), "context_bundle": {"files": []}},
    )
    result = frames[-1]
    assert result["type"] == "agent_result", result
    assert result["proposed_patch"]["after"] == (
        voice_http.transform(original) if author_requested else original.replace("地扳", "地板")
    )
    assert result["proposed_patch"]["requires_confirmation"] is True
    writer = [request for request in voice_http.requests if not request.get("tools")]
    assert len(writer) == 1 and writer[0]["stream"] is True
    prompt = writer[0]["messages"][-1]["content"]
    assert command in prompt and original in prompt
    assert (
        '"allowed_punctuation_forms": ["quotes"]' if author_requested else '"allowed_punctuation_forms": []'
    ) in prompt
    assert voice_http.outer_rounds == 2 and len(voice_http.requests) == 3
    assert target.read_text(encoding="utf-8") == original


VOICE_CASES = [
    ("keep", "“真的？？？”她喊，“回来！！！”\n门，，仍然敞着。", (("，，", "，"),), None, None),
    ("invalid", "“真的？？？”她喊，“回来！！！”\n门，，仍然敞着。", (("，，", "，"),), None, None),
    ("provider", "“真的？？？”她喊，“回来！！！”\n门，，仍然敞着。", (("，，", "，"),), None, None),
    ("length", "“真的？？？”她喊，“回来！！！”\n门，，仍然敞着。", (("，，", "，"),), "response_truncated", None),
    ("offline", "“真的？？？”她喊，“回来！！！”\n门，，仍然敞着。", (("，，", "，"),), None, None),
    ("withdraw", "“真的？？？”她喊，“回来！！！”\n门，，仍然敞着。", (("，，", "，"),), None, None),
    (
        "uncertain-person",
        "他走到窗前。他停了下来。他拿起杯子。他低声问。",
        (("他走到", "人走到"),),
        None,
        "narrative_person_uncertain",
    ),
    (
        "person-flip",
        "他走到窗前。他停了下来。他拿起杯子。他低声问。",
        (("他", "我"),),
        "narrative_person_changed",
        None,
    ),
    (
        "angle-quotes",
        "她说：“门外有一道很浅的车辙，车辙绕过井台，一直通往东边那座空仓。”",
        (("“", "「"), ("”", "」")),
        None,
        None,
    ),
    ("unrelated-negation", "钥匙在林岚手中。院里空无一人。", (("空无一人", "没有人"),), None, None),
    (
        "actual-negation",
        "钥匙在林岚手中。院里空无一人。",
        (("钥匙在", "钥匙不在"),),
        "grounded_fact_contradicted",
        None,
    ),
    ("pronoun", "林岚停在门口。林岚把空杯放下。", (("林岚把", "她把"),), None, "entity_reference_count_changed"),
    ("name-typo", "林岚停在门口。林岚把空杯放下。", (("林岚把", "林蓝把"),), "protected_entity_changed:林岚", None),
    ("same-event", "林岚把铜钥匙交给顾迟。", (("交给", "递给"),), None, None),
    (
        "reversed-event",
        "林岚把铜钥匙交给顾迟。",
        (("林岚把铜钥匙交给顾迟", "顾迟把铜钥匙交给林岚"),),
        "event_relation_changed",
        None,
    ),
    ("protected-span", "等等？？？\n门，，依然敞着。", (("，，", "，"),), None, None),
]


@pytest.mark.parametrize("case,prefix,replacements,reason,advisory", VOICE_CASES, ids=[item[0] for item in VOICE_CASES])
def test_chapter_polish_public_stream_delivers_voice_and_conservative_gates(
    client, tmp_path, voice_http, case, prefix, replacements, reason, advisory
):
    project = tmp_path / "project"
    (project / ".storyforge").mkdir(parents=True)
    author = "VOICE_HTTP_AUTHOR：保留重复问号和感叹号。"
    if case == "protected-span":
        author += "保留“等等？？？”逐字不变。"
    files = []
    for path, kind, text in (
        (".storyforge/agent-instructions.md", "author_instructions", author),
        ("设定/钥匙.md", "setting", "钥匙在林岚手中。"),
        ("人物/林岚.md", "character", "林岚是人物。"),
        ("人物/顾迟.md", "character", "顾迟是人物。"),
    ):
        source = project / path
        source.parent.mkdir(exist_ok=True)
        source.write_text(text, encoding="utf-8")
        files.append({"relative_path": path, "kind": kind, "excerpt": text})
    original = prefix + "\n" + TAIL
    target = project / "正文.md"
    target.write_text(original, encoding="utf-8", newline="")
    voice_http.replacements = replacements
    voice_http.response_mode = (
        case if case in {"invalid", "provider", "length"} else "invalid" if case == "withdraw" else "valid"
    )
    command = "不要保留重复问号和感叹号，只润色表达。" if case == "withdraw" else "只润色表达，不改事实。"
    run_id = f"voice-http-{case}"
    frames = stream_agent_message(
        client,
        "voice-http-session",
        run_id=run_id,
        intent="chapter.polish",
        user_message=command,
        permission_profile="full",
        args={
            "project_path": str(project),
            "file_path": "正文.md",
            "content": original,
            "online_enabled": case != "offline",
            "context_bundle": {"project_root": str(project), "files": files},
        },
    )
    result = frames[-1]
    assert result["type"] == "agent_result", result
    trace = next(item for item in result["tool_trace"] if item["tool_name"] == "chapter.polish")
    summary = trace["output_summary"]
    assert summary["edit_policy"]["source_sha256"] == hashlib.sha256(original.encode("utf-8")).hexdigest()
    assert summary["edit_policy"]["preserve_repeated_marks"] is (case != "withdraw")
    assert "VOICE_HTTP_AUTHOR" not in json.dumps(trace, ensure_ascii=False)
    assert "PROVIDER_PRIVATE_HTTP" not in json.dumps(result, ensure_ascii=False)
    assert len(voice_http.requests) == int(case != "offline")
    if voice_http.requests:
        wire = voice_http.requests[0]
        assert wire["model"] == "synthetic-voice-http" and not wire.get("stream")
        system = wire["messages"][0]["content"]
        assert author in system and command in system
        payload = json.loads(wire["messages"][-1]["content"])
        assert {"林岚", "顾迟"} <= set(payload["constraints"]["protected_entities"])
        assert any("钥匙在林岚手中" in fact["statement"] for fact in payload["constraints"]["continuity_facts"])
        if case == "protected-span":
            assert all("等等？？？" not in item["text"] for item in payload["segments"])
    if reason:
        assert reason in summary["gate_reasons"]["online"]
    if advisory:
        assert advisory in summary["gate_advisories"]["online"]
    degraded = case in {"invalid", "provider", "length", "withdraw"}
    preserved_original = bool(reason and case != "length")
    patch = result.get("proposed_patch")
    if preserved_original:
        assert patch is None
        assert summary["selected_source"] == "original"
    else:
        expected = voice_http.transform(original)
        if case == "withdraw":
            expected = expected.replace("？？？", "？").replace("！！！", "！")
        assert patch["after"] == expected and patch["before"] == original
        assert patch["candidate_source"] == ("local" if degraded or case == "offline" else "online")
        assert patch["requires_confirmation"] is degraded
        assert patch["degraded"] is degraded
    artifacts = client.get(f"/api/agent-runs/{run_id}/artifacts")
    assert artifacts.status_code == 200
    saved = [item for item in artifacts.json() if item["kind"] == "proposed_patch"]
    assert len(saved) == int(not preserved_original)
    if saved:
        assert saved[0]["payload"] == patch
    events = client.get(f"/api/agent-runs/{run_id}/events")
    assert events.status_code == 200
    persisted = next(
        item["payload"]["trace"]
        for item in events.json()
        if item["event_type"] == "tool_trace" and item["payload"]["trace"]["tool_name"] == "chapter.polish"
    )
    assert persisted == trace
    assert len(voice_http.requests) == int(case != "offline")
    assert target.read_text(encoding="utf-8") == original
