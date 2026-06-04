from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
GATE_DOCUMENT_PATH = REPO_ROOT / ".codex" / "real-llm-smoke-gate.md"
SENSITIVE_MARKERS = (
    "外部令牌" + "计划端点",
    "tp" + "-",
    "Authori" + "zation",
    "Bear" + "er",
)


def test_real_llm_smoke_gate_documents_safe_10ch_runbook() -> None:
    """真实 10 章运行手册必须锁定安全顺序和最终验收边界。"""

    document = GATE_DOCUMENT_PATH.read_text(encoding="utf-8")

    assert "run-real-llm-10ch-current-env.ps1" in document
    assert "-Interactive" in document
    assert "-ProbeOnly" in document
    assert "run-real-llm-long-direct.py" in document
    assert "validate-real-llm-long-evidence.ps1" in document
    assert "-RequireManualReadthrough" in document
    assert "不要把凭据写入文件" in document
    assert "先执行 ProbeOnly" in document
    assert "再执行正式 10 章运行" in document
    assert "人工通读完成后" in document
    assert "仍不代表 3-5 万字长程完成" in document
    for marker in SENSITIVE_MARKERS:
        assert marker not in document
