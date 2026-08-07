from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from pathlib import PurePosixPath
from typing import Any

from app.common.llm_client import LLMError, build_llm_provider
from app.common.llm_env import (
    PolishLlmNotConfiguredError,
    ResolvedPolishLlm,
    resolve_polish_llm,
)
from app.domains.agent_runs.patches.polishing import (
    POLISH_GATE_VERSION,
    POLISH_RULE_VERSION,
    PolishCandidate,
    PolishDecision,
    apply_deterministic_polish,
    rebuild_polishable_markdown,
    select_polish_candidate,
    split_polishable_markdown,
)
from app.platform.ai_sdk.contracts import ChatMessage, ChatRequest, MessageRole, TokenUsage
from app.platform.ai_sdk.errors import ProviderError
from app.platform.ai_sdk.provider import LLMProvider

_JSON_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", flags=re.S | re.I)
_POLISHABLE_SUFFIXES = frozenset({".md", ".markdown", ".txt"})
_FORBIDDEN_PATH_PARTS = frozenset(
    {".storyforge", "evidence", "evidences", "artifacts", "exports", "cache", "logs"}
)


class InvalidPolishModelResponseError(ValueError):
    pass


@dataclass(frozen=True)
class ControlledPolishResult:
    decision: PolishDecision
    provider: str | None
    model: str | None
    resolution_source: str | None
    online_failure: str | None
    online_attempted: bool
    usage: Mapping[str, int | str | None] = field(repr=False)
    rule_version: str = POLISH_RULE_VERSION
    gate_version: str = POLISH_GATE_VERSION

    def trace_summary(self) -> dict[str, Any]:
        return {
            "status": self.decision.status,
            "selected_source": self.decision.selected_source,
            "degraded": self.decision.degraded,
            "provider": self.provider,
            "model": self.model,
            "resolution_source": self.resolution_source,
            "online_attempted": self.online_attempted,
            "online_failure": self.online_failure,
            "rule_version": self.rule_version,
            "gate_version": self.gate_version,
            "gate_reasons": {
                source: list(evaluation.reasons)
                for source, evaluation in self.decision.evaluations.items()
            },
            "usage": dict(self.usage),
        }


def validate_polishable_path(path: str) -> str:
    normalized = path.replace("\\", "/").strip()
    pure = PurePosixPath(normalized)
    lowered_parts = {part.lower() for part in pure.parts}
    if (
        not normalized
        or pure.is_absolute()
        or ".." in pure.parts
        or re.match(r"^[A-Za-z]:/", normalized)
        or "://" in normalized
    ):
        raise ValueError("润色目标必须是项目内相对路径。")
    if lowered_parts & _FORBIDDEN_PATH_PARTS:
        raise ValueError("结构化状态、证据和派生文件不能进入润色流程。")
    if pure.suffix.lower() not in _POLISHABLE_SUFFIXES:
        raise ValueError("润色仅支持 Markdown 或 TXT 小说正文。")
    return pure.as_posix()


def run_controlled_polish(
    original: str,
    *,
    style_instruction: str = "",
    protected_entities: Sequence[str] = (),
    character_constraints: Sequence[Mapping[str, Any]] = (),
    continuity_facts: Sequence[Any] = (),
    required_facts: Sequence[str] = (),
    use_main_model: bool = False,
    online_enabled: bool = True,
    resolution: ResolvedPolishLlm | None = None,
    provider: LLMProvider | None = None,
    provider_builder: Callable[[Mapping[str, str | None]], LLMProvider] = build_llm_provider,
) -> ControlledPolishResult:
    local = PolishCandidate(source="local", text=apply_deterministic_polish(original))
    online: PolishCandidate | None = None
    online_failure: str | None = None
    usage: Mapping[str, int | str | None] = {}
    resolved = resolution

    if online_enabled:
        try:
            resolved = resolved or resolve_polish_llm(use_main_model=use_main_model)
            active_provider = provider or provider_builder(resolved.source)
            response = active_provider.complete(
                _polish_request(
                    original,
                    resolved.model,
                    style_instruction,
                    protected_entities=protected_entities,
                    character_constraints=character_constraints,
                    continuity_facts=continuity_facts,
                    required_facts=required_facts,
                )
            )
            online_text = _parse_polished_response(original, response.content)
            online = PolishCandidate(
                source="online",
                text=online_text,
                response_truncated=response.finish_reason == "length",
            )
            usage = _safe_usage(response.usage)
        except PolishLlmNotConfiguredError:
            online_failure = "polish_model_not_configured"
        except InvalidPolishModelResponseError:
            online_failure = "invalid_model_response"
        except (LLMError, ProviderError):
            online_failure = "provider_failed"

    decision = select_polish_candidate(
        original,
        local_candidate=local,
        online_candidate=online,
        protected_entities=protected_entities,
        character_constraints=character_constraints,
        continuity_facts=continuity_facts,
        required_facts=required_facts,
    )
    if online_enabled and online_failure and decision.selected_source == "local":
        decision = replace(decision, status="degraded", degraded=True)
    return ControlledPolishResult(
        decision=decision,
        provider=resolved.provider if resolved else None,
        model=resolved.model if resolved else None,
        resolution_source=resolved.resolution_source if resolved else None,
        online_failure=online_failure,
        online_attempted=online_enabled,
        usage=usage,
    )


