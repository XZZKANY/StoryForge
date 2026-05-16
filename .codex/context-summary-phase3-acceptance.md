## 项目上下文摘要（Phase 3 收尾验收）

生成时间：2026-05-16 17:50:11 +08:00

### 1. 相似实现分析

- `tests/e2e/phase2-contract.spec.ts`：延续 OpenAPI + 源码证据契约模式，用于 Phase 3 静态收尾验收。
- `apps/api/tests/test_series_memory.py` 与 `test_batch_refinery.py`：沿用 SQLite 内存库 + pytest 的本地可重复验证模式。
- `apps/web/tests/phase1-navigation.test.tsx`：延续前端中文与导航契约测试，扩展到 Phase 3 页面入口。
- `apps/api/app/domains/collaboration/service.py`、`commercial/service.py`、`analytics/service.py`：Phase 3 业务规则聚合落点，适合作为服务层补偿验收入口。

### 2. 项目约定

- 所有新增文档、测试标题、错误说明和日志均使用简体中文。
- 审计过程文件继续写入 `.codex/`。
- OpenAPI 契约仍以 `packages/shared/src/contracts/storyforge.openapi.json` 为事实源。
- 前端继续使用 Node 原生测试做源码契约，不引入额外浏览器依赖。

### 3. 可复用组件清单

- `apps/api/app/domains/workspaces/*`：工作区、成员与席位控制。
- `apps/api/app/domains/collaboration/*`：评论、审批请求、审批决策与时间线。
- `apps/api/app/domains/events/*`：事件写入和倒序读取。
- `apps/api/app/domains/commercial/*`：套餐限额与当前使用量聚合。
- `apps/api/app/domains/provider_gateway/*`：Provider 配置、列表和能力解析。
- `apps/api/app/domains/analytics/*`：审批、修复、任务、事件和 provider 聚合。

### 4. 测试策略

- 静态契约：`apps/web/scripts/phase1-contract-test.mjs` 与 `tests/e2e/phase3-contract.spec.ts`。
- 语法与导入完整性：`python3 -m compileall apps/api/app apps/api/tests`。
- 服务层补偿验收：新增 `apps/api/tests/test_phase3_service_acceptance.py`，在 SQLite 内存库中绕过当前沙箱里 `TestClient` 对同步路由的阻塞问题。
- OpenAPI 验证：重新生成共享契约，并检查 Phase 3 路由已经注册。

### 5. 关键风险点

- 当前沙箱中 FastAPI 同步路由使用 `TestClient` 或 ASGI 传输时会阻塞，因此无法在本环境直接跑 Phase 3 HTTP 路由 pytest；需用服务层补偿验证。
- 商业化控制的 Token 使用量来自 `JobRun.progress["token_usage"]`，属于控制面板估算值，不是账单级真相源。
- 协作时间线在 SQLite 秒级时间戳下需要稳定排序，否则评论和审批请求可能在同秒错序。
