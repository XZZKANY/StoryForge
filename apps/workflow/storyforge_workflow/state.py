from __future__ import annotations

from typing import Any, Literal, TypedDict

WorkflowStatus = Literal[
    "premise_received",
    "outline_created",
    "chapter_plan_created",
    "scene_beats_created",
    "draft_created",
]

ApprovalStatus = Literal["pending", "approved", "rejected"]

_REFERENCE_STATE_KEYS = {
    "thread_id",
    "job_run_id",
    "scene_packet_id",
    "compiled_context_id",
    "model_run_id",
    "draft_artifact_id",
    "memory_atom_ids",
    "timeline_event_ids",
    "current_status",
    "status_history",
    "current_node",
    "approval_status",
    "approval_response",
    "error_code",
}

# prompt 工程层可消费、但不进 checkpoint 的注入键白名单。API 装配器读 DB 后产出，
# 经 WorkflowRuntime.start 透传进初始 state，供 draft_writer 的分层 prompt 使用。
# 刻意不并入 _REFERENCE_STATE_KEYS，因此 checkpoint_reference_state 会自动剔除。
_PROMPT_INJECTION_KEYS = {
    "strategy_title_ref",
    "strategy_question_ref",
    "strategy_reader_promise_ref",
    "strategy_tone_ref",
    "chapter_title_ref",
    "chapter_goal_ref",
    "conflict_axis_ref",
    "scene_goal_ref",
    "scene_beat_refs",
    "previous_summary_ref",
    "protagonist_ref",
    "required_fact_refs",
    "character_constraints",
    "style_directive",
    "pacing_directive",
    "continuity_facts",
}


class GenerationState(TypedDict, total=False):
    """LangGraph checkpoint 只保存引用字段，避免大上下文撑爆持久化。"""

    thread_id: str
    job_run_id: str
    premise: str
    user_intent: str
    scene_packet_id: int
    compiled_context_id: str
    model_run_id: int
    draft_artifact_id: int
    memory_atom_ids: list[int]
    timeline_event_ids: list[int]
    current_status: WorkflowStatus
    status_history: list[WorkflowStatus]
    current_node: str
    approval_status: ApprovalStatus
    approval_response: Any
    error_code: str
    # 以下为 prompt 工程层的可选注入键：由上游编译上下文后写入，属大上下文，
    # 不纳入 _REFERENCE_STATE_KEYS，因此不会被持久化进 checkpoint。
    character_constraints: list[dict[str, Any]]
    style_directive: dict[str, Any]
    pacing_directive: dict[str, Any]
    continuity_facts: list[dict[str, Any]]
    previous_summary_ref: str
    # 评审→修订环的工作键：在单次执行内 draft_writer→critic→reviser 间流转，
    # 同样不纳入 _REFERENCE_STATE_KEYS（环在 human_approval 中断前闭合，无需跨 checkpoint 续存）。
    draft_preview_ref: str
    draft_issues: list[str]
    draft_revision_round: int


def initial_generation_state(
    *,
    thread_id: str,
    job_run_id: str,
    premise: str,
    user_intent: str,
    scene_packet_id: int | None = None,
    compiled_context_id: str | None = None,
    model_run_id: int | None = None,
    draft_artifact_id: int | None = None,
    memory_atom_ids: list[int] | None = None,
    timeline_event_ids: list[int] | None = None,
    scene_packet: dict[str, Any] | None = None,
    prompt_injection: dict[str, Any] | None = None,
) -> GenerationState:
    """创建引用型初始状态，兼容测试输入但不把完整 Scene Packet 写入 checkpoint。"""

    state: GenerationState = {
        "thread_id": thread_id,
        "job_run_id": job_run_id,
        "premise": premise,
        "user_intent": user_intent,
        "scene_packet_id": scene_packet_id or 0,
        "compiled_context_id": compiled_context_id or _string_ref(scene_packet, "compiled_context_id"),
        "model_run_id": model_run_id or 0,
        "draft_artifact_id": draft_artifact_id or 0,
        "memory_atom_ids": list(memory_atom_ids or []),
        "timeline_event_ids": list(timeline_event_ids or []),
        "current_status": "premise_received",
        "status_history": ["premise_received"],
        "current_node": "premise_input",
        "approval_status": "pending",
    }
    if scene_packet:
        state.update(_scene_packet_reference_summary(scene_packet))
    if prompt_injection:
        # 真实装配数据放在 scene_packet 摘要之后合并，让 DB 里的章节标题/目标覆盖占位默认值。
        state.update(_prompt_injection_state(prompt_injection))
    return state


def checkpoint_reference_state(state: dict[str, Any]) -> dict[str, Any]:
    """保存 checkpoint 前只保留可恢复引用和流程状态。"""

    reference_state = {key: state[key] for key in _REFERENCE_STATE_KEYS if key in state}
    reference_state.setdefault("memory_atom_ids", [])
    reference_state.setdefault("timeline_event_ids", [])
    reference_state.setdefault("approval_status", "pending")
    reference_state.setdefault("current_node", "unknown")
    return reference_state


def advance_status(state: GenerationState, status: WorkflowStatus) -> list[WorkflowStatus]:
    """追加状态时去重相邻重复值，保证恢复重跑节点仍可审计。"""

    history = list(state.get("status_history", ["premise_received"]))
    if not history or history[-1] != status:
        history.append(status)
    return history


def _scene_packet_reference_summary(scene_packet: dict[str, Any]) -> dict[str, Any]:
    """提取节点需要的轻量字段，避免保存完整 Scene Packet。"""

    return {
        "chapter_title_ref": str(scene_packet.get("chapter_title", "第一章：启航")),
        "chapter_goal_ref": str(scene_packet.get("chapter_goal", "完成章节目标。")),
        "scene_goal_ref": str(scene_packet.get("scene_goal", "完成关键场景目标。")),
        "protagonist_ref": str(scene_packet.get("protagonist", "主角")),
        "required_fact_refs": [str(value) for value in scene_packet.get("required_facts", [])],
    }


def _prompt_injection_state(prompt_injection: dict[str, Any]) -> dict[str, Any]:
    """从装配器产出的注入键里取 prompt 工程层认得的键，跳过空值。"""

    return {
        key: prompt_injection[key]
        for key in _PROMPT_INJECTION_KEYS
        if key in prompt_injection and prompt_injection[key]
    }


def _string_ref(scene_packet: dict[str, Any] | None, key: str) -> str:
    if not scene_packet:
        return ""
    value = scene_packet.get(key)
    return "" if value is None else str(value)
