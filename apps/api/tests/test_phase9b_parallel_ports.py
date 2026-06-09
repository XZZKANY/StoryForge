from __future__ import annotations

import threading
import time
from collections.abc import Mapping

from app.domains.book_runs.phase9b_parallel_ports import (
    NovelLoopResult,
    _memory_recall_chars_for_chapter,
    _SceneSelectQueryCounter,
    run_book_loop_with_thread_sessions,
    run_phase9b_real_llm_parallel,
)
from app.domains.book_runs.phase9b_real_llm_smoke import Phase9BRealLlmSmokePreflightError
from app.domains.books.models import Book, Chapter
from app.domains.model_runs.models import ModelRun
from app.domains.story_memory.schemas import MemoryAtom
from app.domains.story_memory.service import create_memory_atom, list_memory_atoms


class _TrackedSession:
    """替身 session 只记录生命周期，用于证明并发章节不复用同一实例。"""

    def __init__(self, name: str, events: list[tuple[str, str]]) -> None:
        self.name = name
        self._events = events

    def __enter__(self) -> _TrackedSession:
        self._events.append(("enter", self.name))
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self._events.append(("exit", self.name))


def test_parallel_book_loop_opens_independent_session_per_chapter() -> None:
    """并发章节执行必须为每章创建独立 session，并保留 BookLoop 并发事实指标。"""

    events: list[tuple[str, str]] = []
    seen_sessions: dict[int, str] = {}
    seen_threads: dict[int, int] = {}
    started = threading.Barrier(3)
    lock = threading.Lock()
    counter = 0

    def session_factory() -> _TrackedSession:
        nonlocal counter
        with lock:
            counter += 1
            name = f"session-{counter}"
        return _TrackedSession(name, events)

    def run_chapter(session: _TrackedSession, chapter_index: int) -> NovelLoopResult:
        with lock:
            seen_sessions[chapter_index] = session.name
            seen_threads[chapter_index] = threading.get_ident()
        started.wait(timeout=2)
        time.sleep(0.02)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index + 100,
            repair_patch_id=None,
            approved_scene_id=chapter_index + 200,
            token_usage=100 + chapter_index,
            elapsed_time_sec=1,
            cost_estimate=0.0,
        )

    result = run_book_loop_with_thread_sessions(
        book_run_id=1,
        book_id=2,
        blueprint_id=3,
        total_chapters=3,
        chapter_parallelism=3,
        session_factory=session_factory,
        run_chapter=run_chapter,
    )

    assert result.status == "completed"
    assert [item["chapter_index"] for item in result.progress["completed_chapters"]] == [1, 2, 3]
    assert result.progress["integration_metrics"]["concurrent_chapter_utilization"] > 0.6
    assert result.progress["integration_metrics"]["metric_scope"] == "workflow_book_loop_parallel_runtime_overlap"
    assert len(set(seen_sessions.values())) == 3
    assert len(set(seen_threads.values())) >= 2
    assert sorted(seen_sessions) == [1, 2, 3]
    assert sorted(name for event, name in events if event == "enter") == ["session-1", "session-2", "session-3"]
    assert sorted(name for event, name in events if event == "exit") == ["session-1", "session-2", "session-3"]


