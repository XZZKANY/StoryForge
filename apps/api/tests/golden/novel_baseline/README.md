# Golden 回测基准 · novel_baseline

确定性回测基准：冻结一份真实生成的整本小说导出 + 其确定性评分快照，
让后续 repair / collapse_judge / 字数门禁等改动有数据支撑，而非凭感觉。

## 来源

- `book.md`：30 章真实 LLM（mimo-v2.5-pro）长跑导出（`.codex/narrative-smoke-30ch-20260614-171554/`）。
  其中 CH9 因正文失控（5912 字 > 失控线 5500）被质量门禁正确拒批、未进导出，故实际 29 章。
  这一"缺 CH9"是基准的一部分——它记录了门禁真实行为。
- `expected_gate.json`：对上面 `book.md` 跑确定性评分器得到的期望快照。

## 字段

`expected_gate.json` 全部来自 `narrative_gate._auto_gate_results_from_book_export`
+ `_parse_markdown_chapters`，**零 LLM、零随机、零 DB**，给定 `book.md` 输出恒定：

- `collapse_judge_status`：套路化 gate 结论（pass/fail）
- `template_chapters`：被判套路化的章序号列表
- `chapter_count` / `chapter_ordinals`：解析出的章数与序号（验证导出完整性）
- `per_chapter_char_counts`：每章字符数（验证字数带、抓截断/失控）

## 用法

回测器 `app/domains/book_runs/golden_regression.py` 读这两个文件做 diff，
回归单测 `tests/test_golden_regression.py` 断言无偏差。

更新基准（仅当确认是预期变化时）：重新生成 `book.md` 与 `expected_gate.json`，
在 verification-report 留痕说明为何变。不要为了让测试通过而盲目刷新基准。
