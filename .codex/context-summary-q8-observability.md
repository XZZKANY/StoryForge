# Q8 长程可观测性上下文摘要

时间：2026-06-30 +08:00

## 已完成

- `app/common/metrics.py` 新增：
  - `book_generation_failure_count_total`
  - `book_generation_cost_cny_total`
  - `observe_book_generation_chapter()`
  - `observe_book_generation_failure()`
- 真实串行 `run_book_generation()` / `resume_book_generation()` 在每章 `_judge_and_repair_loop()` 后 emit：
  - `judge_calls_total`
  - `repair_patches_total`
  - `book_generation_cost_cny_total`
- 真实并发 `run_book_generation_parallel()` 的 precommit 校正路径使用同一 helper emit 成功章节指标。
- `_pause_by_failure()` emit `book_generation_failure_count_total`。
- `_judge_and_repair_loop()` 返回 `judge_call_count`，章节 progress 与 summary per-chapter metrics 均带该字段。
- `/metrics` 空端点可看到新增 book generation 指标名。

## 验证

- `cd apps/api && uv run pytest tests/test_metrics.py tests/test_book_generation.py tests/test_book_generation_parallel.py -q` → 50 passed。
- `cd apps/api && uv run ruff check app/common/metrics.py app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_judge.py app/domains/book_runs/book_generation_parallel.py app/domains/book_runs/book_generation_progress.py app/domains/book_runs/book_generation_metrics.py tests/test_metrics.py tests/test_book_generation.py tests/test_book_generation_parallel.py` → All checks passed。

## 未完成

- Q8 不代表 Q9 已完成；尚未进行真实 4 万字长程重跑、resume/预算暂停实战演练、人工盲评或 artifact sha256 登记。
- Prometheus 指标有意不带 `book_run_id` / `chapter_index`，避免高基数；逐章细节继续在 BookRun progress / summary.json 中审计。
