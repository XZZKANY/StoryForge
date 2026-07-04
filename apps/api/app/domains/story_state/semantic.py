from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import httpx

from app.common.llm_client import redact_secrets
from app.common.llm_env import resolved_llm_env
from app.common.llm_http import env_value
from app.common.logging_config import get_logger
from app.domains.story_state.schemas import StateChangeInput

_SEMANTIC_GROUNDING_SYSTEM_PROMPT = """\
你是 StoryForge 的故事状态 grounding 审查员。只返回 JSON 数组，不要解释。

判断每条 CHANGES 是否被本章正文语义支持。注意：这是咨询信号，不要求逐字复述。

输出格式：
[
  {"seq": 1, "score": 0-100, "reason": "一句中文理由"}
]

score >= 80 表示正文明确支持；50-79 表示弱支持或需人工复核；<50 表示正文基本不支持。\
"""


@dataclass(frozen=True)
class SemanticGroundingAdvisory:
    seq: int
    semantic_score: int | None
    semantic_reason: str | None = None


def semantic_ground_story_state_changes(
    prose: str,
    changes: Sequence[StateChangeInput],
) -> dict[int, SemanticGroundingAdvisory]:
    """用 Judge LLM 对 CHANGES 做语义 grounding advisory；未配置时静默跳过。

    W3：配置改走 resolved_llm_env 覆盖链（env → .env settings → llm-provider.json），
    修复此前裸 os.getenv 漏读 llm-provider.json、导致 sidecar 下 grounding 静默失活的缺陷。
    STORYFORGE_JUDGE_LLM_* 仍为进程 env 独占的最高优先级覆盖，与 judge/semantic 一致。"""

    source = resolved_llm_env()
    api_key = os.getenv("STORYFORGE_JUDGE_LLM_API_KEY") or env_value(source, "STORYFORGE_LLM_API_KEY")
    if not api_key or not changes:
        return {}
    base_url = (
        os.getenv("STORYFORGE_JUDGE_LLM_BASE_URL")
        or env_value(source, "STORYFORGE_LLM_BASE_URL")
        or "https://api.openai.com/v1"
    )
    model = os.getenv("STORYFORGE_JUDGE_LLM_MODEL") or env_value(source, "STORYFORGE_LLM_MODEL") or "gpt-4o-mini"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SEMANTIC_GROUNDING_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": _semantic_grounding_user_prompt(prose, changes),
            },
        ],
        "temperature": 0,
    }
    reasoning_effort = os.getenv("STORYFORGE_JUDGE_LLM_REASONING_EFFORT") or env_value(
        source, "STORYFORGE_LLM_REASONING_EFFORT"
    )
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    log = get_logger(__name__)
    try:
        timeout = float(
            os.getenv("STORYFORGE_JUDGE_LLM_TIMEOUT_SECONDS")
            or env_value(source, "STORYFORGE_LLM_TIMEOUT_SECONDS")
            or "300"
        )
        with httpx.Client(timeout=timeout) as client:
            response = client.post(
                _chat_completions_url(base_url),
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            data = response.json()
        decoded = _decode_json_array(str(data["choices"][0]["message"]["content"]))
    except Exception as exc:
        log.warning(
            "story_state_semantic_grounding_failed", error=redact_secrets(str(exc), [api_key]), model=model
        )
        return {
            int(change.seq or index): SemanticGroundingAdvisory(
                seq=int(change.seq or index),
                semantic_score=None,
                semantic_reason="semantic_grounding_failed",
            )
            for index, change in enumerate(changes, start=1)
        }
    return _advisories_from_items(decoded)


def _semantic_grounding_user_prompt(prose: str, changes: Sequence[StateChangeInput]) -> str:
    change_items = [
        {
            "seq": int(change.seq or index),
            "change_type": change.change_type,
            "entity_kind": change.entity_kind,
            "entity_id": change.entity_id,
            "canonical_name": change.canonical_name,
            "surface_forms": change.surface_forms,
            "payload": change.payload,
        }
        for index, change in enumerate(changes, start=1)
    ]
    return (
        f"【正文】\n{prose[:6000]}\n\n"
        "【待 grounding 的 CHANGES】\n"
        f"{json.dumps(change_items, ensure_ascii=False, sort_keys=True)}"
    )


def _advisories_from_items(items: object) -> dict[int, SemanticGroundingAdvisory]:
    if not isinstance(items, list):
        return {}
    advisories: dict[int, SemanticGroundingAdvisory] = {}
    for item in items:
        if not isinstance(item, Mapping):
            continue
        seq = _positive_int(item.get("seq"))
        if seq is None:
            continue
        score = _bounded_score(item.get("score"))
        advisories[seq] = SemanticGroundingAdvisory(
            seq=seq,
            semantic_score=score,
            semantic_reason=_text_value(item.get("reason")),
        )
    return advisories


def _decode_json_array(raw_content: str) -> object:
    stripped = raw_content.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if len(lines) >= 2 and lines[-1].strip() == "```":
            fenced = "\n".join(lines[1:-1]).strip()
            try:
                return json.loads(fenced)
            except json.JSONDecodeError:
                pass
    start = stripped.find("[")
    end = stripped.rfind("]")
    if start >= 0 and end > start:
        return json.loads(stripped[start : end + 1])
    return json.loads(stripped)


def _chat_completions_url(base_url: str) -> str:
    return f"{base_url.strip().rstrip('/')}/chat/completions"


def _positive_int(value: object) -> int | None:
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.strip().isdigit():
        parsed = int(value.strip())
        return parsed if parsed > 0 else None
    return None


def _bounded_score(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return max(0, min(100, int(value)))
    if isinstance(value, str) and value.strip().isdigit():
        return max(0, min(100, int(value.strip())))
    return None


def _text_value(value: object) -> str | None:
    if isinstance(value, str):
        normalized = value.strip()
        if normalized:
            return normalized[:300]
    return None
