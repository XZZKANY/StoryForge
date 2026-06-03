## 项目上下文摘要（下一阶段执行：Timeline/人工通读/跨卷记忆/Assistant 余项）

生成时间：2026-06-02 21:00:21 +08:00

### 1. 当前计划剩余项

- 真实 LLM 10 章或 3-5 万字验收：仍缺模型名和本机安全环境变量注入，不能在当前无模型名状态下执行。
- TimelineEvent 自动接线：已有独立 timeline API/表，但 BookRun progress 回填尚未自动生成事件。
- 人工通读门禁：已有 `awaiting_review` 状态，但缺少整书人工通读 gate 的结构化事实。
- 跨卷 Story Memory guard：已有 `get_active_memory_atoms()` 和 NovelLoop `check_static_quality` 端口，但缺少基于长期事实的生成后硬门禁函数。
- Assistant 前端余项：需核查最近记录真实 API、章节修订/导出审计回流是否已经完全闭环。

### 2. 已完成基线验证

- `uv run pytest tests/test_book_runs.py tests/test_timeline_events.py tests/test_book_exporter.py tests/test_story_memory_contract.py tests/test_story_memory_persistence.py -q`
  - 工作目录：`apps/api`
  - 结果：29 passed，1 个既有 HTTP 422 deprecation warning。

### 3. 当前并行代理

- TimelineEvent 自动接线 worker：写集限定在 `book_runs/service.py`、`test_book_runs.py`、`test_timeline_events.py` 和 `.codex`。
- 人工通读门禁 worker：写集限定在 `book_runs`、`exports/book_markdown_exporter.py`、相关测试和 `.codex`。
- 跨卷 Story Memory guard worker：写集限定在 `story_memory`、相关 API/workflow 测试和 `.codex`。
- OpenAPI 契约 explorer：只读核查 schema 变化后的共享契约同步风险。
- Assistant 最近记录 explorer：只读核查首页最近记录是否已接真实 Assistant sessions。
- Assistant 修订/导出 explorer：只读核查章节审阅、Repair Patch、批准写回、导出审计对话回流。

### 4. 风险与协调

- TimelineEvent worker 与人工通读 worker 都可能触碰 `apps/api/app/domains/book_runs/service.py` 和 `apps/api/tests/test_book_runs.py`，主线程需要在回收结果后做冲突整合。
- OpenAPI 可能需要在 API schema 变更后统一执行 `pnpm openapi`，避免共享契约漂移。
- 当前工作树已有大量未提交改动，禁止回滚非本阶段修改。
- 所有真实 LLM 相关操作禁止复述或落盘 API Key。
