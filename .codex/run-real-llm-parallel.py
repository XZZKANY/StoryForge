from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parents[1]
API_ROOT = ROOT / "apps" / "api"
sys.path.insert(0, str(API_ROOT))

import app.models  # noqa: E402,F401
from app.db.base import Base  # noqa: E402
from app.domains.book_runs.book_generation_parallel import run_book_generation_parallel  # noqa: E402
from app.domains.book_runs.book_generation import (  # noqa: E402
    REQUIRED_REAL_LLM_ENV,
    _artifact_text,
    _evidence_summary,
)

TEXT_ARTIFACT_NAMES = (
    "summary.json",
    "stdout.json",
    "stderr.log",
    "book.md",
    "audit_report.json",
    "run-metadata.json",
    "quality-risk.md",
    "human-readthrough-todo.md",
)

METRIC_THRESHOLDS = {
    "context_cache_hit_rate": (">", 0.95),
    "memory_recall_budget_used": ("<", 8000),
    "arc_completion_rate": (">=", 0.7),
    "db_query_count_per_chapter": ("<=", 3),
    "chapter_generation_time_p50": ("<", 20),
    "concurrent_chapter_utilization": (">", 0.6),
}


def _redact(text: str, private_values: Iterable[str]) -> str:
    redacted = text
    for value in private_values:
        if value.strip():
            redacted = redacted.replace(value, "[REDACTED_PRIVATE_RUNTIME_VALUE]")
    return redacted


def _sensitive_hit_count(paths: Iterable[Path], private_values: Iterable[str]) -> int:
    hits = 0
    values = [value for value in private_values if value.strip()]
    if not values:
        return 0
    for path in paths:
        if not path.exists() or not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for value in values:
            hits += content.count(value)
    return hits


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def _raise_if_outer_timeout_exceeded(*, started_at: float, outer_timeout_seconds: int, now: float | None = None) -> None:
    elapsed = (time.monotonic() if now is None else now) - started_at
    if elapsed > outer_timeout_seconds:
        raise RuntimeError(
            f"外层超时：elapsed_time_sec={int(elapsed)}，outer_timeout_seconds={outer_timeout_seconds}，本次运行不能标记为成功。"
        )


