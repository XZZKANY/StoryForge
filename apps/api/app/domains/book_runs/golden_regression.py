"""Golden 回测器：确定性比对一本导出小说与冻结基准，零 LLM / 零随机 / 零 DB。

设计立场：repair / collapse_judge / 字数门禁等改动若改善（或破坏）了下游产物，
必须能用确定性指标量出来，而不是凭肉眼。本模块把 book.md 跑过 phase9c 确定性
评分器，与基准快照 diff，输出可断言的偏差明细——适合进 CI 卡回归阈值。

刻意只依赖 `narrative_gate` 的纯函数（只吃 book.md 文本）：judge 的确定性
检测层需要 per-scene 的 required_facts/style_rules，从整本导出层面拿不到，故不纳入。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.domains.book_runs.narrative_gate import (
    _auto_gate_results_from_book_export,
    _parse_markdown_chapters,
)


@dataclass(frozen=True)
class GoldenRegressionResult:
    """回测结论：passed=True 表示与基准无偏差，否则 deviations 列出每处差异。"""

    passed: bool
    actual: dict[str, Any]
    expected: dict[str, Any]
    deviations: list[str] = field(default_factory=list)


def score_book_export(book_export: str) -> dict[str, Any]:
    """对一本导出小说算确定性评分快照（与 expected_gate.json 同结构）。"""

    gate = _auto_gate_results_from_book_export(book_export)[0]
    chapters = _parse_markdown_chapters(book_export)
    return {
        "collapse_judge_status": gate["status"],
        "template_chapters": sorted(gate.get("template_chapters", [])),
        "chapter_count": len(chapters),
        "chapter_ordinals": sorted(number for number, _ in chapters),
        "per_chapter_char_counts": {str(number): len(text) for number, text in chapters},
    }


def compare_to_baseline(book_export: str, expected: dict[str, Any]) -> GoldenRegressionResult:
    """把导出小说的确定性评分与基准快照逐字段 diff，返回偏差明细。"""

    actual = score_book_export(book_export)
    deviations: list[str] = []

    if actual["collapse_judge_status"] != expected["collapse_judge_status"]:
        deviations.append(
            f"collapse_judge_status: 基准 {expected['collapse_judge_status']} → 实测 {actual['collapse_judge_status']}"
        )

    actual_templates = set(actual["template_chapters"])
    expected_templates = set(expected["template_chapters"])
    newly_flagged = sorted(actual_templates - expected_templates)
    no_longer_flagged = sorted(expected_templates - actual_templates)
    if newly_flagged:
        deviations.append(f"新增被判套路化的章：{newly_flagged}")
    if no_longer_flagged:
        deviations.append(f"不再被判套路化的章：{no_longer_flagged}")

    if actual["chapter_ordinals"] != expected["chapter_ordinals"]:
        actual_set = set(actual["chapter_ordinals"])
        expected_set = set(expected["chapter_ordinals"])
        missing = sorted(expected_set - actual_set)
        extra = sorted(actual_set - expected_set)
        if missing:
            deviations.append(f"基准有但实测缺失的章：{missing}")
        if extra:
            deviations.append(f"实测多出基准没有的章：{extra}")

    for ordinal, expected_count in expected["per_chapter_char_counts"].items():
        actual_count = actual["per_chapter_char_counts"].get(ordinal)
        if actual_count is None:
            continue  # 章缺失已在上面报告
        if actual_count != expected_count:
            deviations.append(
                f"第{ordinal}章字数：基准 {expected_count} → 实测 {actual_count}"
            )

    return GoldenRegressionResult(
        passed=not deviations,
        actual=actual,
        expected=expected,
        deviations=deviations,
    )


def run_golden_regression(baseline_dir: str | Path) -> GoldenRegressionResult:
    """从基准目录（含 book.md + expected_gate.json）跑一次回测。"""

    base = Path(baseline_dir)
    book_export = (base / "book.md").read_text(encoding="utf-8")
    expected = json.loads((base / "expected_gate.json").read_text(encoding="utf-8"))
    return compare_to_baseline(book_export, expected)


def _default_baseline_dir() -> Path:
    # apps/api/tests/golden/novel_baseline，相对本文件定位，CI 任意 cwd 均可用
    return Path(__file__).resolve().parents[3] / "tests" / "golden" / "novel_baseline"


def main(argv: list[str] | None = None) -> int:
    """CLI 入口：跑 golden 回测，无回归退出 0，有回归打印偏差并退出 1（便于 CI 卡阈值）。"""

    import argparse

    parser = argparse.ArgumentParser(description="StoryForge golden 回测：确定性比对导出小说与冻结基准。")
    parser.add_argument("--baseline-dir", default=str(_default_baseline_dir()), help="基准目录路径")
    args = parser.parse_args(argv)

    result = run_golden_regression(args.baseline_dir)
    if result.passed:
        print(f"[golden] PASS：{result.actual['chapter_count']} 章、collapse_judge={result.actual['collapse_judge_status']}、无回归。")
        return 0
    print("[golden] FAIL：检测到回归：")
    for deviation in result.deviations:
        print(f"  - {deviation}")
    return 1


if __name__ == "__main__":
    import sys

    sys.exit(main())
