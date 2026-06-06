from __future__ import annotations

import sqlite3

import pytest

from storyforge_workflow.runtime import (
    InMemoryWorkflowLifecycleStore,
    RuntimeCheckpointStore,
    WorkflowFailureKind,
    WorkflowLifecycleStatus,
)


def test_workflow_lifecycle_records_start_approval_and_completed_sequence() -> None:
    """??????????????????????"""

    ticks = iter([1000, 1100, 1200, 1300])
    store = InMemoryWorkflowLifecycleStore(clock_ms=lambda: next(ticks))

    store.record(
        thread_id="thread-1",
        job_run_id="job-1",
        status=WorkflowLifecycleStatus.QUEUED,
        current_node="runtime_start",
        message="?????",
    )
    store.record(
        thread_id="thread-1",
        job_run_id="job-1",
        status=WorkflowLifecycleStatus.PROVIDER_RUNNING,
        current_node="provider_execution",
        message="provider ???",
    )
    store.record(
        thread_id="thread-1",
        job_run_id="job-1",
        status=WorkflowLifecycleStatus.APPROVAL_WAITING,
        current_node="human_approval",
        message="??????",
    )
    store.record(
        thread_id="thread-1",
        job_run_id="job-1",
        status=WorkflowLifecycleStatus.COMPLETED,
        current_node="human_approval",
        message="????",
    )

    events = store.list_events("thread-1")
    assert [event.status for event in events] == [
        "queued",
        "provider_running",
        "approval_waiting",
        "completed",
    ]
    assert [event.created_at_ms for event in events] == [1000, 1100, 1200, 1300]
    assert events[-1].current_node == "human_approval"
    assert events[-1].failure_kind is None
    assert events[-1].recoverable is None
    assert store.latest("thread-1") == events[-1]


def test_workflow_lifecycle_records_provider_recoverable_failure() -> None:
    """provider ?????????????????????????"""

    store = InMemoryWorkflowLifecycleStore(clock_ms=lambda: 2000)

    event = store.record_failure(
        thread_id="thread-1",
        job_run_id="job-1",
        current_node="provider_execution",
        message="provider timeout",
        failure_kind=WorkflowFailureKind.PROVIDER_TIMEOUT,
        recoverable=True,
    )

    assert event.status == "recoverable_failed"
    assert event.failure_kind == "provider_timeout"
    assert event.message == "provider timeout"
    assert event.current_node == "provider_execution"
    assert event.recoverable is True
    assert event.created_at_ms == 2000


def test_runtime_checkpoint_store_lists_incomplete_workflows_for_startup_resume(tmp_path) -> None:
    """启动时应能从 SQLite 找到未完成 workflow，并提供最后 checkpoint。"""

    sqlite_path = tmp_path / "workflow-runtime.sqlite3"
    store = RuntimeCheckpointStore(sqlite_path=sqlite_path)
    store.save_state(
        "thread-pending",
        {
            "thread_id": "thread-pending",
            "job_run_id": "job-pending",
            "current_node": "draft_writer",
            "approval_status": "pending",
            "scene_packet_id": 401,
        },
    )
    store.save_state(
        "thread-approved",
        {
            "thread_id": "thread-approved",
            "job_run_id": "job-approved",
            "current_node": "human_approval",
            "approval_status": "approved",
            "scene_packet_id": 402,
        },
    )

    restarted_store = RuntimeCheckpointStore(sqlite_path=sqlite_path)
    incomplete = restarted_store.list_incomplete_workflows()

    assert [snapshot.thread_id for snapshot in incomplete] == ["thread-pending"]
    assert incomplete[0].job_run_id == "job-pending"
    assert incomplete[0].current_node == "draft_writer"
    assert incomplete[0].state["scene_packet_id"] == 401


def test_runtime_checkpoint_store_reuses_sqlite_connection(monkeypatch, tmp_path) -> None:
    """同一个 checkpoint store 应复用 SQLite 连接，避免每次读写都重新建连。"""

    sqlite_path = tmp_path / "workflow-runtime.sqlite3"
    real_connect = sqlite3.connect
    opened_paths: list[str] = []

    def counting_connect(*args, **kwargs):
        opened_paths.append(str(args[0]))
        return real_connect(*args, **kwargs)

    monkeypatch.setattr("storyforge_workflow.runtime.checkpoints.sqlite3.connect", counting_connect)
    store = RuntimeCheckpointStore(sqlite_path=sqlite_path)

    try:
        store.record(
            thread_id="thread-1",
            job_run_id="job-1",
            current_node="draft_writer",
            summary="摘要",
            approval_status="pending",
        )
        store.save_state(
            "thread-1",
            {
                "thread_id": "thread-1",
                "job_run_id": "job-1",
                "current_node": "draft_writer",
                "approval_status": "pending",
            },
        )
        assert store.latest("thread-1") is not None
        assert store.list_state_snapshots("thread-1")
    finally:
        store.close()

    assert opened_paths == [str(sqlite_path)]


