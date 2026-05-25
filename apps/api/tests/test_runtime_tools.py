from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_runtime_tools_endpoint_exposes_registry_tools(client: TestClient) -> None:
    """API 必须从 CreativeToolRegistry 暴露运行时工具事实源。"""

    response = client.get("/api/runtime-tools")

    assert response.status_code == 200, response.text
    tools = response.json()
    assert len(tools) == 7

    retrieval = next(tool for tool in tools if tool["name"] == "retrieval.search")
    assert retrieval["domain"] == "retrieval"
    assert retrieval["input_schema"]["title"] == "RetrievalSearchCreate"
    assert retrieval["output_schema"]["title"] == "RetrievalHitReadList"
    assert retrieval["required_capabilities"] == ["embedding", "reranker"]
    assert "source_ref" in retrieval["evidence_fields"]
    assert "POST /api/retrieval/search" in retrieval["references"]["api_paths"]


def test_runtime_tools_openapi_contract_is_documented() -> None:
    """OpenAPI 必须记录 runtime tools 只读契约，供 Web 和 e2e 校验。"""

    operation = app.openapi()["paths"].get("/api/runtime-tools", {}).get("get")

    assert operation is not None
    assert "运行时工具" in operation["tags"]
    response_schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
    assert response_schema["items"]["$ref"].endswith("RuntimeToolRead")
