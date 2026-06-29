from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class RuntimeToolReferencesRead(BaseModel):
    """运行时工具在 Web、API 与 workflow 中的静态引用。"""

    page_refs: list[str]
    api_paths: list[str]
    workflow_nodes: list[str]


class RuntimeToolRead(BaseModel):
    """运行时工具对外暴露的只读契约。"""

    model_config = ConfigDict(json_schema_extra={"description": "由 AgentRuntime、CreativeToolRegistry 或 MCP 派生的运行时工具说明。"})

    name: str
    domain: str
    origin: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    allowed_roles: list[str]
    permission_level: str
    risk_level: str
    requires_confirmation: bool
    read_only: bool
    retry_safe: bool
    idempotent: bool
    execution_mode: str
    artifact_kinds: list[str]
    event_store_required: bool
    mcp_server: str | None = None
    mcp_tool_name: str | None = None
    required_capabilities: list[str]
    evidence_fields: list[str]
    references: RuntimeToolReferencesRead
