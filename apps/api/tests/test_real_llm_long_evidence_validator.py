from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
VALIDATOR_PATH = REPO_ROOT / ".codex" / "validate-real-llm-long-evidence.ps1"


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _write_minimal_long_evidence(
    run_dir: Path,
    *,
    markdown_artifact_id: str | None = "artifact-book-md",
    epub_artifact_id: str | None = "artifact-book-epub",
    audit_artifact_id: str | None = "artifact-audit-json",
    summary_present: bool = True,
    chapter_count: int = 10,
    integration_metrics: dict[str, object] | None = None,
    include_epub: bool = True,
    include_cost_breakdown: bool = True,
) -> None:
    run_dir.mkdir()
    if integration_metrics is None:
        integration_metrics = {
            "context_cache_hit_rate": 0.96,
            "memory_recall_budget_used": 7999,
            "arc_completion_rate": 0.71,
            "db_query_count_per_chapter": 3,
            "chapter_generation_time_p50": 19,
            "concurrent_chapter_utilization": 0.61,
        }
    summary: dict[str, object] = {
        "book_run_id": 101,
        "book_run_status": "completed",
        "target_chapter_count": chapter_count,
        "actual_chapter_count": chapter_count,
        "tokens_used": 120000,
        "estimated_cost": 1.23,
        "actual_total_chars": 36000,
        "markdown_artifact_id": markdown_artifact_id,
        "epub_artifact_id": epub_artifact_id,
        "audit_artifact_id": audit_artifact_id,
        "prompt_tokens_used": 40000,
        "completion_tokens_used": 80000,
        "cost_cny_estimated": 0.6,
        "artifact_hashes": {
            "book_md_sha256": "book-hash",
            "book_epub_sha256": "epub-hash" if include_epub else "",
            "audit_report_sha256": "audit-hash",
        },
        "per_chapter_metrics": [
            {"chapter_index": index, "quality_score": 95, "quality_issue_count": 0}
            for index in range(1, chapter_count + 1)
        ],
        "integration_metrics": integration_metrics,
    }
    if include_cost_breakdown:
        summary["cost_breakdown"] = {
            "currency": "CNY",
            "input_cny": 0.12,
            "output_cny": 0.48,
            "total_cny": 0.6,
            "source": "provider_usage",
        }
    metadata = {
        "runner_exit_code": 0,
        "summary_present": summary_present,
        "sensitive_hit_count": 0,
        "redacted_parameters": {
            "chapter_count": chapter_count,
            "target_word_count": 9000,
            "token_budget": 200000,
            "timeout_seconds": 300,
            "time_budget_seconds": 4200,
            "outer_timeout_seconds": 4800,
        },
    }
    _write_json(run_dir / "summary.json", summary)
    _write_json(run_dir / "run-metadata.json", metadata)
    (run_dir / "quality-risk.md").write_text("脱敏质量风险记录", encoding="utf-8")
    (run_dir / "human-readthrough-todo.md").write_text("人工通读待办", encoding="utf-8")
    (run_dir / "book.md").write_text("脱敏正文", encoding="utf-8")
    if include_epub:
        (run_dir / "book.epub").write_bytes(b"epub-bytes")
    _write_json(run_dir / "audit_report.json", {"status": "ok"})
    _write_json(run_dir / "stdout.json", {"status": "ok"})
    (run_dir / "stderr.log").write_text("", encoding="utf-8")


def _run_validator(run_dir: Path, *extra_args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(VALIDATOR_PATH),
            "-RunDirectory",
            str(run_dir),
            *extra_args,
        ],
        capture_output=True,
        text=True,
        check=False,
    )


def test_long_evidence_validator_rejects_missing_artifact_ids(tmp_path: Path) -> None:
    """长程证据缺少导出 artifact ID 时，验证器必须失败。"""

    run_dir = tmp_path / "long-evidence"
    _write_minimal_long_evidence(run_dir, markdown_artifact_id="", audit_artifact_id=None)

    result = _run_validator(run_dir)

    assert result.returncode == 1
    assert "gate: fail" in result.stdout
    assert "failure: 缺少 markdown_artifact_id" in result.stdout
    assert "failure: 缺少 audit_artifact_id" in result.stdout


def test_long_evidence_validator_rejects_metadata_summary_present_false(
    tmp_path: Path,
) -> None:
    """metadata 标记 summary 缺失时，即使文件存在也必须拒绝。"""

    run_dir = tmp_path / "long-evidence"
    _write_minimal_long_evidence(run_dir, summary_present=False)

    result = _run_validator(run_dir)

    assert result.returncode == 1
    assert "summary_present: False" in result.stdout
    assert "gate: fail" in result.stdout
    assert "failure: run-metadata.json 标记 summary_present=false" in result.stdout


