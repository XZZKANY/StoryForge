from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parents[1]
API_ROOT = ROOT / "apps" / "api"
sys.path.insert(0, str(API_ROOT))

import app.models  # noqa: E402,F401
from app.db.base import Base  # noqa: E402
from app.domains.book_runs.phase9b_real_llm_smoke import (  # noqa: E402
    REQUIRED_REAL_LLM_ENV,
    _artifact_text,
    _evidence_summary,
    run_phase9b_real_llm_smoke,
)


def _redact(text: str, private_values: list[str]) -> str:
    redacted = text
    for value in private_values:
        if value.strip():
            redacted = redacted.replace(value, "[REDACTED_PRIVATE_RUNTIME_VALUE]")
    return redacted


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def _metadata(
    *,
    out_dir: Path,
    summary_path: Path,
    stdout_path: Path,
    stderr_path: Path,
    runner_exit_code: int,
    sensitive_hit_count: int,
    started_at: float,
    summary: dict[str, Any] | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "mode": "real_llm_smoke",
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S %z"),
        "output_directory": str(out_dir),
        "runner_exit_code": runner_exit_code,
        "summary_present": summary_path.exists(),
        "sensitive_hit_count": sensitive_hit_count,
        "redacted_parameters": {
            "provider_protocol": "openai-compatible",
            "model": os.environ.get("STORYFORGE_LLM_MODEL", ""),
            "chapter_count": 3,
            "token_budget": 60000,
            "target_word_count": 2700,
            "chapter_word_count_min": 600,
            "chapter_word_count_max": 1600,
            "timeout_seconds": int(float(os.environ.get("STORYFORGE_LLM_TIMEOUT_SECONDS", "60"))),
            "time_budget_seconds": int(os.environ.get("STORYFORGE_LLM_SMOKE_TIME_BUDGET_SECONDS", "1800")),
            "database_mode": "ephemeral_sqlite",
        },
        "files": {
            "summary_json": str(summary_path),
            "stdout_json": str(stdout_path),
            "stderr_log": str(stderr_path),
        },
        "elapsed_time_sec": max(0, int(time.monotonic() - started_at)),
    }
    if summary is not None:
        payload["summary"] = {
            "book_run_id": summary.get("book_run_id"),
            "book_run_status": summary.get("book_run_status"),
            "target_chapter_count": summary.get("target_chapter_count"),
            "actual_chapter_count": summary.get("actual_chapter_count"),
            "target_word_count": summary.get("target_word_count"),
            "tokens_used": summary.get("tokens_used"),
            "estimated_cost": summary.get("estimated_cost"),
            "actual_total_chars": summary.get("actual_total_chars"),
            "markdown_artifact_id": summary.get("markdown_artifact_id"),
            "audit_artifact_id": summary.get("audit_artifact_id"),
            "per_chapter_char_counts": summary.get("per_chapter_char_counts"),
            "per_chapter_metrics": summary.get("per_chapter_metrics"),
        }
    return payload


def _write_audit_templates(out_dir: Path, metadata: dict[str, Any]) -> None:
    params = metadata["redacted_parameters"]
    summary = metadata.get("summary", {})
    risk_text = f"""# 真实 LLM 3 章 smoke 质量风险记录

生成时间：{metadata["generated_at"]}

## 脱敏运行参数

- provider_protocol: {params["provider_protocol"]}
- model: {params["model"]}
- chapter_count: {params["chapter_count"]}
- target_word_count: {params["target_word_count"]}
- token_budget: {params["token_budget"]}
- timeout_seconds: {params["timeout_seconds"]}
- time_budget_seconds: {params["time_budget_seconds"]}
- database_mode: {params["database_mode"]}

## 运行结果

- runner_exit_code: {metadata["runner_exit_code"]}
- summary_present: {metadata["summary_present"]}
- sensitive_hit_count: {metadata["sensitive_hit_count"]}
- book_run_status: {summary.get("book_run_status")}
- actual_chapter_count: {summary.get("actual_chapter_count")}
- tokens_used: {summary.get("tokens_used")}
- estimated_cost: {summary.get("estimated_cost")}
- actual_total_chars: {summary.get("actual_total_chars")}
- markdown_artifact_id: {summary.get("markdown_artifact_id")}
- audit_artifact_id: {summary.get("audit_artifact_id")}

## 质量风险

- 本次只证明真实外部 LLM 3 章 smoke 完成与否，不能证明 10 章或 3-5 万字长程完成。
- 本次使用一次性 SQLite 数据库，不能证明默认 Postgres 或跨卷生产稳定性。
- 必须完成三章人工通读后，才能把 9B-4b 记为通过。
- 若发现重复段落、设定漂移、角色口吻异常或模型痕迹，必须暂停扩大到长程。
"""
    _write_text(out_dir / "quality-risk.md", risk_text)
    todo_text = f"""# 真实 LLM 3 章 smoke 人工通读待办

生成时间：{metadata["generated_at"]}

## 必读范围

- 本次章节数：3
- Markdown 产物 ID：{summary.get("markdown_artifact_id")}
- 审计报告 ID：{summary.get("audit_artifact_id")}
- 正文字符数：{summary.get("actual_total_chars")}

## 通读清单

- [ ] 核对每章是否有完整开端、推进和收束。
- [ ] 标记明显重复段落、空泛段落或模板化表达。
- [ ] 核对人物称谓、动机、关系和口吻是否前后一致。
- [ ] 核对时间线、地点、道具、伏笔和设定是否冲突。
- [ ] 核对爽点、悬念、转折和章节钩子是否有效。
- [ ] 核对是否存在不应写入成稿的系统提示、工具痕迹或模型自述。
- [ ] 给出人工结论：通过 / 需修订 / 退回重跑。

## 结论记录

- 人工通读人：待补
- 通读时间：待补
- 结论：待补
- 主要问题：待补
- 是否允许评估 10 章或 3-5 万字长程：待补
"""
    _write_text(out_dir / "human-readthrough-todo.md", todo_text)


