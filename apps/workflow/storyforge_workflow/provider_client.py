from __future__ import annotations

import json
import os
from urllib import request


def generate_text(
    prompt: str,
    *,
    system_prompt: str = "You are a creative writing engine for StoryForge. Return only the requested Chinese prose or structured result.",
    temperature: float | None = None,
    model: str | None = None,
) -> str:
    """调用 OpenAI 兼容 Chat Completions 端点生成文本。

    temperature/model 为 None 时回退到全局 env 默认，保证旧调用方行为不变；
    传入显式值即可按节点角色（规划低温、正文高温）分层采样。
    """

    config = provider_config()
    resolved_temperature = temperature if temperature is not None else float(os.getenv("STORYFORGE_LLM_TEMPERATURE", "0.7"))
    payload = {
        "model": model or config["model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": resolved_temperature,
    }
    max_tokens = os.getenv("STORYFORGE_LLM_MAX_TOKENS")
    if max_tokens:
        payload["max_tokens"] = int(max_tokens)
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    http_request = request.Request(
        f"{config['base_url'].rstrip('/')}/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {config['api_key']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    timeout = float(os.getenv("STORYFORGE_LLM_TIMEOUT_SECONDS", "30"))
    with request.urlopen(http_request, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    content = data["choices"][0]["message"]["content"]
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("LLM 返回内容为空，无法继续工作流。")
    return content.strip()


def provider_config() -> dict[str, str]:
    """解析 workflow 侧真实模型配置，缺少密钥时显式失败。"""

    api_key = os.getenv("STORYFORGE_LLM_API_KEY")
    if not api_key:
        raise RuntimeError("缺少 STORYFORGE_LLM_API_KEY，无法调用真实 LLM。")
    return {
        "api_key": api_key,
        "base_url": os.getenv("STORYFORGE_LLM_BASE_URL", "https://api.openai.com/v1"),
        "model": _normalize_model_id(os.getenv("STORYFORGE_LLM_MODEL", "gpt-4o-mini")),
        "provider_name": os.getenv("STORYFORGE_LLM_PROVIDER", "openai-compatible"),
    }


def _normalize_model_id(model: str) -> str:
    """归一用户口语化模型名，避免网关因非标准 ID 返回上游错误。"""

    aliases = {
        "gpt5.4mini": "gpt-5.4-mini",
        "gpt-5.4mini": "gpt-5.4-mini",
        "gpt5.4-mini": "gpt-5.4-mini",
        "gpt-5.4-mini": "gpt-5.4-mini",
    }
    normalized = model.strip()
    return aliases.get(normalized.lower(), normalized)


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def planning_temperature() -> float:
    """规划节点（策略/章纲/beat）用低温，换取结构稳定与可解析。"""

    return _float_env("STORYFORGE_LLM_PLANNING_TEMPERATURE", 0.3)


def draft_temperature() -> float:
    """正文与重写用高温，换取文笔层次与画面感。"""

    return _float_env("STORYFORGE_LLM_DRAFT_TEMPERATURE", 0.85)


def planning_model() -> str | None:
    return os.getenv("STORYFORGE_LLM_PLANNING_MODEL") or None


def draft_model() -> str | None:
    return os.getenv("STORYFORGE_LLM_DRAFT_MODEL") or None
