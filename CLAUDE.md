# CLAUDE.md — StoryForge 项目上下文

> 本文件帮助新一轮 Claude Code 会话快速理解 StoryForge 仓库。
> 上位规范见 `docs/internal/AGENTS.md`、日常执行版见 `docs/internal/AI_ITERATION_GUIDE.md`。

## 1. 项目定位

StoryForge 是面向**长篇小说生产**的可验证创作流水线：
每一次生成、检索、评审、修复、批准与回写，都必须留下可追溯证据，而不是只产出一段孤立文本。

设计立场：**先做诊断控制台，再做生成器**。任何生成路径都先有读取证据 → 评审 → 修复 → 批准的闭环，再考虑接真实模型。

## 2. 技术栈

- **API（后端事实源）：** FastAPI（Python 3.11+） + SQLAlchemy + Alembic + Pydantic v2，依赖管理走 `uv`。
- **Web（前端工作台）：** Next.js 15（App Router） + React 19 + Tailwind v4 + TypeScript 5.8。
- **Workflow（编排）：** LangGraph，承载长任务、checkpoint、真实模型调用边界。
- **共享契约：** `packages/shared`（TypeScript 包），其中 `src/contracts/storyforge.openapi.json` 是后端 OpenAPI 快照，必须随后端变化同步刷新。
- **基础设施：** PostgreSQL（+ pgvector） + Redis + MinIO（对象存储） + Sentry（错误追踪） + Prometheus 指标。
- **包管理：** pnpm 9.x（workspace），Python 侧 `uv sync`。

## 3. 仓库布局

```
apps/
  api/           FastAPI 业务真相源（领域驱动，每个子目录是一个 domain）
    app/
      common/    auth、config、logging_config、middleware、pagination、redis_cache、metrics、sentry_config
      db/        SQLAlchemy session、deps
      domains/   ~25 个业务域，每个含 router.py / service.py / schemas.py / models.py
      main.py    FastAPI 应用装配 + 全局中间件
    alembic/     数据库迁移
  web/           Next.js 前端工作台（/studio /retrieval /artifacts /evaluations /runs /worldbuilding /refinery）
  workflow/      LangGraph 编排器（generation_graph、provider_adapter、creative_tool_registry）
packages/
  shared/        TS 共享契约 + 类型，src/contracts/storyforge.openapi.json 为后端契约快照
deploy/          Nginx、部署相关配置
scripts/         dev-start.mjs / generate-openapi.mjs / run-e2e.mjs / verify-local.ps1 / migrate.sh
tests/           顶层 e2e 契约测试（Node --test 风格）
docs/            架构与工作台契约文档
docs/internal/codex/  验证报告（verification-report.md），所有变更必须留痕
```

## 4. 常用命令

### 一键开发环境

```bash
pnpm dev               # docker compose + alembic + API + Web 全启动
pnpm dev:api           # 只启基础服务 + API
pnpm dev:web           # 只启基础服务 + Web
node scripts/dev-start.mjs --skip-docker --skip-migrate    # 已有服务时快速重启
```

### 验证门禁（每次提交前必跑）

```bash
pnpm verify            # 本地 verify 全链路（PowerShell）
pnpm test              # Web + shared + API + Workflow 全套单元/契约测试
pnpm e2e               # OpenAPI 刷新 + 契约 diff + 真实 HTTP pytest（不接受补偿验证）
pnpm openapi           # 重新生成 packages/shared/src/contracts/storyforge.openapi.json
```

非 Windows 环境下 PowerShell 不可用时：直接跑 `node scripts/run-e2e.mjs`、`pnpm --filter @storyforge/web test`、`cd apps/api && uv run pytest`、`cd apps/workflow && uv run pytest`。

### 代码风格

```bash
pnpm lint              # eslint + prettier --check
pnpm lint:fix          # 自动修复
cd apps/api && uv run ruff check .     # Python 侧 ruff
```

### 单独跑某个测试

