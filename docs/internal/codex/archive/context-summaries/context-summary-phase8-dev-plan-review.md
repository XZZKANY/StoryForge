## 项目上下文摘要（Phase 8 任务完成度审查）

生成时间：2026-05-26 22:54:31 +08:00

### 1. 相似实现与关键证据

- **计划文件**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.dev_plan.md`
  - 模式：Stage 1-8 全部以 `[x]` 标记完成。
  - 需注意：标记完成不等于本地门禁通过，需逐项用文件和命令验证。
- **质量门禁**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/package.json`
  - 模式：根脚本提供 `verify`、`test`、`e2e`、`lint`、`openapi`。
  - 需注意：`verify` 只跑 PowerShell 本地检查，未覆盖测试、lint、e2e 和 build。
- **CI 工作流**: `.github/workflows/ci.yml` 与 `.github/workflows/e2e.yml`
  - 模式：CI 与 E2E 拆为两个 workflow；E2E 配置 Postgres 和 Redis service。
  - 需注意：CI 证据存在，但本地无法证明远端 Actions 通过。
### 2. 项目约定

- **技术栈**: pnpm workspace；Next.js 15 + React 19；FastAPI + SQLAlchemy + pytest；Workflow Python runtime + pytest。
- **命名约定**: TypeScript 使用 PascalCase 组件和 camelCase 函数；Python 模块使用 snake_case。
- **文件组织**: API 按 `apps/api/app/domains/*` 分域；通用能力在 `apps/api/app/common/*`；Web 组件在 `apps/web/components/*`。
- **验证方式**: 根脚本为 `pnpm lint`、`pnpm test`、`pnpm verify`、`pnpm e2e`；Docker 验证使用 `docker compose`。

### 3. 可复用组件清单

- `apps/api/app/common/pagination.py`: 游标分页 helper。
- `apps/api/app/common/redis_cache.py`: Redis 缓存 helper。
- `apps/api/app/common/middleware.py`: Request ID、安全响应头中间件。
- `apps/api/app/common/config.py`: Pydantic Settings 配置层。
- `apps/web/components/job-status/job-status-core.ts`: Job 状态解析工具。
- `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`: Provider adapter、fallback 和 token 估算。
### 4. 测试策略

- **Web**: `node scripts/phase1-contract-test.mjs`，本次本地结果为 56/56 通过。
- **API**: `cd apps/api && uv run pytest`，本次本地结果为 214/214 通过，存在 4 个 JWT 密钥长度告警。
- **Workflow**: `cd apps/workflow && uv run pytest`，本次本地结果为 55/55 通过。
- **静态检查**: `pnpm lint` 本次本地通过。
- **发布门禁**: `pnpm verify`、`pnpm e2e`、Web production build、prod compose config 本次均失败。

### 5. 依赖和集成点

- **OpenAPI**: `scripts/generate-openapi.mjs` 生成 `packages/shared/src/contracts/storyforge.openapi.json`。
- **CI/E2E**: GitHub Actions 配置在 `.github/workflows/ci.yml` 和 `.github/workflows/e2e.yml`。
- **Docker**: `docker-compose.yml` 提供 6 个基础/应用服务；nginx 仅在 `docker-compose.prod.yml`。
- **前端构建**: `next.config.ts` 使用 `output: 'standalone'` 与 Sentry wrapper。

### 6. 关键风险点

- 计划标记与本地门禁结果不一致，不能认定全部完成。
- OpenAPI 契约刷新后仍产生 git diff，说明契约快照未同步。
- Docker prod config 依赖缺失的 `.env.production`，本地 config 验证失败。
- Web build 在 Windows symlink 阶段 EPERM 失败，发布构建不可重复通过。
- Stage 6/7 存在计划范围缺口：provider 矩阵、全列表分页、Scene Packet 缓存均未充分证明。
