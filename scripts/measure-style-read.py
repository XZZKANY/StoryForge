"""Offline style-read comparison; synthetic corpus only, no real providers or manuscript writes.

Run with --output <json>; optionally --baseline-source <saved style_baseline.py>.
The baseline argument executes that local Python snapshot, not an external downloaded file.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.util
import json
import math
import platform
import statistics
import subprocess
import sys
import tempfile
import time
import tracemalloc
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "apps/api"), str(ROOT / "apps/api/tests")]

import pytest  # noqa: E402
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script  # noqa: E402
from authoring_measurement_support import fixture_text  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from style_read_support import CASES, ReadProbe, make_corpus  # noqa: E402

import app.models  # noqa: E402,F401
from app.common import author_voice, style_baseline  # noqa: E402
from app.common.llm_client import LLMError  # noqa: E402
from app.common.performance import RunMeasurement, measurement_scope  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.domains.agent_runs import service  # noqa: E402
from app.domains.assistant import service as assistant_service  # noqa: E402


def digest(value):
    return hashlib.sha256(
        value if isinstance(value, bytes) else value.encode()
    ).hexdigest()


def load_baseline(path):
    spec = importlib.util.spec_from_file_location("style_read_baseline_snapshot", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def identity():
    paths = sorted((ROOT / "apps/api/app").rglob("*.py"))
    paths += [Path(__file__), ROOT / "apps/api/tests/style_read_support.py"]
    code = hashlib.sha256()
    for path in paths:
        code.update(path.relative_to(ROOT).as_posix().encode())
        code.update(path.read_bytes())
    return {
        "backend_fixture_runner_hash": code.hexdigest(),
        "commit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "dirty": bool(
            subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT)
        ),
        "python": platform.python_version(),
        "platform": platform.platform(),
    }


def direct_sample(root, module):
    start = time.perf_counter()
    baseline = module.build_style_baseline(str(root))
    elapsed = (time.perf_counter() - start) * 1000
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(
            author_voice,
            "append_style_baseline_to_system_prompt",
            module.append_style_baseline_to_system_prompt,
        )
        prompt = author_voice.build_generation_system_prompt("通用准则", str(root))
    return {
        "elapsed_ms": elapsed,
        "signature": {
            "baseline": asdict(baseline) if baseline else None,
            "prompt_hash": digest(prompt),
            "author_last": prompt.endswith("保持短句，不新增设定。"),
        },
    }


def agent_sample(root, module, failure):
    """Real Agent chat + SDK + revision facade; transport/startup/GUI deliberately excluded."""
    target = root / "正文/第001章.md"
    original = fixture_text(2)
    target.write_bytes(original.encode())
    captures = []
    with (
        tempfile.TemporaryDirectory(prefix="style-read-db-") as directory,
        pytest.MonkeyPatch.context() as patch,
    ):
        db = create_engine(f"sqlite+pysqlite:///{Path(directory) / 'run.sqlite'}")
        Base.metadata.create_all(db)
        factory = sessionmaker(bind=db, autoflush=False, expire_on_commit=False)
        counts = {"sql_count": 0, "commit_count": 0, "model_calls": 0}
        event.listen(
            db,
            "before_cursor_execute",
            lambda *_: counts.update(sql_count=counts["sql_count"] + 1),
        )
        event.listen(
            db,
            "commit",
            lambda *_: counts.update(commit_count=counts["commit_count"] + 1),
        )
        patch.setattr(
            author_voice,
            "append_style_baseline_to_system_prompt",
            module.append_style_baseline_to_system_prompt,
        )
        _enable_loop_env(patch)

        def generate(_source, **kwargs):
            captures.append(digest(kwargs["system_prompt"]))
            counts["model_calls"] += 1
            if failure:
                raise LLMError("synthetic generation failed")
            return {
                "content": original + "\n她收起刀。",
                "completion_tokens": 8,
                "prompt_tokens": 10,
            }

        def deny_network(*_, **__):
            raise AssertionError("offline experiment must not use network")

        patch.setattr(assistant_service, "_call_llm_streamed", generate)
        patch.setattr("urllib.request.urlopen", deny_network)
        outer = _fake_llm_script(
            patch,
            [
                {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "style-revise",
                            "type": "function",
                            "function": {
                                "name": "file_revise",
                                "arguments": json.dumps(
                                    {
                                        "path": "正文/第001章.md",
                                        "instruction": "保守修订",
                                    }
                                ),
                            },
                        }
                    ],
                },
                {"content": "处理结束。", "tool_calls": []},
            ],
        )
        recorder = RunMeasurement(max_spans=256)
        try:
            with factory() as session, measurement_scope(recorder):
                start = time.perf_counter()
                run = service.run_agent_user_message(
                    session,
                    agent_session_id="style-measure",
                    message={
                        "run_id": "style-measure",
                        "user_message": "保守修订",
                        "permission_profile": "full",
                        "args": {
                            "project_path": str(root),
                            "context_bundle": {"files": []},
                        },
                    },
                )
                elapsed = (time.perf_counter() - start) * 1000
            proposal = run.result.get("proposed_patch")
            counts["model_calls"] += len(outer)
            selected = (
                {
                    key: proposal.get(key)
                    for key in ("before", "after", "requires_confirmation")
                }
                if proposal
                else None
            )
            return {
                "elapsed_ms": elapsed,
                "measurement": recorder.snapshot(),
                "resources": counts,
                "cost": {"state": "not_applicable", "amount": None},
                "signature": {
                    "prompt_hashes": captures,
                    "patch_hash": digest(json.dumps(selected, ensure_ascii=False)),
                    "patch_present": bool(proposal),
                    "original_unchanged": target.read_bytes() == original.encode(),
                },
                "expected_match": bool(proposal) is not failure
                and len(captures) == 1
                and counts["model_calls"] == 3,
            }
        finally:
            db.dispose()


def resource_sample(root, files, module):
    with ReadProbe(files) as probe:
        baseline = module.build_style_baseline(str(root))
    peaks = []
    for _ in range(3):
        gc.collect()
        tracemalloc.start()
        try:
            module.build_style_baseline(str(root))
            peaks.append(tracemalloc.get_traced_memory()[1])
        finally:
            tracemalloc.stop()
    return {
        "reads": probe.summary(),
        "peak_python_allocated_bytes": peaks,
        "baseline": asdict(baseline) if baseline else None,
    }


def safe_sample(function, *args):
    try:
        return {"ok": True, **function(*args)}
    except Exception:
        # Preserve failed observations, but do not export potentially sensitive exception text.
        return {
            "ok": False,
            "error_code": "unexpected_experiment_error",
            "elapsed_ms": None,
        }


def summarize(rows):
    groups = {}
    for row in rows:
        if row["phase"] != "sample":
            continue
        groups.setdefault(f"{row['variant']}:{row['case']}:{row['entry']}", []).append(
            row
        )
    result = {}
    for key, group in groups.items():
        values = sorted(r["elapsed_ms"] for r in group if r["elapsed_ms"] is not None)
        stages = [
            s["duration_ms"]
            for r in group
            for s in r.get("measurement", {}).get("stages", [])
            if s["name"] == "revision.system_prompt" and s["duration_ms"] is not None
        ]
        result[key] = {
            "samples": len(group),
            "failures": sum(not r["ok"] for r in group),
            "median_ms": statistics.median(values) if values else None,
            "p95_nearest_rank_ms": values[math.ceil(0.95 * len(values)) - 1]
            if values
            else None,
            "system_prompt_median_ms": statistics.median(stages) if stages else None,
        }
    return result


def experiment(*, baseline_source=None, samples=5, warmup=1):
    variants = {"candidate": style_baseline}
    if baseline_source:
        variants = {"baseline": load_baseline(baseline_source), **variants}
    rows, probes, fixtures = [], [], []
    with tempfile.TemporaryDirectory(prefix="style-read-corpus-") as directory:
        for case in CASES:
            root = Path(directory) / case
            files, fixture = make_corpus(root, case)
            fixtures.append(fixture)
            for index in range(warmup + samples):
                phase = "warmup" if index < warmup else "sample"
                # Alternate order instead of measuring all old samples before all new samples.
                ordered = list(variants.items())[:: 1 if index % 2 == 0 else -1]
                for name, module in ordered:
                    row = safe_sample(direct_sample, root, module)
                    rows.append(
                        {
                            "variant": name,
                            "case": case,
                            "entry": "baseline",
                            "phase": phase,
                            "iteration": index,
                            **row,
                        }
                    )
                    if case in {"normal", "large_suffix"}:
                        for failure in (False, True):
                            row = safe_sample(agent_sample, root, module, failure)
                            rows.append(
                                {
                                    "variant": name,
                                    "case": case,
                                    "entry": "agent_failure"
                                    if failure
                                    else "agent_success",
                                    "phase": phase,
                                    "iteration": index,
                                    **row,
                                }
                            )
            for name, module in variants.items():
                probes.append(
                    {
                        "variant": name,
                        "case": case,
                        **safe_sample(resource_sample, root, files, module),
                    }
                )
            fixture["original_unchanged"] = all(
                digest(file.read_bytes()) == fixture["content_sha256"] for file in files
            )
    signatures = {}
    for row in rows:
        key = (row["case"], row["entry"])
        if row["ok"]:
            signatures.setdefault(key, row["signature"])
        row["equivalent"] = row["ok"] and row["signature"] == signatures[key]
        row["correctness_passed"] = (
            row["equivalent"]
            and row.get("expected_match", True)
            and row["signature"].get("original_unchanged", True)
            and row["signature"].get("author_last", True)
        )
    return {
        "identity": identity(),
        "baseline_source_hash": digest(Path(baseline_source).read_bytes())
        if baseline_source
        else None,
        "conditions": {
            "samples": samples,
            "warmup": warmup,
            "cache_state": "unknown; first invocation retained separately",
            "read_probe_separate": True,
            "read_probe_scope": "binary reads of the synthetic corpus files; not other project files",
            "memory_probe_separate": True,
            "physical_disk_io_measured": False,
            "agent_scope": "public facade/chat/SDK/revision/SQLite; no SSE/startup/GUI/real provider",
        },
        "fixtures": fixtures,
        "rows": rows,
        "probes": probes,
        "summary": summarize(rows),
        "passed": (
            all(r["correctness_passed"] for r in rows)
            and all(p["ok"] for p in probes)
            and all(f["original_unchanged"] for f in fixtures)
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=5)
    parser.add_argument("--warmup", type=int, default=1)
    args = parser.parse_args()
    if not 1 <= args.samples <= 20 or not 1 <= args.warmup <= 5:
        parser.error("samples must be 1..20 and warmup 1..5")
    report = experiment(
        baseline_source=args.baseline_source, samples=args.samples, warmup=args.warmup
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "passed": report["passed"],
                "samples": len(report["rows"]),
                "summary": report["summary"],
            }
        )
    )
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
