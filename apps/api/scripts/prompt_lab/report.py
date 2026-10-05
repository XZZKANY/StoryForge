"""对比报告渲染纯函数：markdown 报告 + difflib 差异块 + 盲评重排。

约定：`run_data` 是 runner 汇总的格级数据（dict），本模块只负责渲染，不触网不读写盘。
"""

from __future__ import annotations

import difflib
import hashlib
import hmac
import json
import random
import re
from collections.abc import Sequence
from typing import Any

# 报告里每个任务一节的字段名（run_data 约定，runner 侧构造）
_TASK_DESCRIPTION = "task_description"
_VARIANTS = "variants"


def _fmt_cost(cost: float | None) -> str:
    if cost is None:
        return "-"
    return f"{cost:.6f}"


def _fmt_int(value: int | None) -> str:
    return "-" if value is None else str(value)


def _diff_blocks(baseline_prompt: str, variant_prompt: str) -> list[str]:
    """baseline 与变体 prompt 的 unified diff 行（供「这次实验改了什么」快速定位）。"""

    if baseline_prompt == variant_prompt:
        return []
    return list(
        difflib.unified_diff(
            baseline_prompt.splitlines(),
            variant_prompt.splitlines(),
            fromfile="baseline",
            tofile="variant",
            lineterm="",
            n=1,
        )
    )


def _render_metrics_table(entries: Sequence[dict[str, Any]], baseline_prompt: str) -> str:
    """每任务的指标表：编号 / 变体 / 差异说明 / prompt 字符 / 输出字符 / token / 耗时 / 成本。

    输出字符是代表样本；资源是全尝试合计（包含失败及补跑历史）。
    """

    lines = ["| 编号 | 变体 | 差异说明 | prompt字符 | 代表稿字符 | token合计入/出 | 耗时合计ms | 估算成本合计CNY |", "|---|---|---|---|---|---|---|---|"]
    for index, entry in enumerate(entries, start=1):
        label = entry["label"]
        letter = f"{chr(64 + index)}"
        resources = entry.get("resources")
        detail = entry['description']
        if resources:
            detail += f"；成功/已记录尝试 {resources['success_count']}/{resources['attempt_count']}"
            detail += f"；当前 {resources['current_count']}，历史 {resources['attempt_count'] - resources['current_count']}"
            if resources["legacy_count"]:
                detail += "；legacy 历史完整性未知"
            if not resources['cost_cny_complete']:
                detail += f"；费用不完整，已知小计 {_fmt_cost(resources['cost_cny_known'])}"
        else:
            detail += "；legacy 资源证据不完整"
        lines.append(
            f"| {letter} | {label} | {detail} | "
            f"{_fmt_int(entry['prompt_chars'])} | {_fmt_int(entry['output_chars'])} | "
            f"{_fmt_int(entry['prompt_tokens'])}/{_fmt_int(entry['completion_tokens'])} | "
            f"{_fmt_int(entry['latency_ms'])} | {_fmt_cost(entry['cost_cny_estimated'])} |"
        )
    return "\n".join(lines)


def _render_output_block(letter: str, label: str, entry: dict[str, Any], dry_run: bool) -> str:
    repeats = entry.get("repeats")
    if dry_run:
        return f"#### {letter}. {label}\n\n（dry-run：未调用 LLM）\n"
    if repeats:
        parts = [f"#### {letter}. {label}"]
        for index, sample in enumerate(repeats, start=1):
            if sample.get("status") == "dry_run":
                parts.append(f"\n**第 {index} 次：dry-run，未调用 LLM**\n")
                continue
            if sample.get("status") == "scheduled":
                parts.append(f"\n**第 {index} 次：未确认完成，消耗未知**\n")
                continue
            if "error" in sample:
                parts.append(f"\n**第 {index} 次：失败（{sample['error'][:120]}）**\n")
                continue
            parts.append(f"\n**第 {index} 次**\n\n```\n{sample['output'] if sample['output'] else '（空输出）'}\n```")
        return "\n".join(parts) + "\n"
    output = entry.get("output")
    if output is None:
        return f"#### {letter}. {label}\n\n（失败：无输出）\n"
    return f"#### {letter}. {label}\n\n```\n{output if output else '（空输出）'}\n```\n"