def test_parallel_book_loop_threads_consistency_barrier_to_workflow() -> None:
    """API 并发胶水必须把一致性屏障透传给 workflow BookLoop。"""

    class _ConflictReport:
        conflicts = [{"kind": "arc_stalled", "arc_id": "暗线A"}]

        @property
        def has_conflict(self) -> bool:
            return True

    events: list[tuple[str, str]] = []
    barrier_calls: list[tuple[int, int]] = []

    def session_factory() -> _TrackedSession:
        return _TrackedSession("session", events)

    def run_chapter(_session: _TrackedSession, chapter_index: int) -> NovelLoopResult:
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index + 100,
            repair_patch_id=None,
            approved_scene_id=chapter_index + 200,
            token_usage=100 + chapter_index,
            elapsed_time_sec=1,
            cost_estimate=0.0,
        )

    def consistency_barrier(chapter_index, _chapter_result, committed_chapters):
        barrier_calls.append((chapter_index, len(committed_chapters)))
        if chapter_index == 2:
            return _ConflictReport()
        return None

    result = run_book_loop_with_thread_sessions(
        book_run_id=1,
        book_id=2,
        blueprint_id=3,
        total_chapters=3,
        chapter_parallelism=3,
        session_factory=session_factory,
        run_chapter=run_chapter,
        consistency_barrier=consistency_barrier,
    )

    assert result.status == "awaiting_review"
    assert result.current_chapter_index == 2
    assert barrier_calls == [(1, 0), (2, 1)]
    assert result.progress["consistency_conflict"]["conflicts"][0]["kind"] == "arc_stalled"
    assert [item["chapter_index"] for item in result.progress["checkpoint"]] == [1]


def test_phase9b_memory_recall_chars_counts_relevant_recalled_atoms_only(session) -> None:
    """P2.5 预算指标应统计相关召回，而不是把所有 active 记忆都算进 prompt。"""

    book = Book(title="召回预算", status="draft", premise="验证相关记忆预算。")
    session.add(book)
    session.flush()
    chapter = Chapter(
        book_id=book.id,
        ordinal=4,
        title="灯塔检修",
        status="draft",
        summary="林岚争取灯塔维修窗口。",
        pov="林岚",
        location="灯塔",
    )
    session.add(chapter)
    session.commit()
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="relevant-linlan",
            novel_id=book.id,
            entity_type="character",
            entity_id="林岚",
            fact_type="status",
            value="左臂旧伤未愈。",
            source_ref="chapter:1",
            valid_from_chapter=1,
        ),
    )
    unrelated = create_memory_atom(
        session,
        MemoryAtom(
            memory_id="irrelevant-city",
            novel_id=book.id,
            entity_type="location",
            entity_id="远方城市",
            fact_type="rule",
            value="远方城市烟火庆典持续三天。",
            source_ref="chapter:1",
            valid_from_chapter=1,
        ),
    )

    recall_chars = _memory_recall_chars_for_chapter(session, book.id, chapter.ordinal)

    assert recall_chars > 0
    assert recall_chars < len(f"{unrelated.entity_id}：{unrelated.value}")


def test_parallel_book_loop_can_require_prior_commit_before_chapter_start() -> None:
    """Phase9B 胶水应能要求后续章节在前序提交后再启动，避免生成时缺前文。"""

    events: list[tuple[str, str]] = []
    committed_indexes: list[int] = []
    start_observations: dict[int, int] = {}
    lock = threading.Lock()

    def session_factory() -> _TrackedSession:
        return _TrackedSession("session", events)

    def run_chapter(_session: _TrackedSession, chapter_index: int) -> NovelLoopResult:
        with lock:
            start_observations[chapter_index] = len(committed_indexes)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index + 100,
            repair_patch_id=None,
            approved_scene_id=chapter_index + 200,
            token_usage=100 + chapter_index,
            elapsed_time_sec=1,
            cost_estimate=0.0,
        )

    def progress_callback(progress) -> None:
        with lock:
            committed_indexes.append(progress.current_chapter_index)

    result = run_book_loop_with_thread_sessions(
        book_run_id=1,
        book_id=2,
        blueprint_id=3,
        total_chapters=3,
        chapter_parallelism=3,
        session_factory=session_factory,
        run_chapter=run_chapter,
        progress_callback=progress_callback,
        require_prior_chapter_commit_before_start=True,
    )

    assert result.status == "completed"
    assert start_observations == {1: 0, 2: 1, 3: 2}
    assert result.progress["integration_metrics"]["dependency_mode"] == "prior_chapter_commit"


