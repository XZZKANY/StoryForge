from __future__ import annotations

from langgraph.types import Command

from storyforge_workflow import InMemoryWorkflowStore, create_generation_graph, initial_generation_state


def test_generation_graph_pauses_at_human_approval_and_records_checkpoints() -> None:
    """生成工作流按固定阶段推进，并在人工审批点暂停。"""

    store = InMemoryWorkflowStore()
    graph = create_generation_graph(store=store)
    thread_id = "thread-task-5"
    job_run_id = "job-task-5"
    config = {"configurable": {"thread_id": thread_id}}

    chunks = list(graph.stream(_state(thread_id, job_run_id), config))

    assert [next(iter(chunk)) for chunk in chunks] == [
        "book_director",
        "chapter_planner",
        "scene_beats",
        "draft_writer",
        "__interrupt__",
    ]
    draft_chunk = chunks[-2]["draft_writer"]
    assert draft_chunk["status_history"] == [
        "premise_received",
        "outline_created",
        "chapter_plan_created",
        "scene_beats_created",
        "draft_created",
    ]
    interrupt_value = chunks[-1]["__interrupt__"][0].value
    assert interrupt_value["question"] == "请审批当前草稿片段。"
    assert interrupt_value["thread_id"] == thread_id

    records = store.list_records(thread_id=thread_id)
    assert [record.current_node for record in records] == [
        "book_director",
        "scene_architect.chapter_plan",
        "scene_architect.scene_beats",
        "draft_writer",
    ]
    assert {record.thread_id for record in records} == {thread_id}
    assert {record.job_run_id for record in records} == {job_run_id}
    assert all(record.approval_status == "pending" for record in records)
    assert "premise" in records[0].input_summary
    assert "draft_excerpt" in records[-1].output_summary


def test_generation_graph_resumes_with_same_thread_id_and_command() -> None:
    """相同 thread_id 可用 Command(resume=...) 从中断点恢复。"""

    store = InMemoryWorkflowStore()
    graph = create_generation_graph(store=store)
    thread_id = "thread-resume"
    job_run_id = "job-resume"
    config = {"configurable": {"thread_id": thread_id}}

    first_chunks = list(graph.stream(_state(thread_id, job_run_id), config))
    assert "__interrupt__" in first_chunks[-1]

    resumed_chunks = list(
        graph.stream(
            Command(resume={"approved": True, "comment": "同意进入后续润色。"}),
            config,
        )
    )

    assert resumed_chunks == [
        {
            "human_approval": {
                "approval_status": "approved",
                "approval_response": {"approved": True, "comment": "同意进入后续润色。"},
                "current_node": "human_approval",
            }
        }
    ]
    final_state = graph.get_state(config).values
    assert final_state["approval_status"] == "approved"
    assert final_state["current_status"] == "draft_created"
    assert final_state["status_history"] == [
        "premise_received",
        "outline_created",
        "chapter_plan_created",
        "scene_beats_created",
        "draft_created",
    ]
    latest = store.latest_for(thread_id)
    assert latest is not None
    assert latest.current_node == "human_approval"
    assert latest.approval_status == "approved"
    assert latest.thread_id == thread_id
    assert latest.job_run_id == job_run_id


def _state(thread_id: str, job_run_id: str) -> dict:
    """构造确定性输入，不依赖外部服务或真实 LLM。"""

    return initial_generation_state(
        thread_id=thread_id,
        job_run_id=job_run_id,
        premise="远航舰队寻找新家园。",
        user_intent="突出角色强撑与谈判压力。",
        scene_packet={
            "chapter_title": "暗潮",
            "chapter_goal": "舰队抵达灯塔港并争取维修窗口。",
            "scene_goal": "林岚在港口谈判中争取维修窗口。",
            "protagonist": "林岚",
            "required_facts": ["左臂受伤", "灯塔信号每七分钟重复"],
        },
    )
