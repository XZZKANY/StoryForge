# CLAUDE.md — StoryForge 项目上下文

> 本文件帮助新一轮 Claude Code 会话快速理解 StoryForge 仓库。
> 上位规范见 `docs/internal/AGENTS.md`、日常执行版见 `docs/internal/AI_ITERATION_GUIDE.md`。
> 当前阶段事实以 `docs/internal/current-phase.md` 为准；下一步入口见 `docs/internal/TODO.md`。

## 1. 项目定位

StoryForge 是面向**长篇小说生产**的可验证创作流水线：
每一次生成、检索、评审、修复、批准与回写，都必须留下可追溯证据，而不是只产出一段孤立文本。

设计立场：**先做诊断控制台，再做生成器**。任何生成路径都先有读取证据 → 评审 → 修复 → 批准的闭环，再考虑接真实模型。

## 1.1 当前项目真相（2026-06-21）

- StoryForge 当前处于**真实长程验收整改与 Desktop IDE Agent 收口阶段**。
- 产品重心已经转为 **Desktop IDE-first**：`apps/desktop` 是主产品体验；`apps/web` 已退场，不再作为维护、调试、兼容或契约验证入口。
- 真实 LLM 1 章、3 章和 10 章 smoke 已完成脱敏验证，其中 10 章 smoke 已通过人工通读，最终门禁为 `gate: pass_for_real_10ch_final_acceptance`。
- 一次 30 章真实长程已经跑完并导出 Markdown、EPUB 和审计报告，证据目录为 `.codex/real-llm-30ch-mimo25pro-20260611-192356`；但人工通读结论是**退回重跑**。
- 因此当前只能宣称“真实长程运行链路可达、制品导出成立”，不能宣称真实 3-5 万字长程质量验收通过，也不能宣称稳定生产级长篇生产闭环。
- 2026-06-21 已启动 Web 退场收口：默认开发、验证、容器编排和 CORS 均转向 Desktop/API/Workflow。

## 2. 技术栈

- **API（后端事实源）：** FastAPI（Python 3.11+） + SQLAlchemy + Alembic + Pydantic v2，依赖管理走 `uv`。
- **Desktop IDE（主产品入口）：** Tauri 2 + Vite + React 18 + Monaco Editor + 本地文件系统集成。
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
  desktop/      Tauri 桌面 IDE（当前主产品体验）
  workflow/      LangGraph 编排器（generation_graph、provider_adapter、creative_tool_registry）
packages/
  shared/        TS 共享契约 + 类型，src/contracts/storyforge.openapi.json 为后端契约快照