def test_runtime_checkpoint_store_configures_sqlite_wal(tmp_path) -> None:
    """SQLite checkpoint 应启用 WAL 和较低同步级别，降低频繁快照写入延迟。"""

    sqlite_path = tmp_path / "workflow-runtime.sqlite3"
    store = RuntimeCheckpointStore(sqlite_path=sqlite_path)

    try:
        with store._connect() as connection:
            journal_mode = connection.execute("PRAGMA journal_mode").fetchone()[0]
            synchronous = connection.execute("PRAGMA synchronous").fetchone()[0]
            busy_timeout = connection.execute("PRAGMA busy_timeout").fetchone()[0]
    finally:
        store.close()

    assert str(journal_mode).lower() == "wal"
    assert int(synchronous) <= 1
    assert int(busy_timeout) >= 1000


def test_runtime_checkpoint_store_write_behind_defers_disk_write_until_read(monkeypatch, tmp_path) -> None:
    """write-behind 模式下 save_state 应先进内存缓冲，读路径再刷盘保持一致性。"""

    sqlite_path = tmp_path / "workflow-runtime.sqlite3"
    monkeypatch.setenv("STORYFORGE_CHECKPOINT_WRITE_BEHIND", "1")
    store = RuntimeCheckpointStore(sqlite_path=sqlite_path)

    try:
        store.save_state(
            "thread-buffered",
            {
                "thread_id": "thread-buffered",
                "job_run_id": "job-buffered",
                "current_node": "draft_writer",
                "approval_status": "pending",
            },
        )
        with store._connect() as connection:
            assert connection.execute("SELECT COUNT(*) FROM runtime_states").fetchone()[0] == 0

        loaded = store.load_state("thread-buffered")

        assert loaded is not None
        assert loaded["current_node"] == "draft_writer"
        with store._connect() as connection:
            assert connection.execute("SELECT COUNT(*) FROM runtime_states").fetchone()[0] == 1
            assert connection.execute("SELECT COUNT(*) FROM runtime_state_snapshots").fetchone()[0] == 1
    finally:
        store.close()


def test_runtime_checkpoint_store_write_behind_flushes_latest_state_on_close(monkeypatch, tmp_path) -> None:
    """关闭 store 前必须刷出同一线程最后状态，避免 worker 退出丢 checkpoint。"""

    sqlite_path = tmp_path / "workflow-runtime.sqlite3"
    monkeypatch.setenv("STORYFORGE_CHECKPOINT_WRITE_BEHIND", "1")
    store = RuntimeCheckpointStore(sqlite_path=sqlite_path)
    store.save_state(
        "thread-close",
        {
            "thread_id": "thread-close",
            "job_run_id": "job-close",
            "current_node": "scene_architect",
            "approval_status": "pending",
        },
    )
    store.save_state(
        "thread-close",
        {
            "thread_id": "thread-close",
            "job_run_id": "job-close",
            "current_node": "human_approval",
            "approval_status": "approved",
        },
    )

    store.close()
    restarted_store = RuntimeCheckpointStore(sqlite_path=sqlite_path)
    try:
        loaded = restarted_store.load_state("thread-close")
        snapshots = restarted_store.list_state_snapshots("thread-close")
    finally:
        restarted_store.close()

    assert loaded is not None
    assert loaded["current_node"] == "human_approval"
    assert loaded["approval_status"] == "approved"
    assert [snapshot.current_node for snapshot in snapshots] == ["human_approval"]


def test_runtime_checkpoint_store_discards_broken_sqlite_connection_for_next_operation(tmp_path) -> None:
    """SQLite 连接进入坏状态后，下一次操作应丢弃旧连接并重新连接。"""

    sqlite_path = tmp_path / "workflow-runtime.sqlite3"
    store = RuntimeCheckpointStore(sqlite_path=sqlite_path)
    store.record(
        thread_id="thread-1",
        job_run_id="job-1",
        current_node="draft_writer",
        summary="摘要",
        approval_status="pending",
    )
    assert store._connection is not None
    store._connection.close()

    with pytest.raises(sqlite3.ProgrammingError):
        store.latest("thread-1")

    assert store.latest("thread-1") is not None
