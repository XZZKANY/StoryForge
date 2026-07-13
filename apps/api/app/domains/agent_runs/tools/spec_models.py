from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ToolCatalogReferences:
    page_refs: Sequence[str] = field(default_factory=tuple)
    api_paths: Sequence[str] = field(default_factory=tuple)
    workflow_nodes: Sequence[str] = field(default_factory=tuple)


@dataclass(frozen=True)
class LoopToolSchema:
    """chat 自由文本循环暴露给 LLM 的 function 描述与参数 schema。

    带此字段的 spec 即「进 chat 循环、对 LLM 可见」的工具；不带（None）的工具（context.load /
    judge.* / bookrun.*）只走固定管线或控制通道，不进循环。LLM 面的 name / 描述 / 参数从这里
    单点派生（见 build_loop_tool_schemas），删掉 loop_runtime 里那份手写镜像。
    """

    description: str
    parameters: Mapping[str, Any]


@dataclass(frozen=True)
class AgentRuntimeToolSpec:
    name: str
    description: str
    domain: str
    input_schema: Mapping[str, Any]
    output_schema: Mapping[str, Any]
    allowed_roles: Sequence[str]
    risk_level: str
    retry_safe: bool
    idempotent: bool
    execution_mode: str
    artifact_kinds: Sequence[str] = field(default_factory=tuple)
    required_capabilities: Sequence[str] = field(default_factory=tuple)
    evidence_fields: Sequence[str] = field(default_factory=tuple)
    references: ToolCatalogReferences = field(default_factory=ToolCatalogReferences)
    loop_schema: LoopToolSchema | None = None

    # permission_level / requires_confirmation 从 risk_level + execution_mode 单点派生，不再并列声明
    # （消除三字段漂移），派生规则见 derive_requires_confirmation。
    @property
    def requires_confirmation(self) -> bool:
        return derive_requires_confirmation(self.risk_level, self.execution_mode)

    @property
    def permission_level(self) -> str:
        return derive_permission_level(self.risk_level, self.execution_mode)


_CONFIRMING_RISK_LEVELS = frozenset({"write_pending", "high_cost", "propose_patch", "network"})


def derive_requires_confirmation(risk_level: str, execution_mode: str) -> bool:
    """从 risk_level + execution_mode 单点派生「是否需作者确认」。

    permission_level / requires_confirmation 此前与 risk_level 并列人工声明、彼此 100% 相关但
    可各自漂移；改由本函数派生，risk_level + execution_mode 成为唯一声明轴。
    """

    if risk_level in _CONFIRMING_RISK_LEVELS:
        return True
    return risk_level == "long_running" and execution_mode != "control"


def derive_permission_level(risk_level: str, execution_mode: str) -> str:
    """需确认即 confirm、否则 auto（agent_runtime 词表）。"""

    return "confirm" if derive_requires_confirmation(risk_level, execution_mode) else "auto"