def test_phase9b_parallel_runner_uses_workflow_metrics_and_exports_audit(
    session,
    session_factory,
    monkeypatch,
) -> None:
    """并发真实 runner 应复用 phase9b 单章链路、独立 session，并导出真实 audit 指标。"""

    seen_session_ids: dict[int, int] = {}
    seen_thread_ids: dict[int, int] = {}
    lock = threading.Lock()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "parallel-test-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    def fake_generate(chapter_session, source: Mapping[str, str | None], chapter_index: int, chapter):
        assert source["STORYFORGE_LLM_API_KEY"] == "test-private-credential"
        with lock:
            seen_session_ids[chapter_index] = id(chapter_session)
            seen_thread_ids[chapter_index] = threading.get_ident()
        time.sleep(0.02)
        return {
            "prompt": f"第 {chapter_index} 章 prompt",
            "content": f"第 {chapter_index} 章并发正文。",
            "token_usage": 100 + chapter_index,
            "token_usage_source": "provider_usage",
            "latency_ms": 1000 + chapter_index,
        }

    def fake_judge_and_repair_loop(chapter_session, source, book_run, scene, scene_packet):
        return {
            "judge_report_id": 1000 + scene.id,
            "repair_patch_id": None,
            "repair_patch_ids": [],
            "repair_rounds": 0,
            "quality_score": 100,
            "quality_issues": [],
        }

    monkeypatch.setattr("app.domains.book_runs.phase9b_real_llm_smoke._generate_chapter", fake_generate)
    monkeypatch.setattr(
        "app.domains.book_runs.phase9b_real_llm_smoke._judge_and_repair_loop",
        fake_judge_and_repair_loop,
    )

    result = run_phase9b_real_llm_parallel(
        session,
        session_factory=session_factory,
        chapter_count=3,
        chapter_parallelism=3,
        token_budget=10000,
        target_word_count=3000,
        env=env,
    )

    assert result.book_run.status == "completed"
    assert result.book_run.current_chapter_index == 3
    assert result.chapter_count == 3
    assert result.markdown_artifact.name == "book.md"
    assert result.audit_artifact.name == "audit_report.json"
    completed = result.book_run.progress["completed_chapters"]
    assert [item["chapter_index"] for item in completed] == [1, 2, 3]
    assert [item["quality_score"] for item in completed] == [100, 100, 100]
    assert [item["generation_latency_ms"] for item in completed] == [1001, 1002, 1003]
    metrics = result.audit_artifact.payload["integration_metrics"]
    assert metrics["concurrent_chapter_utilization"] > 0.6
    assert metrics["arc_completion_rate"] >= 0.7
    assert metrics["memory_recall_budget_used"] > 0
    assert metrics["memory_recall_budget_scope"] == "phase9b_parallel_story_memory_recall"
    assert metrics["chapter_generation_time_p50"] == 1.002
    assert metrics["context_cache_hit_rate"] == 0.667
    progress_metrics = result.book_run.progress["integration_metrics"]
    assert progress_metrics["dependency_mode"] == "precommit_revision"
    assert progress_metrics["chapter_correction_count"] == 3
    assert progress_metrics["context_cache_hits"] == 2
    assert progress_metrics["context_cache_misses"] == 1
    assert completed[0]["memory_atom_ids"]
    assert completed[1]["memory_recall_chars"] > 0
    assert metrics["db_query_count_per_chapter"] >= 0
    assert progress_metrics["db_query_count_total"] >= 0
    assert progress_metrics["db_query_count_scope"] == "scene_business_join_select"
    assert sorted(seen_session_ids) == [1, 2, 3]
    assert sorted(seen_thread_ids) == [1, 2, 3]
    assert session.query(ModelRun).count() == 3
    assert "test-private-credential" not in str(result.audit_artifact.payload)


