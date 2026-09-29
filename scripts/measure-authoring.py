"""Offline authoring experiment: synthetic providers, temporary files/SQLite, no GUI/quality claims.

Run: uv run --no-sync --project apps/api python scripts/measure-authoring.py --output <json>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import statistics
import subprocess
import sys
import tempfile
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "apps/api"), str(ROOT / "apps/api/tests")]

import pytest  # noqa: E402 - development-only experiment runner
from agent_loop_runtime_test_support import (  # noqa: E402
    _enable_loop_env,
    _fake_llm_script,
    _send_chat_message,
)  # noqa: E402
from authoring_measurement_support import (  # noqa: E402
    FIXTURE_VERSION,
    SyntheticPolishProvider,
    fixture_resolution,
    fixture_revision,
    fixture_text,
)
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.models  # noqa: E402,F401 - register real application tables in temporary SQLite
from app.common.llm_client import LLMError  # noqa: E402
from app.common.performance import RunMeasurement, measurement_scope  # noqa: E402
from app.common.version import APP_VERSION  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.deps import get_session  # noqa: E402
from app.domains.agent_runs.llm_context import SNAPSHOT_VERSION  # noqa: E402
from app.domains.agent_runs.patches import polishing_service, run_controlled_polish  # noqa: E402
from app.domains.agent_runs.patches.polishing import (  # noqa: E402
    POLISH_GATE_VERSION,
    POLISH_RULE_VERSION,
)  # noqa: E402
from app.domains.assistant import service as assistant_service  # noqa: E402
from app.domains.assistant.revision import RevisionQualityRejected, revise_text  # noqa: E402
from app.domains.ide import router as ide_router, stream_measurement  # noqa: E402
from app.platform.ai_sdk.providers.anthropic import AnthropicProvider  # noqa: E402


def code_identity():
    digest = hashlib.sha256()
    files = sorted((ROOT / "apps/api/app").rglob("*.py"))
    files += [Path(__file__), ROOT / "apps/api/tests/authoring_measurement_support.py"]
    for path in files:
        digest.update(path.relative_to(ROOT).as_posix().encode())
        digest.update(path.read_bytes())

    def git(*args):
        return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()

    return {
        "app_version": APP_VERSION,
        "git_commit": git("rev-parse", "HEAD"),
        "dirty": bool(git("status", "--porcelain")),
        "backend_and_fixture_hash": digest.hexdigest(),
        "python_version": platform.python_version(),
        "platform": platform.platform(),
    }


def quality_summary(evaluations):
    reasons = Counter(
        reason.split(":", 1)[0]
        for gate in evaluations.values()
        for reason in gate.reasons
    )
    return {
        "gates": {name: gate.passed for name, gate in evaluations.items()},
        "reason_counts": dict(reasons),
    }


def sample(feature, scenario, entry, lines):
    content = fixture_text(lines)
    provider = SyntheticPolishProvider(scenario)
    generations = 0

    def generate(**_):
        nonlocal generations
        generations += 1
        if scenario == "provider_failure":
            raise LLMError("synthetic model failure")
        return {
            "content": "短" if scenario == "rejected" else content + "\n林岚收起刀。",
            "prompt_tokens": 10,
            "completion_tokens": 8,
            "token_usage_source": "synthetic",
        }

    row = {
        "feature": feature,
        "entry": entry,
        "case": scenario,
        "fixture": {
            "id": FIXTURE_VERSION,
            "content_hash": hashlib.sha256(content.encode()).hexdigest(),
            "content_chars": len(content),
            "line_count": len(content.splitlines()),
            "context_files": 0,
            "context_chars": 0,
        },
        "versions": {
            "snapshot": SNAPSHOT_VERSION,
            "rule": POLISH_RULE_VERSION,
            "gate": POLISH_GATE_VERSION,
        },
        "cost": {"state": "not_applicable", "amount": None},
        "usage": {
            "state": "unavailable",
            "source": None,
            "input_tokens": None,
            "output_tokens": None,
        },
        "resources": {"model_calls": 0, "sql_count": None, "commit_count": None},
        "quality": {"gates": {}, "reason_counts": {}},
        "outcome": "failed",
    }
    recorder = RunMeasurement(max_spans=256)
    start = time.perf_counter()
    expected = (
        "failed"
        if feature == "revision" and scenario == "provider_failure"
        else (
            "rejected"
            if scenario == "rejected"
            else "degraded"
            if scenario in {"provider_failure", "invalid_json", "truncated"}
            else ("noop" if scenario == "noop" else "success")
        )
    )
    try:
        if entry == "capability":
            with measurement_scope(recorder):
                if feature == "revision":
                    result = revise_text(
                        fixture_revision(content, gated=scenario == "rejected"),
                        generate=generate,
                    )
                    row["outcome"] = "success"
                    row["quality"] = quality_summary(
                        {"revision": result.quality_gate} if result.quality_gate else {}
                    )
                    row["usage"] = {
                        "state": "available",
                        "source": "synthetic",
                        "input_tokens": 10,
                        "output_tokens": 8,
                    }
                else:
                    result = run_controlled_polish(
                        content, provider=provider, resolution=fixture_resolution()
                    )
                    row["outcome"] = (
                        "success"
                        if result.decision.status == "accepted"
                        else result.decision.status
                    )
                    row["quality"] = quality_summary(result.decision.evaluations)
                    if result.usage:
                        row["usage"] = {
                            "state": "available",
                            "source": result.usage.get("source"),
                            "input_tokens": result.usage.get("input_tokens"),
                            "output_tokens": result.usage.get("output_tokens"),
                        }
            row["correctness"] = {"patch_present": None, "original_unchanged": True}
        else:
            # Real live chat -> SDK tool -> real capability -> evidence/permission -> SSE.
            with (
                tempfile.TemporaryDirectory(prefix="storyforge-measure-") as directory,
                pytest.MonkeyPatch.context() as patch,
            ):
                root = Path(directory)
                target = root / "正文/第01章.md"
                target.parent.mkdir()
                target.write_text(content, encoding="utf-8")
                engine = create_engine(
                    f"sqlite+pysqlite:///{(root / 'measure.sqlite').as_posix()}",
                    connect_args={"check_same_thread": False},
                )
                Base.metadata.create_all(engine)
                factory = sessionmaker(
                    bind=engine, autoflush=False, expire_on_commit=False
                )
                counts = {"sql_count": 0, "commit_count": 0}
                event.listen(
                    engine,
                    "before_cursor_execute",
                    lambda *_: counts.update(sql_count=counts["sql_count"] + 1),
                )
                event.listen(
                    engine,
                    "commit",
                    lambda *_: counts.update(commit_count=counts["commit_count"] + 1),
                )

                def session_dependency():
                    with factory() as session:
                        yield session

                application = (
                    FastAPI()
                )  # No production startup/config DB; real IDE routes/runtime.
                application.include_router(ide_router.router)
                application.dependency_overrides[get_session] = session_dependency
                captures = []
                patch.setattr(stream_measurement, "log_measurement", captures.append)
                _enable_loop_env(patch)
                patch.setattr(
                    assistant_service,
                    "_call_llm_streamed",
                    lambda _source, **kw: generate(**kw),
                )
                patch.setattr(
                    polishing_service,
                    "resolve_polish_llm",
                    lambda **_: fixture_resolution(),
                )
                patch.setattr(
                    AnthropicProvider,
                    "complete",
                    lambda _self, request: provider.complete(request),
                )

                def deny_network(*_args, **_kwargs):
                    raise AssertionError("offline experiment must not use network")

                patch.setattr("urllib.request.urlopen", deny_network)
                tool = "file_revise" if feature == "revision" else "chapter_polish"
                outer = _fake_llm_script(
                    patch,
                    [
                        {
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": "measure",
                                    "type": "function",
                                    "function": {
                                        "name": tool,
                                        "arguments": json.dumps(
                                            {
                                                "path": "正文/第01章.md",
                                                "instruction": "保守修订",
                                            }
                                        ),
                                    },
                                }
                            ],
                        },
                        {
                            "content": "请查看处理结果。",
                            "tool_calls": [],
                            "prompt_tokens": 3,
                            "completion_tokens": 2,
                        },
                    ],
                )
                try:
                    with TestClient(application) as client:
                        start = (
                            time.perf_counter()
                        )  # Exclude fixture/DB/schema/client setup.
                        final = _send_chat_message(
                            client,
                            run_id="experiment-run",
                            project_path=str(root),
                            message="保守修订",
                            permission_profile="full",
                        )[-1]
                        elapsed = (time.perf_counter() - start) * 1000
                    snapshot = max(captures, key=lambda item: len(item["stages"]))
                    row["measurement"] = snapshot
                    row["resources"].update(counts)
                    row["resources"]["model_calls"] += len(outer)
                    proposal = final.get("proposed_patch")
                    trace = [
                        item
                        for item in final.get("tool_trace", [])
                        if item.get("tool_name") == tool.replace("_", ".", 1)
                    ]
                    row["outcome"] = (
                        "degraded"
                        if proposal and proposal.get("degraded")
                        else "success"
                        if proposal
                        else (
                            "failed"
                            if feature == "revision" and failure_in(snapshot)
                            else "noop"
                        )
                    )
                    if trace and isinstance(trace[-1].get("output_summary"), dict):
                        summary = trace[-1]["output_summary"]
                        codes = Counter(
                            reason.split(":", 1)[0]
                            for reasons in summary.get("gate_reasons", {}).values()
                            for reason in reasons
                        )
                        row["quality"]["reason_counts"] = dict(codes)
                        row["quality"]["gates"] = {name: not reasons for name, reasons in summary.get("gate_reasons", {}).items()}
                    row["correctness"] = {
                        "patch_present": bool(proposal),
                        "original_unchanged": target.read_text(encoding="utf-8")
                        == content,
                    }
                    row["elapsed_ms"] = elapsed
                finally:
                    engine.dispose()
    except RevisionQualityRejected as exc:
        row["outcome"] = "rejected"
        row["quality"] = quality_summary({"revision": exc.gate})
    except LLMError:
        row["outcome"] = "failed"
    except Exception:  # Preserve unexpected failed samples without dumping private exception text.
        row["error_code"] = "unexpected_experiment_error"
        row["outcome"] = "failed"
        row["correctness"] = {"patch_present": None, "original_unchanged": None}
    row.setdefault("elapsed_ms", (time.perf_counter() - start) * 1000)
    row.setdefault("measurement", recorder.snapshot())
    row.setdefault("correctness", {"patch_present": None, "original_unchanged": True})
    row["correctness"]["expected_result_match"] = row["outcome"] == expected and "error_code" not in row
    row["resources"]["model_calls"] += generations + provider.calls
    return row


def failure_in(snapshot):
    return any(
        s["name"] == "revision.model" and s["status"] == "error"
        for s in snapshot["stages"]
    )


def summarize(rows):
    groups = {}
    for row in rows:
        key = f"{row['feature']}:{row['entry']}:{row['case']}:{row['fixture']['content_chars']}"
        groups.setdefault(key, []).append(row)
    result = {}
    for key, group in groups.items():
        successful = [r["elapsed_ms"] for r in group if r["outcome"] == "success"]
        result[key] = {
            "samples": len(group),
            "outcomes": dict(Counter(r["outcome"] for r in group)),
            "failure_rate": sum(r["outcome"] == "failed" for r in group) / len(group),
            "median_all_ms": statistics.median(r["elapsed_ms"] for r in group),
            "median_success_ms": statistics.median(successful) if successful else None,
            "correctness_passed": all(
                r["correctness"]["expected_result_match"] and r["correctness"]["original_unchanged"] is True
                for r in group
            ),
        }
        # Individual stage observations, not a sum of overlapping parent/child intervals.
        stage_times = {}
        for row in group:
            for stage in row["measurement"]["stages"]:
                if stage["duration_ms"] is not None:
                    stage_times.setdefault(stage["name"], []).append(
                        stage["duration_ms"]
                    )
        result[key]["stage_median_ms"] = {
            name: statistics.median(values) for name, values in stage_times.items()
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--samples", type=int, default=5)
    parser.add_argument("--warmup", type=int, default=1)
    parser.add_argument("--lines", type=int, nargs="+", default=[10, 100])
    args = parser.parse_args()
    if args.samples < 1 or args.warmup < 0 or any(n < 1 for n in args.lines):
        parser.error("positive samples/lines and nonnegative warmup required")
    rows = []
    for lines in args.lines:
        for feature, scenarios in [
            ("revision", ["success", "provider_failure", "rejected"]),
            (
                "polish",
                ["success", "provider_failure", "invalid_json", "noop", "truncated"],
            ),
        ]:
            for scenario in scenarios:
                for entry in (
                    ["capability", "sse_chat"]
                    if scenario in {"success", "provider_failure"}
                    else ["capability"]
                ):
                    for index in range(-args.warmup, args.samples):
                        row = sample(feature, scenario, entry, lines)
                        if index >= 0:
                            rows.append({"sample_index": index, **row})
    report = {
        "schema_version": 1,
        "mode": "deterministic_local",
        "code": code_identity(),
        "configuration": {
            "samples": args.samples,
            "warmup": args.warmup,
            "lines": args.lines,
        },
        "scope": "Synthetic capability and in-process real SSE chat; no production startup/middleware, real provider, network TTFT or GUI claims.",
        "samples": rows,
        "summary": summarize(rows),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "samples": len(rows),
                "output": str(args.output),
                "all_expected": all(
                    r["correctness"]["expected_result_match"] for r in rows
                ),
            }
        )
    )
    return (
        0
        if all(
            r["correctness"]["expected_result_match"]
            and r["correctness"]["original_unchanged"]
            for r in rows
        )
        else 1
    )


if __name__ == "__main__":
    raise SystemExit(main())
