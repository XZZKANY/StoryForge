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


class GenerationState(TypedDict, total=False):
    """LangGraph 生成链路共享状态，字段保持可序列化。"""

    thread_id: str
    job_run_id: str
    premise: str
    user_intent: str
    scene_packet: dict[str, Any]
    current_status: WorkflowStatus
    status_history: list[WorkflowStatus]
    current_node: str
    book_strategy: dict[str, Any]
    chapter_plan: dict[str, Any]
    scene_beats: list[dict[str, Any]]
    draft_excerpt: str
    approval_status: ApprovalStatus
    approval_response: Any

def initial_generation_state(
    *,
    thread_id: str,
    job_run_id: str,
    premise: str,
    user_intent: str,
    scene_packet: dict[str, Any],
) -> GenerationState:
    """创建测试和调用方可复用的初始状态。"""

    return {
        "thread_id": thread_id,
        "job_run_id": job_run_id,
        "premise": premise,
        "user_intent": user_intent,
        "scene_packet": scene_packet,
        "current_status": "premise_received",
        "status_history": ["premise_received"],
        "current_node": "premise_input",
        "approval_status": "pending",
    }


def advance_status(state: GenerationState, status: WorkflowStatus) -> list[WorkflowStatus]:
    """追加状态时去重相邻重复值，保证恢复重跑节点仍可审计。"""

    history = list(state.get("status_history", ["premise_received"]))
    if not history or history[-1] != status:
        history.append(status)
    return history
