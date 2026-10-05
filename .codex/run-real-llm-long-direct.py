from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import zipfile
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parents[1]
API_ROOT = ROOT / "apps" / "api"
sys.path.insert(0, str(API_ROOT))

import app.models  # noqa: E402,F401
from app.db.base import Base  # noqa: E402
from app.domains.book_runs.book_generation import (  # noqa: E402
    REQUIRED_REAL_LLM_ENV,
    _artifact_text,
    _evidence_summary,
    resume_book_generation,
    run_book_generation,
)
from app.domains.exports.book_markdown_exporter import build_book_run_epub_package, export_book_run_epub  # noqa: E402


TEXT_ARTIFACT_NAMES = (
    "summary.json",
    "stdout.json",
    "stderr.log",
    "book.md",
    "book.epub",
    "audit_report.json",
    "run-metadata.json",
    "quality-risk.md",
    "human-readthrough-todo.md",
)


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
            if path.suffix.lower() == ".epub":
                hits += _sensitive_hit_count_in_epub(path, values)
            continue
        for value in values:
            hits += content.count(value)
    return hits


def _sensitive_hit_count_in_epub(path: Path, private_values: Iterable[str]) -> int:
    hits = 0
    try:
        with zipfile.ZipFile(path) as archive:
            for info in archive.infolist():
                lower_name = info.filename.lower()
                if lower_name.endswith((".opf", ".ncx", ".xhtml", ".html", ".xml", ".txt", ".json")):
                    content = archive.read(info).decode("utf-8", errors="ignore")
                    for value in private_values:
                        hits += info.filename.count(value)
                        hits += content.count(value)
    except zipfile.BadZipFile:
        return hits
    return hits


def _raise_if_outer_timeout_exceeded(*, started_at: float, outer_timeout_seconds: int, now: float | None = None) -> None:
    elapsed = (time.monotonic() if now is None else now) - started_at
    if elapsed > outer_timeout_seconds:
        raise RuntimeError(
            f"外层超时：elapsed_time_sec={int(elapsed)}，outer_timeout_seconds={outer_timeout_seconds}，本次运行不能标记为成功。"
        )


def _gate_failures(summary: dict[str, Any], *, token_budget: int, require_integration_gate: bool = False) -> list[str]:
    failures: list[str] = []
    tokens_used = summary.get("tokens_used")
    if isinstance(tokens_used, int | float) and tokens_used >= token_budget:
        failures.append("tokens_used 达到或超过 token_budget")

    artifact_hashes = summary.get("artifact_hashes")
    if not isinstance(artifact_hashes, dict):
        artifact_hashes = {}
    if not artifact_hashes.get("book_md_sha256"):
        failures.append("缺少 book_md_sha256")
    if not artifact_hashes.get("book_epub_sha256"):
        failures.append("缺少 book_epub_sha256")
    if not artifact_hashes.get("audit_report_sha256"):
        failures.append("缺少 audit_report_sha256")

    metrics = summary.get("per_chapter_metrics")
    if not isinstance(metrics, list) or not metrics:
        failures.append("缺少 per_chapter_metrics")
        return failures

    total_issue_count = 0
    for item in metrics:
        if not isinstance(item, dict):
            failures.append("per_chapter_metrics 包含不可解析条目")
            continue
        chapter_index = item.get("chapter_index", "?")
        quality_score = item.get("quality_score")
        if not isinstance(quality_score, int | float):
            failures.append(f"第 {chapter_index} 章缺少 quality_score")
        elif quality_score < 90:
            failures.append(f"第 {chapter_index} 章 quality_score 低于 90")
        issue_count = item.get("quality_issue_count", 0)
        if isinstance(issue_count, int | float):
            total_issue_count += int(issue_count)
    if total_issue_count > 3:
        failures.append("累计 quality_issue_count 超过 3")

    failures.extend(_story_state_changes_evidence_failures(summary))
    failures.extend(_full_book_advisory_evidence_failures(summary.get("audit_report")))

    if require_integration_gate:
        failures.extend(_integration_metric_failures(summary.get("integration_metrics")))
    return failures


