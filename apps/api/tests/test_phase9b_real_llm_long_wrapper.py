from __future__ import annotations

import importlib.util
import os
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