def test_phase9b_parallel_runner_defaults_to_precommit_revision_dependency(
    session,
    session_factory,
    monkeypatch,
) -> None:
    """真实 runner 默认采用提交前校正，最终稿生成时能看到前序提交。"""

    committed_before_generate: dict[int, int] = {}
    lock = threading.Lock()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "parallel-test-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    def fake_generate(chapter_session, source: Mapping[str, str | None], chapter_index: int, chapter):
        with lock:
            committed_before_generate[chapter_index] = chapter_session.query(ModelRun).count()
        return {
            "prompt": f"第 {chapter_index} 章 prompt",
            "content": f"第 {chapter_index} 章并发正文。",
            "token_usage": 100 + chapter_index,
            "token_usage_source": "provider_usage",
            "latency_ms": 1000 + chapter_index,
        }

    def fake_judge_and_repair_loop(chapter_session, source, book_run, scene, scene_packet):
        return {
            "judge_report_id": 1000 + scene.id,
            "repair_patch_id": None,
            "repair_patch_ids": [],
            "repair_rounds": 0,
            "quality_score": 100,
            "quality_issues": [],
        }

    monkeypatch.setattr("app.domains.book_runs.phase9b_real_llm_smoke._generate_chapter", fake_generate)
    monkeypatch.setattr(
        "app.domains.book_runs.phase9b_real_llm_smoke._judge_and_repair_loop",
        fake_judge_and_repair_loop,
    )

    result = run_phase9b_real_llm_parallel(
        session,
        session_factory=session_factory,
        chapter_count=3,
        chapter_parallelism=3,
        token_budget=10000,
        target_word_count=3000,
        env=env,
    )

    assert result.book_run.status == "completed"
    assert committed_before_generate == {1: 0, 2: 1, 3: 2}
    metrics = result.book_run.progress["integration_metrics"]
    assert metrics["dependency_mode"] == "precommit_revision"
    assert metrics["chapter_correction_count"] == 3


def test_phase9b_parallel_runner_prefetches_then_revises_before_commit(
    session,
    session_factory,
    monkeypatch,
) -> None:
    """P1.5 默认策略应先并发起草，再在提交前按已提交前文校正。"""

    draft_generate_observations: dict[int, int] = {}
    revision_generate_observations: list[tuple[int, int]] = []
    judge_observations: list[tuple[int, int]] = []
    lock = threading.Lock()
    first_wave_started = threading.Barrier(3)
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "parallel-test-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    def fake_generate(chapter_session, source: Mapping[str, str | None], chapter_index: int, chapter):
        with lock:
            model_run_count = chapter_session.query(ModelRun).count()
            if chapter_index not in draft_generate_observations:
                draft_generate_observations[chapter_index] = model_run_count
                should_wait_for_first_wave = True
            else:
                revision_generate_observations.append((chapter_index, model_run_count))
                should_wait_for_first_wave = False
        if should_wait_for_first_wave:
            first_wave_started.wait(timeout=2)
            time.sleep(0.02)
        return {
            "prompt": f"第 {chapter_index} 章 prompt",
            "content": f"第 {chapter_index} 章并发初稿。",
            "token_usage": 100 + chapter_index,
            "token_usage_source": "provider_usage",
            "latency_ms": 1000 + chapter_index,
        }

    def fake_judge_and_repair_loop(chapter_session, source, book_run, scene, scene_packet):
        with lock:
            judge_observations.append((scene.chapter.ordinal, chapter_session.query(ModelRun).count()))
        return {
            "judge_report_id": 1000 + scene.id,
            "repair_patch_id": None,
            "repair_patch_ids": [],
            "repair_rounds": 0,
            "quality_score": 100,
            "quality_issues": [],
        }

    monkeypatch.setattr("app.domains.book_runs.phase9b_real_llm_smoke._generate_chapter", fake_generate)
    monkeypatch.setattr(
        "app.domains.book_runs.phase9b_real_llm_smoke._judge_and_repair_loop",
        fake_judge_and_repair_loop,
    )

    result = run_phase9b_real_llm_parallel(
        session,
        session_factory=session_factory,
        chapter_count=3,
        chapter_parallelism=3,
        token_budget=10000,
        target_word_count=3000,
        env=env,
    )

    metrics = result.book_run.progress["integration_metrics"]
    assert result.book_run.status == "completed"
    assert draft_generate_observations == {1: 0, 2: 0, 3: 0}
    assert revision_generate_observations == [(1, 0), (2, 1), (3, 2)]
    assert judge_observations[-3:] == [(1, 1), (2, 2), (3, 3)]
    assert metrics["dependency_mode"] == "precommit_revision"
    assert metrics["chapter_correction_count"] == 3
    assert metrics["concurrent_chapter_utilization"] > 0.6


