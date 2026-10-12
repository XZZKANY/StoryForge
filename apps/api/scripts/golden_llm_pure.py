"""Real LLM-channel oracle (pure layer): config parsing, auth headers, model-list URL validation,
reasoning-leak and visible-text filters, usage / cost accounting, chat payloads and retry policy."""

from __future__ import annotations

import hashlib
import json
import os
from types import SimpleNamespace

from golden_fs import isolated_fs_oracle

SOURCES = [
    "app/common/llm_client.py",
    "app/common/llm_env.py",
    "app/common/llm_http.py",
    "app/common/llm_protocol.py",
    "app/common/stream_text.py",
]

NUMBERS = ["", "5", " 7 ", "+3", "-2", "-0", "1_000", "1__0", "_1", "1_", "5.0", "abc", "0x10", "007", "1e3",
           "0.7", "1", "1.", ".5", "1e-3", "1_000.5", "inf", "-Infinity", "NaN", "nan", "1.e5", ".e5", "1e1_0",
           "99999999999999999999", "  2.5  "]
BASE = {"STORYFORGE_LLM_MODEL": " gpt-test ", "STORYFORGE_LLM_API_KEY": "sk-test-1234567890abcdef",
        "STORYFORGE_LLM_BASE_URL": "https://relay.example.com/v1/", "STORYFORGE_LLM_PROVIDER": "openai"}
URLS = [
    "https://api.example.com/v1", "https://api.example.com/v1/", "http://localhost:8080",
    "HTTPS://Api.Example.com/v1///", "https://api.example.com/v1?x=1", "https://api.example.com/v1?key=abc",
    "https://api.example.com/v1?Key=", "https://api.example.com/v1?ke%79=x", "https://api.example.com/v1?api_key=x",
    "https://api.example.com/v1?token=x", "https://api.example.com/v1?has_token=x", "https://api.example.com/v1?a+b=1&&c",
    "https://user:pw@api.example.com/v1", "https://@api.example.com", "https://api.example.com:99999/v1",
    "https://api.example.com:abc/v1", "https://api.example.com:/v1", "ftp://api.example.com", "api.example.com/v1",
    "https:///v1", "https://api.example.com/v 1", "https://[::1]:8080/v1", "https://[::1/v1", "https://[1.2.3.4]/v1",
    "https://[fe80::1%25eth0]/v1", "https://[v1.abc]/v1", "https://[vz.abc]/v1", "https://[::ffff:1.2.3.4]/x",
    "https://[1:2:3:4:5:6:7:8:9]/", "https://[:1]/", "https://[1::2::3]/", "https://[1:2:3:4:5:6:7:8]/",
    "https://[::]/", "https://[x]:80/", "https://a[::1]/v1", "https://[1:2:3:4:5:6:7::8]/", "https://[1::2:3:4:5:6:7:8]/",
    "https://api.example.com/v1#frag", "https://api.example.com/v1/sk-SECRET123",
    "https://api.example.com/v1/%73k-SECRET123", "\x01https://api.example.com/v1", "https://ｅxample.com/v1",
    "https://example.com／x/v1", "https://例子.测试/v1", "https://api.example.com/v1?%ZZ=1",
]
THINK_TEXTS = ["", "plain", "<think>a</think>正文", "  <THINK>x</Think>  正文  ", "前<think>a</think>中<think>b</think>后",
               "a</think>b</THINK>c", "<think>unclosed", "x<think>y", "<thinK>k</thinK>z", "<think>\nmulti\nline</think>\n结果"]
STREAMING = [["<think>abc</think>  Hello", " world"], ["Hel", "lo"], ["  <th", "ink>x", "</think>", "y"],
             ["<think>never closed"], ["<", "t", "x"], ["", "a"], ["  ", "  "], ["<THINK>A</THINK>B"], ["<think", ">"]]
