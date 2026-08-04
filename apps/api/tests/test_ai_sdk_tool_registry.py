from __future__ import annotations

import pytest

from app.platform.ai_sdk import ToolSpec
from app.platform.ai_sdk.tools import (
    RuntimeArtifact,
    RuntimeTool,
    RuntimeToolResult,
    ToolRegistry,
    ToolRegistryError,
    validate_json_schema,
)


def _tool(name: str = "lookup") -> RuntimeTool:
    return RuntimeTool(
        spec=ToolSpec(
            name,
            "Lookup a value",
            {
                "type": "object",
                "properties": {"key": {"type": "string", "minLength": 1}},
                "required": ["key"],
                "additionalProperties": False,
            },
        ),
        output_schema={"type": "object", "required": ["value"]},
        handler=lambda context, arguments: RuntimeToolResult.success(
            {"value": f"{context['prefix']}:{arguments['key']}"},
            artifacts=(RuntimeArtifact("lookup", {"key": arguments["key"]}),),
        ),
        retry_safe=True,
        idempotent=True,
    )


def test_registry_rejects_duplicates_and_projects_provider_specs() -> None:
    registry = ToolRegistry([_tool()])
    assert registry.get("lookup").retry_safe is True
    assert registry.specs() == (_tool().spec,)
    with pytest.raises(ToolRegistryError, match="already registered"):
        registry.register(_tool())
    with pytest.raises(ToolRegistryError, match="Unknown runtime tool"):
        registry.get("missing")


def test_schema_validation_reports_nested_required_type_and_extra_fields() -> None:
    schema = _tool().spec.input_schema
    assert validate_json_schema({"key": "chapter"}, schema) == ()
    issues = validate_json_schema({"key": 3, "extra": True}, schema)
    assert {issue.code for issue in issues} == {"type", "additional_property"}
    assert validate_json_schema({}, schema)[0].code == "required"


def test_tool_result_and_artifact_payloads_are_immutable_snapshots() -> None:
    output = {"value": {"items": [1, 2]}}
    result = RuntimeToolResult.success(output)
    output["value"]["items"].append(3)
    assert tuple(result.output["value"]["items"]) == (1, 2)
    with pytest.raises(TypeError):
        result.output["value"]["new"] = True  # type: ignore[index]
