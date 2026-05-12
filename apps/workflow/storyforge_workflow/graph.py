from collections.abc import Callable
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from storyforge_workflow.nodes.director import create_book_strategy
from storyforge_workflow.nodes.draft_writer import create_draft_excerpt
from storyforge_workflow.nodes.scene_architect import create_chapter_plan, create_scene_beats
from storyforge_workflow.persistence import InMemoryWorkflowStore, summarize_value
from storyforge_workflow.state import GenerationState

NodeFunction = Callable[[GenerationState], dict[str, Any]]


def create_generation_graph(
    *,
    store: InMemoryWorkflowStore | None = None,
    checkpointer: InMemorySaver | None = None,
):
    """创建可中断、可恢复的生成工作流图。"""

    workflow_store = store or InMemoryWorkflowStore()
    saver = checkpointer or InMemorySaver()
    builder = StateGraph(GenerationState)
    builder.add_node("book_director", _audited_node("book_director", create_book_strategy, workflow_store))
    builder.add_node(
        "chapter_planner",
        _audited_node("scene_architect.chapter_plan", create_chapter_plan, workflow_store),
    )
    builder.add_node(
        "scene_beats",
        _audited_node("scene_architect.scene_beats", create_scene_beats, workflow_store),
    )
    builder.add_node("draft_writer", _audited_node("draft_writer", create_draft_excerpt, workflow_store))
    builder.add_node("human_approval", _approval_node(workflow_store))

    builder.add_edge(START, "book_director")
    builder.add_edge("book_director", "chapter_planner")
    builder.add_edge("chapter_planner", "scene_beats")
    builder.add_edge("scene_beats", "draft_writer")
    builder.add_edge("draft_writer", "human_approval")
    builder.add_edge("human_approval", END)
    return builder.compile(checkpointer=saver)


def build_generation_graph(
    *,
    store: InMemoryWorkflowStore | None = None,
    checkpointer: InMemorySaver | None = None,
):
    """兼容调用方命名偏好，返回同一类编译图。"""

    return create_generation_graph(store=store, checkpointer=checkpointer)


def _audited_node(node_name: str, node: NodeFunction, store: InMemoryWorkflowStore):
    def run(state: GenerationState, config: RunnableConfig | None = None) -> dict[str, Any]:
        output = node(state)
        store.record(
            thread_id=_thread_id(state, config),
            job_run_id=state["job_run_id"],
            current_node=node_name,
            input_summary=summarize_value(_node_input(state, node_name)),
            output_summary=summarize_value(output),
            approval_status=state.get("approval_status", "pending"),
        )
        return output

    return run


def _approval_node(store: InMemoryWorkflowStore):
    def run(state: GenerationState, config: RunnableConfig | None = None) -> dict[str, Any]:
        approval_request = {
            "question": "请审批当前草稿片段。",
            "thread_id": _thread_id(state, config),
            "job_run_id": state["job_run_id"],
            "draft_excerpt": state["draft_excerpt"],
            "status_history": state["status_history"],
        }
        decision = interrupt(approval_request)
        approval_status = _approval_status(decision)
        output = {
            "approval_status": approval_status,
            "approval_response": decision,
            "current_node": "human_approval",
        }
        store.record(
            thread_id=_thread_id(state, config),
            job_run_id=state["job_run_id"],
            current_node="human_approval",
            input_summary=summarize_value(approval_request),
            output_summary=summarize_value(output),
            approval_status=approval_status,
        )
        return output

    return run


def _thread_id(state: GenerationState, config: RunnableConfig | None) -> str:
    configured = (config or {}).get("configurable", {}).get("thread_id")
    return str(configured or state["thread_id"])


def _node_input(state: GenerationState, node_name: str) -> dict[str, Any]:
    if node_name == "book_director":
        return {"premise": state.get("premise"), "user_intent": state.get("user_intent")}
    if node_name == "scene_architect.chapter_plan":
        return {"book_strategy": state.get("book_strategy"), "scene_packet": state.get("scene_packet")}
    if node_name == "scene_architect.scene_beats":
        return {"chapter_plan": state.get("chapter_plan"), "scene_packet": state.get("scene_packet")}
    return {"scene_packet": state.get("scene_packet"), "scene_beats": state.get("scene_beats")}


def _approval_status(decision: Any) -> str:
    if isinstance(decision, dict):
        approved = decision.get("approved")
        if approved is True:
            return "approved"
        if approved is False:
            return "rejected"
    if decision in ("approved", "通过", True):
        return "approved"
    return "rejected"
