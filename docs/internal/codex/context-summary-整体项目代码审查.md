## 项目上下文摘要（整体项目代码审查）

生成时间：2026-06-09 03:40:00 +08:00

### 1. 代码结构与主链路

- `apps/api/app/main.py`：FastAPI 入口，统一挂载认证、限流、请求超时、安全响应头、指标和各领域 router。
- `apps/api/app/domains/book_runs/service.py`：BookRun 核心状态机，负责启动、dispatch payload、progress 回填、预算暂停、checkpoint、Timeline 同步。
- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`：整书章节循环，支持串行、并发预取、预算、provider 降级、跨章一致性屏障。
- `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`：单章 compile/generate/judge/repair/approve/memory/continuity 端口化闭环。
- `apps/web/lib/api-client.ts`：Web 服务端访问 API 的统一客户端，注入 API Key 并使用 `cache: no-store`。

### 2. 相似实现分析

- **API router/service 模式**：`book_runs/router.py` 只做 HTTP 映射和异常转换，业务集中在 `book_runs/service.py`。
- **workflow 端口模式**：`novel_loop.py` 使用 `NovelLoopPorts` 注入外部依赖，便于单测替换 generate/judge/approve。
- **Web Server Action 模式**：`studio/actions.tsx`、home assistant action 复用 `apiFetch`、依赖注入和重定向/刷新模式。

### 3. 项目约定

- Python：FastAPI + SQLAlchemy 2 + Pydantic v2，领域按 `models/schemas/service/router` 分层。
- Workflow：dataclass 请求/结果对象，端口函数注入，pytest 直接断言编排行为。
- Web：Next.js 15/React 19，服务端读取统一走 `apiFetch/readJson`，测试使用 `node:test` 与 `assert`。
- 共享契约：OpenAPI JSON 位于 `packages/shared/src/contracts/storyforge.openapi.json`，类型由 `openapi-typescript` 生成。

### 4. 测试策略

- API：`apps/api/tests` 使用 SQLite 内存库、TestClient、依赖覆盖，重点覆盖中间件、BookRun、迁移、领域服务。
- Workflow：`apps/workflow/tests` 使用纯函数/端口替身覆盖编排、并发、provider fallback、checkpoint。
- Web：`apps/web/tests` 通过 `phase1-contract-test.mjs` 跑 node:test，覆盖统一 API client、页面契约和 SSE 代理。
- 本轮定向验证：API 41 passed、Workflow 20 passed、Web 5 passed。
### 5. 依赖与集成点

- API 与 Web 通过 `STORYFORGE_API_BASE_URL`、`STORYFORGE_API_KEY` 集成。
- API 与 Workflow 通过 BookRun dispatch/progress payload、`storyforge_api_client.py`、真实/确定性 provider 配置集成。
- API 与数据库依赖 Alembic、SQLAlchemy ORM、Postgres/pgvector；测试主要用 SQLite 替身。
- 运行验证入口为 `pnpm verify`、`pnpm test`、`pnpm e2e`、`pnpm openapi`。

### 6. 关键风险点

- API 限流使用 `limits.storage.MemoryStorage`，但容器入口默认注入多 uvicorn worker，限流计数会按进程分片。
- Web 与 workflow 默认回退 `local-dev-key`，生产若配置遗漏会依赖启动校验兜底，但跨服务配置仍需显式验证。
- workflow 并发预取会在预算或 provider 降级门禁触发前启动窗口内后续章节，可能产生额外 LLM 成本。
- `novel_loop._optional_int` 对非整数字符串或异常 provider payload 会直接抛 `ValueError`，缺少边界容错。

### 7. 工具与资料来源

- 本地源码：使用 Desktop Commander 读取关键文件；`start_search` 未暴露，已记录并用 PowerShell/rg 后备检索。
- 官方文档：Context7 查询 FastAPI router/dependency/middleware/exception 组织模式。
- 开源参考：GitHub code search 抽样检索 FastAPI API key / rate limit middleware 参考实现。