def _story_state_changes_evidence_failures(summary: dict[str, Any]) -> list[str]:
    metrics = summary.get("per_chapter_metrics")
    audit_report = summary.get("audit_report")
    chapter_sources: list[str] = []
    for collection in (metrics, _audit_chapters(audit_report)):
        if not isinstance(collection, list):
            continue
        for item in collection:
            if not isinstance(item, dict):
                continue
            source = str(item.get("story_state_changes_source") or "").strip().lower()
            if source:
                chapter_sources.append(source)
    valid_sources = [source for source in chapter_sources if source not in {"none", "missing", "unavailable", "null"}]
    if not valid_sources:
        return ["缺少 story_state_changes_source 证据"]
    return []


def _audit_chapters(audit_report: Any) -> Any:
    if isinstance(audit_report, dict):
        return audit_report.get("chapters")
    return None


def _full_book_advisory_evidence_failures(audit_report: Any) -> list[str]:
    if not isinstance(audit_report, dict):
        return ["缺少 audit_report.full_book_advisory_audit"]
    advisory = audit_report.get("full_book_advisory_audit")
    if not isinstance(advisory, dict):
        return ["缺少 audit_report.full_book_advisory_audit"]
    failures: list[str] = []
    if advisory.get("hard_gate") is not False:
        failures.append("full_book_advisory_audit.hard_gate 必须为 false")
    if not advisory.get("status"):
        failures.append("缺少 full_book_advisory_audit.status")
    if "checks" not in advisory:
        failures.append("缺少 full_book_advisory_audit.checks")
    quality_summary = audit_report.get("quality_summary")
    if not isinstance(quality_summary, dict) or not quality_summary.get("full_book_advisory_status"):
        failures.append("缺少 quality_summary.full_book_advisory_status")
    return failures


def _integration_metric_failures(metrics: Any) -> list[str]:
    failures: list[str] = []
    if not isinstance(metrics, dict):
        return ["缺少 integration_metrics"]

    context_cache_hit_rate = _number_or_none(metrics.get("context_cache_hit_rate"))
    if context_cache_hit_rate is None:
        failures.append("缺少 context_cache_hit_rate")
    elif context_cache_hit_rate <= 0.95:
        failures.append("context_cache_hit_rate 未超过 0.95")

    memory_recall_budget_used = _number_or_none(metrics.get("memory_recall_budget_used"))
    if memory_recall_budget_used is None:
        failures.append("缺少 memory_recall_budget_used")
    elif memory_recall_budget_used >= 8000:
        failures.append("memory_recall_budget_used 未低于 8000")

    arc_completion_rate = _number_or_none(metrics.get("arc_completion_rate"))
    if arc_completion_rate is None:
        failures.append("缺少 arc_completion_rate")
    elif arc_completion_rate < 0.7:
        failures.append("arc_completion_rate 低于 0.7")

    db_query_count_per_chapter = _number_or_none(metrics.get("db_query_count_per_chapter"))
    if db_query_count_per_chapter is None:
        failures.append("缺少 db_query_count_per_chapter")
    elif db_query_count_per_chapter > 3:
        failures.append("db_query_count_per_chapter 超过 3")

    chapter_generation_time_p50 = _number_or_none(metrics.get("chapter_generation_time_p50"))
    if chapter_generation_time_p50 is None:
        failures.append("缺少 chapter_generation_time_p50")
    elif chapter_generation_time_p50 >= 20:
        failures.append("chapter_generation_time_p50 未低于 20 秒")

    concurrent_chapter_utilization = _number_or_none(metrics.get("concurrent_chapter_utilization"))
    if concurrent_chapter_utilization is None:
        failures.append("缺少 concurrent_chapter_utilization")
    elif concurrent_chapter_utilization <= 0.6:
        failures.append("concurrent_chapter_utilization 未超过 0.6")

    return failures


