from __future__ import annotations

import importlib.util
import os
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.domains.book_runs.phase9b_real_llm_smoke import Phase9BRealLlmSmokePreflightError, _assert_preflight


def _load_long_wrapper():
    script_path = Path(__file__).resolve().parents[3] / ".codex" / "run-real-llm-long-direct.py"
    spec = importlib.util.spec_from_file_location("storyforge_real_llm_long_wrapper", script_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_long_wrapper_scans_all_text_artifacts_for_private_runtime_values(tmp_path: Path) -> None:
    """长程真实 LLM 包装脚本必须扫描全部文本产物，避免只检查摘要文件。"""

    module = _load_long_wrapper()
    paths: list[Path] = []
    for name in (
        "summary.json",
        "stdout.json",
        "stderr.log",
        "book.md",
        "audit_report.json",
        "run-metadata.json",
        "quality-risk.md",
        "human-readthrough-todo.md",
    ):
        path = tmp_path / name
        path.write_text("普通脱敏内容", encoding="utf-8")
        paths.append(path)
    (tmp_path / "book.md").write_text("正文误含 private-runtime-value", encoding="utf-8")
    (tmp_path / "audit_report.json").write_text("审计误含 private-runtime-value", encoding="utf-8")

    assert module._sensitive_hit_count(paths, ["private-runtime-value"]) == 2


def test_long_wrapper_rejects_success_when_outer_timeout_is_exceeded() -> None:
    """外层超时触发后，长程包装脚本不能继续把运行记为成功。"""

    module = _load_long_wrapper()

    with pytest.raises(RuntimeError, match="外层超时"):
        module._raise_if_outer_timeout_exceeded(
            started_at=100.0,
            outer_timeout_seconds=10,
            now=111.0,
        )


def test_long_wrapper_reports_quality_and_audit_gate_failures() -> None:
    """运行后质量、token 和审计证据不达标时，长程包装脚本不能返回成功。"""

    module = _load_long_wrapper()
    summary = {
        "tokens_used": 200000,
        "artifact_hashes": {"book_md_sha256": ""},
        "per_chapter_metrics": [
            {"chapter_index": 1, "quality_score": 89, "quality_issue_count": 1},
            {"chapter_index": 2, "quality_score": 92, "quality_issue_count": 4},
        ],
    }

    failures = module._gate_failures(summary, token_budget=200000)

    assert "tokens_used 达到或超过 token_budget" in failures
    assert "缺少 audit_report_sha256" in failures
    assert "第 1 章 quality_score 低于 90" in failures
    assert "累计 quality_issue_count 超过 3" in failures


def test_long_wrapper_requires_phase5_integration_metrics() -> None:
    """PH5 长程门禁必须拒绝缺失或不达标的集成指标。"""

    module = _load_long_wrapper()
    summary = {
        "tokens_used": 120000,
        "artifact_hashes": {"book_md_sha256": "book-hash", "audit_report_sha256": "audit-hash"},
        "per_chapter_metrics": [{"chapter_index": 1, "quality_score": 95, "quality_issue_count": 0}],
    }

    missing_failures = module._gate_failures(summary, token_budget=200000)

    assert "缺少 integration_metrics" in missing_failures

    summary["integration_metrics"] = {
        "context_cache_hit_rate": 0.95,
        "memory_recall_budget_used": 8000,
        "arc_completion_rate": 0.69,
        "db_query_count_per_chapter": 4,
        "chapter_generation_time_p50": 20,
        "concurrent_chapter_utilization": 0.6,
    }

    failures = module._gate_failures(summary, token_budget=200000)

    assert "context_cache_hit_rate 未超过 0.95" in failures
    assert "memory_recall_budget_used 未低于 8000" in failures
    assert "arc_completion_rate 低于 0.7" in failures
    assert "db_query_count_per_chapter 超过 3" in failures
    assert "chapter_generation_time_p50 未低于 20 秒" in failures
    assert "concurrent_chapter_utilization 未超过 0.6" in failures


def test_long_wrapper_accepts_passing_phase5_integration_metrics() -> None:
    """PH5 集成指标达标时，长程包装脚本不应新增门禁失败。"""

    module = _load_long_wrapper()
    summary = {
        "tokens_used": 120000,
        "artifact_hashes": {"book_md_sha256": "book-hash", "audit_report_sha256": "audit-hash"},
        "per_chapter_metrics": [{"chapter_index": 1, "quality_score": 95, "quality_issue_count": 0}],
        "integration_metrics": {
            "context_cache_hit_rate": 0.96,
            "memory_recall_budget_used": 7999,
            "arc_completion_rate": 0.71,
            "db_query_count_per_chapter": 3,
            "chapter_generation_time_p50": 19,
            "concurrent_chapter_utilization": 0.61,
        },
    }

    assert module._gate_failures(summary, token_budget=200000) == []


def test_long_wrapper_metadata_keeps_phase5_integration_metrics(tmp_path: Path) -> None:
    """run-metadata.json 的 summary 镜像必须保留 PH5 集成指标。"""

    module = _load_long_wrapper()
    args = SimpleNamespace(
        chapter_count=30,
        max_chapter_count=30,
        token_budget=800000,
        target_word_count=35000,
        chapter_word_count_min=600,
        chapter_word_count_max=1600,
        timeout_seconds=300,
        time_budget_seconds=4200,
        outer_timeout_seconds=4800,
        resume_run_directory=None,
    )
    summary = {
        "book_run_id": 1,
        "book_run_status": "completed",
        "target_chapter_count": 30,
        "actual_chapter_count": 30,
        "target_word_count": 35000,
        "tokens_used": 120000,
        "estimated_cost": 1.23,
        "actual_total_chars": 36000,
        "markdown_artifact_id": "artifact-book-md",
        "audit_artifact_id": "artifact-audit-json",
        "per_chapter_char_counts": [],
        "per_chapter_metrics": [],
        "artifact_hashes": {"book_md_sha256": "book-hash", "audit_report_sha256": "audit-hash"},
        "integration_metrics": {
            "context_cache_hit_rate": 0.96,
            "memory_recall_budget_used": 7999,
            "arc_completion_rate": 0.71,
            "db_query_count_per_chapter": 3,
            "chapter_generation_time_p50": 19,
            "concurrent_chapter_utilization": 0.61,
        },
    }

    metadata = module._metadata(
        out_dir=tmp_path,
        runner_exit_code=0,
        sensitive_hit_count=0,
        started_at=100.0,
        args=args,
        summary=summary,
        failure_message="",
    )

    assert metadata["summary"]["integration_metrics"] == summary["integration_metrics"]


def test_long_wrapper_keeps_default_smoke_limit_but_allows_explicit_long_limit() -> None:
    """默认 smoke 仍限制 10 章，真实长程入口可显式放宽到 30 章。"""

    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "http://127.0.0.1:1/v1",
        "STORYFORGE_LLM_MODEL": "local-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    with pytest.raises(Phase9BRealLlmSmokePreflightError, match="只允许 1 到 10 章"):
        _assert_preflight(env, 11, 1000, 9000)

    _assert_preflight(env, 30, 800000, 35000, max_chapter_count=30)


def test_long_runner_passes_explicit_max_chapter_count_to_real_smoke(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """35k runner 应把显式章节上限传给业务 smoke，避免被默认 10 章上限误拒。"""

    module = _load_long_wrapper()
    captured: dict[str, int] = {}
    monkeypatch.setattr(module, "ROOT", tmp_path)

    def fake_run_real_smoke(*_args: object, **kwargs: object) -> SimpleNamespace:
        captured["chapter_count"] = int(kwargs["chapter_count"])
        captured["max_chapter_count"] = int(kwargs["max_chapter_count"])
        captured["token_budget"] = int(kwargs["token_budget"])
        return SimpleNamespace(
            book_run=SimpleNamespace(id=1, status="completed", tokens_used=1200, estimated_cost=0.0),
            markdown_artifact=SimpleNamespace(id=2, payload={"content": "## 第 1 章\n正文"}),
            audit_artifact=SimpleNamespace(id=3, payload={"status": "ok"}),
            chapter_count=30,
        )

    monkeypatch.setattr(module, "run_phase9b_real_llm_smoke", fake_run_real_smoke)
    monkeypatch.setattr(module, "_raise_for_gate_failures", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(module, "_artifact_text", lambda artifact: str(artifact.payload))
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-private-credential")
    monkeypatch.setenv("STORYFORGE_LLM_BASE_URL", "http://127.0.0.1:1/v1")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "local-model")
    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "openai-compatible")
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD", "1")
    monkeypatch.setenv("STORYFORGE_ALLOW_DIRECT_SERIAL_PH5", "1")

    result = module.main(
        [
            "--chapter-count",
            "30",
            "--target-word-count",
            "35000",
            "--token-budget",
            "800000",
            "--label",
            "pytest-long-limit",
        ]
    )

    assert result == 0
    assert captured == {"chapter_count": 30, "max_chapter_count": 30, "token_budget": 800000}
    assert os.environ["STORYFORGE_LLM_API_KEY"] == "test-private-credential"


def test_long_runner_rejects_thirty_chapter_direct_serial_without_override(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """PH5 30 章不能默认走 direct 串行 runner，避免真实调用后才被并发门禁拒绝。"""

    module = _load_long_wrapper()
    monkeypatch.setattr(module, "ROOT", tmp_path)

    def fail_if_called(*_args: object, **_kwargs: object) -> SimpleNamespace:
        raise AssertionError("30 章 PH5 不应调用 direct 串行 runner")

    monkeypatch.setattr(module, "run_phase9b_real_llm_smoke", fail_if_called)
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-private-credential")
    monkeypatch.setenv("STORYFORGE_LLM_BASE_URL", "http://127.0.0.1:1/v1")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "local-model")
    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "openai-compatible")
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD", "1")

    result = module.main(
        [
            "--chapter-count",
            "30",
            "--target-word-count",
            "35000",
            "--token-budget",
            "800000",
            "--label",
            "pytest-direct-serial-block",
        ]
    )

    assert result == 2


