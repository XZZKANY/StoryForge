# Q1/Q4 P8 OpenAI-compatible tool-call transport 上下文摘要（2026-06-30）

## 目标

- 为 StoryState CHANGES 增加真正的 OpenAI-compatible `tools/tool_calls` 结构化传输。
- 保留正文 `STORY_STATE_CHANGES` JSON block fallback，避免目标 provider 不支持 tools 时断粮。
- 仍复用稳定 ID 花名册、schema retry、semantic grounding advisory，不绕过既有 Q1/Q4 规则。

## 已落地

- `apps/api/app/domains/book_runs/book_generation_llm.py`
  - `_call_llm()` 新增 `tools` / `tool_choice` 可选入参。
  - 请求 payload 透传 `tools` / `tool_choice`。
  - 响应 `message.tool_calls` 规整为 `result["tool_calls"]`。
  - 正文仍必须在 `message.content` 中返回；tool call 不能替代章节正文。
- `apps/api/app/domains/book_runs/book_generation_changes.py`
  - 新增 `STORY_STATE_CHANGES_TOOL_NAME = "record_story_state_changes"`。
  - 新增 `story_state_changes_tools()`，工具参数包含 `changes[]`，字段对齐 `StateChangeInput`。
  - 新增 `extract_story_state_changes_from_tool_calls()`，从 tool call arguments JSON 中读取 CHANGES。
- `apps/api/app/domains/book_runs/book_generation.py`
  - `_generate_chapter()` 默认发送 `record_story_state_changes` tool schema，`tool_choice="auto"`。
  - 若 tool call 与正文 JSON block 同时存在，优先采用 tool call。
  - `STORYFORGE_LLM_STORY_STATE_TOOL_CALLS=0/false/no/off` 可关闭 tools，回退 JSON block。
  - 返回 `story_state_changes_source` 与 `story_state_tool_call_count`。
- `apps/api/app/domains/book_runs/book_generation_records.py`
  - ScenePacket payload 记录 `story_state_changes_source`。
  - ModelRun payload 记录 `story_state_changes_source` / `story_state_tool_call_count`。
- `apps/api/app/domains/book_runs/book_generation_parallel.py`
  - 并发 precommit 路径透传 ScenePacket 来源与章节 progress 来源字段。

## 验证

- `cd apps/api && uv run pytest tests/test_book_generation_llm_retry.py tests/test_book_generation.py::test_story_state_changes_tool_calls_are_extracted tests/test_book_generation.py::test_generate_chapter_prefers_story_state_tool_calls -q` → 7 passed。
- `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_book_generation_llm_retry.py tests/test_story_state.py -q` → 69 passed。
- `cd apps/api && uv run ruff check app/domains/book_runs/book_generation_llm.py app/domains/book_runs/book_generation_changes.py app/domains/book_runs/book_generation.py app/domains/book_runs/book_generation_records.py app/domains/book_runs/book_generation_parallel.py tests/test_book_generation_llm_retry.py tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_story_state.py` → All checks passed。

## 仍未完成

- 未对真实外部 provider 做 tools 兼容性探针。
- Q9 前若 provider 不支持 tools，需要设置 `STORYFORGE_LLM_STORY_STATE_TOOL_CALLS=0` 明确回退 JSON block。
- 跨章语义新维度仍未实现；Q9 真实 4 万字长程仍未执行。