def _render_task_section(task_id: str, description: str, entries: Sequence[dict[str, Any]], dry_run: bool) -> str:
    parts = [f"## 任务 {task_id}", f"> 输入：{description}", "", _render_metrics_table(entries, entries[0]["prompt"]), ""]
    for index, entry in enumerate(entries, start=1):
        parts.append(_render_output_block(chr(64 + index), entry["label"], entry, dry_run))
    baseline_prompt = entries[0]["prompt"]
    for index, entry in enumerate(entries[1:], start=2):
        diff_lines = _diff_blocks(baseline_prompt, entry["prompt"])
        if diff_lines:
            parts.extend(
                [
                    f"#### {chr(64 + index)} 相对 baseline 的 prompt 差异",
                    "```diff",
                    *diff_lines,
                    "```",
                    "",
                ]
            )
    parts.extend(["- [ ] 哪版更好？理由：", ""])
    return "\n".join(parts)


def render_blind_packet(run_data: dict[str, Any], *, dry_run: bool, seed: int) -> tuple[str, dict[str, Any]]:
    """Reading copy contains tasks and anonymous prose only; reveal stays a separate artifact."""
    parts = ["# 匿名阅读包", ""]
    reveal: dict[str, Any] = {"seed": seed, "run_id": run_data.get("run_id"), "tasks": {}}
    for task_id, task in run_data[_VARIANTS].items():
        domain = json.dumps([seed, run_data.get("run_id", "legacy"), task_id], ensure_ascii=False).encode()
        key = hashlib.sha256(domain).digest()
        samples = []
        for entry in task[_VARIANTS]:
            for index, sample in enumerate(entry.get("repeats") or [entry], start=1):
                identity = sample.get("sample_id") or f"legacy/{entry['id']}/{index}"
                anonymous_id = hmac.new(key, str(identity).encode(), hashlib.sha256).hexdigest()[:16]
                included = not dry_run and sample.get("output") is not None and "error" not in sample
                samples.append(({
                    "anonymous_id": anonymous_id, "sample_id": sample.get("sample_id"),
                    "variant_id": entry["id"], "repeat_index": index,
                    "status": sample.get("status", "legacy"), "included": included,
                    "output_sha256": hashlib.sha256(sample["output"].encode()).hexdigest() if included else None,
                }, sample))
        # Domain separation, not an assertion that two random permutations can never coincide.
        samples.sort(key=lambda pair: pair[0]["anonymous_id"])
        random.Random(key).shuffle(samples)
        reveal["tasks"][task_id] = [mapping for mapping, _ in samples]
        parts.extend([f"## 任务 {task_id}", f"> 输入：{task[_TASK_DESCRIPTION]}", ""])
        for mapping, sample in samples:
            if mapping["included"]:
                body = sample["output"]
                # A generated backtick fence must not escape its literal reading block.
                fence = "`" * (max([2, *(len(part) for part in re.findall(r"`+", body))]) + 1)
                parts.extend([f"### 样本 {mapping['anonymous_id']}", "", fence, body, fence, ""])
    return "\n".join(parts), reveal


def render_report(run_data: dict[str, Any], *, dry_run: bool, blind_seed: int | None = None) -> str:
    if blind_seed is not None:
        return render_blind_packet(run_data, dry_run=dry_run, seed=blind_seed)[0]
    tasks = run_data[_VARIANTS]
    legacy = run_data.get("schema_version") != 2
    model = run_data.get("model", "-") if legacy else "逐样本记录"
    temperature = run_data.get("temperature", "-") if legacy else "逐样本记录"
    header = [
        "# Prompt 对比实验台报告",
        f"- 模型：{model} ｜ 温度：{temperature}",
        f"- 任务数：{len(tasks)} ｜ dry-run：{dry_run}",
        "- 资源合计覆盖当前和历史尝试；未知费用不计为零。正文只展示当前样本。",
        "",
    ]
    sections = [_render_task_section(task_id, task[_TASK_DESCRIPTION], task[_VARIANTS], dry_run)
                for task_id, task in tasks.items()]
    return "\n".join(header + sections)
