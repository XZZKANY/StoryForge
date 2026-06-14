from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace


def _load_parallel_wrapper():
    script_path = Path(__file__).resolve().parents[3] / ".codex" / "run-real-llm-parallel.py"
    spec = importlib.util.spec_from_file_location("storyforge_real_llm_parallel_wrapper", script_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_parallel_wrapper_writes_evidence_and_records_metric_failures(monkeypatch, tmp_path: Path) -> None:
    """并发 runner 应写出脱敏证据，并如实记录缺失或不达标指标。"""

    module = _load_parallel_wrapper()
    monkeypatch.setattr(module, "ROOT", tmp_path)
    captured: dict[str, int] = {}

    def fake_runner(*_args: object, **kwargs: object) -> SimpleNamespace:
        captured["chapter_count"] = int(kwargs["chapter_count"])
        captured["chapter_parallelism"] = int(kwargs["chapter_parallelism"])
        captured["token_budget"] = int(kwargs["token_budget"])
        return SimpleNamespace(
            book_run=SimpleNamespace(
                id=9,
                status="completed",
                tokens_used=3000,
                estimated_cost=0.0,
                progress={
                    "completed_chapters": [
                        {
                            "chapter_index": 1,
                            "token_usage": 1000,
                            "quality_score": 100,
                            "quality_issues": [],
                            "elapsed_time_sec": 40,
                            "repair_rounds": 0,
                        },
                        {
                            "chapter_index": 2,
                            "token_usage": 1000,
                            "quality_score": 100,
                            "quality_issues": [],
                            "elapsed_time_sec": 42,
                            "repair_rounds": 0,
                        },
                    ]
                },
            ),
            markdown_artifact=SimpleNamespace(id=10, payload={"content": "## 第 1 章\n正文\n## 第 2 章\n正文"}),
            audit_artifact=SimpleNamespace(
                id=11,
                payload={
                    "integration_metrics": {
                        "context_cache_hit_rate": 0.96,
                        "memory_recall_budget_used": 0,
                        "arc_completion_rate": 1.0,
                        "db_query_count_per_chapter": 2.5,
                        "chapter_generation_time_p50": 41.0,
                        "concurrent_chapter_utilization": 0.67,
                    }
                },
            ),
            chapter_count=2,
        )

    monkeypatch.setattr(module, "run_book_generation_parallel", fake_runner)
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-private-credential")
    monkeypatch.setenv("STORYFORGE_LLM_BASE_URL", "http://127.0.0.1:1/v1")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "local-model")
    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "openai-compatible")

    result = module.main(
        [
            "--chapter-count",
            "2",
            "--chapter-parallelism",
            "3",
            "--target-word-count",
            "2400",
            "--token-budget",
            "12000",
            "--label",
            "pytest-parallel",
        ]
    )

    assert result == 1
    assert captured == {"chapter_count": 2, "chapter_parallelism": 3, "token_budget": 12000}
    run_dirs = sorted((tmp_path / ".codex").glob("real-llm-parallel-pytest-parallel-*"))
    assert len(run_dirs) == 1
    run_dir = run_dirs[0]
    summary = module.json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
    metadata = module.json.loads((run_dir / "run-metadata.json").read_text(encoding="utf-8"))
    assert summary["mode"] == "real_llm_parallel_smoke"
    assert summary["chapter_parallelism"] == 3
    assert summary["integration_metrics"]["concurrent_chapter_utilization"] == 0.67
    assert summary["metric_results"]["concurrent_chapter_utilization"]["passed"] is True
    assert summary["metric_results"]["context_cache_hit_rate"]["passed"] is True
    assert summary["metric_results"]["db_query_count_per_chapter"]["passed"] is True
    assert summary["metric_results"]["chapter_generation_time_p50"]["passed"] is False
    assert metadata["quality_gate_failed"] is True
    assert "缺少 context_cache_hit_rate" not in metadata["quality_gate_failures"]
    assert "缺少 db_query_count_per_chapter" not in metadata["quality_gate_failures"]
    assert "chapter_generation_time_p50 未低于 20 秒" in metadata["quality_gate_failures"]
    assert "test-private-credential" not in (run_dir / "stderr.log").read_text(encoding="utf-8")


def test_parallel_wrapper_accepts_low_utilization_in_prior_commit_dependency_mode() -> None:
    """前序提交依赖模式优先保证前文正确，低并发利用率不应触发并发门禁失败。"""

    module = _load_parallel_wrapper()
    summary = {
        "tokens_used": 3000,
        "artifact_hashes": {"book_md_sha256": "book-hash", "audit_report_sha256": "audit-hash"},
        "per_chapter_metrics": [{"chapter_index": 1, "quality_score": 100, "quality_issue_count": 0}],
        "metric_results": {
            "context_cache_hit_rate": {"passed": True},
            "memory_recall_budget_used": {"passed": True},
            "arc_completion_rate": {"passed": True},
            "db_query_count_per_chapter": {"passed": True},
            "chapter_generation_time_p50": {"passed": True},
            "concurrent_chapter_utilization": {"passed": False, "status": "failed"},
        },
        "integration_metrics": {
            "dependency_mode": "prior_chapter_commit",
            "concurrent_chapter_utilization": 0.34,
        },
    }

    assert module._gate_failures(summary, token_budget=12000) == []
