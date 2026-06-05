from __future__ import annotations

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from storyforge_workflow.graph import create_generation_graph
from storyforge_workflow.persistence import InMemoryWorkflowStore
from storyforge_workflow.state import initial_generation_state


def _stub_llm(monkeypatch) -> None:
    """用测试替身固定节点输出，生产代码仍通过 provider client 调真实模型。"""

    responses = iter(
        [
            "灯塔远航\n舰队如何在旧伤与谈判压力中找到新家园\n克制、具画面感、重视连续性\n兑现迁徙史诗与个人代价",
            "暗潮\n林岚在港口谈判中争取维修窗口\n外部任务压力与角色隐秘状态互相挤压",
            "林岚压住左臂旧伤进入谈判。\n灯塔信号每七分钟重复一次，逼近维修窗口。\n港口代表提出代价，留下下一章疑问。",
            "林岚把左臂藏进披风，听见灯塔信号第七分钟再次回响。她没有解释伤势，只把维修窗口压进谈判桌。",
        ]
    )
    monkeypatch.setattr("storyforge_workflow.nodes.director.generate_text", lambda prompt, **kwargs: next(responses))
    monkeypatch.setattr("storyforge_workflow.nodes.scene_architect.generate_text", lambda prompt, **kwargs: next(responses))
    monkeypatch.setattr("storyforge_workflow.nodes.draft_writer.generate_text", lambda prompt, **kwargs: next(responses))


def test_generation_graph_pauses_at_human_approval_and_records_checkpoints(monkeypatch) -> None:
    """生成工作流按固定阶段推进，并在人工审批点暂停。"""

    monkeypatch.setenv("STORYFORGE_DRAFT_CRITIQUE_ENABLED", "0")
    _stub_llm(monkeypatch)
    store = InMemoryWorkflowStore()
    graph = create_generation_graph(store=store, checkpointer=InMemorySaver())
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
    assert "draft_artifact_id" in records[-1].output_summary
    assert "draft_preview_ref" in records[-1].output_summary


def test_generation_graph_resumes_with_same_thread_id_and_command(monkeypatch) -> None:
    """相同 thread_id 可用 Command(resume=...) 从中断点恢复。"""

    monkeypatch.setenv("STORYFORGE_DRAFT_CRITIQUE_ENABLED", "0")
    _stub_llm(monkeypatch)
    store = InMemoryWorkflowStore()
    graph = create_generation_graph(store=store, checkpointer=InMemorySaver())
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


def test_generation_graph_requires_explicit_checkpointer_for_local_tests() -> None:
    """图构建不应默认创建 InMemorySaver，生产入口必须显式传入持久化 checkpointer。"""

    with pytest.raises(ValueError, match="checkpointer"):
        create_generation_graph(store=InMemoryWorkflowStore())