deploy/          Nginx、部署相关配置
scripts/         dev-start.mjs / generate-openapi.mjs / run-e2e.mjs / verify-local.ps1 / migrate.sh
tests/           顶层 e2e 契约测试（Node --test 风格）
docs/            架构与工作台契约文档
.codex/  验证报告（verification-report.md），所有变更必须留痕
```

## 4. 常用命令

### 一键开发环境

```bash
pnpm dev               # 桌面 IDE 主体验（含桌面 Vite、Docker、迁移、API、Tauri 窗口）
pnpm desktop:dev       # 同上，显式桌面端入口
pnpm dev:maintenance   # docker compose + alembic + API
pnpm dev:api           # 只启基础服务 + API
node scripts/dev-start.mjs --skip-docker --skip-migrate    # 已有服务时快速重启
```

### 验证门禁（每次提交前必跑）

```bash
pnpm.cmd lint          # Windows 推荐入口；根 lint 门禁
pnpm verify            # 本地 verify 全链路（PowerShell）
pnpm test              # Desktop + shared + API + Workflow 全套单元/契约测试
pnpm e2e               # OpenAPI 刷新 + 契约 diff + 真实 HTTP pytest（不接受补偿验证）
pnpm openapi           # 重新生成 packages/shared/src/contracts/storyforge.openapi.json
```

P0 复位时已通过的关键命令：

```bash
pnpm.cmd lint
npm --prefix apps/desktop/frontend run typecheck
npm --prefix apps/desktop/frontend run test
pnpm.cmd --filter @storyforge/shared test
pnpm.cmd test
cd apps/api && uv run pytest
cd apps/workflow && uv run pytest
cd apps/api && uv run pytest tests/test_phase9_fact_sources.py -q
cd apps/api && uv run ruff check tests/test_phase9_fact_sources.py
```

非 Windows 环境下 PowerShell 不可用时：直接跑 `node scripts/run-e2e.mjs`、`npm --prefix apps/desktop/frontend run test`、`cd apps/api && uv run pytest`、`cd apps/workflow && uv run pytest`。

### 代码风格

```bash
pnpm.cmd lint          # eslint + prettier --check（Windows 下优先用 pnpm.cmd）
pnpm lint:fix          # 自动修复
cd apps/api && uv run ruff check .     # Python 侧 ruff
```

### 单独跑某个测试

```bash
cd apps/api && uv run pytest tests/test_artifacts.py -q
cd apps/workflow && uv run pytest tests/test_generation_graph.py -q
npm --prefix apps/desktop/frontend run test
```

## 5. 架构事实源

- **API 是业务真相源。** 任何流程的判定都在 FastAPI 路由 + service 层完成；前端不允许私自计算业务结论。
- **Desktop IDE 是主体验。** 新的用户工作流默认落在 `apps/desktop`；Tauri 主进程负责本地文件系统、服务启动和 API 配置注入。
- **Web 已退场。** 不新增 `apps/web` 代码、脚本、容器或测试；需要前端能力时优先落在 `apps/desktop`。
- **Workflow 负责长任务边界。** 真实模型调用、checkpoint、ModelRun 记录都在 workflow，确保 API 始终保持事务边界清晰。
- **OpenAPI 是后端对客户端的硬契约。** 任何路由签名变化都必须 `pnpm openapi` 刷新快照，并解释 diff 来源。

## 6. 协作约定

- **语言：** 所有回复、文档、注释、日志、提交信息默认简体中文；代码标识符、包名、API 名称保留英文。
- **证据链：** 所有变更必须在 `.codex/verification-report.md` 留下验证记录（命令、输出摘要、未联通能力）。
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

- Desktop IDE：打开本地项目、文件树浏览、Monaco 编辑、版本记录、命令面板、保存快照和 API 配置注入。
- Desktop IDE Agent：后端意图路由、真实文件修订、多视角 file.review、稳定 issue id、范围控制、待确认 proposed patch 和确认写回防重复生成已有本地验证证据。
- BookRun：deterministic/mock provider 下可跑最小整书闭环，支持 checkpoint、预算暂停、provider 降级、Markdown/EPUB/审计报告导出。
- 真实 LLM：1/3/10 章 smoke 有脱敏证据；30 章真实长程有链路和制品导出证据，但质量未通过。
- Web：`apps/web` 已退场；旧页面只保留在历史文档和 git 历史中。
- Provider/LLM：通过 Provider Gateway 真实接入与降级，敏感配置必须来自本机私有运行时环境变量。

**不做：**

- 不能宣称真实 3-5 万字长程质量验收通过；30 章真实长程已人工退回重跑。
- 不能把自动审计、golden gate 或模型自评等同于人工通读通过。
- 不能宣称稳定生产级长篇生产闭环。
- 不能宣称真实 Tauri 桌面端到端写回确认链路已经完成。
- 暂不承诺完整多人协作、生产级对象存储签名下载、多租户认证或全步骤 Studio 编排器。

## 8.1 当前下一步优先级

1. 跑真实 Tauri 桌面端到端：打开文件 -> Agent 审稿 -> 指定问题修订 -> diff 确认 -> 写回 -> 版本记录。
2. 基于 30 章人工通读意见整理重跑策略，重跑真实 3-5 万字长程并执行人工通读。
3. 将新一轮长程的 Markdown、EPUB、`audit_report.json`、summary 和人工盲评写入 `.codex/verification-report.md`。
4. 将 Desktop IDE Agent 的可选增强拆小：WebSocket 流式响应、真实 LLM file.review 探针、前端 file.review 触发链路和更细的修订范围 UI。

## 9. 常见陷阱

- **PowerShell 执行策略：** Windows 下 `pnpm.ps1` 可能被阻塞，改用 `pnpm.cmd` 或 `powershell.exe -NoProfile -Command "pnpm.cmd run X"`。
- **OpenAPI 漂移：** 改了路由没跑 `pnpm openapi` → CI 立刻挂。
- **API Key：** 默认 `local-dev-key`，生产环境如未配置 `STORYFORGE_API_KEY` 会触发 warn_default_credentials 日志告警。
- **CORS：** 默认允许桌面 Vite `http://localhost:3007` / `http://127.0.0.1:3007`，自定义前端域名要改 `STORYFORGE_CORS_ORIGINS`。
- **migration 锁：** docker entrypoint 自动获取 advisory lock，多实例并发部署时不要绕开。

## Agent skills

### Issue tracker

Issues and PRDs live in GitHub Issues for `XZZKANY/StoryForge`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: read root `CONTEXT.md` plus relevant architecture docs under `docs/architecture/`. See `docs/agents/domain.md`.
