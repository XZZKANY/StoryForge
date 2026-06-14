"""Golden 回测器单测：冻结基准应无回归；注入套路化/丢章变体应被抓出。"""

from __future__ import annotations

import json
from pathlib import Path

from app.domains.book_runs.golden_regression import (
    compare_to_baseline,
    run_golden_regression,
    score_book_export,
)

_BASELINE_DIR = Path(__file__).parent / "golden" / "novel_baseline"


def _load_expected() -> dict:
    return json.loads((_BASELINE_DIR / "expected_gate.json").read_text(encoding="utf-8"))


def test_golden_baseline_has_no_regression() -> None:
    """冻结的真实 30 章导出对当前确定性评分器应零偏差。"""

    result = run_golden_regression(_BASELINE_DIR)
    assert result.passed, f"基准出现回归：{result.deviations}"
    assert result.actual["collapse_judge_status"] == "pass"
    assert result.actual["template_chapters"] == []


def test_golden_detects_newly_templated_chapter() -> None:
    """回归探测力证明：把基准某章替换成套路化骨架，回测器必须抓到 collapse_judge 翻转。"""

    book = (_BASELINE_DIR / "book.md").read_text(encoding="utf-8")
    expected = _load_expected()

    # 追加一个纯套路化章（命中≥3 动作桶、无具体锚点）——回测器应判它新增 template
    templated = "\n\n## 第 99 章 占位\n林岚来到码头，询问船员，查看登记表，把纸页收进内袋，转身离开。\n"
    mutated = book + templated

    result = compare_to_baseline(mutated, expected)
    assert not result.passed
    assert any("套路化" in d for d in result.deviations)
    assert any("99" in d for d in result.deviations)


def test_golden_detects_missing_chapter() -> None:
    """回归探测力证明：删掉基准某章标题块，回测器必须报告该章缺失。"""

    book = (_BASELINE_DIR / "book.md").read_text(encoding="utf-8")
    expected = _load_expected()

    # 把第 1 章标题改写，使其解析不到 ordinal=1 → 基准有但实测缺
    mutated = book.replace("## 第 1 章", "## 序章", 1)

    result = compare_to_baseline(mutated, expected)
    assert not result.passed
    assert any("缺失" in d for d in result.deviations)


def test_score_book_export_is_deterministic() -> None:
    """同一输入两次评分结果完全一致（无随机/无外部状态）。"""

    book = (_BASELINE_DIR / "book.md").read_text(encoding="utf-8")
    assert score_book_export(book) == score_book_export(book)
