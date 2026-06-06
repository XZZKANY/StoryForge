import os
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from time import perf_counter
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from storyforge_workflow.nodes.director import create_book_strategy
from storyforge_workflow.nodes.draft_writer import (
    create_draft_critique,
    create_draft_excerpt,
    create_draft_revision,
)
from storyforge_workflow.nodes.scene_architect import create_chapter_plan, create_scene_beats
from storyforge_workflow.persistence import InMemoryWorkflowStore, summarize_value
from storyforge_workflow.state import GenerationState
from storyforge_workflow.utils.logging import get_logger

log = get_logger("storyforge_workflow.graph")

NodeFunction = Callable[[GenerationState], dict[str, Any]]
DEFAULT_NODE_TIMEOUT_SECONDS = 120.0
DEFAULT_MAX_REVISIONS = 2
DEFAULT_NODE_EXECUTOR_WORKERS = 4
DEFAULT_RETIRED_NODE_EXECUTOR_LIMIT = 4
_node_executor_lock = threading.Lock()
_node_executor: ThreadPoolExecutor | None = None
_retired_node_executors: list[ThreadPoolExecutor] = []


class WorkflowNodeTimeoutError(TimeoutError):
    """workflow 节点执行超过配置阈值。"""

    def __init__(self, *, node_name: str, timeout_seconds: float) -> None:
        super().__init__(f"workflow 节点 {node_name} 执行超过 {timeout_seconds:g} 秒。")
        self.node_name = node_name
        self.timeout_seconds = timeout_seconds


def create_generation_graph(
    *,
    store: InMemoryWorkflowStore | None = None,
    checkpointer: InMemorySaver | None = None,
    node_timeout_seconds: float | None = None,
):
    """创建可中断、可恢复的生成工作流图。"""

    if checkpointer is None:
        raise ValueError("create_generation_graph 需要显式传入持久化 checkpointer；测试可传入 InMemorySaver。")
    workflow_store = store or InMemoryWorkflowStore()
    resolved_node_timeout_seconds = _resolve_node_timeout_seconds(node_timeout_seconds)
    log.info("graph_created", node_timeout_seconds=resolved_node_timeout_seconds)
    builder = StateGraph(GenerationState)
    builder.add_node(
        "book_director",
        _audited_node("book_director", create_book_strategy, workflow_store, resolved_node_timeout_seconds),
    )
    builder.add_node(
        "chapter_planner",
        _audited_node(
            "scene_architect.chapter_plan", create_chapter_plan, workflow_store, resolved_node_timeout_seconds
        ),
    )
    builder.add_node(
        "scene_beats",
        _audited_node("scene_architect.scene_beats", create_scene_beats, workflow_store, resolved_node_timeout_seconds),
    )
    builder.add_node(
        "draft_writer",
        _audited_node("draft_writer", create_draft_excerpt, workflow_store, resolved_node_timeout_seconds),
    )
    builder.add_node(
        "draft_critic",
        _audited_node("draft_critic", create_draft_critique, workflow_store, resolved_node_timeout_seconds),
    )
    builder.add_node(
        "draft_reviser",
        _audited_node("draft_reviser", create_draft_revision, workflow_store, resolved_node_timeout_seconds),
    )
    builder.add_node("human_approval", _approval_node(workflow_store))

    builder.add_edge(START, "book_director")
    builder.add_edge("book_director", "chapter_planner")
    builder.add_edge("chapter_planner", "scene_beats")
    builder.add_edge("scene_beats", "draft_writer")
    # 评审→修订环：默认开（env 可关）。critic 发现问题且未超轮数则回到 reviser 重写后再评审。
    builder.add_conditional_edges(
        "draft_writer",
        _route_after_draft,
        {"draft_critic": "draft_critic", "human_approval": "human_approval"},
    )
    builder.add_conditional_edges(
        "draft_critic",
        _route_after_critique,
        {"draft_reviser": "draft_reviser", "human_approval": "human_approval"},
    )
    builder.add_edge("draft_reviser", "draft_critic")
    builder.add_edge("human_approval", END)
    return builder.compile(checkpointer=checkpointer)


def _critique_enabled() -> bool:
    return os.getenv("STORYFORGE_DRAFT_CRITIQUE_ENABLED", "1").strip().lower() not in ("0", "false", "no", "off", "")


def _max_revisions() -> int:
    raw = os.getenv("STORYFORGE_DRAFT_MAX_REVISIONS")
    if raw is None:
        return DEFAULT_MAX_REVISIONS
    try:
        parsed = int(raw)
    except ValueError:
        return DEFAULT_MAX_REVISIONS
    return parsed if parsed >= 0 else DEFAULT_MAX_REVISIONS


def _route_after_draft(state: GenerationState) -> str:
    return "draft_critic" if _critique_enabled() else "human_approval"


def _route_after_critique(state: GenerationState) -> str:
    issues = state.get("draft_issues") or []
    rounds = int(state.get("draft_revision_round", 0))
    if issues and rounds < _max_revisions():
        return "draft_reviser"
    return "human_approval"