def test_long_evidence_validator_accepts_complete_minimal_evidence(tmp_path: Path) -> None:
    """长程证据具备完整 artifact ID 和质量门禁时，验证器允许当前 10 章范围通过。"""

    run_dir = tmp_path / "long-evidence"
    _write_minimal_long_evidence(run_dir)

    result = _run_validator(run_dir, "-RequireIntegrationGate")

    assert result.returncode == 0
    assert "markdown_artifact_id: artifact-book-md" in result.stdout
    assert "epub_artifact_id: artifact-book-epub" in result.stdout
    assert "audit_artifact_id: artifact-audit-json" in result.stdout
    assert "cost_cny_estimated: 0.6" in result.stdout
    assert "quality_issue_count_total: 0" in result.stdout
    assert "gate: pass_for_real_10ch_scope" in result.stdout


def test_long_evidence_validator_rejects_missing_epub_and_cost_breakdown(tmp_path: Path) -> None:
    """30 章长跑证据必须包含 EPUB 文件、EPUB hash 和 cost breakdown。"""

    run_dir = tmp_path / "long-evidence"
    _write_minimal_long_evidence(
        run_dir,
        chapter_count=30,
        epub_artifact_id="",
        include_epub=False,
        include_cost_breakdown=False,
    )

    result = _run_validator(run_dir, "-ExpectedChapterCount", "30")

    assert result.returncode == 1
    assert "gate: fail" in result.stdout
    assert "failure: 缺少必需产物：book.epub" in result.stdout
    assert "failure: 缺少 epub_artifact_id" in result.stdout
    assert "failure: 缺少 book_epub_sha256" in result.stdout
    assert "failure: 缺少 cost_breakdown" in result.stdout


def test_long_evidence_validator_rejects_missing_phase5_integration_metrics(tmp_path: Path) -> None:
    """PH5 集成证据缺少指标时，验证器必须失败。"""

    run_dir = tmp_path / "long-evidence"
    _write_minimal_long_evidence(run_dir, integration_metrics={})

    result = _run_validator(run_dir, "-RequireIntegrationGate")

    assert result.returncode == 1
    assert "gate: fail" in result.stdout
    assert "failure: 缺少 context_cache_hit_rate" in result.stdout
    assert "failure: 缺少 memory_recall_budget_used" in result.stdout
    assert "failure: 缺少 arc_completion_rate" in result.stdout


def test_long_evidence_validator_accepts_thirty_chapter_phase5_metrics(tmp_path: Path) -> None:
    """30 章集成指标达标时，验证器输出 PH5 专属 gate。"""

    run_dir = tmp_path / "long-evidence"
    _write_minimal_long_evidence(run_dir, chapter_count=30)

    result = _run_validator(run_dir, "-ExpectedChapterCount", "30")

    assert result.returncode == 0
    assert "context_cache_hit_rate: 0.96" in result.stdout
    assert "memory_recall_budget_used: 7999" in result.stdout
    assert "arc_completion_rate: 0.71" in result.stdout
    assert "gate: pass_for_real_30ch_integration_scope" in result.stdout


def test_long_evidence_validator_requires_manual_readthrough_for_final_acceptance(tmp_path: Path) -> None:
    """最终验收模式必须要求独立人工通读完成证据。"""

    run_dir = tmp_path / "long-evidence"
    _write_minimal_long_evidence(run_dir)

    result = _run_validator(run_dir, "-RequireManualReadthrough")

    assert result.returncode == 1
    assert "gate: fail" in result.stdout
    assert "failure: 缺少 manual-readthrough-completion.md" in result.stdout


def test_long_evidence_validator_accepts_final_acceptance_with_manual_readthrough(tmp_path: Path) -> None:
    """最终验收模式在人工通读通过后输出独立最终 gate。"""

    run_dir = tmp_path / "long-evidence"
    _write_minimal_long_evidence(run_dir)
    (run_dir / "manual-readthrough-completion.md").write_text(
        "# 真实 LLM 10 章 smoke 人工通读完成记录\n\n"
        "- 通读人：Codex\n"
        "- 结论：通过 10 章 smoke 人工通读，未发现明显人物、世界观或时间线矛盾。\n",
        encoding="utf-8",
    )

    result = _run_validator(run_dir, "-RequireManualReadthrough")

    assert result.returncode == 0
    assert "manual-readthrough-completion.md: present" in result.stdout
    assert "gate: pass_for_real_10ch_final_acceptance" in result.stdout
    assert "gate: pass_for_real_10ch_scope" not in result.stdout
