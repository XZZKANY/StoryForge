"""光标处续写：增量思维链剥离、流式出网、确定性后处理与 SSE 端点证据链。"""

from __future__ import annotations

import json
from urllib import error

import pytest
from fastapi.testclient import TestClient

from app.common import llm_client
from app.common.llm_http import StreamingReasoningFilter
from app.domains.assistant import continuation
from app.domains.assistant import service as assistant_service


def _drive(filter_: StreamingReasoningFilter, chunks: list[str]) -> str:
    return "".join([*(filter_.feed(chunk) for chunk in chunks), filter_.flush()])


class TestStreamingReasoningFilter:
    def test_plain_prose_passes_through_unchanged(self) -> None:
        filter_ = StreamingReasoningFilter()
        assert _drive(filter_, ["他推开", "门。", "外面下着雪。"]) == "他推开门。外面下着雪。"
        assert filter_.stripped is False

    def test_leading_think_block_is_dropped(self) -> None:
        filter_ = StreamingReasoningFilter()
        assert _drive(filter_, ["<think>", "先想想雪景", "</think>", "他推开门。"]) == "他推开门。"
        assert filter_.stripped is True

    def test_think_tags_split_across_chunks_still_stripped(self) -> None:
        """标签被切成半截送达是流式常态，不能因为一次 feed 看不全就误放行。"""

        assert _drive(StreamingReasoningFilter(), ["<th", "ink>盘算", "</thi", "nk>正文来了"]) == "正文来了"

    def test_angle_bracket_that_is_not_think_is_not_swallowed(self) -> None:
        assert _drive(StreamingReasoningFilter(), ["<", "p>不是思维链"]) == "<p>不是思维链"

    def test_unclosed_think_falls_back_to_whole_text_strip(self) -> None:
        filter_ = StreamingReasoningFilter()
        assert _drive(filter_, ["<think>只有思维链没闭合"]) == "只有思维链没闭合"
        assert filter_.stripped is True

    def test_case_insensitive_tags(self) -> None:
        assert _drive(StreamingReasoningFilter(), ["<THINK>x</THINK>正文"]) == "正文"


class TestManuscriptTail:
    def test_takes_lines_up_to_cursor(self) -> None:
        doc = "第一段。\n\n第二段。\n\n第三段。"
        assert continuation.manuscript_tail(doc, 3) == "第一段。\n\n第二段。"

    def test_cursor_beyond_end_is_clamped(self) -> None:
        """前端行号可能比后端读到的文件多一行（未保存的编辑），夹取而不是抛错。"""

        assert continuation.manuscript_tail("只有一行。", 999) == "只有一行。"

    def test_cursor_zero_returns_empty(self) -> None:
        assert continuation.manuscript_tail("正文。", 0) == ""

    def test_long_manuscript_is_windowed(self) -> None:
        doc = "\n\n".join(f"第{i}段的内容。" for i in range(1, 400))
        tail = continuation.manuscript_tail(doc, 10_000, max_chars=200)
        assert len(tail) <= 200
        assert tail.endswith("第399段的内容。")


class TestStripRepeatedPrefix:
    def test_restated_tail_is_removed(self) -> None:
        tail = "他推开门，外面下着雪。"
        assert continuation.strip_repeated_prefix(tail, tail + "雪落在肩上。") == "雪落在肩上。"

    def test_fresh_continuation_is_untouched(self) -> None:
        assert continuation.strip_repeated_prefix("他推开门。", "完全不同的新句子。") == "完全不同的新句子。"

    def test_short_incidental_overlap_is_not_stripped(self) -> None:
        """"他" 这种一两字的偶然重合不能算复述，否则会吃掉正文开头。"""

        assert continuation.strip_repeated_prefix("走进来的是他", "他抬起头。") == "他抬起头。"