def test_long_runner_exports_evidence_when_quality_gate_fails(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """质量门禁失败仍应导出脱敏证据，但运行结果必须保持失败。"""

    module = _load_long_wrapper()
    monkeypatch.setattr(module, "ROOT", tmp_path)

    def fake_run_real_smoke(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(
            book_run=SimpleNamespace(
                id=1,
                status="completed",
                tokens_used=1200,
                estimated_cost=0.0,
                progress={
                    "completed_chapters": [
                        {
                            "chapter_index": 1,
                            "token_usage": 1200,
                            "quality_score": 84,
                            "quality_issues": [{"summary": "需人工复核"}, {"summary": "节奏偏弱"}],
                            "elapsed_time_sec": 12,
                            "repair_rounds": 0,
                        }
                    ]
                },
            ),
            markdown_artifact=SimpleNamespace(id=2, payload={"content": "## 第 1 章\n正文"}),
            audit_artifact=SimpleNamespace(id=3, payload={"quality_summary": {"issue_count": 2}}),
            chapter_count=1,
        )

    monkeypatch.setattr(module, "run_phase9b_real_llm_smoke", fake_run_real_smoke)
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-private-credential")
    monkeypatch.setenv("STORYFORGE_LLM_BASE_URL", "http://127.0.0.1:1/v1")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "local-model")
    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "openai-compatible")
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD", "1")
    monkeypatch.setenv("STORYFORGE_ALLOW_DIRECT_SERIAL_PH5", "1")

    result = module.main(
        [
            "--chapter-count",
            "1",
            "--target-word-count",
            "1000",
            "--token-budget",
            "800000",
            "--label",
            "pytest-quality-fail",
        ]
    )

    assert result == 1
    run_dirs = sorted((tmp_path / ".codex").glob("real-llm-pytest-quality-fail-*"))
    assert len(run_dirs) == 1
    run_dir = run_dirs[0]
    assert (run_dir / "summary.json").exists()
    assert (run_dir / "book.md").read_text(encoding="utf-8") == "## 第 1 章\n正文"
    assert (run_dir / "audit_report.json").exists()
    metadata = module.json.loads((run_dir / "run-metadata.json").read_text(encoding="utf-8"))
    assert metadata["runner_exit_code"] == 1
    assert metadata["summary_present"] is True
    assert metadata["quality_gate_failed"] is True
    assert "第 1 章 quality_score 低于 90" in metadata["quality_gate_failures"]
    assert "test-private-credential" not in (run_dir / "stderr.log").read_text(encoding="utf-8")


