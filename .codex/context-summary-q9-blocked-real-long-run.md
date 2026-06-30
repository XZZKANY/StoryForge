# Q9 真实长程验收阻塞摘要（2026-06-30）

## 当前状态

- Q9 真实 4 万字长跑未执行。
- 本轮只复验了长程 wrapper / evidence validator 的本地结构门禁。

## 环境预检

以下变量均缺失：

- `STORYFORGE_LLM_API_KEY`
- `STORYFORGE_LLM_BASE_URL`
- `STORYFORGE_LLM_MODEL`
- `STORYFORGE_LLM_PROVIDER`
- `STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD`
- `STORYFORGE_ALLOW_DIRECT_SERIAL_PH5`

## 已验证

- `cd apps/api && uv run pytest tests/test_book_generation_long_wrapper.py -q` → 16 passed。
- `cd apps/api && uv run pytest tests/test_real_llm_long_evidence_validator.py -q` → 12 passed。
- `cd apps/api && uv run pytest tests/test_book_generation.py tests/test_book_generation_long_wrapper.py tests/test_real_llm_long_evidence_validator.py tests/test_book_exporter.py -q` → 76 passed。
- `cd apps/api && uv run ruff check app/domains/book_runs/book_generation_metrics.py tests/test_book_generation.py tests/test_book_generation_long_wrapper.py tests/test_real_llm_long_evidence_validator.py` → All checks passed。
- PowerShell parser check for `.codex/validate-real-llm-long-evidence.ps1` → parse-ok。

## 本轮增强

- `summary.json.per_chapter_metrics` 现在投影 `story_state_changes_source` / `story_state_tool_call_count`。
- `.codex/run-real-llm-long-direct.py` 运行后门禁要求：
  - `audit_report.full_book_advisory_audit` 存在。
  - `full_book_advisory_audit.hard_gate=false`。
  - `quality_summary.full_book_advisory_status` 存在。
  - 至少一章存在非 `none` 的 `story_state_changes_source`。
- `.codex/validate-real-llm-long-evidence.ps1` 落盘验收执行同类校验。
- 默认接受 `tool_call` 或 `json_block` StoryState changes 来源；新增 `-RequireToolCallStoryStateChanges` 只用于真实 provider tool-call 严格探针。

## 不得误判

- 上述测试只证明 wrapper / validator 结构门禁可用，并且 Q6/P8 证据会被纳入验收，不代表 Q9 完成。
- 仍缺：
  - 真实 provider 配置与成本确认。
  - 真实 provider tool-call support 探针。
  - 4 万字 / 16-18 章真实长跑。
  - resume/预算暂停实战演练。
  - 人工盲评与 `manual-readthrough-completion.md`。
  - `book.md` / `book.epub` / `audit_report.json` / `summary.json` / `run-metadata.json` 的真实 sha256 登记。

## 产品轨阻塞

- P1-P4 / F1 未交付。
- 当前约束为不触碰 `apps/web`；这些事项依赖 Tauri/Web 真实按钮路径、CJK diff、Provider 设置、实时流式或 P1 结论。
