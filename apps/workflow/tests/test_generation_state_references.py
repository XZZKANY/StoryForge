from __future__ import annotations

from typing import get_type_hints

import storyforge_workflow.runtime as runtime_module
from storyforge_workflow.runtime import RuntimeCheckpointStore
from storyforge_workflow.state import GenerationState, checkpoint_reference_state, initial_generation_state


def test_generation_state_contract_exposes_references_not_large_payload_fields() -> None:
    """Workflow State 契约应优先暴露引用字段，避免 checkpoint 保存大对象。"""

    hints = get_type_hints(GenerationState)

    assert "scene_packet_id" in hints
    assert "compiled_context_id" in hints
    assert "model_run_id" in hints
    assert "draft_artifact_id" in hints
    assert "memory_atom_ids" in hints
    assert "timeline_event_ids" in hints
    assert "current_node" in hints
    assert "approval_status" in hints

    forbidden_fields = {
        "scene_packet",
        "compiled_context",
        "draft_excerpt",
        "chapter_plan",
        "book_strategy",
    }
    assert forbidden_fields.isdisjoint(hints)


def test_checkpoint_reference_state_removes_full_payloads_and_keeps_ids() -> None:
    """保存 checkpoint 前应裁掉全文，只留下可恢复引用。"""

    state = initial_generation_state(
        thread_id="thread-reference",
        job_run_id="job-reference",
        premise="远航舰队寻找新家园。",
        user_intent="突出角色强撑与谈判压力。",
        scene_packet_id=101,
        compiled_context_id="ctx_reference",
        model_run_id=501,
        draft_artifact_id=701,
        memory_atom_ids=[11, 12],
        timeline_event_ids=[21],
        scene_packet={"全文上下文": "不应进入 checkpoint"},
    )
    state["draft_excerpt"] = "完整草稿不应进入 checkpoint。"
    state["book_strategy"] = {"完整策略": "不应保存"}
    state["chapter_plan"] = {"完整计划": "不应保存"}

    checkpoint_state = checkpoint_reference_state(state)

    assert checkpoint_state["scene_packet_id"] == 101
    assert checkpoint_state["compiled_context_id"] == "ctx_reference"
    assert checkpoint_state["model_run_id"] == 501
    assert checkpoint_state["draft_artifact_id"] == 701
    assert checkpoint_state["memory_atom_ids"] == [11, 12]
    assert checkpoint_state["timeline_event_ids"] == [21]
    assert checkpoint_state["current_node"] == "premise_input"
    assert checkpoint_state["approval_status"] == "pending"
    assert "scene_packet" not in checkpoint_state
    assert "draft_excerpt" not in checkpoint_state
    assert "book_strategy" not in checkpoint_state
    assert "chapter_plan" not in checkpoint_state


def test_runtime_checkpoint_store_saves_reference_state_only() -> None:
    """运行时 checkpoint 仓库必须在边界处强制引用化。"""

    store = RuntimeCheckpointStore()
    store.save_state(
        "thread-reference-store",
        {
            "thread_id": "thread-reference-store",
            "job_run_id": "job-reference-store",
            "scene_packet_id": 202,
            "compiled_context_id": "ctx_store",
            "current_node": "draft_writer",
            "approval_status": "pending",
            "scene_packet": {"大对象": "禁止保存"},
            "draft_excerpt": "完整草稿禁止保存。",
        },
    )

    saved = store.load_state("thread-reference-store")

    assert saved is not None
    assert saved["scene_packet_id"] == 202
    assert saved["compiled_context_id"] == "ctx_store"
    assert saved["current_node"] == "draft_writer"
    assert "scene_packet" not in saved
    assert "draft_excerpt" not in saved


def test_runtime_checkpoint_store_persists_state_across_instances(tmp_path) -> None:
    """默认运行时 checkpoint 仓库必须落到 SQLite，而不是进程内字典。"""

    sqlite_path = tmp_path / "workflow-runtime.sqlite3"
    assert hasattr(runtime_module, "InMemoryRuntimeCheckpointStore")
    first_store = RuntimeCheckpointStore(sqlite_path=sqlite_path)
    first_store.record(
        thread_id="thread-sqlite",
        job_run_id="job-sqlite",
        current_node="draft_writer",
        summary="已保存到 SQLite。",
        approval_status="pending",
    )
    first_store.save_state(
        "thread-sqlite",
        {
            "thread_id": "thread-sqlite",
            "job_run_id": "job-sqlite",
            "scene_packet_id": 303,
            "compiled_context_id": "ctx_sqlite",
            "current_node": "draft_writer",
            "approval_status": "pending",
            "draft_excerpt": "完整草稿禁止进入持久化 checkpoint。",
        },
    )

    second_store = RuntimeCheckpointStore(sqlite_path=sqlite_path)
    latest = second_store.latest("thread-sqlite")
    saved = second_store.load_state("thread-sqlite")

    assert latest is not None
    assert latest.current_node == "draft_writer"
    assert latest.summary == "已保存到 SQLite。"
    assert saved is not None
    assert saved["scene_packet_id"] == 303
    assert saved["compiled_context_id"] == "ctx_sqlite"
    assert "draft_excerpt" not in saved