def test_phase9b_parallel_runner_extracts_and_recalls_story_memory(
    session,
    session_factory,
    monkeypatch,
) -> None:
    """P2 记忆链应写入章末记忆，并在后续章节记录召回字符数。"""

    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "parallel-test-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    def fake_generate(chapter_session, source: Mapping[str, str | None], chapter_index: int, chapter):
        return {
            "prompt": f"第 {chapter_index} 章 prompt",
            "content": f"第 {chapter_index} 章：林岚左臂旧伤未愈，灯塔信号继续逼近。",
            "token_usage": 100 + chapter_index,
            "token_usage_source": "provider_usage",
            "latency_ms": 1000 + chapter_index,
        }

    def fake_judge_and_repair_loop(chapter_session, source, book_run, scene, scene_packet):
        return {
            "judge_report_id": 1000 + scene.id,
            "repair_patch_id": None,
            "repair_patch_ids": [],
            "repair_rounds": 0,
            "quality_score": 100,
            "quality_issues": [],
        }

    monkeypatch.setattr("app.domains.book_runs.phase9b_real_llm_smoke._generate_chapter", fake_generate)
    monkeypatch.setattr(
        "app.domains.book_runs.phase9b_real_llm_smoke._judge_and_repair_loop",
        fake_judge_and_repair_loop,
    )

    result = run_phase9b_real_llm_parallel(
        session,
        session_factory=session_factory,
        chapter_count=3,
        chapter_parallelism=3,
        token_budget=10000,
        target_word_count=3000,
        env=env,
    )

    completed = result.book_run.progress["completed_chapters"]
    metrics = result.book_run.progress["integration_metrics"]
    atoms = list_memory_atoms(session, book_id=result.book_run.book_id)
    extracted_atoms = [atom for atom in atoms if atom.source_ref.startswith("chapter:")]

    assert result.book_run.status == "completed"
    assert extracted_atoms
    assert all(chapter["memory_atom_ids"] for chapter in completed)
    assert completed[0]["memory_recall_chars"] == 0
    assert completed[1]["memory_recall_chars"] > 0
    assert completed[2]["memory_recall_chars"] >= completed[1]["memory_recall_chars"]
    assert metrics["memory_recall_budget_used"] > 0
    assert metrics["memory_recall_budget_scope"] == "phase9b_parallel_story_memory_recall"


