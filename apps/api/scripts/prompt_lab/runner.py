"""prompt 对比实验台 CLI：固定输入 × 变体配置 → 真 LLM 输出 → 并排报告。

用法：
    # dry-run（零成本，先验 prompt 装配与报告可读性）
    uv run python -m scripts.prompt_lab.runner --all --dry-run
    uv run python -m scripts.prompt_lab.runner --task opening-preview,critique-draft --variants baseline,no-craft --dry-run
    # 真跑（人工实验；Windows 需先挂本机配置；--jobs 控制 LLM 调用并行度）
    $env:STORYFORGE_LLM_CONFIG_FILE = "$env:APPDATA\\com.storyforge.ide\\llm-provider.json"
    uv run python -m scripts.prompt_lab.runner --all --out .codex/prompt-lab/wave1 --seed 42 --jobs 8
    # 补跑失败的格子并合并回既有 run（其余格子保留，blind seed 沿用）
    uv run python -m scripts.prompt_lab.runner --merge .codex/prompt-lab/wave1 --task transition-full --variants baseline,task-rewrite --jobs 2

真 LLM 调用只走 app.common.llm_client（唯一出网通道）；本工具在 app/ 之外，
不会被 PyInstaller 打进 sidecar exe。判定靠人工读 report.md，工具不下结论。
当前正文只认 run-metadata.json 的 current_outputs（含 SHA-256）；outputs 子目录保留历史，
不能用文件数量当样本数。盲评只分发 blind.md；blind-reveal.json 和 metadata 留给组织者。
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import sys
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.common.llm_client import LLMConfigError, call_llm_streamed, error_usage_summary
from app.common.llm_env import resolved_llm_env
from app.common.llm_observation import model_observation_scope
from app.common.redaction import redact_sensitive, redact_sensitive_text
from scripts.prompt_lab import report
from scripts.prompt_lab.agent_registry import AGENT_VARIANTS
from scripts.prompt_lab.fixtures import TASKS
from scripts.prompt_lab.registry import BOOK_VARIANTS

_REPO_ROOT = Path(__file__).resolve().parents[4]


def _default_out_dir() -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return _REPO_ROOT / ".codex" / "prompt-lab" / stamp


def _select_variants(kind: str, names: list[str] | None) -> dict[str, Any]:
    registry = AGENT_VARIANTS if kind == "agent" else BOOK_VARIANTS[kind]
    if names:
        missing = [name for name in names if name not in registry]
        if missing:
            raise SystemExit(f"未知变体：{missing}；可选：{sorted(registry)}")
        return {name: registry[name] for name in names}
    return registry


# 变体产出的是 system prompt、任务自带 user 消息的两类 kind（其余 kind 是单条 user prompt）。
_SYSTEM_PROMPT_KINDS = frozenset({"agent", "live-draft"})


def _build_prompt(task: Any, variant: Any) -> str:
    kind = task.kind
    if kind in _SYSTEM_PROMPT_KINDS:
        return variant.build()
    if kind == "draft":
        return variant.build(task.ctx, preview_chars=task.preview_chars, full_chapter=task.full_chapter)
    if kind == "critique":
        return variant.build(task.ctx, task.draft)
    if kind == "revision":
        return variant.build(task.ctx, task.draft, task.issues)
    raise SystemExit(f"未知任务类型：{kind}")


def _fixture_fingerprint(task: Any) -> str:
    """绑定任务说明、全部嵌套输入和设置，不包含有意变化的变体实现。"""
    canonical = json.dumps(asdict(task), ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class _SampleObservation:
    """Capture actual SDK request identity and unpriced retries without a second ledger."""

    def __init__(self):
        self.data: dict[str, Any] = {"unaccounted_retry_count": 0}

    def begin(self, request, *, source, streaming, operation, provenance):
        secrets = [v for k, v in source.items() if k.endswith(("_API_KEY", "_AUTH_TOKEN"))]
        self.data.update(redact_sensitive({
            "provider": source.get("STORYFORGE_LLM_PROVIDER") or "openai-compatible",
            "model": request.model, "streaming": streaming,
            "parameters": {"temperature": request.temperature, "max_tokens": request.max_tokens,
                           "reasoning_effort": request.reasoning_effort},
        }, extra_secrets=secrets))
        return self

    def progress(self, values):
        if values.get("phase") == "retry_started":
            self.data["unaccounted_retry_count"] += 1

    def finish(self, status, *, usage, finish_reason=None, error_code=None):
        self.data.update({"request_state": status, "finish_reason": finish_reason})


def _call_once(prompt: str, task: Any) -> dict[str, Any]:
    source = {}
    secrets = []
    observer = _SampleObservation()
    started = time.monotonic()
    try:
        source = resolved_llm_env()
        secrets = [v for k, v in source.items() if k.endswith(("_API_KEY", "_AUTH_TOKEN"))]
        with model_observation_scope(observer):
            result = call_llm_streamed(
                source, system_prompt=prompt if task.kind in _SYSTEM_PROMPT_KINDS else "",
                user_prompt=task.user_prompt if task.kind in _SYSTEM_PROMPT_KINDS else prompt,
            )
        single = {key: result.get(key) for key in (
            "prompt_tokens", "completion_tokens", "token_usage", "token_usage_source", "cache_hit_tokens",
            "cost_cny_estimated", "cost_breakdown", "latency_ms",
        )}
        single.update({"output": result["content"], "status": "ok"})
    except Exception as exc:  # noqa: BLE001 - isolate samples, retain partial provider accounting
        single = {**error_usage_summary(exc, source=source), "status": "failed",
                  "no_model_call": isinstance(exc, LLMConfigError),
                  "error": redact_sensitive_text(f"{type(exc).__name__}: {exc}", extra_secrets=secrets),
                  "latency_ms": int((time.monotonic() - started) * 1000)}
    return {**single, **observer.data}


def _samples(entry: dict[str, Any]) -> list[dict[str, Any]]:
    if entry.get("repeats"):
        return [sample if sample.get("sample_id") or sample.get("legacy") else {**sample, "legacy": True}
                for sample in entry["repeats"]]
    # Preserve old evidence without inventing unavailable scheduling or usage provenance.
    return [{**{k: v for k, v in entry.items() if k not in {"history", "resources"}}, "legacy": True}]


def _refresh_entry(entry: dict[str, Any]) -> None:
    current = entry["repeats"] = _samples(entry)
    entry.setdefault("prompt_chars", len(entry.get("prompt", "")))
    samples = [sample for old in entry.get("history", []) for sample in _samples(old)] + current
    resources: dict[str, Any] = {"attempt_count": len(samples), "current_count": len(current),
                               "success_count": sum(s.get("output") is not None and "error" not in s for s in samples),
                               "legacy_count": sum(bool(s.get("legacy")) for s in samples),
                               "unaccounted_retry_count": sum(s.get("unaccounted_retry_count", 0) for s in samples),
                               "estimated_usage_count": sum(str(s.get("token_usage_source", "")).startswith("estimated") for s in samples)}
    for field, name in (("prompt_tokens", "prompt_tokens"), ("completion_tokens", "completion_tokens"),
                        ("token_usage", "token_usage"), ("latency_ms", "latency_ms"),
                        ("cost_cny_estimated", "cost_cny")):
        known = sum(s.get(field) or 0 for s in samples)
        unknown = sum(s.get(field) is None and not s.get("no_model_call") for s in samples)
        complete = not unknown and not resources["legacy_count"] and not any(s.get("unaccounted_retry_count") for s in samples)
        resources.update({f"{name}_known": known, f"{name}_unknown_count": unknown,
                          f"{name}_complete": complete, field: known if complete else None})
    entry["resources"] = resources
    first = next((s for s in current if s.get("output") is not None and "error" not in s), None)
    entry["output"] = first["output"] if first else None
    entry["output_chars"] = len(first["output"]) if first else None
    entry["representative_sample_id"] = first.get("sample_id") if first else None
    for field in ("prompt_tokens", "completion_tokens", "latency_ms", "cost_cny_estimated"):
        entry[field] = resources[field]
    if not first and all(s.get("error") for s in current):
        entry["error"] = "All current samples failed"


def _checkpoint(out_dir: Path | None, run_data: dict[str, Any]) -> None:
    current_outputs = []
    for task_id, task in run_data["variants"].items():
        for entry in task["variants"]:
            _refresh_entry(entry)
            for index, sample in enumerate(_samples(entry), start=1):
                if sample.get("output") is None or "error" in sample:
                    continue
                body = sample["output"].encode("utf-8")
                digest = hashlib.sha256(body).hexdigest()
                batch = sample.get("batch_id", "legacy")
                # Never trust persisted paths during --merge; derive a local, content-bound path.
                namespace = hashlib.sha256(str(batch).encode()).hexdigest()[:24]
                cell = hashlib.sha256(f"{task_id}/{entry['id']}".encode()).hexdigest()[:16]
                path = f"outputs/{namespace}/{cell}-{digest[:16]}--r{index}.txt"
                if out_dir is not None:
                    destination = out_dir / path
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    if not destination.exists():
                        destination.write_bytes(body)
                    elif destination.read_bytes() != body:
                        raise ValueError("Output evidence hash mismatch")
                current_outputs.append({"task_id": task_id, "variant_id": entry["id"],
                                        "sample_id": sample.get("sample_id"), "repeat_index": index,
                                        "path": path, "sha256": digest, "legacy": bool(sample.get("legacy"))})
    run_data["current_outputs"] = current_outputs
    if out_dir is not None:
        out_dir.mkdir(parents=True, exist_ok=True)
        dry_run = run_data.get("dry_run", False)
        blind_seed = run_data.get("blind_seed")
        (out_dir / "report.md").write_text(report.render_report(run_data, dry_run=dry_run), encoding="utf-8")
        if blind_seed is not None:
            blind, reveal = report.render_blind_packet(run_data, dry_run=dry_run, seed=blind_seed)
            (out_dir / "blind.md").write_text(blind, encoding="utf-8")
            (out_dir / "blind-reveal.json").write_text(
                json.dumps(reveal, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        temporary = out_dir / "run-metadata.json.tmp"
        temporary.write_text(json.dumps(run_data, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(out_dir / "run-metadata.json")


def _run_grid(tasks: dict[str, Any], variants: dict[str, dict[str, Any]], *, dry_run: bool,
              jobs: int = 1, repeat: int = 1, existing: dict[str, Any] | None = None,
              out_dir: Path | None = None, blind_seed: int | None = None) -> tuple[dict[str, Any], int]:
    """Allocate every sample before dispatch; completion only fills its assigned slot."""
    if jobs < 1 or repeat < 1:
        raise ValueError("jobs and repeat must be positive")
    fingerprints = {task_id: _fixture_fingerprint(task) for task_id, task in tasks.items()}
    # 装配 prompt、分发调用或写入检查点前，先校验全部选中任务。
    # 旧版 prompt 本身无法证明生成它时使用了哪些固定输入。
    for task_id, task in tasks.items():
        group = (existing or {}).get("variants", {}).get(task_id)
        if group is not None and (
            group.get("fixture_fingerprint") != fingerprints[task_id]
            or group.get("task_description") != task.description
        ):
            reason = "固定输入或任务说明已变化" if group.get("fixture_fingerprint") else "旧版记录缺少固定输入指纹"
            raise SystemExit(f"无法合并任务 {task_id!r}：{reason}；请用 --out 指定新目录，重新开始实验")
    run_data = copy.deepcopy(existing) if existing else {"variants": {}}
    run_data.setdefault("run_id", uuid.uuid4().hex)
    run_data["schema_version"] = 2
    run_data["repeat"] = repeat
    run_data["dry_run"] = dry_run
    if blind_seed is not None:
        run_data["blind_seed"] = blind_seed
    batch_id = uuid.uuid4().hex
    selected = []
    failed = 0
    # Prompt builders temporarily patch globals, so rendering must remain serial.
    for task_id, task in tasks.items():
        group = run_data["variants"].setdefault(task_id, {
            "task_description": task.description, "fixture_fingerprint": fingerprints[task_id], "variants": [],
        })
        for variant_id, variant in variants[task.kind].items():
            old = next((e for e in group["variants"] if e["id"] == variant_id), None)
            entry = {"id": variant_id, "label": variant.label, "description": variant.description,
                     "prompt": "", "prompt_chars": None, "history": [], "repeats": []}
            if old is not None:
                history = old.pop("history", [])
                entry["history"] = [*history, old]
                group["variants"][group["variants"].index(old)] = entry
            else:
                group["variants"].append(entry)
            error = None
            try:
                entry["prompt"] = _build_prompt(task, variant)
                entry["prompt_chars"] = len(entry["prompt"])
                entry["user_prompt"] = task.user_prompt if task.kind in _SYSTEM_PROMPT_KINDS else entry["prompt"]
            except Exception as exc:  # noqa: BLE001 - failed builds replace stale success too
                error = f"Prompt construction failed: {type(exc).__name__}"
                failed += repeat
            for index in range(1, repeat + 1):
                sample = {"sample_id": f"{batch_id}/{task_id}/{variant_id}/{index}",
                          "batch_id": batch_id, "repeat_index": index,
                          "status": "prompt_failed" if error else "dry_run" if dry_run else "scheduled",
                          "no_model_call": bool(error or dry_run)}
                if error:
                    sample["error"] = error
                entry["repeats"].append(sample)
            selected.append((task_id, task, entry))
    _checkpoint(out_dir, run_data)
    if dry_run:
        return run_data, failed
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        futures: dict[Future, tuple[str, dict[str, Any], dict[str, Any]]] = {}
        for task_id, task, entry in selected:
            for sample in entry["repeats"]:
                if sample["status"] == "scheduled":
                    futures[pool.submit(_call_once, entry["prompt"], task)] = (task_id, entry, sample)
        for done, future in enumerate(as_completed(futures), start=1):
            task_id, entry, sample = futures[future]
            try:
                result = future.result()
            except Exception as exc:  # noqa: BLE001 - worker/setup isolation; no raw secret-bearing diagnostics
                result = {**error_usage_summary(exc), "status": "failed", "error": type(exc).__name__}
            sample.update(result)
            if "error" in sample:
                sample["status"] = "failed"
                failed += 1
            else:
                sample["status"] = "ok"
                sample["output_chars"] = len(sample["output"])
            _checkpoint(out_dir, run_data)
            print(f"  [{done}/{len(futures)}] {task_id}--{entry['id']} r{sample['repeat_index']}: {sample['status']}", flush=True)
    return run_data, failed


def _write_artifacts(out_dir: Path, run_data: dict[str, Any], *, dry_run: bool, blind_seed: int | None) -> None:
    run_data["dry_run"] = dry_run
    if blind_seed is not None:
        run_data["blind_seed"] = blind_seed
    _checkpoint(out_dir, run_data)
    prompts_dir = out_dir / "prompts"
    prompts_dir.mkdir(exist_ok=True)
    for task_id, task in run_data["variants"].items():
        for entry in task["variants"]:
            (prompts_dir / f"{task_id}--{entry['id']}.txt").write_text(entry["prompt"], encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    """独立成函数供 docstring 用法示例的护栏测试反查（本模块 docstring 曾写过不存在的 --blind）。"""

    parser = argparse.ArgumentParser(description="prompt 对比实验台：固定输入 × 变体配置 → 并排报告")
    parser.add_argument("--task", help="逗号分隔的任务 id；缺省 = 全部")
    parser.add_argument("--all", action="store_true", help="跑全部任务（缺省行为）")
    parser.add_argument("--variants", help="逗号分隔的变体 id（按任务 kind 解析）；缺省 = 该 kind 全部")
    parser.add_argument("--dry-run", action="store_true", help="只渲染 prompt 与报告，不调 LLM")
    parser.add_argument("--out", type=Path, help="输出目录；缺省 = .codex/prompt-lab/<ts>/")
    parser.add_argument("--seed", type=int, default=None, help="盲评洗牌种子（同时生成 blind.md）")
    parser.add_argument("--jobs", type=int, default=4, help="LLM 调用并行度（线程池；默认 4）")
    parser.add_argument("--repeat", type=int, default=1, help="每格重复调用次数（统计性判定用；结果进 repeats 数组）")
    parser.add_argument("--merge", type=Path, default=None, help="补跑并合并进既有 run 目录（读其 run-metadata.json，只替换本次格子）")
    return parser


def anchor_at_repo_root(path: Path | None) -> Path | None:
    """相对路径一律锚在仓库根，绝对路径原样。

    缺省输出目录本就是 `_REPO_ROOT/.codex/prompt-lab/<ts>`，而显式 `--out .codex/...`
    若按 cwd 解析，从 `apps/api` 跑就会落进 `apps/api/.codex/`——那里不被 `.gitignore`
    的 `.codex/*` 覆盖（该模式锚在仓根），证据目录会变成未跟踪文件冒到 git status 里。
    """

    if path is None or path.is_absolute():
        return path
    return _REPO_ROOT / path


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.jobs < 1 or args.repeat < 1:
        raise SystemExit("--jobs and --repeat must be positive")
    args.out = anchor_at_repo_root(args.out)
    args.merge = anchor_at_repo_root(args.merge)

    if args.merge:
        if args.dry_run:
            raise SystemExit("--merge 与 --dry-run 互斥：合并是补跑真实 LLM 用的。")
        if not args.task:
            raise SystemExit("--merge 必须配 --task 指定要补跑的格子。")
        metadata_path = args.merge / "run-metadata.json"
        if not metadata_path.exists():
            raise SystemExit(f"merge 目标没有 run-metadata.json：{metadata_path}")
        existing = json.loads(metadata_path.read_text(encoding="utf-8"))
    else:
        existing = None

    if args.task:
        names = [name.strip() for name in args.task.split(",") if name.strip()]
        missing = [name for name in names if name not in TASKS]
        if missing:
            raise SystemExit(f"未知任务：{missing}；可选：{sorted(TASKS)}")
        tasks = {name: TASKS[name] for name in names}
    else:
        tasks = TASKS

    variants: dict[str, dict[str, Any]] = {}
    variant_names = [name.strip() for name in args.variants.split(",")] if args.variants else None
    for task in tasks.values():
        variants[task.kind] = _select_variants(task.kind, variant_names)

    out_dir = args.merge or args.out or _default_out_dir()
    if not args.merge and (out_dir / "run-metadata.json").exists():
        raise SystemExit("Output already contains a run; use --merge or a new --out directory")
    seed = (existing or {}).get("blind_seed") if args.merge else args.seed
    run_data, failed = _run_grid(tasks, variants, dry_run=args.dry_run, jobs=args.jobs,
                                repeat=args.repeat, existing=existing, out_dir=out_dir, blind_seed=seed)
    _write_artifacts(out_dir, run_data, dry_run=args.dry_run, blind_seed=seed)
    print(f"输出目录：{out_dir}")
    print(f"失败样本数：{failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
