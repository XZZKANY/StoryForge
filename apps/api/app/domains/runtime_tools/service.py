from __future__ import annotations

from collections.abc import Mapping, Sequence, Set
from typing import Any

from app.domains.agent_runs.tools import list_agent_runtime_tool_specs
from app.domains.runtime_tools.creative_registry import CreativeToolSpec, list_creative_tools
from app.domains.runtime_tools.schemas import RuntimeToolRead, RuntimeToolReferencesRead

_MCP_READONLY_TOOL_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {
        "name": "mcp.project.search",
        "domain": "mcp",
        "mcp_server": "project-context",
        "mcp_tool_name": "search",
        "input_schema": {
            "title": "McpProjectSearchInput",
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            "required": ["query"],
        },
        "output_schema": {
            "title": "McpProjectSearchResultList",
            "type": "array",
            "items": {"type": "object", "required": ["source_ref", "excerpt"]},
        },
        "required_capabilities": ["mcp", "read"],
        "evidence_fields": ["source_ref", "excerpt", "rank"],
        "references": RuntimeToolReferencesRead(
            page_refs=[],
            api_paths=[],
            workflow_nodes=["agent_runtime.mcp_readonly"],
        ),
    },
    {
        "name": "mcp.context.inspect",
        "domain": "mcp",
        "mcp_server": "project-context",
        "mcp_tool_name": "inspect",
        "input_schema": {
            "title": "McpContextInspectInput",
            "type": "object",
            "properties": {
                "source_ref": {"type": "string", "minLength": 1},
                "max_chars": {"type": "integer", "minimum": 1, "maximum": 8000},
            },
            "required": ["source_ref"],
        },
        "output_schema": {
            "title": "McpContextInspectResult",
            "type": "object",
            "properties": {
                "source_ref": {"type": "string"},
                "content_excerpt": {"type": "string"},
                "metadata": {"type": "object"},
            },
            "required": ["source_ref", "content_excerpt"],
        },
        "required_capabilities": ["mcp", "read"],
        "evidence_fields": ["source_ref", "content_excerpt", "metadata"],
        "references": RuntimeToolReferencesRead(
            page_refs=[],
            api_paths=[],
            workflow_nodes=["agent_runtime.mcp_readonly"],
        ),
    },
)

_INTERNAL_WRITE_OR_HIGH_COST_TOOLS = frozenset(
    {
        "repair.create_patch",
        "artifacts.create",
        "evaluations.create_run",
        "provider_gateway.resolve",
    }
)


def _load_creative_tools() -> tuple[CreativeToolSpec, ...]:
    """读取进程内创作工具注册表。

    2026-07-26 `apps/workflow` 退役时，registry 从相邻目录的 importlib 文件桥改为进程内模块
    `creative_registry.py`（原文件零 workflow 依赖、内容全是 apps/api 自身端点的静态描述）。
    随 `collect_submodules('app')` 进冻结 exe，故不再需要「文件缺失降级空列表」的兜底路径。"""

    return list_creative_tools()


def _to_jsonable(value: object) -> Any:
    """递归转换冻结容器，输出 FastAPI 可序列化的 JSON 值。"""

    if isinstance(value, Mapping):
        return {str(key): _to_jsonable(item) for key, item in value.items()}
    if isinstance(value, Set):
        return [_to_jsonable(item) for item in sorted(value, key=str)]
    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        return [_to_jsonable(item) for item in value]
    return value


def list_runtime_tools() -> list[RuntimeToolRead]:
    """返回 AgentRuntime、CreativeToolRegistry 与 MCP 派生的运行时工具列表。"""

    runtime_tools: list[RuntimeToolRead] = []
    for tool in list_agent_runtime_tool_specs():
        runtime_tools.append(
            RuntimeToolRead(
                name=tool.name,
                domain=tool.domain,
                origin="agent_runtime",
                input_schema=_to_jsonable(tool.input_schema),
                output_schema=_to_jsonable(tool.output_schema),
                allowed_roles=list(tool.allowed_roles),
                permission_level=tool.permission_level,
                risk_level=tool.risk_level,
                requires_confirmation=tool.requires_confirmation,
                read_only=tool.risk_level in {"read", "analyze"} and not tool.requires_confirmation,
                retry_safe=tool.retry_safe,
                idempotent=tool.idempotent,
                execution_mode=tool.execution_mode,
                artifact_kinds=list(tool.artifact_kinds),
                event_store_required=True,
                required_capabilities=list(tool.required_capabilities),
                evidence_fields=list(tool.evidence_fields),
                references=RuntimeToolReferencesRead(
                    page_refs=list(tool.references.page_refs),
                    api_paths=list(tool.references.api_paths),
                    workflow_nodes=list(tool.references.workflow_nodes),
                ),
            )
        )
    for tool in _load_creative_tools():
        runtime_tools.append(
            RuntimeToolRead(
                name=tool.name,
                domain=tool.domain,
                origin="internal",
                input_schema=_to_jsonable(tool.input_schema),
                output_schema=_to_jsonable(tool.output_schema),
                allowed_roles=[],
                permission_level=_internal_permission_level(tool.name),
                risk_level=_internal_risk_level(tool.name),
                requires_confirmation=_requires_confirmation(tool.name),
                read_only=not _requires_confirmation(tool.name),
                retry_safe=not _requires_confirmation(tool.name),
                idempotent=False,
                execution_mode="internal",
                artifact_kinds=[],
                event_store_required=True,
                required_capabilities=list(tool.required_capabilities),
                evidence_fields=list(tool.evidence_fields),
                references=RuntimeToolReferencesRead(
                    page_refs=list(tool.references.page_refs),
                    api_paths=list(tool.references.api_paths),
                    workflow_nodes=list(tool.references.workflow_nodes),
                ),
            )
        )
    for tool in _MCP_READONLY_TOOL_DEFINITIONS:
        runtime_tools.append(
            RuntimeToolRead(
                name=str(tool["name"]),
                domain=str(tool["domain"]),
                origin="mcp",
                input_schema=dict(tool["input_schema"]),
                output_schema=dict(tool["output_schema"]),
                allowed_roles=["context_explorer", "external_scout"],
                permission_level="read",
                risk_level="read",
                requires_confirmation=False,
                read_only=True,
                retry_safe=True,
                idempotent=True,
                execution_mode="mcp_readonly",
                artifact_kinds=[],
                event_store_required=True,
                mcp_server=str(tool["mcp_server"]),
                mcp_tool_name=str(tool["mcp_tool_name"]),
                required_capabilities=list(tool["required_capabilities"]),
                evidence_fields=list(tool["evidence_fields"]),
                references=tool["references"],
            )
        )
    return runtime_tools


def _requires_confirmation(tool_name: str) -> bool:
    return tool_name in _INTERNAL_WRITE_OR_HIGH_COST_TOOLS


def _internal_permission_level(tool_name: str) -> str:
    if tool_name in _INTERNAL_WRITE_OR_HIGH_COST_TOOLS:
        return "risk_confirm"
    return "read"


def _internal_risk_level(tool_name: str) -> str:
    if tool_name in {"evaluations.create_run", "provider_gateway.resolve"}:
        return "high_cost"
    if tool_name in _INTERNAL_WRITE_OR_HIGH_COST_TOOLS:
        return "write_pending"
    return "read"
