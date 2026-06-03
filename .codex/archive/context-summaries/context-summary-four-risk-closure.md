## 项目上下文摘要（四项剩余风险收口）

生成时间：2026-05-20 20:05:00 +08:00

### 1. 相似实现分析

- `apps/web/app/studio/page.tsx`：既有 async Server Component 使用页面级 `fetch(..., { cache: "no-store" })` 读取作品、章节、Scene Packet、Judge 和 Repair，失败时返回页面状态而非抛出异常。
- `apps/web/app/retrieval/page.tsx`：按资料源、刷新任务、搜索请求分段读取真实 API，并保留中文契约区块和不可用边界说明。
- `apps/api/app/domains/studio/router.py` + `service.py` + `schemas.py`：沿用 router/service/schema 分层，路由只做 Query 参数和异常到 HTTP 状态映射，业务只读摘要放在 service。
- `apps/web/lib/phase6-data-sources.ts`：作为 Phase 6 页面契约 registry，页面只渲染 registry，不在页面内重复维护状态事实。

### 2. 项目约定

- Web 页面采用 App Router async page，局部类型守卫验证 API payload；失败显示“可重试错误摘要”。
- API 采用 FastAPI router + SQLAlchemy service + Pydantic schema；只读摘要 API 不触发写入或后台执行。
- 文档和审计均使用简体中文；状态必须区分“Web 单点读取已实现”和“执行流仍未实现”。

### 3. 可复用组件清单

- `phase6DataSources`：统一记录 Studio/Retrieval/Runs/Artifacts/Evaluations 数据源状态。
- `SessionDependency`：API router 的数据库会话依赖。
- `NotFoundError` 派生异常：service 抛出业务缺失，router 转换为可展示 HTTP 错误。
- `assertIncludesAll()`：前端中文契约测试复用断言工具。
### 4. 测试策略

- API 定向测试：`tests/test_model_runs.py`、`tests/test_studio_book_list_api.py`、`tests/test_artifacts.py`、`tests/test_evaluations.py`。
- Web 契约测试：`pnpm --filter @storyforge/web test` 保护中文页面、registry 状态、真实读取端点和未实现边界文案。
- TypeScript：`pnpm --filter @storyforge/web exec tsc --noEmit` 验证 async 页面类型与 payload guard。
- 发布门禁：`pnpm verify`、`pnpm openapi`、`pnpm test`、`pnpm e2e`、Alembic `current --check-heads`、`git diff --check`。

### 5. 依赖和集成点

- Runs 页面读取 `GET /api/model-runs/job-runs/{job_run_id}`，当前默认 `job_run_id=1`。
- Studio 页面新增读取 `GET /api/studio/approval-summary` 与 `GET /api/studio/recovery-summary`，仅展示资格摘要。
- Artifacts 页面读取 `GET /api/artifacts`；Evaluations 页面读取 `GET /api/evaluations/runs`。
- `.codex/current-phase.md` 为当前事实入口；`.codex/operations-log.md` 仅追加索引化摘要，不复制长流水。

### 6. 技术选型理由

- 继续使用页面级 SSR 读取，避免引入全量 HTTP client、缓存平台或跨页面状态管理。
- Studio 批准/恢复只做摘要 API，符合计划“不实现真实按钮执行流”的边界。
- Registry 状态与契约测试同步更新，避免页面、TODO 和架构文档分叉。

### 7. 关键风险点

- `job_run_id=1` 在干净环境可能不存在，因此页面必须展示可重试错误摘要而不是崩溃。
- Artifacts/Evaluations 列表只做摘要读取，下载、趋势图、报告详情仍需明确保留为未实现。
- OpenAPI 生成如有 diff，必须确认来源于新增 Studio 摘要端点后再提交。
