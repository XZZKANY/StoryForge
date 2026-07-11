from __future__ import annotations

from app.domains.agent_runs.ws_schema import build_agent_ws_schema

# Agent 实时帧 schema 契约测试：把 build_agent_ws_schema() 的产物形状钉死，
# 与 event_encoders 实际出线的 type 值集合对齐。schema 是前端派生类型的单一事实源，
# 这里保证它覆盖全部帧、全部判别 type 值，且严格禁额外字段；文件/函数名为历史兼容名。


def test_schema_defs_cover_the_six_frames() -> None:
    schema = build_agent_ws_schema()
    assert set(schema["$defs"]) == {
        "AgentRunStartedFrame",
        "AgentStepFrame",
        "ToolTraceFrame",
        "PermissionRequiredFrame",
        "TerminalFrame",
        "ControlAckFrame",
    }


def test_schema_oneof_refs_every_frame() -> None:
    schema = build_agent_ws_schema()
    refs = {entry["$ref"] for entry in schema["oneOf"]}
    assert refs == {f"#/$defs/{name}" for name in schema["$defs"]}


def test_schema_discriminator_covers_every_wire_type() -> None:
    """schema 里所有帧的 type（const 或 enum）并集，必须正好等于 event_encoders
    可能出线的全部 type 值——漏一个前端就会碰到 schema 没覆盖的帧。"""

    schema = build_agent_ws_schema()
    wire_types: set[str] = set()
    for frame_schema in schema["$defs"].values():
        type_field = frame_schema["properties"]["type"]
        if "const" in type_field:
            wire_types.add(type_field["const"])
        else:
            wire_types.update(type_field["enum"])

    assert wire_types == {
        "agent_run_started",
        "agent_step",
        "tool_trace",
        "permission_required",
        "agent_run_completed",
        "agent_run_failed",
        "permission_approved",
        "permission_denied",
        "pause_run",
        "resume_run",
        "stop_run",
        "retry_from_checkpoint",
    }


def test_every_frame_forbids_extra_properties() -> None:
    """extra="forbid" → additionalProperties:false：帧带未知字段即 schema 违约，
    防前端解出后端没声明的野键。"""

    schema = build_agent_ws_schema()
    for frame_schema in schema["$defs"].values():
        assert frame_schema["additionalProperties"] is False


def test_started_frame_required_fields_match_model() -> None:
    """抽查一帧的 required 集合，防模型改可空性后 schema 悄悄漂移。"""

    schema = build_agent_ws_schema()
    started = schema["$defs"]["AgentRunStartedFrame"]
    assert set(started["required"]) == {"session_id", "run_id", "user_message", "event_id"}
