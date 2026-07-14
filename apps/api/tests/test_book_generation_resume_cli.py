from __future__ import annotations

import json
import subprocess
import sys
from http.server import HTTPServer
from io import StringIO
from pathlib import Path
from threading import Thread
from types import SimpleNamespace

import pytest
from book_generation_test_support import (
    _BookGenerationChatHandler,
    _draft_requests,
    _local_provider_base_url,
)
from sqlalchemy import inspect
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.common.metrics import book_generation_failure_count_total
from app.domains.book_runs.book_generation import (
    BookGenerationError,
    _prior_chapters_recap,
    main,
    resume_book_generation,
    run_book_generation,
)
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book, Chapter, Scene
from app.domains.model_runs.models import ModelRun


def test_book_generation_resume_continues_after_existing_approved_chapters(session: Session) -> None:
    """断点续跑应复用已批准章节，只从下一章继续生成并导出完整证据。"""

    _BookGenerationChatHandler.requests = []
    server = HTTPServer(("127.0.0.1", 0), _BookGenerationChatHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": _local_provider_base_url(server.server_port),
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }
    import os

    old_env = {key: os.environ.get(key) for key in env}
    os.environ.update(env)
    try:
        partial = run_book_generation(
            session,
            chapter_count=2,
            token_budget=10000,
            target_word_count=3000,
            max_chapter_count=4,
            env=env,
        )
        partial.book_run.status = "running"
        partial.book_run.total_chapters = 4
        partial.book_run.chapter_budget = 4
        partial.book_run.progress = {"completed_chapters": []}
        for chapter in session.query(Chapter).order_by(Chapter.ordinal).all():
            chapter.blueprint_id = partial.book_run.blueprint_id
        session.commit()

        for ordinal in (3, 4):
            session.add(
                Chapter(
                    book_id=partial.book_run.book_id,
                    blueprint_id=partial.book_run.blueprint_id,
                    ordinal=ordinal,
                    title=f"真实生成 {ordinal}",
                    status="planned",
                    summary=f"第 {ordinal} 章继续推进调查。",
                    required_beats=[],
                )
            )
        session.commit()
        _BookGenerationChatHandler.requests = []

        result = resume_book_generation(
            session,
            book_run_id=partial.book_run.id,
            chapter_count=4,
            token_budget=10000,
            target_word_count=3000,
            max_chapter_count=4,
            env=env,
        )
    finally:
        server.shutdown()
        thread.join(timeout=2)
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    assert result.book_run.status == "completed"
    assert result.book_run.current_chapter_index == 4
    assert result.book_run.total_chapters == 4
    assert len(result.book_run.progress["completed_chapters"]) == 4
    assert [item["chapter_index"] for item in result.book_run.progress["completed_chapters"]] == [1, 2, 3, 4]
    assert [item["quality_score"] for item in result.book_run.progress["completed_chapters"][:2]] == [100, 100]
    assert session.query(ModelRun).count() == 4
    assert len(_draft_requests()) == 2
    assert "第 3 章" in str(result.markdown_artifact.payload)
    assert "第 4 章" in str(result.markdown_artifact.payload)


class _FakeSession:
    def __enter__(self) -> str:
        return "fake-session"

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        return None


def _seed_recap_chapters(session: Session, *, count: int, body_chars: int) -> int:
    book = Book(title="recap", status="draft", premise="验证有界 recap。")
    session.add(book)
    session.commit()
    session.refresh(book)
    for ordinal in range(1, count + 1):
        chapter = Chapter(
            book_id=book.id,
            ordinal=ordinal,
            title=f"第{ordinal}章",
            status="approved",
            summary=f"第{ordinal}章梗概：林岚推进调查到阶段{ordinal}。",
        )
        session.add(chapter)
        session.commit()
        session.refresh(chapter)
        scene = Scene(
            chapter_id=chapter.id,
            ordinal=1,
            title=f"第{ordinal}章正文",
            status="approved",
            content=f"CH{ordinal}_BODY_" + ("正" * body_chars),
        )
        session.add(scene)
    session.commit()
    return book.id


def test_prior_chapters_recap_is_bounded_and_keeps_recent_full_text(session: Session) -> None:
    """有界 recap：最近 N 章给完整正文，更早章节只出梗概，总长受上限约束。"""

    book_id = _seed_recap_chapters(session, count=5, body_chars=2000)

    # 为第 6 章构建上文（前 5 章已批准）。
    recap = _prior_chapters_recap(session, book_id, ordinal=6, full_chapters=2, max_chars=6000)
    assert recap is not None
    assert len(recap) <= 6000

    # 最近 2 章（第 4、5 章）正文必须在内。
    assert "CH5_BODY_" in recap
    assert "CH4_BODY_" in recap
    # 更早章节（第 1-3 章）只出梗概，不出完整正文。
    assert "CH3_BODY_" not in recap
    assert "CH1_BODY_" not in recap
    assert "前情提要" in recap
    assert "第3章梗概" in recap


