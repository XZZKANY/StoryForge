## 项目上下文摘要（真实 LLM 瓶颈优化）

生成时间：2026-06-06 02:23:07 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`
  - 模式：顺序驱动每章 NovelLoop，完章后回填 progress、checkpoint 和预算。
  - 可复用：`BookLoopRequest`、`BookLoopResult`、`_chapter_progress`、`_checkpoint_entry`。
  - 需注意：预算和 provider fallback 暂停依赖顺序累计，不能让并发完成顺序直接决定 checkpoint。
- **实现2**: `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`
  - 模式：adapter 注入 `NovelSkillRunner`，通过 `BookRunProgressSink` 将 BookLoop 结果回填 API。
  - 可复用：`CapturingProgressSink`、`CallableProgressSink`、`_emit_result_progress`、`_volume_progress_from_result`。
  - 需注意：失败时必须先回填 failed progress，并重新抛出原始异常。
- **实现3**: `apps/workflow/storyforge_workflow/provider_client.py`
  - 模式：`generate_text` 统一读取 provider env，并调用 OpenAI 兼容 Chat Completions。
  - 可复用：`provider_config`、`planning_temperature`、`draft_temperature`、模型别名归一逻辑。
  - 需注意：当前使用 `urllib.request.urlopen`，每次调用新建连接，缺少连接复用。
- **实现4**: `apps/api/app/domains/book_runs/service.py`
  - 模式：`apply_book_run_progress` 统一应用 workflow 回填，并同步完章 TimelineEvent。
  - 可复用：`_timeline_event_payload_for_completed_chapter`、`_timeline_evidence_refs`、预算汇总逻辑。
  - 需注意：`_sync_completed_chapter_timeline_events` 对每个 completed chapter 逐个查章节和事件，存在 N+1 查询。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case；dataclass/Protocol 使用 PascalCase；pytest 用 `test_` 前缀。
- **文件组织**: workflow 侧负责真实模型调用与长任务编排；API 侧负责 BookRun 状态、Timeline 和数据库事务。
- **导入顺序**: `from __future__ import annotations` 后标准库、第三方、项目内部导入，受 ruff `I` 管理。
- **代码风格**: 行宽 120，中文注释说明意图与约束，端口注入优先于硬编码。

### 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/provider_client.py`: provider env 解析、模型别名、温度配置。
- `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`: provider 错误归一、fallback adapter、成本估算。
- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`: BookRun 章节状态机。
- `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`: workflow 到 API progress sink 边界。
- `apps/api/app/domains/book_runs/service.py`: BookRun progress 真相源与 Timeline 同步。

### 4. 测试策略

- **测试框架**: workflow/API 使用 pytest，Web 使用 Vitest/Playwright。
- **测试模式**: 对 provider client 使用本地 HTTPServer 和 monkeypatch；对编排逻辑使用注入端口和捕获 sink。
- **参考文件**: `apps/workflow/tests/test_llm_provider.py`、`apps/workflow/tests/test_book_loop_three_chapters.py`、`apps/workflow/tests/test_book_run_adapter.py`、`apps/api/tests/test_book_runs.py`。
- **覆盖要求**: provider 连接复用需覆盖真实 HTTP 协议调用、参数透传、错误保持；后续章节并发需覆盖顺序提交、预算暂停、失败回填和 resume。

### 5. 依赖和集成点

- **外部依赖**: Python 标准库 `http.client`、`urllib.error.HTTPError`、`concurrent.futures`、`sqlite3`；当前 workflow 未声明 `httpx` 或 `requests`。
- **内部依赖**: workflow `generate_text` 被 `nodes/director.py`、`nodes/scene_architect.py`、`nodes/draft_writer.py` 和 provider adapter 调用。
- **集成方式**: provider client 维持 `generate_text(prompt, system_prompt, temperature, model)` 公开接口；API progress 继续由 `apply_book_run_progress` 作为唯一写入口。
- **配置来源**: `STORYFORGE_LLM_*` env；workflow SQLite 由 `STORYFORGE_WORKFLOW_SQLITE_PATH` 控制。

### 6. 技术选型理由

- **为什么用这个方案**: 第一阶段先替换 `urllib` 为标准库持久连接客户端，不新增依赖，收益明确且对业务状态机影响最小。
- **优势**: 保持公开接口兼容；可通过本地 HTTP/1.1 测试证明连接复用；异常仍可映射为现有 `HTTPError`/timeout。
- **劣势和风险**: `http.client` 属低层 API，需要确保响应完整读取、异常时关闭连接、按线程隔离连接避免跨线程共享。

### 7. 关键风险点

- **并发问题**: 连接对象不能跨线程共享；章节并发不能让后完成的前序章节阻塞后序 checkpoint 语义。
- **边界条件**: provider 返回非 JSON、空内容、HTTP 429/500、连接被服务端关闭时必须清理连接。
- **性能瓶颈**: provider 建连、章节串行等待、Timeline N+1、SQLite 每次开连接、每节点新建线程池。
- **安全考虑**: 不能记录 API key；不能削弱 provider fallback、预算暂停、checkpoint 和审计链。