def _number_or_none(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    return None


def _metric_results(metrics: dict[str, Any]) -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    for name, (operator, threshold) in METRIC_THRESHOLDS.items():
        value = _number_or_none(metrics.get(name))
        if value is None:
            results[name] = {
                "status": "missing",
                "passed": False,
                "value": None,
                "threshold": threshold,
                "operator": operator,
            }
            continue
        passed = _metric_passed(value, operator, threshold)
        results[name] = {
            "status": "passed" if passed else "failed",
            "passed": passed,
            "value": value,
            "threshold": threshold,
            "operator": operator,
        }
    return results


def _metric_passed(value: float, operator: str, threshold: float) -> bool:
    if operator == ">":
        return value > threshold
    if operator == ">=":
        return value >= threshold
    if operator == "<":
        return value < threshold
    if operator == "<=":
        return value <= threshold
    return False


def _gate_failures(summary: dict[str, Any], *, token_budget: int) -> list[str]:
    failures: list[str] = []
    tokens_used = summary.get("tokens_used")
    if isinstance(tokens_used, int | float) and tokens_used >= token_budget:
        failures.append("tokens_used 达到或超过 token_budget")

    artifact_hashes = summary.get("artifact_hashes")
    if not isinstance(artifact_hashes, dict):
        artifact_hashes = {}
    if not artifact_hashes.get("book_md_sha256"):
        failures.append("缺少 book_md_sha256")
    if not artifact_hashes.get("audit_report_sha256"):
        failures.append("缺少 audit_report_sha256")

    per_chapter = summary.get("per_chapter_metrics")
    if not isinstance(per_chapter, list) or not per_chapter:
        failures.append("缺少 per_chapter_metrics")
    elif sum(int(item.get("quality_issue_count") or 0) for item in per_chapter if isinstance(item, dict)) > 3:
        failures.append("累计 quality_issue_count 超过 3")
    for item in per_chapter if isinstance(per_chapter, list) else []:
        if not isinstance(item, dict):
            continue
        score = item.get("quality_score")
        chapter_index = item.get("chapter_index")
        if isinstance(score, int | float) and score < 90:
            failures.append(f"第 {chapter_index} 章 quality_score 低于 90")

    metric_results = summary.get("metric_results")
    if not isinstance(metric_results, dict):
        failures.append("缺少 metric_results")
        return failures
    integration_metrics = summary.get("integration_metrics")
    dependency_mode = (
        integration_metrics.get("dependency_mode")
        if isinstance(integration_metrics, dict)
        else None
    )
    for name, result in metric_results.items():
        if not isinstance(result, dict):
            failures.append(f"{name} 指标结果格式无效")
            continue
        if result.get("passed") is True:
            continue
        if name == "concurrent_chapter_utilization" and dependency_mode == "prior_chapter_commit":
            continue
        if result.get("status") == "missing":
            failures.append(f"缺少 {name}")
        else:
            failures.append(_metric_failure_message(name))
    return failures


def _metric_failure_message(name: str) -> str:
    messages = {
        "context_cache_hit_rate": "context_cache_hit_rate 未超过 0.95",
        "memory_recall_budget_used": "memory_recall_budget_used 未低于 8000",
        "arc_completion_rate": "arc_completion_rate 低于 0.7",
        "db_query_count_per_chapter": "db_query_count_per_chapter 超过 3",
        "chapter_generation_time_p50": "chapter_generation_time_p50 未低于 20 秒",
        "concurrent_chapter_utilization": "concurrent_chapter_utilization 未超过 0.6",
    }
    return messages.get(name, f"{name} 未通过门禁")


def _raise_for_gate_failures(summary: dict[str, Any], *, token_budget: int) -> None:
    failures = _gate_failures(summary, token_budget=token_budget)
    if failures:
        raise RuntimeError("运行后成功门禁未通过：" + "；".join(failures))


def _integration_metrics_from_result(result: Any) -> dict[str, Any]:
    audit_payload = getattr(result.audit_artifact, "payload", None)
    if isinstance(audit_payload, dict):
        metrics = audit_payload.get("integration_metrics")
        if isinstance(metrics, dict):
            return dict(metrics)
        quality_summary = audit_payload.get("quality_summary")
        if isinstance(quality_summary, dict):
            metrics = quality_summary.get("integration_metrics")
            if isinstance(metrics, dict):
                return dict(metrics)
    try:
        parsed = json.loads(_artifact_text(result.audit_artifact))
    except (TypeError, ValueError):
        return {}
    if isinstance(parsed, dict):
        metrics = parsed.get("integration_metrics")
        if isinstance(metrics, dict):
            return dict(metrics)
    return {}


def _redacted_parameters(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "provider_protocol": "openai-compatible",
        "model": os.environ.get("STORYFORGE_LLM_MODEL", ""),
        "chapter_count": args.chapter_count,
        "chapter_parallelism": args.chapter_parallelism,
        "max_chapter_count": args.max_chapter_count,
        "token_budget": args.token_budget,
        "target_word_count": args.target_word_count,
        "chapter_word_count_min": args.chapter_word_count_min,
        "chapter_word_count_max": args.chapter_word_count_max,
        "timeout_seconds": args.timeout_seconds,
        "time_budget_seconds": args.time_budget_seconds,
        "outer_timeout_seconds": args.outer_timeout_seconds,
        "database_mode": "ephemeral_sqlite",
    }


def _metadata(
    *,
    out_dir: Path,
    runner_exit_code: int,
    sensitive_hit_count: int,
    started_at: float,
    args: argparse.Namespace,
    summary: dict[str, Any] | None,
    failure_message: str = "",
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "mode": "real_llm_parallel_smoke",
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S %z"),
        "output_directory": str(out_dir),
        "runner_exit_code": runner_exit_code,
        "summary_present": (out_dir / "summary.json").exists(),
        "sensitive_hit_count": sensitive_hit_count,
        "redacted_parameters": _redacted_parameters(args),
        "files": {name.replace(".", "_").replace("-", "_"): str(out_dir / name) for name in TEXT_ARTIFACT_NAMES},
        "elapsed_time_sec": max(0, int(time.monotonic() - started_at)),
        "gate_scope": "真实 6-8 章并发 smoke 证据，指标按实测记录，不代表长程 30 章完成。",
    }
    if failure_message:
        payload["failure_message"] = failure_message
        quality_gate_prefix = "运行后成功门禁未通过："
        if failure_message.startswith(quality_gate_prefix):
            payload["quality_gate_failed"] = True
            payload["quality_gate_failures"] = failure_message.removeprefix(quality_gate_prefix).split("；")
    if summary is not None:
        payload["summary"] = {
            "book_run_id": summary.get("book_run_id"),
            "book_run_status": summary.get("book_run_status"),
            "target_chapter_count": summary.get("target_chapter_count"),
            "actual_chapter_count": summary.get("actual_chapter_count"),
            "chapter_parallelism": summary.get("chapter_parallelism"),
            "target_word_count": summary.get("target_word_count"),
            "tokens_used": summary.get("tokens_used"),
            "estimated_cost": summary.get("estimated_cost"),
            "actual_total_chars": summary.get("actual_total_chars"),
            "markdown_artifact_id": summary.get("markdown_artifact_id"),
            "audit_artifact_id": summary.get("audit_artifact_id"),
            "per_chapter_char_counts": summary.get("per_chapter_char_counts"),
            "per_chapter_metrics": summary.get("per_chapter_metrics"),
            "artifact_hashes": summary.get("artifact_hashes"),
            "integration_metrics": summary.get("integration_metrics"),
            "metric_results": summary.get("metric_results"),
        }
    return payload


def _write_audit_templates(out_dir: Path, metadata: dict[str, Any]) -> None:
    params = metadata["redacted_parameters"]
    summary = metadata.get("summary", {})
    risk_text = f"""# 真实 LLM 并发 smoke 质量风险记录

生成时间：{metadata["generated_at"]}

## 脱敏运行参数

- provider_protocol: {params["provider_protocol"]}
- model: {params["model"]}
- chapter_count: {params["chapter_count"]}
- chapter_parallelism: {params["chapter_parallelism"]}
- target_word_count: {params["target_word_count"]}
- token_budget: {params["token_budget"]}

## 运行结果

- runner_exit_code: {metadata["runner_exit_code"]}
- summary_present: {metadata["summary_present"]}
- sensitive_hit_count: {metadata["sensitive_hit_count"]}
- book_run_status: {summary.get("book_run_status")}
- actual_chapter_count: {summary.get("actual_chapter_count")}
- tokens_used: {summary.get("tokens_used")}
- integration_metrics: {summary.get("integration_metrics")}
- metric_results: {summary.get("metric_results")}

## 风险说明

- 本次只证明小规模并发链路和实测指标，不证明 30 章长程稳定。
- context_cache_hit_rate 与 db_query_count_per_chapter 只有在真实采集时才写入，缺失即按失败记录。
- chapter_generation_time_p50 受模型 reasoning 延迟影响，本次只如实记录。
"""
    _write_text(out_dir / "quality-risk.md", risk_text)
    todo_text = f"""# 真实 LLM 并发 smoke 人工通读待办

生成时间：{metadata["generated_at"]}

## 必读范围

- 本次章节数：{params["chapter_count"]}
- 并发度：{params["chapter_parallelism"]}
- Markdown 产物 ID：{summary.get("markdown_artifact_id")}
- 审计报告 ID：{summary.get("audit_artifact_id")}

## 通读清单

- [ ] 核对每章是否完整。
- [ ] 标记重复段落、空泛段落或模板化表达。
- [ ] 核对人物、时间线、地点和伏笔是否冲突。
- [ ] 给出人工结论：通过 / 需修订 / 退回重跑。
"""
    _write_text(out_dir / "human-readthrough-todo.md", todo_text)


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="运行 StoryForge Phase9B 真实 LLM 并发 smoke，并生成脱敏证据。")
    parser.add_argument("--chapter-count", type=int, required=True)
    parser.add_argument("--chapter-parallelism", type=int, default=3)
    parser.add_argument("--max-chapter-count", type=int, default=8)
    parser.add_argument("--target-word-count", type=int, required=True)
    parser.add_argument("--token-budget", type=int, required=True)
    parser.add_argument("--chapter-word-count-min", type=int, default=600)
    parser.add_argument("--chapter-word-count-max", type=int, default=1600)
    parser.add_argument("--timeout-seconds", type=int, default=300)
    parser.add_argument("--time-budget-seconds", type=int, default=1800)
    parser.add_argument("--outer-timeout-seconds", type=int, default=2400)
    parser.add_argument("--label", type=str, default="parallel")
    return parser.parse_args(argv)


