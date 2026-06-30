# Q4 P1 跨章语义 judge 维度上下文摘要（2026-06-30）

## 目标

- 扩展 semantic judge 的类别空间，让它能识别 story_state / memory / evidence_links 提供的跨章事实冲突。
- 不改 HTTP schema，不新增 judge 表或路由。

## 已落地

- `apps/api/app/domains/judge/semantic.py`
  - system prompt 新增四类 category：
    - `cross_chapter_state_conflict`
    - `foreshadow_payoff_gap`
    - `arc_continuity_drift`
    - `repetition_echo`
  - user prompt 新增 `证据链接：{payload.evidence_links}`，让 `story_state_ledger` / memory / planning 证据进入远程 Judge 上下文。
- `apps/api/app/domains/book_runs/book_generation_judge.py`
  - `_CATEGORY_DIMENSION` 新增上述类别映射：
    - `cross_chapter_state_conflict` → `world_consistency`
    - `foreshadow_payoff_gap` / `arc_continuity_drift` → `narrative_quality`
    - `repetition_echo` → `style_consistency`
- `apps/api/tests/test_judge_semantic.py`
  - provider 返回 `cross_chapter_state_conflict` 时应保留类别、严重性和 expected_text。
  - 远程请求 prompt 应包含新增跨章类别和 `story_state_ledger` evidence。

## 验证

- `cd apps/api && uv run pytest tests/test_judge_semantic.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_story_state.py -q` → 70 passed。
- `cd apps/api && uv run ruff check app/domains/judge/semantic.py app/domains/book_runs/book_generation_judge.py tests/test_judge_semantic.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_story_state.py` → All checks passed。

## 仍未完成

- 未跑真实外部 provider 长程观察这些类别的误报/漏报。
- 未做 Q9 真实 4 万字重跑与人工盲评。
- 未接 workflow narrative guard；本实现限定在 API judge domain。