def test_generation_graph_runs_critique_revision_loop(monkeypatch) -> None:
    """critique 环开启时：首稿被评出问题→reviser 改稿→二轮通过→暂停于审批。"""

    monkeypatch.setenv("STORYFORGE_DRAFT_CRITIQUE_ENABLED", "1")
    monkeypatch.setenv("STORYFORGE_DRAFT_MAX_REVISIONS", "2")

    planning = iter(
        [
            "灯塔远航\n舰队如何在旧伤与谈判压力中找到新家园\n克制、具画面感\n兑现迁徙史诗",
            "暗潮\n林岚在港口谈判中争取维修窗口\n外部任务压力与角色隐秘状态互相挤压",
            "林岚压住左臂旧伤进入谈判。\n灯塔信号每七分钟重复一次。\n港口代表提出代价。",
        ]
    )
    monkeypatch.setattr(
        "storyforge_workflow.nodes.director.generate_text",
        lambda prompt, **kwargs: next(planning),
    )
    monkeypatch.setattr(
        "storyforge_workflow.nodes.scene_architect.generate_text",
        lambda prompt, **kwargs: next(planning),
    )

    calls: list[str] = []

    def fake_draft_writer_llm(prompt: str, **kwargs) -> str:
        # 用 prompt 段落标题区分 draft / critique / revision 三种调用。
        if "待审正文" in prompt:
            calls.append("critique")
            # 第一次评审报问题，第二次（修订后）通过。
            critique_calls = [c for c in calls if c == "critique"]
            if len(critique_calls) == 1:
                return "文笔｜他很愤怒｜用动作呈现情绪"
            return "通过"
        if "原稿" in prompt and "评审问题清单" in prompt:
            calls.append("revision")
            return "林岚把左臂藏进披风，指节泛白，把维修窗口压进谈判桌。"
        calls.append("draft")
        return "林岚很愤怒地进入谈判。"

    monkeypatch.setattr(
        "storyforge_workflow.nodes.draft_writer.generate_text",
        fake_draft_writer_llm,
    )

    store = InMemoryWorkflowStore()
    graph = create_generation_graph(store=store, checkpointer=InMemorySaver())
    thread_id = "thread-critique"
    job_run_id = "job-critique"
    config = {"configurable": {"thread_id": thread_id}}

    chunks = list(graph.stream(_state(thread_id, job_run_id), config))
    visited = [next(iter(chunk)) for chunk in chunks]

    assert visited == [
        "book_director",
        "chapter_planner",
        "scene_beats",
        "draft_writer",
        "draft_critic",
        "draft_reviser",
        "draft_critic",
        "__interrupt__",
    ]
    assert calls == ["draft", "critique", "revision", "critique"]

    state_values = graph.get_state(config).values
    assert state_values["draft_revision_round"] == 1
    assert state_values["draft_preview_ref"].startswith("林岚把左臂藏进披风")
    assert state_values["draft_issues"] == []


def test_generation_graph_caps_revisions_at_max(monkeypatch) -> None:
    """critic 持续报问题时，重写轮数被 STORYFORGE_DRAFT_MAX_REVISIONS 限制后转入审批。"""

    monkeypatch.setenv("STORYFORGE_DRAFT_CRITIQUE_ENABLED", "1")
    monkeypatch.setenv("STORYFORGE_DRAFT_MAX_REVISIONS", "1")

    planning = iter(
        [
            "灯塔远航\n核心问题\n语气\n承诺",
            "暗潮\n章节目标\n冲突轴",
            "beat1\nbeat2\nbeat3",
        ]
    )
    monkeypatch.setattr(
        "storyforge_workflow.nodes.director.generate_text",
        lambda prompt, **kwargs: next(planning),
    )
    monkeypatch.setattr(
        "storyforge_workflow.nodes.scene_architect.generate_text",
        lambda prompt, **kwargs: next(planning),
    )

    visited_nodes: list[str] = []

    def always_failing(prompt: str, **kwargs) -> str:
        if "待审正文" in prompt:
            visited_nodes.append("critique")
            return "文笔｜仍有问题｜继续修"
        if "原稿" in prompt and "评审问题清单" in prompt:
            visited_nodes.append("revision")
            return "改了一版仍有问题的正文。"
        visited_nodes.append("draft")
        return "初稿正文。"

    monkeypatch.setattr(
        "storyforge_workflow.nodes.draft_writer.generate_text",
        always_failing,
    )

    store = InMemoryWorkflowStore()
    graph = create_generation_graph(store=store, checkpointer=InMemorySaver())
    thread_id = "thread-cap"
    job_run_id = "job-cap"
    config = {"configurable": {"thread_id": thread_id}}

    chunks = list(graph.stream(_state(thread_id, job_run_id), config))
    visited = [next(iter(chunk)) for chunk in chunks]

    # max=1：draft → critic(报问题) → reviser → critic(仍报问题，但已达上限) → approval
    assert visited == [
        "book_director",
        "chapter_planner",
        "scene_beats",
        "draft_writer",
        "draft_critic",
        "draft_reviser",
        "draft_critic",
        "__interrupt__",
    ]
    assert graph.get_state(config).values["draft_revision_round"] == 1


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