def test_long_runner_resume_copies_failed_sqlite_and_calls_resume_runner(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """断点续跑应复制失败目录 SQLite 到新目录，并调用业务 resume 入口补完剩余章节。"""

    module = _load_long_wrapper()
    monkeypatch.setattr(module, "ROOT", tmp_path)
    failed_dir = tmp_path / ".codex" / "real-llm-failed"
    failed_dir.mkdir(parents=True)
    source_db = failed_dir / "smoke.sqlite3"
    sqlite3.connect(source_db).close()
    captured: dict[str, object] = {}

    def fake_resume_real_smoke(*_args: object, **kwargs: object) -> SimpleNamespace:
        captured["book_run_id"] = kwargs["book_run_id"]
        captured["chapter_count"] = kwargs["chapter_count"]
        captured["max_chapter_count"] = kwargs["max_chapter_count"]
        return SimpleNamespace(
            book_run=SimpleNamespace(
                id=1,
                status="completed",
                tokens_used=1200,
                estimated_cost=0.0,
                progress={
                    "completed_chapters": [
                        {
                            "chapter_index": chapter_index,
                            "token_usage": 1200,
                            "quality_score": 100,
                            "quality_issues": [],
                            "elapsed_time_sec": 12,
                            "repair_rounds": 0,
                        }
                        for chapter_index in range(1, 31)
                    ]
                },
            ),
            markdown_artifact=SimpleNamespace(id=2, payload={"content": "## 第 1 章\n正文"}),
            audit_artifact=SimpleNamespace(id=3, payload={"quality_summary": {"issue_count": 0}}),
            chapter_count=30,
        )

    monkeypatch.setattr(module, "resume_phase9b_real_llm_smoke", fake_resume_real_smoke)
    monkeypatch.setattr(module, "_raise_for_gate_failures", lambda *_args, **_kwargs: None)
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-private-credential")
    monkeypatch.setenv("STORYFORGE_LLM_BASE_URL", "http://127.0.0.1:1/v1")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "local-model")
    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "openai-compatible")
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD", "1")
    monkeypatch.setenv("STORYFORGE_ALLOW_DIRECT_SERIAL_PH5", "1")

    result = module.main(
        [
            "--chapter-count",
            "30",
            "--max-chapter-count",
            "30",
            "--target-word-count",
            "35000",
            "--token-budget",
            "800000",
            "--label",
            "pytest-resume",
            "--resume-run-directory",
            str(failed_dir),
        ]
    )

    assert result == 0
    assert captured == {"book_run_id": 1, "chapter_count": 30, "max_chapter_count": 30}
    run_dirs = sorted((tmp_path / ".codex").glob("real-llm-pytest-resume-*"))
    assert len(run_dirs) == 1
    run_dir = run_dirs[0]
    assert (run_dir / "smoke.sqlite3").exists()
    assert (run_dir / "smoke.sqlite3") != source_db
    metadata = module.json.loads((run_dir / "run-metadata.json").read_text(encoding="utf-8"))
    assert metadata["resume_source_directory"] == str(failed_dir)


def test_long_runner_resolves_relative_resume_directory_from_repo_root(tmp_path: Path) -> None:
    """恢复源相对路径必须按仓库根目录解析，不能受当前工作目录影响。"""

    module = _load_long_wrapper()
    original_root = module.ROOT
    module.ROOT = tmp_path
    try:
        resolved = module._resolve_resume_run_directory(".codex/real-llm-failed")
    finally:
        module.ROOT = original_root

    assert resolved == (tmp_path / ".codex" / "real-llm-failed").resolve()