```bash
cd apps/api && uv run pytest tests/test_artifacts.py -q
cd apps/workflow && uv run pytest tests/test_generation_graph.py -q
cd apps/web && pnpm test
```

## 5. 架构事实源

- **API 是业务真相源。** 任何流程的判定都在 FastAPI 路由 + service 层完成；前端不允许私自计算业务结论。
- **Web 只展示已验证页面级闭环。** 业务请求必须经 `apps/web/lib/api-client.ts` 注入 `X-StoryForge-API-Key` 与 `cache: "no-store"`。
- **Workflow 负责长任务边界。** 真实模型调用、checkpoint、ModelRun 记录都在 workflow，确保 API 始终保持事务边界清晰。
- **OpenAPI 是 Web/API 之间的硬契约。** 任何路由签名变化都必须 `pnpm openapi` 刷新快照，并解释 diff 来源。

## 6. 协作约定

- **语言：** 所有回复、文档、注释、日志、提交信息默认简体中文；代码标识符、包名、API 名称保留英文。
- **证据链：** 所有变更必须在 `docs/internal/codex/verification-report.md` 留下验证记录（命令、输出摘要、未联通能力）。
- **小步推进：** 一次只解决一个明确问题，禁止顺手重构无关代码。
- **不写多余注释：** 只在 WHY 不明显时加一行；不要描述代码做了什么。
- **不写无关 README：** 除非用户明确要求。
- **不创建假数据兜底：** 数据缺失就明确返回错误，不要伪造空对象误导前端。
- **rate limit：** API 默认 per-API-Key 分层限流（读 120/min、写 60/min、批量 10/min）；调试时不要去关它。
- **认证：** `X-StoryForge-API-Key`（服务间）或 `Authorization: Bearer <jwt>`（用户）。
- **数据库迁移：** 用 alembic；新增列要带 server_default 否则会卡线上数据。

## 7. 可观测性

- **结构化日志：** Python 侧用 `structlog`，开发模式彩色终端、生产模式 JSON。
- **Request ID：** 每个请求注入 UUID，响应头返回 `X-Request-Id`，日志全链路携带。
- **Sentry：** `SENTRY_DSN` 配置即启用；API、Web、Workflow 三侧统一。
- **指标：** `/metrics` 端点暴露 Prometheus 格式，含 `judge_calls_total`、`repair_patches_total`、`batch_refinery_jobs_total` 等业务计数器。
- **健康检查：** `/health/live`（仅进程） + `/health/ready`（DB + Redis + 核心表）。

## 8. 当前能做与不能做

**能做：**

- Studio 创作链路读取 + Server Action 批准写回
- Retrieval 工作台读取（资料源、刷新任务、命中、证据锚点）
- Runs 读取（JobRun、Checkpoint、ModelRun），retry 只创建恢复任务
- Artifacts、Evaluations、Worldbuilding 读取
- Provider/LLM 通过 Provider Gateway 真实接入与降级

**不做：**

- 全步骤 Studio 编排器、跨步骤草稿编辑器
- 对象存储签名 URL 下载、上传资料执行流
- Runs retry 立即续跑 workflow
- 外部 LLM 端到端质量承诺

## 9. 常见陷阱

- **PowerShell 执行策略：** Windows 下 `pnpm.ps1` 可能被阻塞，改用 `pnpm.cmd` 或 `powershell.exe -NoProfile -Command "pnpm.cmd run X"`。
- **OpenAPI 漂移：** 改了路由没跑 `pnpm openapi` → CI 立刻挂。
- **API Key：** 默认 `local-dev-key`，生产环境如未配置 `STORYFORGE_API_KEY` 会触发 warn_default_credentials 日志告警。
- **CORS：** 默认允许 `http://localhost:3000` 和 `http://127.0.0.1:3000`，自定义前端域名要改 `STORYFORGE_CORS_ORIGINS`。
- **migration 锁：** docker entrypoint 自动获取 advisory lock，多实例并发部署时不要绕开。