def _text_artifact_paths(out_dir: Path) -> list[Path]:
    return [out_dir / name for name in TEXT_ARTIFACT_NAMES]


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    missing = [name for name in REQUIRED_REAL_LLM_ENV if not os.environ.get(name)]
    if missing:
        print("missing_env=" + ",".join(missing))
        return 2
    os.environ["STORYFORGE_LLM_TIMEOUT_SECONDS"] = str(args.timeout_seconds)
    os.environ["STORYFORGE_LLM_SMOKE_TIME_BUDGET_SECONDS"] = str(args.time_budget_seconds)

    run_id = time.strftime("%Y%m%d-%H%M%S")
    safe_label = "".join(ch for ch in args.label if ch.isalnum() or ch in ("-", "_")) or "parallel"
    out_dir = ROOT / ".codex" / f"real-llm-parallel-{safe_label}-{run_id}"
    out_dir.mkdir(parents=True, exist_ok=True)
    sqlite_path = out_dir / "smoke.sqlite3"
    started_at = time.monotonic()
    private_values = [
        os.environ.get("STORYFORGE_LLM_BASE_URL", ""),
        os.environ.get("STORYFORGE_LLM_API_KEY", ""),
    ]
    summary: dict[str, Any] | None = None
    exit_code = 0
    stderr_text = ""
    failure_message = ""
    stdout_payload: dict[str, Any] = {"mode": "real_llm_parallel_smoke", "run_directory": str(out_dir)}

    engine = create_engine(f"sqlite+pysqlite:///{sqlite_path.as_posix()}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    try:
        _raise_if_outer_timeout_exceeded(started_at=started_at, outer_timeout_seconds=args.outer_timeout_seconds)
        with SessionLocal() as session:
            result = run_book_generation_parallel(
                session,
                session_factory=SessionLocal,
                chapter_count=args.chapter_count,
                chapter_parallelism=args.chapter_parallelism,
                token_budget=args.token_budget,
                target_word_count=args.target_word_count,
                chapter_word_count_min=args.chapter_word_count_min,
                chapter_word_count_max=args.chapter_word_count_max,
                max_chapter_count=args.max_chapter_count,
                env=os.environ,
            )
            _raise_if_outer_timeout_exceeded(started_at=started_at, outer_timeout_seconds=args.outer_timeout_seconds)
            summary = _evidence_summary(
                result,
                target_word_count=args.target_word_count,
                chapter_word_count_min=args.chapter_word_count_min,
                chapter_word_count_max=args.chapter_word_count_max,
            )
            summary["mode"] = "real_llm_parallel_smoke"
            summary["chapter_parallelism"] = args.chapter_parallelism
            summary["integration_metrics"] = _integration_metrics_from_result(result)
            summary["metric_results"] = _metric_results(summary["integration_metrics"])
            _write_json(out_dir / "summary.json", summary)
            _write_text(out_dir / "book.md", _artifact_text(result.markdown_artifact))
            _write_text(out_dir / "audit_report.json", _artifact_text(result.audit_artifact))
            _raise_for_gate_failures(summary, token_budget=args.token_budget)
            stdout_payload.update(
                {
                    "book_run_id": summary["book_run_id"],
                    "book_run_status": summary["book_run_status"],
                    "actual_chapter_count": summary["actual_chapter_count"],
                    "tokens_used": summary["tokens_used"],
                    "markdown_artifact_id": summary["markdown_artifact_id"],
                    "audit_artifact_id": summary["audit_artifact_id"],
                    "integration_metrics": summary["integration_metrics"],
                }
            )
    except Exception as exc:  # noqa: BLE001
        exit_code = 1
        stderr_text = _redact(str(exc), private_values)
        failure_message = stderr_text
    finally:
        engine.dispose()

    _write_json(out_dir / "stdout.json", stdout_payload)
    _write_text(out_dir / "stderr.log", stderr_text)
    metadata = _metadata(
        out_dir=out_dir,
        runner_exit_code=exit_code,
        sensitive_hit_count=0,
        started_at=started_at,
        args=args,
        summary=summary,
        failure_message=failure_message,
    )
    _write_json(out_dir / "run-metadata.json", metadata)
    _write_audit_templates(out_dir, metadata)
    sensitive_hit_count = _sensitive_hit_count(_text_artifact_paths(out_dir), private_values)
    metadata = _metadata(
        out_dir=out_dir,
        runner_exit_code=exit_code,
        sensitive_hit_count=sensitive_hit_count,
        started_at=started_at,
        args=args,
        summary=summary,
        failure_message=failure_message,
    )
    _write_json(out_dir / "run-metadata.json", metadata)

    print(f"run_directory={out_dir}")
    print(f"runner_exit_code={exit_code}")
    print(f"summary_present={(out_dir / 'summary.json').exists()}")
    print(f"sensitive_hit_count={sensitive_hit_count}")
    if summary is not None:
        print(f"book_run_status={summary.get('book_run_status')}")
        print(f"actual_chapter_count={summary.get('actual_chapter_count')}")
        print(f"tokens_used={summary.get('tokens_used')}")
    if exit_code != 0:
        return exit_code
    if sensitive_hit_count != 0:
        return 11
    if summary is None or summary.get("book_run_status") != "completed":
        return 12
    if summary.get("actual_chapter_count") != args.chapter_count:
        return 13
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
