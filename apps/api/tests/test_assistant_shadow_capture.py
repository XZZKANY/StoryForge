"""影子档 prompt 捕获（TS 迁移 P5-1）：带请求头时把派发给模型的请求快照交回，不带时一切照旧。"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.common import llm_client
from app.domains.agent_runs import request_evidence

API_KEY = "sk-shadow-capture-key-value"
SHADOW = {"X-StoryForge-Shadow": "prompts"}


class _FakeStream:
    def __init__(self, lines: list[bytes]) -> None:
        self._lines = lines

    def __iter__(self):
        yield from self._lines

    def close(self) -> None:
        pass


def _sse_lines(pieces: list[str]) -> list[bytes]:
    lines: list[bytes] = []
    for piece in pieces:
        chunk = {"choices": [{"delta": {"content": piece}}]}
        lines.append(f"data: {json.dumps(chunk, ensure_ascii=False)}\n".encode())
        lines.append(b"\n")
    lines.append(f"data: {json.dumps({'choices': [], 'usage': {'prompt_tokens': 9, 'completion_tokens': 4}})}\n".encode())
    lines.append(b"data: [DONE]\n")
    return lines


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    """从传输层打桩：请求照常经过 ObservedProvider，记下线上真正发出的请求体。"""

    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "openai-compatible")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "shadow-model")
    monkeypatch.setenv("STORYFORGE_LLM_BASE_URL", "https://example.invalid/v1")
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", API_KEY)
    monkeypatch.setattr(llm_client, "_sleep_before_retry", lambda **_: None)
    bodies: list[dict[str, object]] = []

    def urlopen(req, **_kwargs):  # noqa: ANN001 - 传输桩
        bodies.append(json.loads(req.data.decode("utf-8")))
        return _FakeStream(_sse_lines(["林岚冲进", "雾里的港口。"]))

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    return bodies


def _frames(text: str) -> list[tuple[str, dict[str, object]]]:
    frames = []
    for block in text.split("\n\n"):
        lines = block.strip().splitlines()
        if len(lines) == 2:
            frames.append((lines[0].removeprefix("event: "), json.loads(lines[1].removeprefix("data: "))))
    return frames


def _assert_matches_wire(entry: dict[str, object], body: dict[str, object], *, streaming: bool) -> None:
    assert entry["step"] == "agent.model"
    assert entry["streaming"] is streaming
    request = entry["request"]
    assert isinstance(request, dict)
    assert request["messages"] == body["messages"]
    assert request["model"] == "shadow-model"
    assert entry["request_digest"] == request_evidence._digest(request)


REVISE = {"file_path": "draft.md", "content": "林岚走进港口。", "instruction": "加强画面感"}


def test_revise_returns_the_request_it_sent_when_asked(client: TestClient, sent: list[dict[str, object]]) -> None:
    response = client.post("/api/assistant/revise", json=REVISE, headers=SHADOW)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["after"] == "林岚冲进雾里的港口。"
    [entry] = data["shadow_requests"]
    _assert_matches_wire(entry, sent[0], streaming=True)
    assert API_KEY not in response.text


def test_revise_without_header_is_unchanged(client: TestClient, sent: list[dict[str, object]]) -> None:
    plain = client.post("/api/assistant/revise", json=REVISE).json()
    shadowed = client.post("/api/assistant/revise", json=REVISE, headers=SHADOW).json()
    assert "shadow_requests" not in plain
    shadowed.pop("shadow_requests")
    for volatile in ("assistant_session_id", "latency_ms"):
        plain.pop(volatile)
        shadowed.pop(volatile)
    assert shadowed == plain
    assert sent[0] == sent[1]


def test_capture_failure_never_breaks_the_request(
    client: TestClient, sent: list[dict[str, object]], monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(*_args, **_kwargs):
        raise RuntimeError("snapshot")

    monkeypatch.setattr(request_evidence, "request_snapshot", broken)
    response = client.post("/api/assistant/revise", json=REVISE, headers=SHADOW)
    assert response.status_code == 200, response.text
    assert response.json()["after"] == "林岚冲进雾里的港口。"
    assert response.json()["shadow_requests"] == [
        {"step": "agent.model", "streaming": True, "error": "snapshot_failed"}
    ]
    assert len(sent) == 1


CONTINUE = {"file_path": "正文/第001章.md", "content": "他推开门。", "cursor_line": 1}


# 观察者若挂派发记录，ObservedProvider 会在流式生成器里跨步 reset ContextVar（Starlette 每步换 Context）。
@pytest.mark.filterwarnings("error::pytest.PytestUnraisableExceptionWarning")
def test_continue_appends_a_shadow_frame_after_the_stream(
    client: TestClient, sent: list[dict[str, object]]
) -> None:
    response = client.post("/api/assistant/continue", json=CONTINUE, headers=SHADOW)
    assert response.status_code == 200, response.text
    frames = _frames(response.text)
    assert [event for event, _ in frames][-2:] == ["done", "shadow"]
    assert frames[-2][1]["text"] == "林岚冲进雾里的港口。"
    [entry] = frames[-1][1]["requests"]
    _assert_matches_wire(entry, sent[0], streaming=True)
    assert API_KEY not in response.text


def test_continue_without_header_has_no_shadow_frame(
    client: TestClient, sent: list[dict[str, object]]
) -> None:
    response = client.post("/api/assistant/continue", json=CONTINUE)
    assert response.status_code == 200, response.text
    assert [event for event, _ in _frames(response.text)][-1] == "done"
