"""Agent system prompt 组装链的变体注册表。

`agent-baseline` 恒等引用 prompt_context.SYSTEM_PROMPT（含作者记忆子句与创作准则子句）；
`agent-no-craft` 从同一常量剔除 craft_prompt_clause() 段——用 replace 同源操作，不手抄文案。
"""

from __future__ import annotations

from dataclasses import dataclass

from app.common.craft import craft_prompt_clause
from app.domains.agent_runs.loop import prompt_context


@dataclass(frozen=True)
class AgentVariant:
    id: str
    label: str
    description: str
    build: object  # () -> str


def _build_agent_baseline() -> str:
    return prompt_context.SYSTEM_PROMPT


def _build_agent_no_craft() -> str:
    clause = craft_prompt_clause()
    prompt = prompt_context.SYSTEM_PROMPT
    count = prompt.count(clause)
    if count != 1:
        raise AssertionError(f"craft_prompt_clause 在 SYSTEM_PROMPT 中出现 {count} 次（期望 1 次）")
    return prompt.replace(clause, "")


AGENT_VARIANTS: dict[str, AgentVariant] = {
    "agent-baseline": AgentVariant("agent-baseline", "原样", "prompt_context.SYSTEM_PROMPT 恒等引用", _build_agent_baseline),
    "agent-no-craft": AgentVariant("agent-no-craft", "去创作准则子句", "摘掉 craft_prompt_clause()，量化准则在组装链的贡献", _build_agent_no_craft),
}
