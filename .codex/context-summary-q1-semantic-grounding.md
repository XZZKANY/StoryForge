# Q1/Q4 P7 LLM 语义 grounding 上下文摘要

时间：2026-06-30 +08:00

## 已完成

- `StoryStateGroundingResult` 新增 `semantic_reason`。
- 新增 `apps/api/app/domains/story_state/semantic.py`：
  - `semantic_ground_story_state_changes(prose, changes)`
  - 复用 `STORYFORGE_JUDGE_LLM_*`，回退到 `STORYFORGE_LLM_*`。
  - 输出每条 CHANGES 的 `semantic_score` 与 `semantic_reason`。
- `commit_story_state_changes()` 新增可注入 `semantic_grounder`，语义 grounding 只作为 advisory：
  - 有分数则写入 grounding/event。
  - grounder 异常时写 `semantic_grounding_failed`，不回滚确定性通过的提交。
  - 未配置语义模型时保持 `semantic_status=not_run`。
- `_commit_story_state_for_scene()` 在真实生成路径传入 `semantic_ground_story_state_changes`。
- fast judge advisory 场景现在会有两次语义 LLM 调用：章节语义 judge + story_state semantic grounding。

## 验证

- `cd apps/api && uv run pytest tests/test_story_state.py tests/test_book_generation.py tests/test_book_generation_parallel.py -q` → 60 passed。
- `cd apps/api && uv run ruff check app/domains/story_state/schemas.py app/domains/story_state/service.py app/domains/story_state/semantic.py app/domains/book_runs/book_generation_judge.py tests/test_story_state.py tests/test_book_generation.py tests/test_book_generation_parallel.py` → All checks passed。

## 未完成

- 语义 grounding 仍是 advisory，不硬断、不触发机械改写。
- 真正 function/tool-call transport 尚未实现；当前仍使用 `STORY_STATE_CHANGES` JSON block。
- 跨章语义新维度与 Q9 真实 4 万字重跑仍未执行。
