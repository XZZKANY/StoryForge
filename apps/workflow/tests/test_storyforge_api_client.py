from __future__ import annotations

import io
import json
from urllib.error import HTTPError

import pytest

from storyforge_workflow import storyforge_api_client as client


def _http_error(code: int, detail: str) -> HTTPError:
    body = json.dumps({"detail": detail}, ensure_ascii=False).encode("utf-8")
    return HTTPError(url="http://x", code=code, msg="err", hdrs=None, fp=io.BytesIO(body))


def test_post_chapter_approval_returns_json(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def fake_request(*, url, body, headers, timeout):
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = json.loads(body.decode("utf-8"))
        return {"continuity_edge_count": 2, "record_count": 5}

    monkeypatch.setattr(client, "_request_json", fake_request)
    monkeypatch.setenv("STORYFORGE_API_BASE_URL", "http://api.local:8000")
    monkeypatch.setenv("STORYFORGE_API_KEY", "k-123")

    result = client.post_chapter_approval({"chapter_id": 1})

    assert result["continuity_edge_count"] == 2
    assert captured["url"] == "http://api.local:8000/api/continuity/chapter-approval"
    assert captured["headers"]["X-StoryForge-API-Key"] == "k-123"
    assert captured["body"] == {"chapter_id": 1}


def test_post_chapter_approval_raises_gate_rejected_on_409(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_request(*, url, body, headers, timeout):
        raise _http_error(409, "连续性结构冲突，批准被拒绝：[blocking] 关系成环")

    monkeypatch.setattr(client, "_request_json", fake_request)

    with pytest.raises(client.ContinuityGateRejected) as exc:
        client.post_chapter_approval({"chapter_id": 1})
    assert "成环" in exc.value.detail


def test_post_chapter_approval_retries_then_raises_on_500(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def fake_request(*, url, body, headers, timeout):
        calls["n"] += 1
        raise _http_error(500, "boom")

    monkeypatch.setattr(client, "_request_json", fake_request)
    monkeypatch.setattr(client, "_sleep_before_retry", lambda **kwargs: None)
    monkeypatch.setenv("STORYFORGE_API_RETRY_MAX_ATTEMPTS", "3")

    with pytest.raises(HTTPError):
        client.post_chapter_approval({"chapter_id": 1})
    assert calls["n"] == 3


def test_post_chapter_approval_does_not_retry_400(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def fake_request(*, url, body, headers, timeout):
        calls["n"] += 1
        raise _http_error(400, "bad")

    monkeypatch.setattr(client, "_request_json", fake_request)

    with pytest.raises(HTTPError):
        client.post_chapter_approval({"chapter_id": 1})
    assert calls["n"] == 1
