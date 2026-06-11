# StoryForge

面向**长篇小说生产**的可验证创作流水线——每一次生成、评审、修复与回写都留下可追溯证据，而不是只产出一段孤立文本。

## 设计立场

**先做诊断控制台，再做生成器。** 任何生成路径都先经过"读取证据 → 评审 → 修复 → 批准"的闭环，确认控制面可观测、可追踪之后，才接真实模型。所以 StoryForge 不是"输入提示词就出小说"的黑箱——它是给你看每一步判据、每一条检索锚点、每一次 Judge 打分与 Repair 修订记录的工作台。

## 技术栈

| 层 | 技术 | 为什么 |
|---|---|---|
| API（业务真相源） | FastAPI + SQLAlchemy + Alembic + Pydantic v2 | 所有判定在服务端完成，前端不私自计算业务结论 |
| Web（工作台） | Next.js 15 (App Router) + React 19 + Tailwind v4 | 只展示已验证页面级闭环，请求经 `api-client.ts` 注入 `X-StoryForge-API-Key` |
| Workflow（编排） | LangGraph | 长任务、checkpoint、真实模型调用——保持 API 事务边界清晰 |
| 共享契约 | `packages/shared`（TypeScript） | OpenAPI 快照 + `api-types.ts` 生成类型，前后端硬约束 |
| 基础设施 | PostgreSQL + pgvector + Redis + MinIO + Sentry + Prometheus | 向量检索、缓存、对象存储、错误追踪、业务指标 |
| 包管理 | pnpm 9.x（workspace）+ `uv sync` | monorepo 统一依赖，Python 侧用 uv 锁定环境 |

## 快速开始

```bash
git clone https://github.com/XZZKANY/StoryForge.git
cd StoryForge
pnpm install
docker compose up -d postgres redis minio
pnpm dev          # 全栈启动（API + Web + 迁移）
pnpm verify       # 本地全链路门禁
pnpm test         # 全套单元/契约测试
pnpm e2e          # OpenAPI 刷新 + 契约 diff + 真实 HTTP 测试
```

Windows 下如遇 `pnpm.ps1` 被 PowerShell 执行策略阻止，使用 `pnpm.cmd` 替代或：

```powershell
powershell.exe -NoProfile -Command "pnpm.cmd run dev"
```

## 当前能力

- **BookRun 整书闭环**：从 Blueprint 章节计划驱动生成 → Judge 评审 → Repair 修复 → 批准 → checkpoint → 导出，全程可追溯。
- **诊断工作台**：Studio 创作链路、Retrieval 证据检索、Runs 运行追踪、Artifacts 制品治理、Evaluations 评测诊断、Provider/模型诊断——每个模块都是只读诊断控制台，不在前端私自计算业务结论。
- **控制面**：BookRun 支持 checkpoint 暂停/恢复、token/章节预算硬上限、provider 连续降级自动暂停、成本摘要。
- **制品导出**：Markdown、EPUB、`audit_report.json`（含 generate/judge/repair/approve/memory_extract 完整证据链）。
- **真实 LLM 冒烟门禁**：10 章真实 LLM smoke 已通过最终验收（`quality_summary.status=ok`），含人工通读完成记录。
- **P0/P1 安全硬化**：Web 侧 API Key 已脱离客户端、下载与导出链路接入 workspace 作用域校验、ModelRun 与 BookRun 可观测性已补全。

## 当前边界

StoryForge 仍在向 3–5 万字长程稳定生产推进中，以下能力**尚未就绪**：

- 真实 LLM 下 3–5 万字长程闭环（当前真实证据最高覆盖 10 章 smoke）
- 全步骤 Studio 编排器、跨步骤草稿编辑器
- 对象存储签名 URL 下载、上传资料执行流
- Runs retry 即时续跑 workflow
- 多租户用户认证、streaming 响应
- 外部 LLM 端到端质量承诺

## 架构

StoryForge 是三层的严格分层架构，每层有明确定义的数据流向和契约约束：

```
┌──────────────────────────────────────────────────────┐
│  Web (Next.js)         用户工作台，只读展示 + BFF    │
│                         /studio /runs /artifacts ...  │
│                         lib/api-client.ts             │
└────────────────────────────┬─────────────────────────┘
                             │ X-StoryForge-API-Key
                             │ OpenAPI 硬契约（快照 → 类型生成）
                             ▼
┌──────────────────────────────────────────────────────┐
│  API (FastAPI)          业务真相源，~25 个域          │
│                         domain/router → service       │
│                         → models (SQLAlchemy + pg)    │
│                         /health/ready  /metrics       │
└────────────────────────────┬─────────────────────────┘
                             │ 写入 JobRun / Checkpoint
                             │ 读写 ModelRun
                             ▼
┌──────────────────────────────────────────────────────┐
│  Workflow (LangGraph)    长任务编排 + 真实模型边界    │
│                         generation_graph              │
│                         provider_adapter              │
│                         creative_tool_registry        │
└──────────────────────────────────────────────────────┘
```

### 关键设计不变式

- **API 是单一真相源。** 任何流程的判定都在 FastAPI `router → service` 完成；前端不允许私自计算业务结论。
- **OpenAPI 是硬契约。** API 路由签名变化 → `pnpm openapi` 刷新快照 → `generate:types` 更新 TS 类型 → 消费侧类型检查捕获契约漂移。
- **Web 只做 BFF + 展示。** 浏览器请求经 `lib/api-client.ts` 注入服务间认证头与 `cache: "no-store"`，不绕过 API 直连数据库或 workflow。
- **Workflow 隔离长任务。** 真实模型调用、checkpoint、ModelRun 记录都在 workflow 侧，确保 API 始终保持事务边界清晰、不因长时间外部调用阻塞 HTTP 连接池。
- **证据链不丢失。** 每次生成、评审、修复、批准都写入结构化记录（非 markdown 摘要），导出时聚合成 `audit_report.json` 供人工通读回溯。

### BookRun 生命周期

```
Blueprint（章节计划）
  → NovelLoop 逐章驱动
    → generate（Scene Architect → Draft Writer）
    → judge（6 维质量评分 + 人工盲评门禁）
    → repair（分级修订、去重回退）
    → approve（写入章节 + Story Memory 注入）
    → checkpoint（LangGraph 持久化）
  → 导出（Markdown / EPUB / audit_report.json）
```

### 仓库布局

```
apps/api/         FastAPI 业务真相源（domain-driven，每域 router/service/schemas/models）
apps/web/         Next.js 工作台（/studio /runs /artifacts /evaluations /retrieval /book-runs）
apps/workflow/    LangGraph 编排器（generation_graph / provider_adapter / creative_tool_registry）
packages/shared/  TS 共享契约（src/contracts/storyforge.openapi.json + generated/api-types.ts）
scripts/          dev-start.mjs / generate-openapi.mjs / run-e2e.mjs
tests/            顶层 E2E 契约测试
docs/             架构文档 + 内部验证记录（internal/codex/）
```

详细架构见 `CLAUDE.md`，当前阶段状态与未完成验收项见 `docs/internal/current-phase.md`。
