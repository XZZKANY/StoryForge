from __future__ import annotations

import importlib.util
import sys
from collections.abc import Mapping, Sequence, Set
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any

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


def _registry_file_path() -> Path:
    """定位相邻 workflow registry 文件，避免导入 workflow 顶层运行时依赖。"""

    apps_dir = Path(__file__).resolve().parents[4]
    return apps_dir / "workflow" / "storyforge_workflow" / "tools" / "registry.py"


@lru_cache(maxsize=1)
def _load_registry_module() -> ModuleType:
    """从真实 registry.py 加载工具事实源，不触发 workflow 包顶层导入。"""

    registry_path = _registry_file_path()
    spec = importlib.util.spec_from_file_location("storyforge_runtime_tools_registry", registry_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 CreativeToolRegistry：{registry_path}")
    module = importlib.util.module_from_spec(spec)
    sys_modules_name = spec.name
    sys.modules[sys_modules_name] = module
    spec.loader.exec_module(module)
    return module


def _load_creative_tools():
    """延迟读取 workflow registry，避免 API 复制工具清单。"""

    return _load_registry_module().list_creative_tools()


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
    """返回 CreativeToolRegistry 派生的运行时工具列表。"""

    runtime_tools: list[RuntimeToolRead] = []
    for tool in _load_creative_tools():
        runtime_tools.append(
            RuntimeToolRead(
                name=tool.name,
                domain=tool.domain,
                origin="internal",
                input_schema=_to_jsonable(tool.input_schema),
                output_schema=_to_jsonable(tool.output_schema),
                permission_level=_internal_permission_level(tool.name),
                requires_confirmation=_requires_confirmation(tool.name),
                read_only=not _requires_confirmation(tool.name),
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
                permission_level="read",
                requires_confirmation=False,
                read_only=True,
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
