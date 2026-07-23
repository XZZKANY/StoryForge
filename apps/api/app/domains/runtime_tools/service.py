from __future__ import annotations

import importlib.util
import logging
import sys
from collections.abc import Mapping, Sequence, Set
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any

from app.domains.agent_runs.tools import list_agent_runtime_tool_specs
from app.domains.runtime_tools.schemas import RuntimeToolRead, RuntimeToolReferencesRead

_logger = logging.getLogger(__name__)

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
    """延迟读取 workflow registry，避免 API 复制工具清单。

    冻结 sidecar 内 apps/workflow 未随 exe 打包（spec 只 collect_submodules('app') + alembic），
    registry.py 文件不存在 → importlib 加载抛错。此处降级为空列表 + 告警，而非让只读端点
    GET /api/runtime-tools 直接 500（D6-001；根治随 workflow 收编，见 workflow 迁移 ledger）。
    只捕加载类异常，不吞 registry 内部真 bug。"""

    try:
        return _load_registry_module().list_creative_tools()
    except (RuntimeError, OSError, ImportError):
        _logger.warning(
            "CreativeToolRegistry 不可用（apps/workflow 未随冻结 exe 打包？），"
            "运行时工具清单降级为 agent_runtime + MCP，不含 internal creative 工具。",
            exc_info=True,
        )
        return ()


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
