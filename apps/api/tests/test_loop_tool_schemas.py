from __future__ import annotations

import json
from pathlib import Path

from app.domains.agent_runs import loop_runtime
from app.domains.agent_runs.tooling import (
    AgentRuntimeToolSpec,
    LoopToolSchema,
    build_loop_tool_name_map,
    build_loop_tool_schemas,
    list_loop_tool_specs,
    llm_tool_name,
    loop_patch_tool_specs,
)

# W6 slice 3：chat 循环的 LLM 工具 schema / 名映射 / 补丁工具集从 spec 单点派生，
# 删掉 loop_runtime 里那份手写镜像。下面既钉「派生结果 == 冻结的手写基线」（先绿再切），
# 又用 demo 工具证明「加一个循环工具 = 加一条带 loop_schema 的 spec」的单点收敛。

_GOLDEN_PATH = Path(__file__).parent / "fixtures" / "loop_tool_schemas_golden.json"


def _wire(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def test_derived_loop_schemas_match_frozen_golden() -> None:
    """派生的 LLM function schema 必须与切换前手写的 LOOP_TOOL_SCHEMAS 逐字节一致。"""

    golden = json.loads(_GOLDEN_PATH.read_text(encoding="utf-8"))
    assert _wire(build_loop_tool_schemas()) == _wire(golden)


def test_loop_runtime_consumes_the_derivation() -> None:
    """loop_runtime 的模块级常量确实吃派生结果，而非又存了一份副本。"""

    assert build_loop_tool_schemas() == loop_runtime.LOOP_TOOL_SCHEMAS
    assert build_loop_tool_name_map() == loop_runtime._TOOL_NAME_MAP
    assert tuple(spec.name for spec in loop_patch_tool_specs()) == loop_runtime._PATCH_TOOLS
    assert tuple(
        llm_tool_name(spec.name) for spec in loop_patch_tool_specs()
    ) == loop_runtime._PATCH_TOOL_LLM_NAMES


def test_name_map_is_dotted_to_underscore_roundtrip() -> None:
    name_map = build_loop_tool_name_map()
    for llm_name, dotted in name_map.items():
        assert llm_tool_name(dotted) == llm_name
        assert "." not in llm_name


def test_only_write_pending_loop_tools_are_patch_tools() -> None:
    """补丁工具集从 risk_level 派生，正好是 file.revise / file.create。"""

    assert tuple(spec.name for spec in loop_patch_tool_specs()) == ("file.revise", "file.create")


def test_non_loop_specs_stay_out_of_the_llm_loop() -> None:
    """没有 loop_schema 的工具（context.load / judge.* / bookrun.*）不进循环，不对 LLM 暴露。"""

    loop_names = {spec.name for spec in list_loop_tool_specs()}
    for name in ("context.load", "judge.run", "judge.repair", "bookrun.start", "bookrun.pause"):
        assert name not in loop_names


def _demo_spec(*, name: str, risk_level: str) -> AgentRuntimeToolSpec:
    return AgentRuntimeToolSpec(
        name=name,
        description="demo",
        domain="demo",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent",),
        risk_level=risk_level,
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        loop_schema=LoopToolSchema(
            description="demo 工具描述。",
            parameters={
                "type": "object",
                "properties": {"target": {"type": "string", "description": "目标。"}},
                "required": ["target"],
            },
        ),
    )


def test_registering_a_demo_loop_tool_auto_flows_schema_and_name_map() -> None:
    """单点收敛证明：一条带 loop_schema 的 demo spec 自动产出 LLM schema + 名映射，
    无需再手改 loop_runtime。这就是「加循环工具 = 加一条 spec」的改动面。"""

    demo = _demo_spec(name="demo.analyze", risk_level="analyze")
    specs = [*list_loop_tool_specs(), demo]

    schemas = build_loop_tool_schemas(specs)
    demo_schema = schemas[-1]
    assert demo_schema == {
        "type": "function",
        "function": {
            "name": "demo_analyze",
            "description": "demo 工具描述。",
            "parameters": {
                "type": "object",
                "properties": {"target": {"type": "string", "description": "目标。"}},
                "required": ["target"],
            },
        },
    }
    assert build_loop_tool_name_map(specs)["demo_analyze"] == "demo.analyze"
    # analyze 级不进补丁集
    assert "demo.analyze" not in {spec.name for spec in loop_patch_tool_specs(specs)}


def test_registering_a_write_pending_demo_tool_auto_becomes_patch_tool() -> None:
    """write_pending 的 demo 工具自动进补丁集（生成补丁后会被撤下），无需手改补丁名单。"""

    demo = _demo_spec(name="demo.write", risk_level="write_pending")
    specs = [*list_loop_tool_specs(), demo]
    assert "demo.write" in {spec.name for spec in loop_patch_tool_specs(specs)}
    assert "demo_write" in build_loop_tool_name_map(specs)
