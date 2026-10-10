from __future__ import annotations

import pytest

from app.domains.agent_runs.tooling import (
    confirming_tool_names,
    derive_permission_level,
    derive_requires_confirmation,
    list_agent_runtime_tool_specs,
)
from app.domains.runtime_tools.creative_registry import CreativeToolRegistry, CreativeToolSpec, list_creative_tools

# CreativeToolRegistry 之外还有 2 个 MCP 只读工具（见 service._MCP_READONLY_TOOL_DEFINITIONS）。
_MCP_READONLY_TOOL_COUNT = 2


def test_creative_registry_preserves_registration_order() -> None:
    first, second = list_creative_tools()[:2]

    registry = CreativeToolRegistry([second, first])

    assert registry.all() == (second, first)


def test_creative_registry_rejects_duplicate_names() -> None:
    tool = list_creative_tools()[0]

    with pytest.raises(ValueError, match="工具名称重复"):
        CreativeToolRegistry([tool, tool])


def test_creative_registry_schemas_remain_detached_and_immutable() -> None:
    choices = ["draft"]
    input_schema = {"properties": {"status": {"enum": choices}}}
    output_schema = {"type": "object"}
    tool = CreativeToolSpec(
        name="test.schema",
        domain="test",
        input_schema=input_schema,
        output_schema=output_schema,
    )
    registry = CreativeToolRegistry([tool])
    choices.append("changed")
    output_schema["type"] = "string"

    registered = registry.all()[0]
    assert registered.input_schema["properties"]["status"]["enum"] == ("draft",)
    assert registered.output_schema["type"] == "object"
    with pytest.raises(TypeError):
        registered.input_schema["properties"]["status"]["enum"] = ("changed",)
    with pytest.raises(TypeError):
        registered.output_schema["type"] = "string"


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


def test_permission_fields_derive_from_risk_and_execution_mode() -> None:
    """permission_level / requires_confirmation 必须能从 risk_level + execution_mode 单点派生。

    先绿再切的安全垫：证明派生规则对全量 spec 逐条等于当前声明值，且派生出的确认集恰等于
    runtime._execute_tool 那份手写放行名单，切片 2 才可放心删声明字段与手写名单。
    """

    for spec in list_agent_runtime_tool_specs():
        assert derive_requires_confirmation(spec.risk_level, spec.execution_mode) is spec.requires_confirmation, spec.name
        assert derive_permission_level(spec.risk_level, spec.execution_mode) == spec.permission_level, spec.name

    # == runtime.py:_execute_tool 当前手写允许名单（钉死等价关系）。
    assert confirming_tool_names() == frozenset(
        {
            "file.revise",
            "chapter.polish",
            "file.create",
            "project.trim_prose",
            "prose.continue",
            "judge.repair",
            "chapter.brief",
            "chapter.draft",
            "chapter.repair",
        }
    )


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