def test_prior_chapters_recap_length_stays_bounded_as_chapters_grow(session: Session) -> None:
    """章数从 5 增到 20 时，recap 长度仍受同一上限约束，不随章数膨胀。"""

    book_id = _seed_recap_chapters(session, count=20, body_chars=2000)
    recap = _prior_chapters_recap(session, book_id, ordinal=21, full_chapters=2, max_chars=6000)
    assert recap is not None
    assert len(recap) <= 6000


def test_prior_chapters_recap_returns_none_for_first_chapter(session: Session) -> None:
    book_id = _seed_recap_chapters(session, count=3, body_chars=50)
    assert _prior_chapters_recap(session, book_id, ordinal=1) is None



def test_book_generation_cli_prints_summary_without_secret() -> None:
    """CLI 入口应输出可粘贴到验证报告的摘要，且不能泄露密钥。"""

    output = StringIO()
    error = StringIO()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    def runner(
        session: str,
        *,
        chapter_count: int,
        token_budget: int,
        target_word_count: int,
        chapter_word_count_min: int,
        chapter_word_count_max: int,
        max_chapter_count: int,
        env: dict[str, str],
    ):
        assert session == "fake-session"
        assert chapter_count == 10
        assert token_budget == 1000
        assert target_word_count == 50000
        assert chapter_word_count_min == 3000
        assert chapter_word_count_max == 5000
        assert max_chapter_count == 30
        assert env["STORYFORGE_LLM_API_KEY"] == "test-private-credential"
        return SimpleNamespace(
            book_run=SimpleNamespace(id=7, status="completed", tokens_used=323, estimated_cost=0.0),
            markdown_artifact=SimpleNamespace(id=8, name="book.md"),
            audit_artifact=SimpleNamespace(id=9, name="audit_report.json"),
            chapter_count=10,
        )

    exit_code = main(
        [
            "--chapter-count",
            "10",
            "--token-budget",
            "1000",
            "--target-word-count",
            "50000",
            "--chapter-word-count-min",
            "3000",
            "--chapter-word-count-max",
            "5000",
        ],
        session_factory=_FakeSession,
        runner=runner,
        output=output,
        error=error,
        env=env,
    )

    assert exit_code == 0
    summary = json.loads(output.getvalue())
    assert summary == {
        "book_run_id": 7,
        "status": "completed",
        "chapter_count": 10,
        "tokens_used": 323,
        "estimated_cost": 0.0,
        "markdown_artifact_id": 8,
        "markdown_artifact_name": "book.md",
        "audit_artifact_id": 9,
        "audit_artifact_name": "audit_report.json",
    }
    assert error.getvalue() == ""
    assert "test-private-credential" not in output.getvalue()


def test_book_generation_cli_allows_q9_chapter_band_with_parameterized_cap() -> None:
    """Q9 16-18 章长跑不应被旧 10 章 CLI 上限卡住；上限需显式可配。"""

    output = StringIO()
    error = StringIO()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    def runner(
        session: str,
        *,
        chapter_count: int,
        token_budget: int,
        target_word_count: int,
        chapter_word_count_min: int,
        chapter_word_count_max: int,
        max_chapter_count: int,
        env: dict[str, str],
    ):
        assert session == "fake-session"
        assert chapter_count == 18
        assert token_budget == 200000
        assert target_word_count == 40000
        assert chapter_word_count_min == 2000
        assert chapter_word_count_max == 2500
        assert max_chapter_count == 18
        assert env["STORYFORGE_LLM_API_KEY"] == "test-private-credential"
        return SimpleNamespace(
            book_run=SimpleNamespace(id=18, status="completed", tokens_used=1000, estimated_cost=0.0),
            markdown_artifact=SimpleNamespace(id=19, name="book.md"),
            audit_artifact=SimpleNamespace(id=20, name="audit_report.json"),
            chapter_count=18,
        )

    exit_code = main(
        [
            "--chapter-count",
            "18",
            "--token-budget",
            "200000",
            "--target-word-count",
            "40000",
            "--chapter-word-count-min",
            "2000",
            "--chapter-word-count-max",
            "2500",
            "--max-chapter-count",
            "18",
        ],
        session_factory=_FakeSession,
        runner=runner,
        output=output,
        error=error,
        env=env,
    )

    assert exit_code == 0
    assert error.getvalue() == ""
    assert json.loads(output.getvalue())["chapter_count"] == 18