def test_phase9b_parallel_runner_enables_arc_barrier_from_blueprint(
    session,
    session_factory,
    monkeypatch,
) -> None:
    """真实并发 runner 应从 blueprint planning_summary 自动启用弧线一致性屏障。"""

    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "parallel-test-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    def fake_planning_arcs(_chapter_count: int) -> list[dict[str, object]]:
        return [
            {
                "arc_id": "payoff-only",
                "title": "只在第二章兑现的暗线",
                "target_chapters": [2],
                "payoff_chapter": 2,
            }
        ]

    def fake_generate(chapter_session, source: Mapping[str, str | None], chapter_index: int, chapter):
        return {
            "prompt": f"第 {chapter_index} 章 prompt",
            "content": f"第 {chapter_index} 章并发正文。",
            "token_usage": 100 + chapter_index,
            "token_usage_source": "provider_usage",
            "latency_ms": 1000 + chapter_index,
        }

    def fake_judge_and_repair_loop(chapter_session, source, book_run, scene, scene_packet):
        if scene.chapter.ordinal == 2:
            return {
                "judge_report_id": 2000 + scene.id,
                "repair_patch_id": None,
                "repair_patch_ids": [],
                "repair_rounds": 0,
                "quality_score": 50,
                "quality_issues": [{"kind": "forced_failure"}],
            }
        return {
            "judge_report_id": 1000 + scene.id,
            "repair_patch_id": None,
            "repair_patch_ids": [],
            "repair_rounds": 0,
            "quality_score": 100,
            "quality_issues": [],
        }

    monkeypatch.setattr("app.domains.book_runs.phase9b_real_llm_smoke._smoke_planning_arcs", fake_planning_arcs)
    monkeypatch.setattr("app.domains.book_runs.phase9b_real_llm_smoke._generate_chapter", fake_generate)
    monkeypatch.setattr(
        "app.domains.book_runs.phase9b_real_llm_smoke._judge_and_repair_loop",
        fake_judge_and_repair_loop,
    )

    result = run_phase9b_real_llm_parallel(
        session,
        session_factory=session_factory,
        chapter_count=2,
        chapter_parallelism=2,
        token_budget=10000,
        target_word_count=2400,
        env=env,
    )

    assert result.book_run.status == "awaiting_review"
    assert result.book_run.current_chapter_index == 2
    conflict = result.book_run.progress["consistency_conflict"]
    assert conflict["conflicts"][0]["kind"] == "arc_stalled"
    assert conflict["conflicts"][0]["arc_id"] == "payoff-only"
    assert result.markdown_artifact.name == "book_run_blocked.md"
    assert result.audit_artifact.name == "blocked_audit_report.json"
    assert result.audit_artifact.payload["progress"]["consistency_conflict"]["conflicts"][0]["arc_id"] == "payoff-only"


def test_scene_select_counter_only_counts_join_business_queries() -> None:
    """采集口径仅计数 JOIN scenes 业务查询，排除 ORM 写后回读与 lazy load。"""

    counter = _SceneSelectQueryCounter(bind=object())
    samples = [
        # 业务查询：BookContext._build、_build_recap_context、_book_id_for_scene 都长这样
        "SELECT chapters.ordinal, scenes.content FROM chapters JOIN scenes ON scenes.chapter_id = chapters.id WHERE chapters.book_id = ?",
        "SELECT chapters.book_id FROM chapters JOIN scenes ON scenes.chapter_id = chapters.id WHERE scenes.id = ?",
        '  SELECT * FROM "chapters" JOIN "scenes" ON "scenes".chapter_id = "chapters".id',
        # 非业务查询：session.refresh / lazy load
        "SELECT scenes.id, scenes.chapter_id, scenes.content FROM scenes WHERE scenes.id = ?",
        "SELECT scenes.id, scenes.chapter_id FROM scenes WHERE scenes.chapter_id IN (?, ?, ?)",
        # 非 SELECT
        "INSERT INTO scenes (chapter_id, content) VALUES (?, ?)",
        "UPDATE scenes SET status = ? WHERE id = ?",
        # SELECT 但不涉及 scenes
        "SELECT chapters.id FROM chapters WHERE chapters.book_id = ?",
    ]
    for statement in samples:
        counter._record(None, None, statement, None, None, None)
    metrics = counter.metrics(chapter_count=3)
    assert metrics["db_query_count_total"] == 3
    assert metrics["db_query_count_per_chapter"] == 1.0
    assert metrics["db_query_count_scope"] == "scene_business_join_select"


def test_phase9b_parallel_runner_requires_positive_parallelism(session, session_factory) -> None:
    """并发 runner 应拒绝非并发配置，避免误产串行证据。"""

    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "parallel-test-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    try:
        run_phase9b_real_llm_parallel(
            session,
            session_factory=session_factory,
            chapter_count=3,
            chapter_parallelism=1,
            token_budget=10000,
            env=env,
        )
    except Phase9BRealLlmSmokePreflightError as exc:
        assert "并发度必须大于 1" in str(exc)
    else:
        raise AssertionError("非并发配置应被前置拒绝。")
