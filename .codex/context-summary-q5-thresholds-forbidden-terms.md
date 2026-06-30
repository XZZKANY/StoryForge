# Q5 参数化章节阈值 + API 系统词检测上下文摘要

时间：2026-06-30 +08:00

## 已完成

- `book_runs.dispatch._default_phase_policy(total_chapters)` 按实际总章数派生默认阶段边界：
  - 30 章仍保持历史 1-6 / 7-15 / 16-24 / 25-30。
  - 18 章变为 1-4 / 5-9 / 10-14 / 15-18。
- CLI 新增 `--max-chapter-count`，默认 30，可由 `STORYFORGE_LLM_SMOKE_MAX_CHAPTER_COUNT` 覆盖；Q9 的 16-18 章 band 不再被旧 10 章默认上限拦住。
- `book_generation_preflight.resolved_llm_env()` 读取 `STORYFORGE_LLM_SMOKE_MAX_CHAPTER_COUNT`。
- API judge 自包含实现系统/流程词检测：
  - 新增 `FORBIDDEN_DRAFT_TERMS`。
  - `deterministic_judge_fallback()` 输出 `forbidden_draft_term` issues。
  - 未 import `apps/workflow` 的 `ForbiddenDraftTermsFilter`，避免把 workflow narrative guard 硬接真实路径。

## 验证

- `cd apps/api && uv run pytest tests/test_book_generation.py::test_deterministic_judge_flags_forbidden_draft_system_terms tests/test_book_generation.py::test_book_generation_cli_allows_q9_chapter_band_with_parameterized_cap tests/test_book_run_workflow_dispatch.py -q` → 18 passed。
- `cd apps/api && uv run ruff check app/domains/judge/types.py app/domains/judge/deterministic.py app/domains/book_runs/book_generation_judge.py app/domains/book_runs/book_generation_cli.py app/domains/book_runs/book_generation_preflight.py app/domains/book_runs/dispatch.py tests/test_book_generation.py tests/test_book_run_workflow_dispatch.py` → All checks passed。

## 未完成

- `/api/book-runs/{id}/start` 的后台单进程安全上限仍保留 6 章；Q9 按计划走 CLI 长程路径，不走 HTTP `/start`。
- 系统词检测先覆盖 workflow `ForbiddenDraftTermsFilter` 的核心固定词，不接 workflow guard、不做全文重生策略。