class TestTrimToSentenceEnd:
    def test_dangling_fragment_is_trimmed(self) -> None:
        text = "他推开门，雪扑在脸上。他缩了缩脖子，把领口拉紧。远处传来一声闷响，像是"
        assert continuation.trim_to_sentence_end(text) == "他推开门，雪扑在脸上。他缩了缩脖子，把领口拉紧。"

    def test_complete_text_is_unchanged(self) -> None:
        assert continuation.trim_to_sentence_end("整段都写完了。") == "整段都写完了。"

    def test_refuses_to_discard_more_than_half(self) -> None:
        """一句超长没有终止符时宁可留半句，也不要把刚生成的大部分丢掉。"""

        text = "开头。" + "后面是一整段没有任何句号的长句一直写下去写下去写下去"
        assert continuation.trim_to_sentence_end(text) == text


class TestBuildContinuePrompt:
    def test_steering_sits_after_the_manuscript(self) -> None:
        """近因位置最强：canon 约束与本次要求必须排在上文之后，而不是塞进开头。"""

        prompt = continuation.build_continue_prompt(
            tail="他推开门。",
            file_path="正文/第001章.md",
            scene_constraints="[canon 硬约束]\n·「归零权限」唯一持有者 = 青岩。",
        )
        assert prompt.index("MANUSCRIPT>>>") < prompt.index("canon 硬约束")
        assert prompt.index("canon 硬约束") < prompt.index("【本次续写要求】")

    def test_forbids_restating_and_wrapping_up(self) -> None:
        prompt = continuation.build_continue_prompt(tail="他推开门。", file_path="a.md")
        assert "不要重复" in prompt
        assert "不要收尾" in prompt

    def test_empty_manuscript_says_so(self) -> None:
        prompt = continuation.build_continue_prompt(tail="", file_path="a.md")
        assert "还是空的" in prompt


class _FakeStream:
    """够用的 urlopen 返回体替身：可迭代出 SSE 行，可 close。"""

    def __init__(self, lines: list[bytes], *, fail_at: int | None = None) -> None:
        self._lines = lines
        self._fail_at = fail_at
        self.closed = False

    def __iter__(self):
        for index, line in enumerate(self._lines):
            if self._fail_at is not None and index == self._fail_at:
                raise ConnectionError("连接在读流中途断开")
            yield line

    def close(self) -> None:
        self.closed = True


def _sse_lines(pieces: list[str], *, usage: dict[str, int] | None = None) -> list[bytes]:
    lines: list[bytes] = []
    for piece in pieces:
        chunk = {"choices": [{"delta": {"content": piece}}]}
        lines.append(f"data: {json.dumps(chunk, ensure_ascii=False)}\n".encode())
        lines.append(b"\n")
    if usage is not None:
        lines.append(f"data: {json.dumps({'choices': [], 'usage': usage})}\n".encode())
    lines.append(b"data: [DONE]\n")
    return lines


@pytest.fixture
def _llm_stream_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "test-model")
    monkeypatch.setenv("STORYFORGE_LLM_BASE_URL", "https://example.invalid/v1")
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "sk-test-key-value")
    monkeypatch.setattr(llm_client, "_sleep_before_retry", lambda **_: None)


