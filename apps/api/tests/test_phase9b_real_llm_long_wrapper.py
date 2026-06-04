from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


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
