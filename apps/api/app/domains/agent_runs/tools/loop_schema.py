from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from app.domains.agent_runs.tools.catalog import AGENT_RUNTIME_TOOL_SPECS as _AGENT_RUNTIME_TOOL_SPECS
from app.domains.agent_runs.tools.spec_models import AgentRuntimeToolSpec


def llm_tool_name(spec_name: str) -> str:
    """dotted registry 名 → OpenAI function 名（function 名不允许点号）。"""

    return spec_name.replace(".", "_")


def list_loop_tool_specs(
    specs: Sequence[AgentRuntimeToolSpec] | None = None,
) -> tuple[AgentRuntimeToolSpec, ...]:
    """进 chat 循环、对 LLM 可见的工具（带 loop_schema），按声明顺序。

    specs 省略则取全量注册表；元测试可传入含 demo 工具的列表验证单点派生。
    """

    source = _AGENT_RUNTIME_TOOL_SPECS if specs is None else specs
    return tuple(spec for spec in source if spec.loop_schema is not None)


def build_loop_tool_schemas(
    specs: Sequence[AgentRuntimeToolSpec] | None = None,
) -> list[dict[str, Any]]:
    """从 spec 单点派生 chat 循环的 OpenAI function schema 列表（替代手写镜像）。"""

    schemas: list[dict[str, Any]] = []
    for spec in list_loop_tool_specs(specs):
        assert spec.loop_schema is not None  # list_loop_tool_specs 已过滤
        schemas.append(
            {
                "type": "function",
                "function": {
                    "name": llm_tool_name(spec.name),
                    "description": spec.loop_schema.description,
                    "parameters": dict(spec.loop_schema.parameters),
                },
            }
        )
    return schemas


def build_loop_tool_name_map(
    specs: Sequence[AgentRuntimeToolSpec] | None = None,
) -> dict[str, str]:
    """OpenAI function 名 → dotted registry 名。"""

    return {llm_tool_name(spec.name): spec.name for spec in list_loop_tool_specs(specs)}


def loop_patch_tool_specs(
    specs: Sequence[AgentRuntimeToolSpec] | None = None,
) -> tuple[AgentRuntimeToolSpec, ...]:
    """循环内会产出待确认补丁的工具（write_pending）：一次对话最多一个补丁，生成后撤下。"""

    return tuple(spec for spec in list_loop_tool_specs(specs) if spec.risk_level == "write_pending")