@pytest.mark.usefixtures("_llm_stream_env")
class TestStreamChatCompletions:
    def _payload(self) -> dict[str, object]:
        import os

        return llm_client.build_chat_payload(
            os.environ,
            messages=[{"role": "user", "content": "写下去"}],
            tools=None,
            tool_choice=None,
            stream=True,
        )

    def test_yields_deltas_then_done_with_usage(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import os

        stream = _FakeStream(_sse_lines(["他推开", "门。"], usage={"prompt_tokens": 100, "completion_tokens": 8}))
        monkeypatch.setattr(llm_client.request, "urlopen", lambda *a, **k: stream)

        frames = list(llm_client.stream_chat_completions(os.environ, self._payload()))

        assert [f["text"] for f in frames if f["type"] == "delta"] == ["他推开", "门。"]
        done = frames[-1]
        assert done["type"] == "done"
        assert done["content"] == "他推开门。"
        assert done["prompt_tokens"] == 100
        assert done["completion_tokens"] == 8
        assert done["token_usage_source"] == "provider_usage"
        assert stream.closed is True

    def test_missing_provider_usage_falls_back_to_estimate(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import os

        monkeypatch.setattr(
            llm_client.request, "urlopen", lambda *a, **k: _FakeStream(_sse_lines(["正文"]))
        )
        done = list(llm_client.stream_chat_completions(os.environ, self._payload()))[-1]
        assert done["token_usage_source"] == "estimated_split"

    def test_retries_before_first_byte(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import os

        attempts: list[int] = []

        def flaky(*_a, **_k):
            attempts.append(1)
            if len(attempts) < 3:
                raise error.HTTPError("u", 503, "busy", {}, None)  # type: ignore[arg-type]
            return _FakeStream(_sse_lines(["成功"]))

        monkeypatch.setattr(llm_client.request, "urlopen", flaky)
        frames = list(llm_client.stream_chat_completions(os.environ, self._payload()))
        assert len(attempts) == 3
        assert frames[-1]["content"] == "成功"

    def test_does_not_retry_once_tokens_have_been_emitted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """重连会让作者眼前重复出现半段正文，比直接失败更糟——吐字后一律不重试。"""

        import os

        attempts: list[int] = []

        def once_then_break(*_a, **_k):
            attempts.append(1)
            # 行序：0=第一条 data，1=空行，2=第二条 data。断在 2 即"第一块已吐出、第二块未到"。
            return _FakeStream(_sse_lines(["开头一句。", "第二句。"]), fail_at=2)

        monkeypatch.setattr(llm_client.request, "urlopen", once_then_break)

        produced: list[str] = []
        with pytest.raises(llm_client.LLMError) as excinfo:
            for frame in llm_client.stream_chat_completions(os.environ, self._payload()):
                if frame["type"] == "delta":
                    produced.append(str(frame["text"]))

        assert attempts == [1], "读流中途断开不得重连"
        assert produced == ["开头一句。"]
        assert "已输出 5 字" in str(excinfo.value)

    def test_drops_stream_options_when_endpoint_rejects_it(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """不认 stream_options 的兼容端点：摘掉重发，而不是把 400 甩给作者。"""

        import os

        sent: list[dict[str, object]] = []

        def picky(req, **_k):
            sent.append(json.loads(req.data.decode("utf-8")))
            if "stream_options" in sent[-1]:
                raise error.HTTPError("u", 400, "bad", {}, None)  # type: ignore[arg-type]
            return _FakeStream(_sse_lines(["正文"]))

        monkeypatch.setattr(llm_client.request, "urlopen", picky)
        frames = list(llm_client.stream_chat_completions(os.environ, self._payload()))

        assert len(sent) == 2
        assert "stream_options" in sent[0]
        assert "stream_options" not in sent[1]
        assert frames[-1]["content"] == "正文"

    def test_payload_without_stream_flag_is_byte_identical_to_before(self) -> None:
        """per-call 覆盖不传时，既有调用方的请求体不得有任何变化。"""

        import os

        payload = llm_client.build_chat_payload(
            os.environ, messages=[{"role": "user", "content": "x"}], tools=None, tool_choice=None
        )
        assert payload == {"model": "test-model", "messages": [{"role": "user", "content": "x"}], "temperature": 0.7}


def _parse_sse(body: str) -> list[tuple[str, dict]]:
    frames: list[tuple[str, dict]] = []
    for block in body.split("\n\n"):
        if not block.strip():
            continue
        event = ""
        data = "{}"
        for line in block.splitlines():
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                data = line[6:]
        frames.append((event, json.loads(data)))
    return frames


class TestContinueEndpoint:
    def test_streams_prose_and_records_evidence(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
        monkeypatch.setenv("STORYFORGE_LLM_MODEL", "test-model")

        captured: dict[str, object] = {}

        def fake_stream(source, payload, **_kwargs):  # noqa: ANN001 - 测试桩
            captured["payload"] = payload
            yield {"type": "delta", "text": "雪落在"}
            yield {"type": "delta", "text": "肩上。还没写完的半"}
            yield {
                "type": "done",
                "content": "雪落在肩上。还没写完的半",
                "prompt_tokens": 210,
                "completion_tokens": 12,
                "cost_cny_estimated": 0.002,
                "latency_ms": 88,
            }

        monkeypatch.setattr(assistant_service, "stream_chat_completions", fake_stream)

        response = client.post(
            "/api/assistant/continue",
            json={"file_path": "正文/第001章.md", "content": "他推开门。", "cursor_line": 1},
        )
        assert response.status_code == 200, response.text
        frames = _parse_sse(response.text)
        kinds = [event for event, _ in frames]
        assert kinds[0] == "start"
        assert "delta" in kinds
        assert kinds[-1] == "done"

        done = frames[-1][1]
        # 流里吐的是原始增量；done.text 经确定性后处理裁掉了没写完的半句。
        assert done["text"] == "雪落在肩上。"
        assert done["model"] == "test-model"

        session_id = done["assistant_session_id"]
        tool_calls = client.get(f"/api/assistant/sessions/{session_id}/tool-calls").json()
        assert [call["tool_name"] for call in tool_calls] == ["assistant.continue"]
        assert tool_calls[0]["status"] == "completed"
        assert tool_calls[0]["output_summary"]["prompt_tokens"] == 210
        assert tool_calls[0]["output_summary"]["final_chars"] == 6

    def test_returns_422_before_streaming_when_llm_unconfigured(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """未配置必须是真 422，不能裹在流里以 200 送出。"""

        monkeypatch.setattr(
            assistant_service, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"]
        )
        response = client.post(
            "/api/assistant/continue",
            json={"file_path": "a.md", "content": "正文。", "cursor_line": 1},
        )
        assert response.status_code == 422

    def test_llm_failure_becomes_error_frame_and_failed_tool_call(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
        monkeypatch.setenv("STORYFORGE_LLM_MODEL", "test-model")

        def boom(source, payload, **_kwargs):  # noqa: ANN001 - 测试桩
            raise llm_client.LLMError("上游 502")
            yield  # pragma: no cover - 使其成为生成器

        monkeypatch.setattr(assistant_service, "stream_chat_completions", boom)

        response = client.post(
            "/api/assistant/continue",
            json={"file_path": "a.md", "content": "正文。", "cursor_line": 1},
        )
        assert response.status_code == 200
        frames = _parse_sse(response.text)
        assert frames[-1][0] == "error"
        assert "上游 502" in frames[-1][1]["message"]

        session_id = frames[0][1]["assistant_session_id"]
        tool_calls = client.get(f"/api/assistant/sessions/{session_id}/tool-calls").json()
        assert tool_calls[0]["status"] == "failed"

    def test_pure_restatement_is_reported_instead_of_written_back(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """模型只复述上文时后处理会掐空，此时必须报错而不是回一个空补丁。"""

        monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
        monkeypatch.setenv("STORYFORGE_LLM_MODEL", "test-model")

        def echo(source, payload, **_kwargs):  # noqa: ANN001 - 测试桩
            yield {"type": "delta", "text": "他推开门，外面下着雪。"}
            yield {"type": "done", "content": "他推开门，外面下着雪。"}

        monkeypatch.setattr(assistant_service, "stream_chat_completions", echo)

        response = client.post(
            "/api/assistant/continue",
            json={"file_path": "a.md", "content": "他推开门，外面下着雪。", "cursor_line": 1},
        )
        frames = _parse_sse(response.text)
        assert frames[-1][0] == "error"
        assert "没有写出新内容" in frames[-1][1]["message"]


class TestCallLlmStreamed:
    """服务端聚合的流式调用：对调用方与 `call_llm` 同构，但传输必须是流式。

    背景（2026-08-01 实测）：非流式长请求在 CDN 前置的中转站会被当空闲连接掐断
    （800–1200 字正文 280s 未返回 + ConnectionReset），流式则持续有字节流动。
    产字三条路径（file.create / file.revise / draft_continuation）正文动辄上千字。
    """

    def test_returns_same_shape_as_non_streamed(self, monkeypatch: pytest.MonkeyPatch, _llm_stream_env: None) -> None:
        import os

        monkeypatch.setattr(
            llm_client.request,
            "urlopen",
            lambda *a, **k: _FakeStream(_sse_lines(["他推开", "门。"], usage={"prompt_tokens": 100, "completion_tokens": 8})),
        )
        result = llm_client.call_llm_streamed(
            os.environ, system_prompt="你是作者。", user_prompt="写下去"
        )

        assert result["content"] == "他推开门。"
        assert result["prompt_tokens"] == 100
        assert result["completion_tokens"] == 8
        assert "type" not in result, "流式内部帧类型不得泄漏给调用方"
        # 与非流式返回逐键同构，否则调用方读 result[...] 会在切换后 KeyError
        for key in ("content", "token_usage", "cost_cny_estimated", "cost_breakdown", "latency_ms"):
            assert key in result, f"缺键 {key}"

    def test_requests_stream_true(self, monkeypatch: pytest.MonkeyPatch, _llm_stream_env: None) -> None:
        """传输必须真是流式——这是本函数存在的唯一理由，退回非流式即失去防掐断能力。"""

        import os

        seen: list[dict[str, object]] = []

        def capture(request_obj, *a, **k):
            seen.append(json.loads(request_obj.data.decode("utf-8")))
            return _FakeStream(_sse_lines(["正文"]))

        monkeypatch.setattr(llm_client.request, "urlopen", capture)
        llm_client.call_llm_streamed(os.environ, system_prompt="s", user_prompt="u")

        assert seen and seen[0].get("stream") is True

    def test_missing_done_frame_raises(self, monkeypatch: pytest.MonkeyPatch, _llm_stream_env: None) -> None:
        """上游提前关流时必须炸——静默返回空正文会把缺文当成功写进补丁。"""

        import os

        monkeypatch.setattr(
            llm_client, "_stream_chat_completions", lambda *a, **k: iter([{"type": "delta", "text": "半句"}])
        )
        with pytest.raises(llm_client.LLMError):
            llm_client.call_llm_streamed(os.environ, system_prompt="s", user_prompt="u")


@pytest.mark.parametrize(
    "func_name",
    ["draft_file_content", "revise_file_content", "draft_continuation"],
)
def test_prose_paths_use_streamed_transport(func_name: str) -> None:
    """三条产字路径必须走流式聚合调用；退回 `_call_llm(` 即红。

    这三条的正文动辄上千字，非流式在 CDN 前置的中转站会被掐断（实测 280s 未返回）。
    短问答 `chat_reply` 刻意不在此列——它没有被掐断的体量，不必改传输。
    """

    import inspect

    from app.domains.assistant import service

    source = inspect.getsource(getattr(service, func_name))
    assert "_call_llm_streamed(" in source, f"{func_name} 没走流式聚合调用"
    assert "result = _call_llm(" not in source, f"{func_name} 退回了非流式调用"


def test_streamed_call_omits_blank_system_message(monkeypatch: pytest.MonkeyPatch, _llm_stream_env: None) -> None:
    """system_prompt 为空时不落进 messages。

    实验台的 draft/critique/revision 形态本就是单条 user prompt；硬塞一条空 system
    会让新波次与 wave1-3 不是同一个输入，破坏波次间可比性。
    """

    import os

    seen: list[dict[str, object]] = []

    def capture(request_obj, *a, **k):
        seen.append(json.loads(request_obj.data.decode("utf-8")))
        return _FakeStream(_sse_lines(["正文"]))

    monkeypatch.setattr(llm_client.request, "urlopen", capture)
    llm_client.call_llm_streamed(os.environ, system_prompt="   ", user_prompt="只有这一条")

    roles = [m["role"] for m in seen[0]["messages"]]
    assert roles == ["user"], f"空 system 被塞进了 messages：{roles}"