def test_book_generation_cli_writes_redacted_summary_file(tmp_path: Path) -> None:
    """CLI 应写入脱敏 summary.json，供真实 smoke 产物验收。"""

    output = StringIO()
    error = StringIO()
    summary_path = tmp_path / "summary.json"
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }
    book_md = (
        "---\n"
        "book_run_id: 11\n"
        "---\n\n"
        "# \u6d4b\u8bd5\u4e66\n\n"
        "## \u7b2c 1 \u7ae0 \u8d77\u70b9\n\n"
        "\u7b2c\u4e00\u7ae0\u6b63\u6587\n\n"
        "## \u7b2c 2 \u7ae0 \u8f6c\u6298\n\n"
        "\u7b2c\u4e8c\u7ae0\u66f4\u957f\u6b63\u6587"
    )

    def runner(
        session: str,
        *,
        chapter_count: int,
        token_budget: int,
        target_word_count: int,
        chapter_word_count_min: int,
        chapter_word_count_max: int,
        max_chapter_count: int,
        env: dict[str, str],
    ):
        assert session == "fake-session"
        assert chapter_count == 2
        assert token_budget == 60000
        assert target_word_count == 1200
        assert chapter_word_count_min == 600
        assert chapter_word_count_max == 1600
        assert max_chapter_count == 30
        assert env["STORYFORGE_LLM_API_KEY"] == "test-private-credential"
        return SimpleNamespace(
            book_run=SimpleNamespace(
                id=11,
                status="completed",
                tokens_used=456,
                estimated_cost=0.0,
                progress={
                    "completed_chapters": [
                        {
                            "chapter_index": 1,
                            "token_usage": 200,
                            "quality_score": 92,
                            "quality_issues": [],
                            "elapsed_time_sec": 17,
                            "repair_rounds": 0,
                            "story_state_changes_source": "tool_call",
                            "story_state_tool_call_count": 1,
                        },
                        {
                            "chapter_index": 2,
                            "token_usage": 256,
                            "quality_score": 88,
                            "quality_issues": [{"summary": "需人工复核"}],
                            "elapsed_time_sec": 23,
                            "repair_rounds": 1,
                            "story_state_changes_source": "json_block",
                            "story_state_tool_call_count": 0,
                        },
                    ],
                    "budget": {"tokens_used": 456, "estimated_cost": 0.0, "elapsed_time_sec": 17},
                },
            ),
            markdown_artifact=SimpleNamespace(id=12, name="book.md", payload={"content": book_md}),
            audit_artifact=SimpleNamespace(
                id=13,
                name="audit_report.json",
                payload={
                    "chapters": [{"chapter_index": 1}, {"chapter_index": 2}],
                    "quality_summary": {"issue_count": 1},
                    "integration_metrics": {
                        "context_cache_hit_rate": 0.96,
                        "memory_recall_budget_used": 7999,
                        "arc_completion_rate": 0.71,
                        "db_query_count_per_chapter": 3,
                        "chapter_generation_time_p50": 19,
                        "concurrent_chapter_utilization": 0.61,
                    },
                },
            ),
            chapter_count=2,
        )

    exit_code = main(
        [
            "--chapter-count",
            "2",
            "--token-budget",
            "60000",
            "--target-word-count",
            "1200",
            "--chapter-word-count-min",
            "600",
            "--chapter-word-count-max",
            "1600",
            "--summary-output",
            str(summary_path),
        ],
        session_factory=_FakeSession,
        runner=runner,
        output=output,
        error=error,
        env=env,
    )

    assert exit_code == 0
    assert error.getvalue() == ""
    assert summary_path.exists()
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["mode"] == "real_llm_smoke"
    assert summary["book_run_id"] == 11
    assert summary["book_run_status"] == "completed"
    assert summary["target_chapter_count"] == 2
    assert summary["actual_chapter_count"] == 2
    assert summary["target_word_count"] == 1200
    assert summary["chapter_word_count_min"] == 600
    assert summary["chapter_word_count_max"] == 1600
    assert summary["tokens_used"] == 456
    assert summary["estimated_cost"] == 0.0
    assert summary["actual_total_chars"] == len(book_md)
    assert summary["per_chapter_char_counts"] == [
        {"chapter_index": 1, "char_count": len("第一章正文")},
        {"chapter_index": 2, "char_count": len("第二章更长正文")},
    ]
    assert summary["markdown_artifact_id"] == 12
    assert summary["audit_artifact_id"] == 13
    assert [
        {
            key: metric[key]
            for key in (
                "chapter_index",
                "token_usage",
                "quality_score",
                "quality_issue_count",
                "elapsed_time_sec",
                "repair_rounds",
                "story_state_changes_source",
                "story_state_tool_call_count",
            )
        }
        for metric in summary["per_chapter_metrics"]
    ] == [
        {
            "chapter_index": 1,
            "token_usage": 200,
            "quality_score": 92,
            "quality_issue_count": 0,
            "elapsed_time_sec": 17,
            "repair_rounds": 0,
            "story_state_changes_source": "tool_call",
            "story_state_tool_call_count": 1,
        },
        {
            "chapter_index": 2,
            "token_usage": 256,
            "quality_score": 88,
            "quality_issue_count": 1,
            "elapsed_time_sec": 23,
            "repair_rounds": 1,
            "story_state_changes_source": "json_block",
            "story_state_tool_call_count": 0,
        },
    ]
    assert summary["prompt_tokens_used"] == 0
    assert summary["completion_tokens_used"] == 0
    assert summary["cost_breakdown"]["currency"] == "CNY"
    assert summary["failure_count"] == 0
    assert summary["repair_round_count"] == 1
    assert summary["artifact_hashes"]["book_md_sha256"]
    assert summary["artifact_hashes"]["audit_report_sha256"]
    assert summary["integration_metrics"] == {
        "context_cache_hit_rate": 0.96,
        "memory_recall_budget_used": 7999,
        "arc_completion_rate": 0.71,
        "db_query_count_per_chapter": 3,
        "chapter_generation_time_p50": 19,
        "concurrent_chapter_utilization": 0.61,
    }
    serialized = json.dumps(summary, ensure_ascii=False)
    assert "test-private-credential" not in serialized
    assert "provider.test" not in serialized


