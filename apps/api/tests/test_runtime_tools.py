from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_runtime_tools_endpoint_exposes_registry_tools(client: TestClient) -> None:
    """API 必须从 CreativeToolRegistry 暴露运行时工具事实源。"""

    response = client.get("/api/runtime-tools")

    assert response.status_code == 200, response.text
    tools = response.json()
    assert len(tools) == 9

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