def main() -> int:
    missing = [name for name in REQUIRED_REAL_LLM_ENV if not os.environ.get(name)]
    if missing:
        print("missing_env=" + ",".join(missing))
        return 2

    os.environ.setdefault("STORYFORGE_LLM_SMOKE_TIME_BUDGET_SECONDS", "1800")
    os.environ.setdefault("STORYFORGE_LLM_TIMEOUT_SECONDS", "60")

    run_id = time.strftime("%Y%m%d-%H%M%S")
    out_dir = ROOT / ".codex" / f"real-llm-3ch-{run_id}"
    out_dir.mkdir(parents=True, exist_ok=True)
    summary_path = out_dir / "summary.json"
    stdout_path = out_dir / "stdout.json"
    stderr_path = out_dir / "stderr.log"
    sqlite_path = out_dir / "smoke.sqlite3"
    started_at = time.monotonic()
    private_values = [
        os.environ.get("STORYFORGE_LLM_BASE_URL", ""),
        os.environ.get("STORYFORGE_LLM_API_KEY", ""),
    ]
    summary: dict[str, Any] | None = None
    exit_code = 0
    stderr_text = ""
    stdout_payload: dict[str, Any] = {"mode": "real_llm_smoke", "run_directory": str(out_dir)}

    engine = create_engine(f"sqlite+pysqlite:///{sqlite_path.as_posix()}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    try:
        with SessionLocal() as session:
            result = run_phase9b_real_llm_smoke(
                session,
                chapter_count=3,
                token_budget=60000,
                target_word_count=2700,
                chapter_word_count_min=600,
                chapter_word_count_max=1600,
                env=os.environ,
            )
            summary = _evidence_summary(
                result,
                target_word_count=2700,
                chapter_word_count_min=600,
                chapter_word_count_max=1600,
            )
            _write_json(summary_path, summary)
            _write_text(out_dir / "book.md", _artifact_text(result.markdown_artifact))
            _write_text(out_dir / "audit_report.json", _artifact_text(result.audit_artifact))
            stdout_payload.update(
                {
                    "book_run_id": summary["book_run_id"],
                    "book_run_status": summary["book_run_status"],
                    "actual_chapter_count": summary["actual_chapter_count"],
                    "tokens_used": summary["tokens_used"],
                    "markdown_artifact_id": summary["markdown_artifact_id"],
                    "audit_artifact_id": summary["audit_artifact_id"],
                }
            )
    except Exception as exc:  # noqa: BLE001
        exit_code = 1
        stderr_text = _redact(str(exc), private_values)
    finally:
        engine.dispose()

    _write_json(stdout_path, stdout_payload)
    _write_text(stderr_path, stderr_text)

    scan_text = ""
    for path in (summary_path, stdout_path, stderr_path):
        if path.exists():
            scan_text += path.read_text(encoding="utf-8")
    sensitive_hit_count = sum(1 for value in private_values if value.strip() and value in scan_text)
    metadata = _metadata(
        out_dir=out_dir,
        summary_path=summary_path,
        stdout_path=stdout_path,
        stderr_path=stderr_path,
        runner_exit_code=exit_code,
        sensitive_hit_count=sensitive_hit_count,
        started_at=started_at,
        summary=summary,
    )
    _write_json(out_dir / "run-metadata.json", metadata)
    _write_audit_templates(out_dir, metadata)

    print(f"run_directory={out_dir}")
    print(f"runner_exit_code={exit_code}")
    print(f"summary_present={summary_path.exists()}")
    print(f"sensitive_hit_count={sensitive_hit_count}")
    if summary is not None:
        print(f"book_run_status={summary.get('book_run_status')}")
        print(f"actual_chapter_count={summary.get('actual_chapter_count')}")
        print(f"tokens_used={summary.get('tokens_used')}")
    if exit_code != 0:
        return exit_code
    if sensitive_hit_count != 0:
        return 11
    if summary is None or summary.get("book_run_status") != "completed" or summary.get("actual_chapter_count") != 3:
        return 12
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
