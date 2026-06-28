"""LLM 调用辅助函数与纯工具。

从 book_generation.py 提取，保持 LLM 协议端之 isolates（headers/token/cost）的纯粹性，
不反向依赖业务逻辑（book_runs/工作流/备考），使 LLM plugin 可增量复用。
book_generation.py 通过 facade re-export 保持可达性（宪法第 5/6 条）。
"""
from __future__ import annotations

import json
import re
import time
from collections.abc import Mapping
from urllib import error, request

from app.domains.book_runs.book_generation_metrics import _float_value
from app.domains.book_runs.errors import BookGenerationError, BookGenerationPreflightError

THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
THINK_OPEN_RE = re.compile(r"<think>", re.IGNORECASE)
THINK_CLOSE_RE = re.compile(r"</think>", re.IGNORECASE)


def _strip_reasoning_leak(content: str) -> str:
    """剥离混进正文的思维链：成对 <think>…</think> 整段删除；只剩残缺闭合标签时，
    丢弃最后一个 </think> 及其之前的全部内容（即被泄漏的推理草稿），只留其后的正文。"""

    cleaned = THINK_BLOCK_RE.sub("", content)
    if THINK_CLOSE_RE.search(cleaned):
        cleaned = cleaned[cleaned.rfind("</think>") + len("</think>") :]
    # 残留的孤立开标签（极少见：有开无闭）直接抹掉标记本身，避免标签裸露在成稿里。
    cleaned = THINK_OPEN_RE.sub("", cleaned)
    return cleaned.strip()


