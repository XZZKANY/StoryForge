"""对比报告渲染纯函数：markdown 报告 + difflib 差异块 + 盲评重排。

约定：`run_data` 是 runner 汇总的格级数据（dict），本模块只负责渲染，不触网不读写盘。
"""

from __future__ import annotations

import difflib
import random
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

    repeat>1 时输出字符/耗时列记首样本值，正文区逐样本渲染。
    """

    lines = ["| 编号 | 变体 | 差异说明 | prompt字符 | 输出字符 | token入/出 | 耗时ms | 成本CNY |", "|---|---|---|---|---|---|---|---|"]
    for index, entry in enumerate(entries, start=1):
        label = entry["label"]
        letter = f"{chr(64 + index)}"
        lines.append(
            f"| {letter} | {label} | {entry['description']} | "
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


def render_report(run_data: dict[str, Any], *, dry_run: bool, blind_seed: int | None = None) -> str:
    """渲染明标主报告；blind_seed 非空时按 seed 洗牌编号生成盲评版（不泄露配置名）。"""

    tasks = run_data[_VARIANTS]  # {task_id: {task_description, variants: [...]}}
    header = [
        "# Prompt 对比实验台报告",
        f"- 模型：{run_data.get('model', '-')} ｜ 温度：{run_data.get('temperature', '-')}",
        f"- 任务数：{len(tasks)} ｜ dry-run：{dry_run}",
        "",
    ]
    sections: list[str] = []
    for task_id, task in tasks.items():
        entries = task[_VARIANTS]
        if blind_seed is not None:
            # 盲评：洗牌编号，只留输出与指标，不写配置 id/label/description
            shuffled = list(entries)
            rng = random.Random(blind_seed)
            rng.shuffle(shuffled)
            parts = [
                f"## 任务 {task_id}",
                f"> 输入：{task[_TASK_DESCRIPTION]}",
                "",
                "| 编号 | prompt字符 | 输出字符 | token入/出 | 耗时ms | 成本CNY |",
                "|---|---|---|---|---|---|",
            ]
            for index, entry in enumerate(shuffled, start=1):
                parts.append(
                    f"| {chr(64 + index)} | {_fmt_int(entry['prompt_chars'])} | {_fmt_int(entry['output_chars'])} | "
                    f"{_fmt_int(entry['prompt_tokens'])}/{_fmt_int(entry['completion_tokens'])} | "
                    f"{_fmt_int(entry['latency_ms'])} | {_fmt_cost(entry['cost_cny_estimated'])} |"
                )
            parts.append("")
            for index, entry in enumerate(shuffled, start=1):
                parts.append(_render_output_block(chr(64 + index), "输出", entry, dry_run))
            parts.extend(["- [ ] 哪版更好？理由（先盲评，后揭晓配置名）：", ""])
            sections.append("\n".join(parts))
        else:
            sections.append(_render_task_section(task_id, task[_TASK_DESCRIPTION], entries, dry_run))
    return "\n".join(header + sections)