def _polish_request(
    original: str,
    model: str,
    style_instruction: str,
    *,
    protected_entities: Sequence[str],
    character_constraints: Sequence[Mapping[str, Any]],
    continuity_facts: Sequence[Any],
    required_facts: Sequence[str],
) -> ChatRequest:
    document = split_polishable_markdown(original)
    payload = {
        "constraints": {
            "protected_entities": list(protected_entities),
            "character_constraints": list(character_constraints),
            "continuity_facts": list(continuity_facts),
            "required_facts": list(required_facts),
        },
        "segments": [
            {"index": index, "text": text}
            for index, text in enumerate(document.polishable_parts)
        ]
    }
    style = style_instruction.strip()
    system = "\n".join(
        [
            "你是中文通俗小说润色编辑。只改善表达，不改剧情事实、人物关系、因果、专名、叙事人称和段落顺序。",
            "默认保守润色：清理模板腔，改善句式、节奏、对白与自然度，保留作者原有文风。",
            "不得添加标题、frontmatter、代码围栏、解释、摘要或修改说明。",
            "输入是正文片段数组；按原 index 返回同样数量的 JSON 片段，不能合并、丢失或重排。",
            "constraints 是只读写作约束：不得改写专名，不得违反人物和连续性事实，也不得把未出现的约束强行补写进正文。",
            "只输出严格 JSON：{\"segments\":[{\"index\":0,\"text\":\"...\"}]}。",
            f"作者本次附加风格要求：{style}" if style else "作者本次没有附加风格要求。",
        ]
    )
    return ChatRequest(
        model=model,
        messages=(
            ChatMessage(role=MessageRole.SYSTEM, content=system),
            ChatMessage(role=MessageRole.USER, content=json.dumps(payload, ensure_ascii=False)),
        ),
        temperature=0.35,
    )


def _parse_polished_response(original: str, content: str) -> str:
    raw = content.strip()
    fenced = _JSON_FENCE.match(raw)
    if fenced is not None:
        raw = fenced.group(1)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidPolishModelResponseError("model response is not JSON") from exc
    items = payload.get("segments") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise InvalidPolishModelResponseError("segments are missing")
    document = split_polishable_markdown(original)
    expected_count = len(document.polishable_parts)
    parts: list[str] = []
    for expected_index, item in enumerate(items):
        if not isinstance(item, dict) or item.get("index") != expected_index:
            raise InvalidPolishModelResponseError("segment indexes changed")
        text = item.get("text")
        if not isinstance(text, str):
            raise InvalidPolishModelResponseError("segment text is missing")
        parts.append(text)
    if len(parts) != expected_count:
        raise InvalidPolishModelResponseError("segment count changed")
    return rebuild_polishable_markdown(document, parts)


def _safe_usage(usage: TokenUsage) -> Mapping[str, int | str | None]:
    return {
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "total_tokens": usage.total_tokens,
        "cached_input_tokens": usage.cached_input_tokens,
        "source": usage.source,
    }