def _number_or_none(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    return None


def _raise_for_gate_failures(
    summary: dict[str, Any], *, token_budget: int, require_integration_gate: bool = False
) -> None:
    failures = _gate_failures(
        summary,
        token_budget=token_budget,
        require_integration_gate=require_integration_gate,
    )
    if failures:
        raise RuntimeError("运行后成功门禁未通过：" + "；".join(failures))


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def _redacted_parameters(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "provider_protocol": "openai-compatible",
        "model": os.environ.get("STORYFORGE_LLM_MODEL", ""),
        "chapter_count": args.chapter_count,
        "max_chapter_count": args.max_chapter_count,
        "token_budget": args.token_budget,
        "target_word_count": args.target_word_count,
        "chapter_word_count_min": args.chapter_word_count_min,
        "chapter_word_count_max": args.chapter_word_count_max,
        "timeout_seconds": args.timeout_seconds,
        "time_budget_seconds": args.time_budget_seconds,
        "outer_timeout_seconds": args.outer_timeout_seconds,
        "require_integration_gate": args.require_integration_gate,
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
        "mode": "real_llm_long_smoke",
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S %z"),
        "output_directory": str(out_dir),
        "runner_exit_code": runner_exit_code,
        "summary_present": (out_dir / "summary.json").exists(),
        "sensitive_hit_count": sensitive_hit_count,
        "redacted_parameters": _redacted_parameters(args),
        "files": {name.replace(".", "_").replace("-", "_"): str(out_dir / name) for name in TEXT_ARTIFACT_NAMES},
        "elapsed_time_sec": max(0, int(time.monotonic() - started_at)),
        "gate_scope": (
            "真实 LLM 长跑技术证据；PH5 并发集成指标默认只记录，"
            "仅在 require_integration_gate=true 时作为失败条件。"
        ),
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
            "target_word_count": summary.get("target_word_count"),
            "tokens_used": summary.get("tokens_used"),
            "estimated_cost": summary.get("estimated_cost"),
            "actual_total_chars": summary.get("actual_total_chars"),
            "markdown_artifact_id": summary.get("markdown_artifact_id"),
            "epub_artifact_id": summary.get("epub_artifact_id"),
            "audit_artifact_id": summary.get("audit_artifact_id"),
            "epub_size_bytes": summary.get("epub_size_bytes"),
            "prompt_tokens_used": summary.get("prompt_tokens_used"),
            "completion_tokens_used": summary.get("completion_tokens_used"),
            "cost_cny_estimated": summary.get("cost_cny_estimated"),
            "cost_breakdown": summary.get("cost_breakdown"),
            "total_latency_ms": summary.get("total_latency_ms"),
            "avg_latency_ms": summary.get("avg_latency_ms"),
            "max_latency_ms": summary.get("max_latency_ms"),
            "failure_count": summary.get("failure_count"),
            "repair_round_count": summary.get("repair_round_count"),
            "per_chapter_char_counts": summary.get("per_chapter_char_counts"),
            "per_chapter_metrics": summary.get("per_chapter_metrics"),
            "artifact_hashes": summary.get("artifact_hashes"),
            "integration_metrics": summary.get("integration_metrics"),
            "full_book_advisory_status": summary.get("full_book_advisory_status"),
        }
    resume_source = getattr(args, "resume_run_directory", None)
    if resume_source:
        payload["resume_source_directory"] = str(Path(resume_source))
    return payload


def _write_audit_templates(out_dir: Path, metadata: dict[str, Any]) -> None:
    params = metadata["redacted_parameters"]
    summary = metadata.get("summary", {})
    risk_text = f"""# 真实 LLM {params["chapter_count"]} 章 smoke 质量风险记录

生成时间：{metadata["generated_at"]}

## 脱敏运行参数

- provider_protocol: {params["provider_protocol"]}
- model: {params["model"]}
- chapter_count: {params["chapter_count"]}
- target_word_count: {params["target_word_count"]}
- token_budget: {params["token_budget"]}
- timeout_seconds: {params["timeout_seconds"]}
- time_budget_seconds: {params["time_budget_seconds"]}
- outer_timeout_seconds: {params["outer_timeout_seconds"]}
- require_integration_gate: {params["require_integration_gate"]}
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
- epub_artifact_id: {summary.get("epub_artifact_id")}
- audit_artifact_id: {summary.get("audit_artifact_id")}
- cost_cny_estimated: {summary.get("cost_cny_estimated")}

## 质量风险

- 本次最多只能证明真实外部 LLM {params["chapter_count"]} 章 smoke 完成与否，不能证明 3-5 万字长程完成。
- 本次使用一次性 SQLite 数据库，不能证明默认 Postgres 或跨卷生产稳定性。
- 必须完成全篇人工通读后，才能把本次 smoke 记为通过。
- 若发现重复段落、设定漂移、角色口吻异常或模型痕迹，必须暂停扩大到更长程。
"""
    _write_text(out_dir / "quality-risk.md", risk_text)
    todo_text = f"""# 真实 LLM {params["chapter_count"]} 章 smoke 人工通读待办

生成时间：{metadata["generated_at"]}

## 必读范围

- 本次章节数：{params["chapter_count"]}
- Markdown 产物 ID：{summary.get("markdown_artifact_id")}
- EPUB 产物 ID：{summary.get("epub_artifact_id")}
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
- 是否允许评估 3-5 万字长程：待补
"""
    _write_text(out_dir / "human-readthrough-todo.md", todo_text)


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="运行 StoryForge 真实 LLM 长程 smoke，并生成脱敏证据。")
    parser.add_argument("--chapter-count", type=int, required=True)
    parser.add_argument("--max-chapter-count", type=int, default=30)
    parser.add_argument("--target-word-count", type=int, required=True)
    parser.add_argument("--token-budget", type=int, required=True)
    parser.add_argument("--chapter-word-count-min", type=int, default=600)
    parser.add_argument("--chapter-word-count-max", type=int, default=1600)
    parser.add_argument("--timeout-seconds", type=int, default=300)
    parser.add_argument("--time-budget-seconds", type=int, default=4200)
    parser.add_argument("--outer-timeout-seconds", type=int, default=4800)
    parser.add_argument("--label", type=str, default="10ch")
    parser.add_argument("--resume-run-directory", type=str, default=None)
    parser.add_argument("--require-integration-gate", action="store_true")
    return parser.parse_args(argv)


