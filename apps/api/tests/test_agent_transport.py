from __future__ import annotations

from types import SimpleNamespace

import pytest
from agent_transport import agent_result, parse_agent_sse, stream_agent_message


class _FakeClient:
    def __init__(self, response: SimpleNamespace) -> None:
        self.response = response

    def post(self, *_args, **_kwargs):  # noqa: ANN002, ANN003, ANN201 - minimal TestClient double
        return self.response


def _response(*, status_code: int = 200, content_type: str = "text/event-stream", text: str = ""):
    return SimpleNamespace(
        status_code=status_code,
        headers={"content-type": content_type},
        text=text,
    )


def test_parse_agent_sse_supports_crlf_and_multiline_data() -> None:
    frames = parse_agent_sse('data: {"type":\r\ndata: "error", "detail": "bad"}\r\n\r\n')

    assert frames == [{"type": "error", "detail": "bad"}]


def test_parse_agent_sse_rejects_malformed_json() -> None:
    with pytest.raises(ValueError):
        parse_agent_sse("data: not-json\n\n")


@pytest.mark.parametrize(
    ("response", "detail"),
    [
        (_response(status_code=500, text="boom"), "boom"),
        (_response(content_type="application/json", text='{"type":"error"}'), "content-type"),
        (_response(text=""), "没有 data 帧"),
        (_response(text='data: {"type":"agent_step"}\n\n'), "缺少终态帧"),
    ],
)
def test_stream_agent_message_rejects_invalid_transport(response: SimpleNamespace, detail: str) -> None:
    with pytest.raises(AssertionError, match=detail):
        stream_agent_message(_FakeClient(response), "session-test", user_message="test")


def test_agent_result_returns_validated_terminal_frame() -> None:
    client = _FakeClient(_response(text='data: {"type":"error","detail":"bad"}\n\n'))

    assert agent_result(client, "session-test", user_message="test") == {
        "type": "error",
        "detail": "bad",
    }