def _call_llm(
    source: Mapping[str, str | None],
    *,
    system_prompt: str,
    user_prompt: str,
) -> dict[str, object]:
    """对真实 OpenAI 兼容端点发一次 chat/completions，返回正文与 token 使用。"""

    payload = {
        "model": _required_env(source, "STORYFORGE_LLM_MODEL"),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": _optional_float(source, "STORYFORGE_LLM_TEMPERATURE", 0.7),
    }
    max_completion_tokens = _optional_int(source, "STORYFORGE_LLM_MAX_COMPLETION_TOKENS", 0)
    if max_completion_tokens > 0:
        payload["max_completion_tokens"] = max_completion_tokens
    reasoning_effort = _env_value(source, "STORYFORGE_LLM_REASONING_EFFORT")
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    http_request = request.Request(
        f"{_required_env(source, 'STORYFORGE_LLM_BASE_URL').rstrip('/')}/chat/completions",
        data=body,
        headers=_llm_request_headers(source),
        method="POST",
    )
    timeout = _optional_float(source, "STORYFORGE_LLM_TIMEOUT_SECONDS", 300.0)
    started_at = time.monotonic()
    try:
        with request.urlopen(http_request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        try:
            error_body = exc.read().decode("utf-8", errors="replace")[:2000]
        except Exception:  # noqa: BLE001 - 仅用于诊断，读不出 body 不应掩盖原始错误
            error_body = "<无法读取响应体>"
        raise BookGenerationError(f"真实 LLM 返回 HTTP {exc.code}（耗时 {elapsed_ms}ms）：{error_body}") from exc
    except (error.URLError, TimeoutError) as exc:
        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        reason = getattr(exc, "reason", exc)
        raise BookGenerationError(
            f"真实 LLM 调用超时或连接失败（耗时 {elapsed_ms}ms，timeout={timeout}s）：{reason}"
        ) from exc
    content = data["choices"][0]["message"]["content"]
    if not isinstance(content, str) or not content.strip():
        raise BookGenerationError("真实 LLM 返回内容为空，不能继续 BookRun 生成。")
    content = _strip_reasoning_leak(content)
    if not content:
        raise BookGenerationError("真实 LLM 返回仅含思维链、无正文，不能继续 BookRun 生成。")
    usage = _token_usage(data, user_prompt, content)
    cost_breakdown = _cost_breakdown(source, usage)
    return {
        "content": content,
        **usage,
        "cost_cny_estimated": cost_breakdown["total_cny"],
        "cost_breakdown": cost_breakdown,
        "latency_ms": max(0, int((time.monotonic() - started_at) * 1000)),
    }


def _llm_request_headers(source: Mapping[str, str | None]) -> dict[str, str]:
    credential = _required_env(source, "STORYFORGE_LLM_API_KEY")
    auth_header = _env_value(source, "STORYFORGE_LLM_AUTH_HEADER").lower() or "bearer"
    headers = {"Content-Type": "application/json"}
    if auth_header == "api-key":
        headers["api-key"] = credential
        return headers
    if auth_header != "bearer":
        raise BookGenerationPreflightError("STORYFORGE_LLM_AUTH_HEADER 只支持 api-key 或 bearer。")
    headers["Authorization"] = f"Bearer {credential}"
    return headers


def _token_usage(data: object, prompt: str, content: str) -> dict[str, int | str]:
    usage = data.get("usage") if isinstance(data, dict) else None
    if isinstance(usage, dict):
        total = usage.get("total_tokens")
        prompt_tokens = usage.get("prompt_tokens")
        completion_tokens = usage.get("completion_tokens")
        if isinstance(prompt_tokens, int) and isinstance(completion_tokens, int):
            resolved_total = total if isinstance(total, int) and total > 0 else prompt_tokens + completion_tokens
            return {
                "token_usage": max(1, resolved_total),
                "prompt_tokens": max(0, prompt_tokens),
                "completion_tokens": max(0, completion_tokens),
                "token_usage_source": "provider_usage",
            }
        if isinstance(total, int) and total > 0:
            estimated_prompt = max(0, len(prompt) // 4)
            estimated_completion = max(0, total - estimated_prompt)
            return {
                "token_usage": total,
                "prompt_tokens": estimated_prompt,
                "completion_tokens": estimated_completion,
                "token_usage_source": "estimated_split",
            }
    prompt_tokens = max(1, len(prompt) // 4)
    completion_tokens = max(1, len(content) // 4)
    return {
        "token_usage": prompt_tokens + completion_tokens,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "token_usage_source": "estimated_split",
    }


def _cost_breakdown(source: Mapping[str, str | None], usage: dict[str, int | str]) -> dict[str, float | str]:
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    input_rate = _optional_float(source, "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS", 0.0)
    output_rate = _optional_float(source, "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS", 0.0)
    cache_hit_rate = _optional_float(source, "STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS", 0.0)
    input_cny = (prompt_tokens / 1_000_000) * input_rate
    output_cny = (completion_tokens / 1_000_000) * output_rate
    return {
        "currency": "CNY",
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "input_cny": input_cny,
        "output_cny": output_cny,
        "total_cny": input_cny + output_cny,
        "input_cny_per_m_tokens": input_rate,
        "output_cny_per_m_tokens": output_rate,
        "cache_hit_input_cny_per_m_tokens": cache_hit_rate,
        "source": str(usage.get("token_usage_source") or "estimated_split"),
    }


def _total_cost_estimate(completed_chapters: list[dict[str, object]]) -> float:
    return sum(_float_value(item.get("cost_estimate")) for item in completed_chapters if isinstance(item, dict))


def _env_value(source: Mapping[str, str | None], name: str) -> str:
    value = source.get(name)
    return value.strip() if value and value.strip() else ""


def _required_env(source: Mapping[str, str | None], name: str) -> str:
    value = _env_value(source, name)
    if not value:
        raise BookGenerationPreflightError(f"缺少真实 LLM 生成环境变量：{name}。")
    return value


def _optional_int(source: Mapping[str, str | None], name: str, default: int) -> int:
    value = _env_value(source, name)
    return int(value) if value else default


def _optional_float(source: Mapping[str, str | None], name: str, default: float) -> float:
    value = _env_value(source, name)
    return float(value) if value else default