def _resolve_resume_run_directory(value: str | None) -> Path | None:
    """恢复源目录相对路径按仓库根目录解析，避免受 apps/api 工作目录影响。"""

    if value is None or not value.strip():
        return None
    path = Path(value)
    if path.is_absolute():
        return path.resolve()
    parts = path.parts
    if len(parts) >= 3 and parts[0] == "docs" and parts[1] == "internal" and parts[2] == "codex":
        return (ROOT / ".codex" / Path(*parts[3:])).resolve()
    return (ROOT / path).resolve()


def _text_artifact_paths(out_dir: Path) -> list[Path]:
    return [out_dir / name for name in TEXT_ARTIFACT_NAMES]


def _write_bytes(path: Path, content: bytes) -> None:
    path.write_bytes(content)


def _sha256_bytes(content: bytes) -> str:
    import hashlib

    return hashlib.sha256(content).hexdigest()


def _epub_bytes_from_artifact(artifact: Any) -> bytes:
    payload = getattr(artifact, "payload", None)
    if isinstance(payload, bytes):
        return payload
    return _artifact_text(artifact).encode("utf-8")


def _attach_epub_summary(summary: dict[str, Any], epub_artifact: Any, epub_bytes: bytes) -> None:
    artifact_hashes = summary.get("artifact_hashes")
    if not isinstance(artifact_hashes, dict):
        artifact_hashes = {}
        summary["artifact_hashes"] = artifact_hashes
    summary["epub_artifact_id"] = getattr(epub_artifact, "id", None)
    artifact_hashes["book_epub_sha256"] = _sha256_bytes(epub_bytes)
    size_bytes = getattr(epub_artifact, "size_bytes", None)
    summary["epub_size_bytes"] = int(size_bytes) if isinstance(size_bytes, int) else len(epub_bytes)


def _integration_metrics_from_result(result: Any) -> dict[str, Any]:
    """从审计报告透传 PH5 集成指标，缺失时让门禁显式失败。"""

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
        quality_summary = parsed.get("quality_summary")
        if isinstance(quality_summary, dict):
            metrics = quality_summary.get("integration_metrics")
            if isinstance(metrics, dict):
                return dict(metrics)
    return {}