SECRET = "MySecretValue123"
VISIBLE = [
    ([], ["Hello ", "<thi", "nk>secret thought</th", "ink> world"]),
    ([], ["key is sk-abc", "def123456789 done."]),
    ([], ["Authorization: Bear", "er abcdefghijk next"]),
    ([SECRET], ["xx MySec", "retValue123 yy"]),
    ([], ["sk-" + "a" * 5000, " tail"]),
    ([], ["sk-" + "a" * 5000, "bbbb", " after"]),
    ([], ["<THINK>x</Think>y"]),
    ([], ["a<think>b"]),
    ([], ["my token\n"]),
    ([], ["😀😀 api_k", "ey=12345678 ok"]),
    ([], ["ſk-abcdefghij more"]),
    ([], ["İ<think>x</think>y"]),
    (["tokenABCDEF123"], ["x tokenABC", "DEF123 y"]),
    ([], ["", "", "ok"]),
    ([], ["password", ": hunter2hunter2 ", "end"]),
    ([], ["ghp_", "abcdefghijklmnopqrstuvwxyz1234 fin"]),
    ([], ["foo_token=abc def"]),
    ([], ["xsk-abcdef", " end"]),
    ([], ["mytoken=abc", "def ok"]),
    ([], ["key sk-abcdef\n"]),
    (["zz-token-zz9"], ["pre zz-token-zz9", " post"]),
    (["zz-token-zz9"], ["pre zz-token-zz9x", " post"]),
    ([], ["sk-" + "a" * 4500, " tail"]),
    (["abcde", "MySecretValue123"], ["x abcde MySecretValue123 y"]),
]
MODEL_LISTS = [
    ({"data": [{"id": "a"}, {"id": "b"}]}, "openai", 200), ({"data": [{"id": "a"}], "has_more": True}, "openai", 200),
    ({"data": [{"id": " "}]}, "openai", 200), ({"data": [{"id": 5}]}, "openai", 200), ({"data": "x"}, "openai", 200),
    ([1], "openai", 200), ({"data": [{"id": "a"}, {"id": "b"}, {"id": "c"}]}, "openai", 2),
    ({"models": [{"name": "models/g1"}], "nextPageToken": "t"}, "gemini", 200),
    ({"models": [{"name": "g1"}]}, "gemini", 200), ({"models": [{"name": "models/"}]}, "google", 200),
    ({"models": [], "nextPageToken": ""}, "gemini", 200), ({"data": [{"id": "x　"}]}, "anthropic", 200),
]
USAGES = [
    (None, "abc", "x"), ({"usage": {"prompt_tokens": 10, "completion_tokens": 5}}, "", ""),
    ({"usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 20}}, "", ""),
    ({"usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 0}}, "", ""),
    ({"usage": {"total_tokens": 100}}, "一" * 41, ""), ({"usage": {"total_tokens": 3}}, "x" * 40, ""),
    ({"usage": {"prompt_tokens": -3, "completion_tokens": 5, "total_tokens": -1}}, "", ""),
    ({"usage": {"prompt_tokens": 10, "completion_tokens": 5, "prompt_cache_hit_tokens": 7}}, "", ""),
    ({"usage": {"prompt_tokens": 10, "completion_tokens": 5, "prompt_tokens_details": {"cached_tokens": 4}}}, "", ""),
    ({"usage": {"prompt_tokens": 10, "completion_tokens": 5, "prompt_cache_hit_tokens": -2}}, "", ""),
    ({"usage": {"prompt_tokens": 10.0, "completion_tokens": 5}}, "abcdefgh", "abcd"), ({"usage": {}}, "", ""),
    ({"usage": "x"}, "", ""), (None, "😀" * 9, "é" * 7),
    ({"usage": {"total_tokens": 9, "prompt_tokens_details": {"cached_tokens": 3}}}, "abcd" * 3, ""),
    ({"usage": {"total_tokens": 100}}, "😀" * 41, ""),
]
PRICING = [
    {}, {"STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "2", "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "8"},
    {"STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "2", "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "8",
     "STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS": "0.2"},
    {"STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "2", "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "8",
     "STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS": "-1"},
    {"STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "2", "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "8",
     "STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS": "0"},
    {"STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "nan", "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "8"},
    {"STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "1e308", "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "1e308"},
    {"STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "-1", "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "8"},
    {"STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "0.15", "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "0.6"},
]
COST_USAGES = [
    {"token_usage": 30, "prompt_tokens": 12345, "completion_tokens": 678, "cache_hit_tokens": None,
     "token_usage_source": "provider_usage"},
    {"token_usage": 30, "prompt_tokens": 12345, "completion_tokens": 678, "cache_hit_tokens": 4000,
     "token_usage_source": "provider_usage"},
    {"token_usage": 30, "prompt_tokens": 100, "completion_tokens": 7, "cache_hit_tokens": 500,
     "token_usage_source": "estimated_split"},
    {"token_usage": 3, "prompt_tokens": 1, "completion_tokens": 2, "token_usage_source": "unavailable"},
    {"prompt_tokens": 1, "completion_tokens": 2}, {"prompt_tokens": 7_000_000_000, "completion_tokens": 3,
                                                   "token_usage_source": "provider_usage"},
    {"prompt_tokens": 5, "completion_tokens": 5, "cache_hit_tokens": -3, "token_usage_source": ""},
]
MESSAGES = [{"role": "system", "content": "系统\t提示 \"引号\" \\ 反斜杠"}, {"role": "user", "content": "你好😀 \x01"}]
PAYLOADS = [
    ({}, {}), ({"STORYFORGE_LLM_TEMPERATURE": "1"}, {}), ({"STORYFORGE_LLM_TEMPERATURE": "abc"}, {}),
    ({"STORYFORGE_LLM_TEMPERATURE": "1e-7"}, {}), ({}, {"temperature": 0.3}), ({}, {"temperature": 0}),
    ({}, {"temperature": 1.0}), ({"STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "2048"}, {}),
    ({"STORYFORGE_LLM_MAX_COMPLETION_TOKENS": " 0"}, {}), ({"STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "-5"}, {}),
    ({"STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "x"}, {"max_completion_tokens": 100}),
    ({"STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "50"}, {"max_completion_tokens": 0}),
    ({"STORYFORGE_LLM_REASONING_EFFORT": " high "}, {}), ({}, {"tools": [], "tool_choice": "auto"}),
    ({}, {"tools": [{"type": "function", "function": {"name": "f", "parameters": {"type": "object"}}}],
          "tool_choice": "auto"}),
    ({}, {"tools": [{"type": "function", "function": {"name": "f"}}], "tool_choice": None}),
    ({}, {"tools": [{"type": "function"}], "tool_choice": {"type": "function", "function": {"name": "f"}}}),
    ({}, {"stream": True}), ({"STORYFORGE_LLM_MODEL": "  "}, {}),
]
CHUNKS = [{}, {"choices": []}, {"choices": "x"}, {"choices": [5]}, {"choices": [{"delta": "x"}]},
          {"choices": [{"delta": {"content": "字"}, "finish_reason": None}]}, {"choices": [{"delta": {"content": 5}}]},
          {"choices": [{"finish_reason": ""}, {"finish_reason": "stop"}]}, {"choices": [3, {"finish_reason": "length"}]}]
TOOL_MESSAGES = [
    {}, {"tool_calls": "x"},
    {"tool_calls": [
        {"id": "c1", "type": "function", "function": {"name": "fs.read", "arguments": {"path": "正文/1.md", "n": 1.5}}},
        {"id": 7, "function": {"name": "f", "arguments": [1, "二"]}},
        {"id": 0, "type": None, "function": {"arguments": None}},
        {"function": {"name": "g", "arguments": 5}}, {"function": {"name": "h", "arguments": 0}},
        {"function": {"name": "i", "arguments": True}}, {"function": {"name": "j", "arguments": "{\"a\":1}"}},
        {"function": {"name": "k", "arguments": {}}}, {"function": "x"}, 5, {"id": 1.0, "function": {"name": 2.5}},
    ]},
]
ASSISTANT_DATA = [{}, {"choices": []}, {"choices": [5]}, {"choices": [{"message": "x"}]},
                  {"choices": [{"message": {"content": "正文"}}]}]
RETRY_AFTER = [None, "", "5", " 2.5 ", "-1", "abc", "inf", "nan", "1e2", "1_0", "0", "-0"]
DELAYS = [(1, 0.5, 0.25, None), (3, 0.5, 0.25, None), (10, 0.5, 0.25, None), (2, 0.5, 0.0, None),
          (1, 0.5, 0.25, 120.0), (1, 0.5, 0.25, 0.0), (2, 0.3, 0.1, None), (4, 1.7, 0.25, 3.5)]
REDACT = [("text with sk-live-abcdefgh inside", ["sk-live-abcdefgh"]), ("Bearer abcdefghij token", [None, "short"]),
          ("密钥 MySecretValue123 与 api_key=zzzzzzzz", ["MySecretValue123"]), ("nothing", [])]
HEADER_SOURCES = [
    {}, {"STORYFORGE_LLM_AUTH_HEADER": "API-KEY"}, {"STORYFORGE_LLM_AUTH_HEADER": "basic"},
    {"STORYFORGE_LLM_PROVIDER": "Claude"}, {"STORYFORGE_LLM_PROVIDER": "google", "STORYFORGE_LLM_AUTH_HEADER": "x"},
    {"STORYFORGE_LLM_API_KEY": "  "}, {"STORYFORGE_LLM_PROVIDER": "anthropic", "STORYFORGE_LLM_AUTH_HEADER": "basic"},
]


def p1_llm_pure_snapshot() -> dict:
    with isolated_fs_oracle("llm-pure-oracle-") as (api, run):
        from app.common import llm_client as lc
        from app.common import llm_env, llm_http, llm_protocol, stream_text
        from app.common.llm_client import LLMConfigError, LLMError
        from app.common.version import APP_VERSION

        pure = []

        def record(fn, args, run_fn, errors=(LLMError, LLMConfigError, ValueError)):
            row = {"fn": fn, "args_json": json.dumps(args, ensure_ascii=False)}
            try:
                row["output_json"] = json.dumps(run_fn(), ensure_ascii=False)
            except errors as error:
                row["error"] = {"type": type(error).__name__, "message": str(error)}
            pure.append(row)

        for raw in NUMBERS:
            source = {"X": raw}
            record("optional_int", {"raw": raw}, lambda source=source: llm_http.optional_int(source, "X", -9))
            record("optional_float", {"raw": raw},
                   lambda source=source: repr(llm_http.optional_float(source, "X", -9.5)))
        for value in [None, "", "  ", " x ", "　y　"]:
            record("env", {"value": value}, lambda value=value: {
                "value": llm_http.env_value({"X": value}, "X"),
                "missing": llm_env.missing_llm_env({**BASE, "STORYFORGE_LLM_PROVIDER": value})})
            record("required_env", {"value": value}, lambda value=value: lc.required_env({"X": value}, "X"))
        for name in ["", "Anthropic", " claude ", "GOOGLE", "gemini", "openai", "x"]:
            record("provider_family", {"name": name}, lambda name=name: llm_protocol.provider_family(name))
        for overrides in HEADER_SOURCES:
            source = {**BASE, **overrides}
            record("headers", {"overrides": overrides}, lambda source=source: {
                "llm": lc.llm_request_headers(source), "provider": lc.provider_request_headers(source)})
        for headers in [{"Authorization": "Bearer abcdef123456"}, {"api-key": "k1", "X-Api-Key": "k2"},
                        {"x-goog-api-key": "g", "Content-Type": "x", "authorization": "bearer zz"}]:
            record("credential_values", {"headers": headers}, lambda headers=headers: lc._credential_header_values(headers))
        for url in URLS:
            for credential in ["", "sk-SECRET123"]:
                record("models_url", {"url": url, "credential": credential},
                       lambda url=url, credential=credential: llm_protocol.models_url(url, credential=credential))
        for data, provider, limit in MODEL_LISTS:
            def decode(data=data, provider=provider, limit=limit):
                result = llm_protocol.decode_model_list(data, provider=provider, limit=limit)
                return {"models": list(result.models), "received_count": result.received_count, "partial": result.partial}
            record("model_list", {"data": data, "provider": provider, "limit": limit}, decode)
        for text in THINK_TEXTS:
            record("strip_reasoning", {"text": text}, lambda text=text: llm_http.strip_reasoning_leak(text))
        for chunks in STREAMING:
            def streaming(chunks=chunks):
                flt = llm_http.StreamingReasoningFilter()
                return {"fed": [flt.feed(chunk) for chunk in chunks], "flush": flt.flush(), "stripped": flt.stripped}
            record("streaming_filter", {"chunks": chunks}, streaming)
        for secrets, chunks in VISIBLE:
            def visible(secrets=secrets, chunks=chunks):
                flt = stream_text.VisibleTextFilter(secrets)
                fed = [flt.feed(chunk) for chunk in chunks]
                return {"snapshot": list(stream_text.configured_secret_values(secrets)), "fed": fed,
                        "finish": flt.finish(), "stripped": flt.stripped}
            record("visible_filter", {"secrets": secrets, "chunks": chunks}, visible)
        for data, prompt, content in USAGES:
            record("token_usage", {"data": data, "prompt": prompt, "content": content},
                   lambda data=data, prompt=prompt, content=content: lc.token_usage(data, prompt, content))
        for pricing in PRICING:
            for usage in COST_USAGES:
                record("cost", {"pricing": pricing, "usage": usage},
                       lambda pricing=pricing, usage=usage: lc.cost_breakdown(pricing, usage))
        for overrides, options in PAYLOADS:
            def payload(overrides=overrides, options=options):
                built = lc.build_chat_payload({**BASE, **overrides}, messages=MESSAGES, tools=options.get("tools"),
                                              tool_choice=options.get("tool_choice"), stream=options.get("stream", False),
                                              temperature=options.get("temperature"),
                                              max_completion_tokens=options.get("max_completion_tokens"))
                return {"payload": built, "body": json.dumps(built, ensure_ascii=False)}
            record("payload", {"overrides": overrides, "options": options, "messages": MESSAGES}, payload)
        for chunk in CHUNKS:
            record("chunk", {"chunk": chunk}, lambda chunk=chunk: {
                "delta": lc.stream_delta_text(chunk), "finish": lc._stream_finish_reason(chunk)})
        for data in ASSISTANT_DATA:
            record("assistant_message", {"data": data}, lambda data=data: lc.assistant_message(data))
        for message in TOOL_MESSAGES:
            record("tool_calls", {"message": message}, lambda message=message: lc.message_tool_calls(message))
        codes = list(range(395, 605, 5)) + [429, 408, 499, 599]
        record("retryable", {"codes": codes}, lambda: [lc.is_retryable_status(code) for code in codes])
        for value in RETRY_AFTER:
            headers = {} if value is None else {"Retry-After": value}
            record("retry_after", {"headers": headers},
                   lambda headers=headers: repr(lc.retry_after_seconds(SimpleNamespace(headers=headers))))
        record("retry_after", {"headers": None}, lambda: repr(lc.retry_after_seconds(SimpleNamespace(headers=None))))
        waits = []
        lc.random = lambda: 0.375
        lc.wait_for_retry = waits.append
        for attempt, base, jitter, retry_after in DELAYS:
            def delay(attempt=attempt, base=base, jitter=jitter, retry_after=retry_after):
                waits.clear()
                lc.sleep_before_retry(attempt=attempt, base_delay=base, jitter=jitter, retry_after=retry_after)
                return repr(waits[0])
            record("retry_delay", {"attempt": attempt, "base": base, "jitter": jitter, "retry_after": retry_after,
                                   "random": 0.375}, delay)
        for text, secrets in REDACT:
            record("redact_secrets", {"text": text, "secrets": secrets},
                   lambda text=text, secrets=secrets: lc.redact_secrets(text, secrets))

        return {
            "format_version": 1,
            "suite": "p2-llm-pure",
            "app_version": APP_VERSION,
            "base_source": BASE,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "pure": pure,
            "platform": "windows" if os.name == "nt" else "posix",
        }
