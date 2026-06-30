# Q1/Q4 P6 稳定 ID 花名册 + CHANGES schema retry 上下文摘要

时间：2026-06-30 +08:00

## 已完成

- `book_generation_changes.py` 新增 `StoryStateRosterEntry` 与稳定 ID/花名册工具：
  - `stable_story_state_entity_id(entity_kind, canonical_name)`
  - `build_story_state_roster()`
  - `normalize_story_state_changes_with_roster()`
  - `validate_story_state_change_dicts()`
- `_generate_chapter()` 现在会把 `state_ledger`、Character Bible、本章 POV/地点组成的花名册注入 CHANGES prompt。
- 模型返回自由名（如 `entity_id=沈砚`）时，后端提交前会按花名册归一为稳定 ID（如 `character:<hash>`），并保留 `canonical_name=沈砚`。
- CHANGES schema 不合格时，`_retry_story_state_changes_schema()` 只重试修正 JSON 数组，不改写章节正文；重试结果仍经花名册归一与 Pydantic schema 校验。
- 串行、resume、并发 precommit 调用 `_generate_chapter()` 时都传入 `book_run_id`，使 run-scoped ledger 可进入后续章节花名册。

## 验证

- `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_story_state.py -q` → 58 passed。
- `cd apps/api && uv run pytest tests/test_metrics.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_story_state.py -q` → 61 passed。
- `cd apps/api && uv run ruff check app/common/metrics.py app/domains/book_runs/book_generation_changes.py app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_judge.py app/domains/book_runs/book_generation_parallel.py app/domains/book_runs/book_generation_progress.py app/domains/book_runs/book_generation_metrics.py tests/test_metrics.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_story_state.py` → All checks passed。

## 未完成

- 仍不是 OpenAI function/tool-call transport；当前仍兼容 `STORY_STATE_CHANGES` JSON block。
- 语义 grounding 仍未接入，当前 schema retry 只校验结构，不判断 delta 语义是否被正文支持。
- 跨章语义新维度与 Q9 真实 4 万字重跑仍未执行。
