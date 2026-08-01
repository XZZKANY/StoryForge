"""前缀缓存：provider 报的命中要进账，稳定上下文块要待在能被命中的位置。

两条独立的缺陷合在一处测，因为它们是同一件事的两端——一端是「省下的钱看不见」，
另一端是「本可以省的钱没省」：

1. `_cost_breakdown` 早就读了 `STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS`
   并原样回显，却从不拿它算钱；`_token_usage` 也不看 provider 回报的命中 token 数。
   于是命中部分一律按全价入账（多数 provider 的命中价是全价的 1/10）。
2. 作品底座 / 连载计划 / 场景约束这几个大块原本排在对话历史**之后**。历史每问一句
   必增长，于是这几个块每条消息都被整体推位，跨消息的前缀缓存一次都覆盖不到它们。

第 3 组打在接线上：只测纯函数会假绿——顺序拼错、块没进 messages，纯函数照样全绿。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script
from agent_transport import agent_result, stream_agent_message
from fastapi.testclient import TestClient

from app.common.llm_client import _cost_breakdown, _provider_cache_hit_tokens, _token_usage

pytest_plugins = ("agent_loop_runtime_test_fixtures",)

_BOOK_HEADING = "[作品底座 · 确定性]"

_RATES = {
    "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "2.0",
    "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "8.0",
    "STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS": "0.2",
}


class TestProviderCacheHitTokens:
    """读不到 ≠ 读到 0：这个区分是整条链的地基。"""

    def test_reads_top_level_field(self) -> None:
        assert _provider_cache_hit_tokens({"prompt_cache_hit_tokens": 1280}) == 1280

    def test_reads_nested_openai_shape(self) -> None:
        usage = {"prompt_tokens_details": {"cached_tokens": 640}}
        assert _provider_cache_hit_tokens(usage) == 640

    def test_absent_field_is_unknown_not_zero(self) -> None:
        assert _provider_cache_hit_tokens({"prompt_tokens": 100}) is None

    def test_reported_zero_stays_zero(self) -> None:
        """provider 说「本次全未命中」是有信息量的，不能和「没报」混为一谈。"""

        assert _provider_cache_hit_tokens({"prompt_cache_hit_tokens": 0}) == 0

    def test_bool_is_not_a_token_count(self) -> None:
        assert _provider_cache_hit_tokens({"prompt_cache_hit_tokens": True}) is None


class TestTokenUsageCarriesCacheHit:
    def test_provider_usage_carries_cache_hit(self) -> None:
        data = {
            "usage": {
                "prompt_tokens": 2000,
                "completion_tokens": 300,
                "prompt_cache_hit_tokens": 1800,
            }
        }
        usage = _token_usage(data, "prompt", "content")

        assert usage["cache_hit_tokens"] == 1800
        assert usage["token_usage_source"] == "provider_usage"

    def test_estimated_path_reports_unknown(self) -> None:
        usage = _token_usage(None, "prompt", "content")

        assert usage["cache_hit_tokens"] is None


class TestCostBreakdownBillsCacheSeparately:
    def test_hit_portion_billed_at_cache_rate(self) -> None:
        usage = {
            "prompt_tokens": 1_000_000,
            "completion_tokens": 0,
            "cache_hit_tokens": 900_000,
            "token_usage_source": "provider_usage",
        }
        cost = _cost_breakdown(_RATES, usage)

        # 100k 未命中 × 2.0 + 900k 命中 × 0.2 = 0.2 + 0.18
        assert cost["input_cny"] == pytest.approx(0.38)
        assert cost["cache_hit_tokens"] == 900_000
        assert cost["cache_miss_tokens"] == 100_000

    def test_unknown_cache_hit_bills_exactly_as_before(self) -> None:
        """provider 没报命中数时，账必须与改动前逐位相同——这是向后兼容的红线。"""

        usage = {
            "prompt_tokens": 1_000_000,
            "completion_tokens": 500_000,
            "cache_hit_tokens": None,
            "token_usage_source": "provider_usage",
        }
        cost = _cost_breakdown(_RATES, usage)

        assert cost["input_cny"] == pytest.approx(2.0)
        assert cost["output_cny"] == pytest.approx(4.0)
        assert cost["cache_hit_tokens"] is None
        assert cost["cache_miss_tokens"] is None

    def test_missing_cache_rate_falls_back_to_full_price(self) -> None:
        """没配命中价时按全价计——低估的成本账比高估更难被发现。"""

        rates = dict(_RATES)
        rates.pop("STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS")
        usage = {
            "prompt_tokens": 1_000_000,
            "completion_tokens": 0,
            "cache_hit_tokens": 1_000_000,
            "token_usage_source": "provider_usage",
        }

        assert _cost_breakdown(rates, usage)["input_cny"] == pytest.approx(2.0)

    def test_reported_hit_cannot_exceed_prompt_tokens(self) -> None:
        usage = {
            "prompt_tokens": 100,
            "completion_tokens": 0,
            "cache_hit_tokens": 999_999,
            "token_usage_source": "provider_usage",
        }
        cost = _cost_breakdown(_RATES, usage)

        assert cost["cache_hit_tokens"] == 100
        assert cost["cache_miss_tokens"] == 0


@pytest.fixture()
def serial(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    (tmp_path / "正文" / "第001章.md").write_text("旧城的雨下了三天。\n" * 40, encoding="utf-8")
    (tmp_path / "正文" / "第002章.md").write_text("陈默扣回玄铁令。\n" * 40, encoding="utf-8")
    (tmp_path / "设定").mkdir()
    (tmp_path / "设定" / "世界观.md").write_text("玄铁令是唯一凭信。\n" * 20, encoding="utf-8")
    return tmp_path


def _common_prefix(first: list[dict[str, Any]], second: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """两次请求逐条比对得到的公共前缀——provider 的前缀缓存只可能覆盖到这里。"""

    shared: list[dict[str, Any]] = []
    for left, right in zip(first, second, strict=False):
        if left != right:
            break
        shared.append(left)
    return shared


def _has_book_block(messages: list[dict[str, Any]]) -> bool:
    return any(_BOOK_HEADING in str(item.get("content") or "") for item in messages)


class TestStableBlocksSitInCachedPrefix:
    def test_stable_blocks_precede_conversation_history(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch, serial: Path
    ) -> None:
        """结构断言：底座排在历史之前。倒过来排，下面那条跨消息断言必然挂。"""

        _enable_loop_env(monkeypatch)
        calls = _fake_llm_script(monkeypatch, [{"content": "读到了。", "tool_calls": []}])

        first = agent_result(
            client,
            "session-cache-order",
            run_id="run-cache-order-1",
            user_message="这本书写到哪了？",
            args={
                "project_path": str(serial),
                "file_path": str(serial / "正文" / "第002章.md"),
                "context_bundle": {"files": []},
            },
        )
        assistant_session_id = first["assistant_session_id"]

        stream_agent_message(
            client,
            "session-cache-order",
            run_id="run-cache-order-2",
            user_message="那第三章该写什么？",
            assistant_session_id=assistant_session_id,
            args={
                "project_path": str(serial),
                "file_path": str(serial / "正文" / "第002章.md"),
                "context_bundle": {"files": []},
            },
        )

        assert len(calls) == 2, f"预期两条消息各发一次模型调用，实际 {len(calls)} 次"
        second_messages = calls[1]["messages"]
        history_positions = [
            index
            for index, item in enumerate(second_messages[:-1])
            if item.get("role") in ("user", "assistant")
        ]
        assert history_positions, "第二条消息时对话历史应当非空，否则本用例证明不了任何事"
        book_positions = [
            index
            for index, item in enumerate(second_messages)
            if _BOOK_HEADING in str(item.get("content") or "")
        ]
        assert book_positions, "作品底座没进 messages"
        assert book_positions[0] < history_positions[0], (
            "作品底座排在了对话历史之后：作者每说一句都会把它整体推位，前缀缓存覆盖不到。"
        )

    def test_second_message_keeps_book_context_cacheable(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch, serial: Path
    ) -> None:
        """接线断言：第二条消息与第一条的公共前缀里必须还有作品底座。

        这条是本文件的靶心。底座排在历史之后时，第二条消息的历史已非空，分岔点落在
        底座之前 —— 公共前缀里找不到底座，缓存每条消息都得从头交全价。
        """

        _enable_loop_env(monkeypatch)
        calls = _fake_llm_script(monkeypatch, [{"content": "读到了。", "tool_calls": []}])

        args = {
            "project_path": str(serial),
            "file_path": str(serial / "正文" / "第002章.md"),
            "context_bundle": {"files": []},
        }
        first = agent_result(
            client,
            "session-cache-prefix",
            run_id="run-cache-prefix-1",
            user_message="这本书写到哪了？",
            args=args,
        )
        stream_agent_message(
            client,
            "session-cache-prefix",
            run_id="run-cache-prefix-2",
            user_message="那第三章该写什么？",
            assistant_session_id=first["assistant_session_id"],
            args=args,
        )

        assert len(calls) == 2
        first_messages: list[dict[str, Any]] = calls[0]["messages"]  # type: ignore[assignment]
        second_messages: list[dict[str, Any]] = calls[1]["messages"]  # type: ignore[assignment]

        assert _has_book_block(first_messages) and _has_book_block(second_messages)
        shared = _common_prefix(first_messages, second_messages)
        assert _has_book_block(shared), (
            "作品底座掉出了两次请求的公共前缀——它每条消息都要重新按未命中计费。"
            f"公共前缀只剩 {len(shared)} 条消息。"
        )