def _audited_node(node_name: str, node: NodeFunction, store: InMemoryWorkflowStore, timeout_seconds: float):
    def run(state: GenerationState, config: RunnableConfig | None = None) -> dict[str, Any]:
        workflow_id = state.get("job_run_id", "unknown")
        bound = log.bind(workflow_id=workflow_id, node_id=node_name)
        bound.info("node_started")
        t0 = perf_counter()
        try:
            output = _run_node_with_timeout(node_name, node, state, timeout_seconds)
        except Exception as exc:
            duration_ms = (perf_counter() - t0) * 1000
            exc.node_name = node_name
            bound.error("node_failed", duration_ms=round(duration_ms, 1), status="failed")
            raise
        duration_ms = (perf_counter() - t0) * 1000
        bound.info("node_completed", duration_ms=round(duration_ms, 1), status="completed")
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
            "draft_artifact_id": state.get("draft_artifact_id"),
            "draft_preview": state.get("draft_preview_ref", "草稿预览已写入制品引用。"),
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
        return {
            "strategy_question_ref": state.get("strategy_question_ref"),
            "scene_packet_id": state.get("scene_packet_id"),
        }
    if node_name == "scene_architect.scene_beats":
        return {"chapter_goal_ref": state.get("chapter_goal_ref"), "scene_packet_id": state.get("scene_packet_id")}
    return {"scene_packet_id": state.get("scene_packet_id"), "scene_beat_refs": state.get("scene_beat_refs")}


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


def _run_node_with_timeout(
    node_name: str, node: NodeFunction, state: GenerationState, timeout_seconds: float
) -> dict[str, Any]:
    executor = _workflow_node_executor()
    future = executor.submit(node, state)
    try:
        return future.result(timeout=timeout_seconds)
    except FutureTimeoutError as exc:
        future.cancel()
        _retire_workflow_node_executor(executor)
        log.error("node_timeout", node_id=node_name, timeout_seconds=timeout_seconds)
        raise WorkflowNodeTimeoutError(node_name=node_name, timeout_seconds=timeout_seconds) from exc


def close_workflow_node_executor() -> None:
    """关闭当前进程复用的节点执行器，测试和 worker 退出时可显式释放线程。"""

    _reset_workflow_node_executor()


def _workflow_node_executor() -> ThreadPoolExecutor:
    global _node_executor
    with _node_executor_lock:
        if _node_executor is None:
            _node_executor = ThreadPoolExecutor(
                max_workers=_resolve_node_executor_workers(),
                thread_name_prefix="storyforge-node",
            )
        return _node_executor


def _reset_workflow_node_executor() -> None:
    global _node_executor
    with _node_executor_lock:
        executor = _node_executor
        _node_executor = None
        retired_executors = list(_retired_node_executors)
        _retired_node_executors.clear()
    if executor is not None:
        executor.shutdown(wait=False, cancel_futures=True)
    for retired_executor in retired_executors:
        retired_executor.shutdown(wait=False, cancel_futures=True)


def _retire_workflow_node_executor(executor: ThreadPoolExecutor) -> None:
    global _node_executor
    should_shutdown = False
    with _node_executor_lock:
        if _node_executor is executor and len(_retired_node_executors) < _resolve_retired_node_executor_limit():
            _node_executor = None
            _retired_node_executors.append(executor)
            should_shutdown = True
    if should_shutdown:
        executor.shutdown(wait=False, cancel_futures=True)


def _resolve_node_executor_workers() -> int:
    raw = os.getenv("STORYFORGE_WORKFLOW_NODE_EXECUTOR_WORKERS")
    if raw is None:
        return DEFAULT_NODE_EXECUTOR_WORKERS
    try:
        parsed = int(raw)
    except ValueError:
        return DEFAULT_NODE_EXECUTOR_WORKERS
    return parsed if parsed > 0 else DEFAULT_NODE_EXECUTOR_WORKERS


def _resolve_retired_node_executor_limit() -> int:
    raw = os.getenv("STORYFORGE_WORKFLOW_RETIRED_NODE_EXECUTOR_LIMIT")
    if raw is None:
        return DEFAULT_RETIRED_NODE_EXECUTOR_LIMIT
    try:
        parsed = int(raw)
    except ValueError:
        return DEFAULT_RETIRED_NODE_EXECUTOR_LIMIT
    return parsed if parsed >= 0 else DEFAULT_RETIRED_NODE_EXECUTOR_LIMIT


def _resolve_node_timeout_seconds(value: float | None) -> float:
    if value is not None and value > 0:
        return value
    configured = os.getenv("STORYFORGE_WORKFLOW_NODE_TIMEOUT_SECONDS")
    if configured:
        try:
            parsed = float(configured)
        except ValueError:
            return DEFAULT_NODE_TIMEOUT_SECONDS
        if parsed > 0:
            return parsed
    return DEFAULT_NODE_TIMEOUT_SECONDS
