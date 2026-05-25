from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from storyforge_workflow.tools.registry import (
    DEFAULT_CREATIVE_TOOL_REGISTRY,
    CreativeToolReferences,
    CreativeToolRegistry,
    CreativeToolSpec,
    get_creative_tool,
    list_creative_tools,
)


REQUIRED_DOMAINS = {
    "retrieval",
    "scene_packets",
    "judge",
    "repair",
    "artifacts",
    "evaluations",
    "provider_gateway",
}


def test_default_registry_covers_required_creative_domains() -> None:
    """默认注册表必须覆盖第三阶段要求的全部创作 domain。"""

    tools = DEFAULT_CREATIVE_TOOL_REGISTRY.all()
    domains = {tool.domain for tool in tools}
    names = {tool.name for tool in tools}

    assert domains == REQUIRED_DOMAINS
    assert len(names) == len(tools)


def test_registry_exposes_schema_capability_and_mapping_metadata() -> None:
    """工具条目应同时描述 schema、能力、证据字段和页面/API/Workflow 映射。"""

    retrieval = DEFAULT_CREATIVE_TOOL_REGISTRY.require("retrieval.search")
    scene_packet = DEFAULT_CREATIVE_TOOL_REGISTRY.require("scene_packets.assemble")

    assert retrieval.domain == "retrieval"
    assert retrieval.input_schema["title"] == "RetrievalSearchCreate"
    assert retrieval.output_schema["title"] == "RetrievalHitReadList"
    assert "embedding" in retrieval.required_capabilities
    assert "source_ref" in retrieval.evidence_fields
    assert "POST /api/retrieval/search" in retrieval.references.api_paths
    assert "apps/web/app/retrieval/page.tsx" in retrieval.references.page_refs
    assert retrieval.references.workflow_nodes

    assert scene_packet.input_schema["title"] == "ScenePacketCreate"
    assert "evidence_links" in scene_packet.evidence_fields
    assert "POST /api/scene-packets" in scene_packet.references.api_paths


def test_registry_queries_by_domain_and_capability() -> None:
    """注册表应支持按 domain 和能力反查工具。"""

    judge_tools = DEFAULT_CREATIVE_TOOL_REGISTRY.by_domain("judge")
    embedding_tools = DEFAULT_CREATIVE_TOOL_REGISTRY.by_capability("embedding")

    assert [tool.name for tool in judge_tools] == ["judge.create_issues"]
    assert {tool.name for tool in embedding_tools} == {"retrieval.search", "provider_gateway.resolve"}
    assert get_creative_tool("repair.create_patch") == DEFAULT_CREATIVE_TOOL_REGISTRY.require("repair.create_patch")
    assert list_creative_tools() == DEFAULT_CREATIVE_TOOL_REGISTRY.all()


def test_registry_returns_immutable_snapshots() -> None:
    """注册表条目应固定为不可变快照，避免运行中被调用方改写。"""

    raw_input_schema = {"type": "object", "properties": {"value": {"type": "string"}}}
    raw_output_schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}}
    spec = CreativeToolSpec(
        name="unit.example",
        domain="unit",
        input_schema=raw_input_schema,
        output_schema=raw_output_schema,
        required_capabilities=["llm"],
        evidence_fields=["request_id"],
        references=CreativeToolReferences(
            page_refs=["apps/web/app/unit/page.tsx"],
            api_paths=["POST /api/unit"],
            workflow_nodes=["unit.node"],
        ),
    )

    raw_input_schema["type"] = "array"
    raw_input_schema["properties"]["value"]["type"] = "number"

    assert spec.input_schema["type"] == "object"
    assert spec.input_schema["properties"]["value"]["type"] == "string"
    assert spec.required_capabilities == ("llm",)
    assert spec.evidence_fields == ("request_id",)
    with pytest.raises(TypeError):
        spec.input_schema["type"] = "array"  # type: ignore[index]
    with pytest.raises(TypeError):
        spec.input_schema["properties"]["value"]["type"] = "number"  # type: ignore[index]
    with pytest.raises(FrozenInstanceError):
        spec.name = "unit.changed"  # type: ignore[misc]


def test_registry_rejects_duplicate_names_and_reports_missing_tools() -> None:
    """注册表应拒绝重复名称，并为缺失工具给出明确错误。"""

    spec = CreativeToolSpec(
        name="unit.example",
        domain="unit",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        required_capabilities=(),
        evidence_fields=(),
        references=CreativeToolReferences(api_paths=("POST /api/unit",)),
    )

    with pytest.raises(ValueError, match="工具名称重复"):
        CreativeToolRegistry([spec, spec])
    with pytest.raises(KeyError, match="创作工具不存在：missing.tool"):
        DEFAULT_CREATIVE_TOOL_REGISTRY.require("missing.tool")
    assert DEFAULT_CREATIVE_TOOL_REGISTRY.get("missing.tool") is None
