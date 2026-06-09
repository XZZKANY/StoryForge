## 项目上下文摘要（整体项目审查）

生成时间：2026-06-09 01:13:16 +08:00

### 1. 相似实现分析

- **后端入口与中间件**: apps/api/app/main.py
  - 模式：FastAPI 单应用集中注册路由，中间件承担 CORS、认证、限流、超时与安全响应头。
  - 可复用：`RequestLoggingMiddleware`、`SecurityHeadersMiddleware`、`SessionDependency`。
  - 需注意：`_expected_api_key()`、`_cors_origins()`、`_request_timeout_seconds()` 仍直接读取环境变量。
- **后端领域服务**: apps/api/app/domains/book_runs/router.py 与 apps/api/app/domains/book_runs/service.py
  - 模式：路由层捕获领域异常并映射 HTTP 状态，服务层直接负责事务提交和聚合状态变更。
  - 可复用：`BookRunBlockedError`、`BookRunError`、`BookRunNotFoundError`、`apply_book_run_progress()`。
  - 需注意：服务层逻辑较厚，BookRun 进度、时间线同步、预算门禁都集中在单文件中。
- **前端统一 API 客户端**: apps/web/lib/api-client.ts
  - 模式：服务端组件和 Server Action 通过 `apiFetch()` 注入 `X-StoryForge-API-Key`，`readJson()` 统一错误状态。
  - 可复用：`apiFetch()`、`readJson()`、`ApiResult<T>`。
  - 需注意：浏览器原生 `EventSource` 不能复用自定义 header 注入逻辑。
- **前端 IDE 运行事件**: apps/web/components/ide/views/BookRunEventsPanel.tsx 与 BookRunEventsClient.tsx
  - 模式：服务端先通过 `apiFetch()` 读取 SSE 快照，客户端再用 `new EventSource(eventsUrl)` 打开实时连接。
  - 可复用：`reduceBookRunEventSourceState()`、`parseBookRunEvent()`。
  - 需注意：客户端连接地址是相对路径 `/api/ide/runs/{id}/events`，未看到对应 Next rewrite 或带认证代理。
- **Workflow 编排**: apps/workflow/storyforge_workflow/orchestrators/book_loop.py 与 book_run_adapter.py
  - 模式：BookRun dispatch payload 通过 adapter 进入 BookLoop，端口协议隔离 API 数据库和 workflow 运行时。
  - 可复用：`BookLoopRequest`、`run_book_loop()`、`BookRunProgressSink`、`run_book_run_dispatch_payload()`。
  - 需注意：并发预取、顺序提交、预算暂停和 provider 降级均有测试覆盖。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case；TypeScript 使用 camelCase/PascalCase；路由端点函数多以语义化动作命名。
- **文件组织**: monorepo 结构，`apps/api` 为 FastAPI 后端，`apps/web` 为 Next.js 前端，`apps/workflow` 为 Python workflow，`packages/shared` 存放 OpenAPI 类型和共享诊断逻辑。
- **导入顺序**: Python 由 Ruff `I` 规则约束；TypeScript 由 ESLint 与 Prettier 约束。
- **代码风格**: Python line-length 120，TypeScript/TSX 由 Prettier 检查；AGENTS.md 要求 UTF-8 无 BOM。

### 3. 可复用组件清单

- `apps/api/app/common/config.py`: 类型化运行时配置与生产环境校验。
- `apps/api/app/db/deps.py`: FastAPI 数据库会话依赖别名。
- `apps/api/app/common/middleware.py`: 请求日志与安全响应头中间件。
- `apps/api/app/common/auth.py`: API Key/JWT 双模认证辅助。
- `apps/web/lib/api-client.ts`: 前端服务端取数和 Server Action 的统一 API 客户端。
- `packages/shared/src/diagnostic.ts`: Judge issue 到 IDE Diagnostic 的共享映射。
- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`: BookRun 章节循环、并发、预算和 checkpoint 核心逻辑。

### 4. 测试策略

- **测试框架**: Web 使用 Node `node:test` 加转译脚本；Shared 使用 `tsc --noEmit`；API 与 Workflow 使用 pytest；静态检查使用 ESLint、Prettier、Ruff。
- **参考文件**:
  - `apps/api/tests/test_api_middleware.py`
  - `apps/api/tests/test_ide_run_events.py`
  - `apps/web/tests/ide-page.test.tsx`
  - `apps/web/tests/ide-components.test.tsx`
  - `apps/workflow/tests/test_book_loop_three_chapters.py`
- **覆盖现状**: 单元和契约测试数量充足；但浏览器原生 EventSource 到受保护 FastAPI SSE 的端到端认证路径缺少覆盖。

### 5. 依赖和集成点

- **外部依赖**: FastAPI、SQLAlchemy、Alembic、Redis、limits、Sentry、Next.js、React、Zustand、LangGraph。
- **内部依赖**: Web 通过 `@storyforge/shared` 消费 OpenAPI 类型；API 生成 OpenAPI 契约到 `packages/shared/src/contracts/storyforge.openapi.json`；Workflow 通过 dispatch payload 和 progress sink 与 API 集成。
- **配置来源**: `.env`、`.env.local`、环境变量、`apps/api/app/common/config.py`；但多个模块仍直接调用 `os.getenv()` 或 `process.env`。
- **关键集成点**: `/api/book-runs`、`/api/ide/runs/{book_run_id}/events`、`/api/ide/commands/{command_id}`、OpenAPI 生成脚本。

### 6. 技术选型理由

- **FastAPI + SQLAlchemy**: 适合类型化 API、OpenAPI 合约和本地 TestClient 验证。
- **Next.js App Router**: 服务端组件可在渲染时安全注入后端 API Key，客户端组件负责 IDE 交互。
- **Workflow 独立应用**: 通过端口和 dispatch payload 降低 API ORM 与长任务运行时耦合。
- **风险**: 若浏览器需要直连 API，静态 API Key 方案和原生 EventSource 的认证能力不匹配。

### 7. 关键风险点

- **本地门禁失败**: `pnpm run verify:ci` 因 Prettier 检查失败中止；API 和 Workflow Ruff 分项也失败。
- **运行链路风险**: 浏览器 `EventSource('/api/ide/runs/{id}/events')` 无法携带 `X-StoryForge-API-Key`，后端全局认证会拒绝缺少凭据的 `/api/ide/**` 请求。
- **编码规范风险**: 多个源码/测试文件存在 UTF-8 BOM，违反 AGENTS.md 的“UTF-8 无 BOM”要求。
- **测试盲区**: 现有 EventSource 测试验证字符串、状态机和假服务器重连，未验证真实 Next 页面到 FastAPI 认证 SSE。