def _parse_audit_report_payload(result: Any) -> dict[str, Any]:
    audit_payload = getattr(result.audit_artifact, "payload", None)
    if isinstance(audit_payload, dict):
        return dict(audit_payload)
    try:
        parsed = json.loads(_artifact_text(result.audit_artifact))
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    missing = [name for name in REQUIRED_REAL_LLM_ENV if not os.environ.get(name)]
    if missing:
        print("missing_env=" + ",".join(missing))
        return 2
    os.environ["STORYFORGE_LLM_TIMEOUT_SECONDS"] = str(args.timeout_seconds)
    os.environ["STORYFORGE_LLM_SMOKE_TIME_BUDGET_SECONDS"] = str(args.time_budget_seconds)

    run_id = time.strftime("%Y%m%d-%H%M%S")
    safe_label = "".join(ch for ch in args.label if ch.isalnum() or ch in ("-", "_")) or "long"
    out_dir = ROOT / ".codex" / f"real-llm-{safe_label}-{run_id}"
    out_dir.mkdir(parents=True, exist_ok=True)
    sqlite_path = out_dir / "smoke.sqlite3"
    resume_source_dir = _resolve_resume_run_directory(args.resume_run_directory)
    if resume_source_dir is not None:
        source_sqlite_path = resume_source_dir / "smoke.sqlite3"
        if not source_sqlite_path.exists():
            print(f"resume_source_sqlite_missing={source_sqlite_path}")
            return 2
        shutil.copy2(source_sqlite_path, sqlite_path)
    started_at = time.monotonic()
    private_values = [
        os.environ.get("STORYFORGE_LLM_BASE_URL", ""),
        os.environ.get("STORYFORGE_LLM_API_KEY", ""),
    ]
    summary: dict[str, Any] | None = None
    exit_code = 0
    stderr_text = ""
    failure_message = ""
    stdout_payload: dict[str, Any] = {"mode": "real_llm_long_smoke", "run_directory": str(out_dir)}

    engine = create_engine(f"sqlite+pysqlite:///{sqlite_path.as_posix()}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    try:
        _raise_if_outer_timeout_exceeded(started_at=started_at, outer_timeout_seconds=args.outer_timeout_seconds)
        with SessionLocal() as session:
            if resume_source_dir is None:
                result = run_book_generation(
                    session,
                    chapter_count=args.chapter_count,
                    token_budget=args.token_budget,
                    target_word_count=args.target_word_count,
                    chapter_word_count_min=args.chapter_word_count_min,
                    chapter_word_count_max=args.chapter_word_count_max,
                    max_chapter_count=args.max_chapter_count,
                    env=os.environ,
                )
            else:
                result = resume_book_generation(
                    session,
                    book_run_id=1,
                    chapter_count=args.chapter_count,
                    token_budget=args.token_budget,
                    target_word_count=args.target_word_count,
                    chapter_word_count_min=args.chapter_word_count_min,
                    chapter_word_count_max=args.chapter_word_count_max,
                    max_chapter_count=args.max_chapter_count,
                    env=os.environ,
                )
            _raise_if_outer_timeout_exceeded(started_at=started_at, outer_timeout_seconds=args.outer_timeout_seconds)
            epub_artifact = getattr(result, "epub_artifact", None)
            if epub_artifact is None:
                epub_artifact = export_book_run_epub(session, result.book_run.id)
                epub_bytes = build_book_run_epub_package(session, result.book_run.id)
            else:
                epub_bytes = _epub_bytes_from_artifact(epub_artifact)
            summary = _evidence_summary(
                result,
                target_word_count=args.target_word_count,
                chapter_word_count_min=args.chapter_word_count_min,
                chapter_word_count_max=args.chapter_word_count_max,
            )
            _attach_epub_summary(summary, epub_artifact, epub_bytes)
            audit_report = _parse_audit_report_payload(result)
            quality_summary = audit_report.get("quality_summary") if isinstance(audit_report, dict) else None
            if isinstance(quality_summary, dict):
                summary["full_book_advisory_status"] = quality_summary.get("full_book_advisory_status")
            summary["integration_metrics"] = _integration_metrics_from_result(result)
            _write_json(out_dir / "summary.json", summary)
            _write_text(out_dir / "book.md", _artifact_text(result.markdown_artifact))
            _write_bytes(out_dir / "book.epub", epub_bytes)
            _write_text(out_dir / "audit_report.json", _artifact_text(result.audit_artifact))
            gate_summary = dict(summary)
            gate_summary["audit_report"] = audit_report
            _raise_for_gate_failures(
                gate_summary,
                token_budget=args.token_budget,
                require_integration_gate=args.require_integration_gate,
            )
            stdout_payload.update(
                {
                    "book_run_id": summary["book_run_id"],
                    "book_run_status": summary["book_run_status"],
                    "actual_chapter_count": summary["actual_chapter_count"],
                    "tokens_used": summary["tokens_used"],
                    "markdown_artifact_id": summary["markdown_artifact_id"],
                    "epub_artifact_id": summary["epub_artifact_id"],
                    "audit_artifact_id": summary["audit_artifact_id"],
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
    sensitive_hit_count = _sensitive_hit_count(_text_artifact_paths(out_dir), private_values)
    if sensitive_hit_count != metadata["sensitive_hit_count"]:
        metadata["sensitive_hit_count"] = sensitive_hit_count
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
