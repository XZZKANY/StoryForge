"""prompt 对比实验台 CLI：固定输入 × 变体配置 → 真 LLM 输出 → 并排报告。

用法：
    # dry-run（零成本，先验 prompt 装配与报告可读性）
    uv run python -m scripts.prompt_lab.runner --all --dry-run
    uv run python -m scripts.prompt_lab.runner --task opening-preview,critique-draft --variants baseline,no-craft --dry-run
    # 真跑（人工实验；Windows 需先挂本机配置；--jobs 控制 LLM 调用并行度）
    $env:STORYFORGE_LLM_CONFIG_FILE = "$env:APPDATA\\com.storyforge.ide\\llm-provider.json"
    uv run python -m scripts.prompt_lab.runner --all --out .codex/prompt-lab/wave1 --blind --seed 42 --jobs 8
    # 补跑失败的格子并合并回既有 run（其余格子保留，blind seed 沿用）
    uv run python -m scripts.prompt_lab.runner --merge .codex/prompt-lab/wave1 --task transition-full --variants baseline,task-rewrite --jobs 2

真 LLM 调用只走 app.common.llm_client（唯一出网通道）；本工具在 app/ 之外，
不会被 PyInstaller 打进 sidecar exe。判定靠人工读 report.md，工具不下结论。
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.common.llm_client import LLMConfigError, LLMError, call_llm_messages
from app.common.llm_env import resolved_llm_env
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


def _build_prompt(task: Any, variant: Any) -> str:
    kind = task.kind
    if kind == "agent":
        return variant.build()
    if kind == "draft":
        return variant.build(task.ctx, preview_chars=task.preview_chars, full_chapter=task.full_chapter)
    if kind == "critique":
        return variant.build(task.ctx, task.draft)
    if kind == "revision":
        return variant.build(task.ctx, task.draft, task.issues)
    raise SystemExit(f"未知任务类型：{kind}")


def _call_once(prompt: str, task: Any) -> dict[str, Any]:
    if task.kind == "agent":
        messages = [{"role": "system", "content": prompt}, {"role": "user", "content": task.user_prompt}]
    else:
        messages = [{"role": "user", "content": prompt}]
    result = call_llm_messages(resolved_llm_env(), messages=messages)
    return {"output": result["content"], "cost_cny_estimated": result["cost_cny_estimated"], "latency_ms": result["latency_ms"]}


def _run_grid(tasks: dict[str, Any], variants: dict[str, dict[str, Any]], *, dry_run: bool, jobs: int = 1, existing: dict[str, Any] | None = None) -> tuple[dict[str, Any], int]:
    """跑任务×变体网格；单格失败记入 error 不中断其余。返回 (run_data, failed_count)。

    先串行渲染全部 prompt（no-examples 的 patch 钩子全局改 builder，不能并发），
    再以 ThreadPoolExecutor 并行调 LLM（llm_client 无共享可变状态，线程安全）。
    existing 非空时（--merge）：只替换本次任务的格子，其余任务保留原数据。
    """

    run_data: dict[str, Any] = {"model": "", "temperature": "", "variants": {}}
    if existing:
        run_data = dict(existing)
        run_data.setdefault("variants", {})
    failed = 0
    for task_id, task in tasks.items():
        entries: list[dict[str, Any]] = []
        for variant_id, variant in variants[task.kind].items():
            try:
                prompt = _build_prompt(task, variant)
            except Exception as exc:  # noqa: BLE001 单格失败隔离
                failed += 1
                entries.append({"id": variant_id, "label": variant.label, "description": variant.description, "prompt": "", "error": f"prompt 构建失败：{exc}"})
                continue
            entries.append({"id": variant_id, "label": variant.label, "description": variant.description, "prompt": prompt, "prompt_chars": len(prompt)})
        if existing and task_id in run_data["variants"]:
            # 格子级合并：命令行选中的变体替换旧格子，该任务其他变体保留；
            # prompt 构建失败的格子不参与替换（保留旧的成功数据）。
            old_entries = run_data["variants"][task_id].get("variants", [])
            new_by_id = {entry["id"]: entry for entry in entries if "error" not in entry}
            entries = [new_by_id.get(entry["id"], entry) for entry in old_entries]
        run_data["variants"][task_id] = {"task_description": task.description, "variants": entries}

    if dry_run:
        for task_id in run_data["variants"]:
            for entry in run_data["variants"][task_id]["variants"]:
                entry.update({"output": None, "output_chars": None, "prompt_tokens": None, "completion_tokens": None, "latency_ms": None, "cost_cny_estimated": None})
        return run_data, failed

    # merge 模式下只有本次命令行选中的变体才发起调用；旧格子只保留不重跑
    selected = {
        (task_id, variant_id) for task_id, task in tasks.items() for variant_id in variants[task.kind]
    }
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        futures: dict[Future, tuple[str, dict[str, Any]]] = {}
        for task_id, task in tasks.items():
            for entry in run_data["variants"][task_id]["variants"]:
                if "error" in entry:
                    continue
                if existing and (task_id, entry["id"]) not in selected:
                    continue
                futures[pool.submit(_call_once, entry["prompt"], task)] = (task_id, entry)
        for future, (_task_id, entry) in futures.items():
            try:
                result = future.result()
                entry.update(
                    {
                        "output": result["output"],
                        "output_chars": len(result["output"]),
                        "prompt_tokens": result.get("prompt_tokens"),
                        "completion_tokens": result.get("completion_tokens"),
                        "latency_ms": result["latency_ms"],
                        "cost_cny_estimated": result["cost_cny_estimated"],
                    }
                )
            except (LLMError, LLMConfigError) as exc:
                failed += 1
                entry.update({"error": f"{type(exc).__name__}: {exc}", "output": None, "output_chars": None, "prompt_tokens": None, "completion_tokens": None, "latency_ms": None, "cost_cny_estimated": None})
    return run_data, failed


def _write_artifacts(out_dir: Path, run_data: dict[str, Any], *, dry_run: bool, blind_seed: int | None) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    prompts_dir = out_dir / "prompts"
    outputs_dir = out_dir / "outputs"
    prompts_dir.mkdir(exist_ok=True)
    outputs_dir.mkdir(exist_ok=True)
    for task_id, task in run_data["variants"].items():
        for entry in task["variants"]:
            (prompts_dir / f"{task_id}--{entry['id']}.txt").write_text(entry["prompt"], encoding="utf-8")
            if entry.get("output") is not None:
                (outputs_dir / f"{task_id}--{entry['id']}.txt").write_text(entry["output"], encoding="utf-8")
    (out_dir / "run-metadata.json").write_text(
        json.dumps(run_data, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    (out_dir / "report.md").write_text(report.render_report(run_data, dry_run=dry_run), encoding="utf-8")
    if blind_seed is not None:
        (out_dir / "blind.md").write_text(
            report.render_report(run_data, dry_run=dry_run, blind_seed=blind_seed), encoding="utf-8"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="prompt 对比实验台：固定输入 × 变体配置 → 并排报告")
    parser.add_argument("--task", help="逗号分隔的任务 id；缺省 = 全部")
    parser.add_argument("--all", action="store_true", help="跑全部任务（缺省行为）")
    parser.add_argument("--variants", help="逗号分隔的变体 id（按任务 kind 解析）；缺省 = 该 kind 全部")
    parser.add_argument("--dry-run", action="store_true", help="只渲染 prompt 与报告，不调 LLM")
    parser.add_argument("--out", type=Path, help="输出目录；缺省 = .codex/prompt-lab/<ts>/")
    parser.add_argument("--seed", type=int, default=None, help="盲评洗牌种子（同时生成 blind.md）")
    parser.add_argument("--jobs", type=int, default=4, help="LLM 调用并行度（线程池；默认 4）")
    parser.add_argument("--merge", type=Path, default=None, help="补跑并合并进既有 run 目录（读其 run-metadata.json，只替换本次格子）")
    args = parser.parse_args(argv)

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

    run_data, failed = _run_grid(tasks, variants, dry_run=args.dry_run, jobs=args.jobs, existing=existing)
    out_dir = args.merge or args.out or _default_out_dir()
    # 合并模式沿用既有 run 的盲评 seed（blind.md 重排必须一致）；同时写回 metadata 供下次合并沿用
    seed = (existing or {}).get("blind_seed") if args.merge else args.seed
    if seed is not None:
        run_data["blind_seed"] = seed
    _write_artifacts(out_dir, run_data, dry_run=args.dry_run, blind_seed=seed)
    print(f"输出目录：{out_dir}")
    print(f"失败格数：{failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
