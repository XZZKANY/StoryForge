from __future__ import annotations

from fastapi.testclient import TestClient

from app.domains.agent_runs.tooling import list_agent_runtime_tool_specs
from app.main import app


def test_runtime_tools_endpoint_exposes_registry_tools(client: TestClient) -> None:
    """API 必须从 AgentRuntime、CreativeToolRegistry 和 MCP 暴露运行时工具事实源。"""

    response = client.get("/api/runtime-tools")

    assert response.status_code == 200, response.text
    tools = response.json()
    assert len(tools) == len(list_agent_runtime_tool_specs()) + 9

    retrieval = next(tool for tool in tools if tool["name"] == "retrieval.search")
    assert retrieval["domain"] == "retrieval"
    assert retrieval["origin"] == "internal"
    assert retrieval["permission_level"] == "read"
    assert retrieval["requires_confirmation"] is False
    assert retrieval["read_only"] is True
    assert retrieval["event_store_required"] is True
    assert retrieval["input_schema"]["title"] == "RetrievalSearchCreate"
    assert retrieval["output_schema"]["title"] == "RetrievalHitReadList"
    assert retrieval["required_capabilities"] == ["embedding", "reranker"]
    assert "source_ref" in retrieval["evidence_fields"]
    assert "POST /api/retrieval/search" in retrieval["references"]["api_paths"]

    artifact_create = next(tool for tool in tools if tool["name"] == "artifacts.create")
    assert artifact_create["permission_level"] == "risk_confirm"
    assert artifact_create["requires_confirmation"] is True
    assert artifact_create["read_only"] is False


def test_runtime_tools_endpoint_includes_executable_agent_runtime_tools(client: TestClient) -> None:
    """描述性 runtime-tools 读侧必须复用可执行 AgentRuntime tool spec。"""

    response = client.get("/api/runtime-tools")

    assert response.status_code == 200, response.text
    tools = response.json()
    specs = list_agent_runtime_tool_specs()
    agent_tools = [tool for tool in tools if tool["origin"] == "agent_runtime"]
    assert [tool["name"] for tool in agent_tools] == [spec.name for spec in specs]
    by_name = {tool["name"]: tool for tool in agent_tools}
    assert by_name["context.load"]["permission_level"] == "auto"
    assert by_name["context.load"]["risk_level"] == "read"
    assert by_name["context.load"]["read_only"] is True
    assert by_name["context.load"]["retry_safe"] is True
    assert by_name["context.load"]["idempotent"] is True
    assert by_name["file.revise"]["permission_level"] == "confirm"
    assert by_name["file.revise"]["risk_level"] == "write_pending"
    assert by_name["file.revise"]["requires_confirmation"] is True
    assert by_name["file.revise"]["read_only"] is False
    assert by_name["file.revise"]["retry_safe"] is False
    assert by_name["file.revise"]["execution_mode"] == "sync"
    assert by_name["file.revise"]["artifact_kinds"] == ["proposed_patch"]
    assert by_name["file.revise"]["allowed_roles"] == ["root_agent", "repair_agent"]
    assert by_name["bookrun.pause"]["requires_confirmation"] is False
    assert by_name["bookrun.pause"]["read_only"] is False
    assert by_name["bookrun.start"]["execution_mode"] == "long_running"
    assert by_name["file.revise"]["references"]["workflow_nodes"] == ["agent_runtime.file_revise"]


def test_agent_runtime_registers_exactly_declared_tool_specs() -> None:
    """执行期 ToolRegistry 的注册结果必须来自同一份 agent runtime tool spec。"""

    from app.domains.agent_runs.runtime import AgentRuntime

    runtime = AgentRuntime(event_sink=None)  # type: ignore[arg-type]
    registered = runtime._tool_registry.all()  # noqa: SLF001 - regression guard for internal registry wiring
    specs = list_agent_runtime_tool_specs()
    specs_by_name = {spec.name: spec for spec in specs}

    assert [tool.name for tool in registered] == [spec.name for spec in specs]
    for tool in registered:
        spec = specs_by_name[tool.name]
        assert tool.description == spec.description
        assert tool.permission_level == spec.permission_level
        assert tool.risk_level == spec.risk_level
        assert tool.requires_confirmation is spec.requires_confirmation
        assert tool.allowed_roles == tuple(spec.allowed_roles)
        assert tool.retry_safe is spec.retry_safe
        assert tool.idempotent is spec.idempotent
        assert tool.execution_mode == spec.execution_mode
        assert tool.artifact_kinds == tuple(spec.artifact_kinds)


def test_agent_runtime_tool_allowed_roles_match_role_catalog() -> None:
    """ToolDefinition.allowed_roles 是 role catalog 的投影，不引入第二套权限事实。"""

    from app.domains.agent_runs.role_catalog import list_agent_roles

    expected_by_tool: dict[str, list[str]] = {}
    for role in list_agent_roles():
        for tool_name in role.allowed_tools:
            if tool_name.startswith("mcp."):
                continue
            expected_by_tool.setdefault(tool_name, []).append(role.name)

    specs_by_name = {spec.name: list(spec.allowed_roles) for spec in list_agent_runtime_tool_specs()}

    assert specs_by_name == {
        tool_name: roles
        for tool_name, roles in expected_by_tool.items()
        if tool_name in specs_by_name
    }


def test_runtime_tools_exposes_only_readonly_mcp_v1_tools(client: TestClient) -> None:
    """MCP v1 只注册只读/分析工具，且必须进入 Event Store。"""

    response = client.get("/api/runtime-tools")

    assert response.status_code == 200, response.text
    tools = response.json()
    mcp_tools = [tool for tool in tools if tool["origin"] == "mcp"]
    assert [tool["name"] for tool in mcp_tools] == ["mcp.project.search", "mcp.context.inspect"]
    assert all(tool["domain"] == "mcp" for tool in mcp_tools)
    assert all(tool["permission_level"] == "read" for tool in mcp_tools)
    assert all(tool["requires_confirmation"] is False for tool in mcp_tools)
    assert all(tool["read_only"] is True for tool in mcp_tools)
    assert all(tool["event_store_required"] is True for tool in mcp_tools)
    assert {tool["mcp_server"] for tool in mcp_tools} == {"project-context"}


def test_runtime_tools_openapi_contract_is_documented() -> None:
    """OpenAPI 必须记录 runtime tools 只读契约，供 Web 和 e2e 校验。"""

    operation = app.openapi()["paths"].get("/api/runtime-tools", {}).get("get")

    assert operation is not None
    assert "运行时工具" in operation["tags"]
    response_schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
    assert response_schema["items"]["$ref"].endswith("RuntimeToolRead")