def test_book_generation_cli_rejects_non_positive_target_word_count() -> None:
    """CLI 应在会话创建前拒绝非正数总字数目标。"""

    output = StringIO()
    error = StringIO()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    def session_factory() -> _FakeSession:
        raise AssertionError("参数校验失败时不应创建数据库会话。")

    exit_code = main(
        ["--chapter-count", "10", "--token-budget", "1000", "--target-word-count", "-1"],
        session_factory=session_factory,
        output=output,
        error=error,
        env=env,
    )

    assert exit_code == 2
    assert output.getvalue() == ""
    assert "target_word_count" in error.getvalue()
    assert "test-private-credential" not in error.getvalue()


def test_book_generation_module_registers_relationship_models_for_direct_cli() -> None:
    """直接导入 CLI 模块后应能配置 mapper，覆盖真实命令行入口路径。"""

    script = (
        "from sqlalchemy.orm import configure_mappers; "
        "import app.domains.book_runs.book_generation; "
        "configure_mappers()"
    )
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, check=False)

    assert result.returncode == 0, result.stderr




def test_book_generation_persistent_schema_contains_workspace_columns(engine) -> None:
    """持久化迁移路径需要包含工作区表和 books.workspace_id，匹配真实 CLI 使用的 ORM 模型。"""

    inspector = inspect(engine)

    assert "workspaces" in inspector.get_table_names()
    book_columns = {column["name"] for column in inspector.get_columns("books")}
    assert "workspace_id" in book_columns


def test_book_generation_failure_increments_prometheus_counter(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """生成章节失败时应在 /metrics 可观测 failure_count，而不是只写 BookRun progress。"""

    import app.domains.book_runs.book_generation as generation

    failure_metric_before = book_generation_failure_count_total._value.get()

    def _fail_generation(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise BookGenerationError("provider timeout")

    monkeypatch.setattr(generation, "_generate_chapter", _fail_generation)
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "http://127.0.0.1:1/v1",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    with pytest.raises(BookGenerationError, match="第 1 章失败"):
        run_book_generation(session, chapter_count=2, token_budget=1000, env=env)

    book_run = session.query(BookRun).one()
    assert book_run.status == "failed"
    assert book_run.progress["failure"]["chapter_index"] == 1
    assert book_generation_failure_count_total._value.get() == failure_metric_before + 1


def test_book_generation_interrupt_marks_paused_not_orphan_running(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """生成期间被 Ctrl-C / SystemExit 中断时，BookRun 应落为 paused_by_user，而非孤儿 running。"""

    import app.domains.book_runs.book_generation as generation

    def _interrupt(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise KeyboardInterrupt

    monkeypatch.setattr(generation, "_generate_chapter", _interrupt)
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "http://127.0.0.1:1/v1",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    with pytest.raises(KeyboardInterrupt):
        run_book_generation(session, chapter_count=3, token_budget=1000, env=env)

    book_run = session.query(BookRun).one()
    assert book_run.status == "paused_by_user"
    assert book_run.current_chapter_index == 1
    assert book_run.progress["completed_chapters"] == []
    assert "中断" in book_run.progress["pause_reason"]
