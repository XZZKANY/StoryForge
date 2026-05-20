# StoryForge

StoryForge 是一个面向长篇小说创作的 AI/RAG 创作工作台。项目目标是把作品资产、章节连续性、检索证据、结构化评审、定向修复、模型运行日志、制品和评测放在同一条可验证链路中，避免只生成孤立文本。

当前仓库已完成 Phase 1 到 Phase 4 的工程闭环，并在 Phase 5/6 中补齐了记忆、上下文、Workflow 引用化、reranker 接入、Studio/Retrieval/Runs 关键数据源和 Phase 6 全局收口验证。当前进入 Phase 7 发布与治理收口；不要继续扩 Studio/Retrieval/Runs/Artifacts/Evaluations 的数据源。详细路线见 `docs/superpowers/plans/2026-05-17-storyforge-master-replan.md`。

## 当前状态

- GitHub 仓库：`https://github.com/XZZKANY/StoryForge.git`
- 当前主分支：`master`
- 当前版本：`0.1.0`
- 包管理器：`pnpm@9.15.4`
- 已完成阶段：
  - Phase 1：作品资产、章节生成、Scene Packet、Judge、Repair、批准回写、下一章继承。
  - Phase 2：系列级记忆、世界观中心、批量精修、风格包、质量看板。
  - Phase 3：团队工作区、协作审批、商业化控制、Provider Gateway、事件流、分析扩展。
  - Phase 4：检索中心、Scene Packet 自动检索、Prompt Pack、模型运行日志、持久化 workflow runtime、制品中心、评测系统。
- Phase 5 当前已完成：
  - `story_memory` 最小持久化、`compiled_contexts` 持久化、Workflow State 引用化。
  - 最小 `AgentProposal -> ArbitrationDecision -> MemoryAtom` 写入闭环。
  - retrieval reranker 最小接入和 Scene Packet rerank 证据透传。
  - Workflow ModelRun sink / payload 映射前置契约。
- Phase 6 当前已完成：
  - Studio、Retrieval、Runs、Artifacts、Evaluations 五个页面的静态入口。
  - Phase 6 数据源契约文档与 `phase6DataSources` registry。
  - Studio 页面已单点读取作品列表、章节目标、Scene Packet 和 Judge 评审 API。
- 下一阶段重点：
  1. Phase 7：发布与运维治理收口，检查环境样例、OpenAPI、迁移链、本地启动、发布清单、故障手册和审计状态。
  2. Phase 5：保留具体 workflow-to-api ModelRun 真表 adapter/client 待办，但本轮不新增运行时功能。
  3. Phase 6：全局收口和验证已完成；后续在另行批准前不要继续扩 Studio/Retrieval/Runs/Artifacts/Evaluations 数据源。

## 架构边界

```text
.
├── apps/
│   ├── api/       # FastAPI、领域模型、业务服务、OpenAPI
│   ├── web/       # Next.js App Router 前端工作台
│   └── workflow/  # LangGraph 或本地兼容 runtime、checkpoint、长任务
├── packages/
│   └── shared/    # 共享契约与 OpenAPI 快照
├── scripts/       # 本地验证、OpenAPI 生成、e2e 编排
├── tests/e2e/     # 阶段级契约测试
├── docs/          # 计划、规格、API 审查和运维文档
└── .codex/        # 上下文摘要、操作日志、验证报告
```

核心原则：`apps/api` 是业务真相源，检索索引只保存加速字段和证据引用；`apps/workflow` 只通过 Job、checkpoint、事件和模型日志对外暴露状态；`apps/web` 不直接持有长任务真相状态。

## 本地环境

建议使用 Windows PowerShell，与当前项目脚本保持一致。

必需工具：

- Node.js
- pnpm
- Python 3.11 或更高版本
- Docker
- uv（推荐，用于 Python 依赖与测试）

本地依赖服务由 `docker-compose.yml` 管理：

- PostgreSQL + pgvector：`127.0.0.1:55432`
- Redis：`127.0.0.1:6379`
- MinIO：`127.0.0.1:9000`，控制台 `127.0.0.1:9001`

`.env.example` 还包含 Phase 5 真实 AI/RAG 接入变量：`STORYFORGE_LLM_*`、`STORYFORGE_EMBEDDING_*`、`STORYFORGE_RERANKER_*`、`STORYFORGE_RAG_*`，以及 Web 单点读取 API 入口 `STORYFORGE_API_BASE_URL`。Provider Gateway 当前会读取 LLM、embedding、reranker 变量；这些变量不作为本地启动前置条件，缺少真实密钥时会回退到 deterministic、local 或 disabled，不能据此声称真实外部 AI/RAG 已端到端可用。

复制环境样例：

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
Copy-Item .env.example .env
```

启动本地基础服务：

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
docker compose up -d postgres redis minio
```

安装依赖：

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm install
```

## 常用命令

```powershell
# 根级环境与基础路径验证
pnpm verify

# 根级阶段契约与补偿验收
pnpm e2e

# Web 与共享包测试
pnpm run test:web

# API 语法验证
pnpm run test:api

# Workflow 语法验证
pnpm run test:workflow

# 刷新 OpenAPI 契约
pnpm openapi
```

更细粒度的 Phase 0 验证命令见 `docs/superpowers/plans/2026-05-17-storyforge-master-replan.md`。

## GitHub 同步门禁

开始任何实现或发布前，先确认本地与 GitHub 一致：

```powershell
git -C D:/StoryForge/1-renovel-ai-ai-rag-tavern fetch origin --prune
git -C D:/StoryForge/1-renovel-ai-ai-rag-tavern status --short --branch
git -C D:/StoryForge/1-renovel-ai-ai-rag-tavern log --oneline --decorate -5
git -C D:/StoryForge/1-renovel-ai-ai-rag-tavern ls-remote --heads origin
```

通过条件：`master...origin/master` 不显示 ahead/behind，远程 `master` 与本地 HEAD 指向同一提交。

## 验证策略

本项目拒绝把远程 CI 或人工外包验证作为完成依据。每次交付都应在本地运行可重复命令，并把结果写入 `.codex/verification-report.md`。
当前已知环境限制：部分环境中 FastAPI `TestClient` 可能阻塞；根级 `scripts/run-e2e.mjs` 会先探测该问题，并在必要时回退到服务层补偿验收。

## 后续路线

| 阶段 | 目标 | 主要交付 |
| --- | --- | --- |
| Phase 0 | 同步与健康基线 | GitHub 同步、稳定验证链、计划纳入版本控制 |
| Phase 5 | 真实 AI/RAG 接入 | story_memory、compiled_contexts、Workflow State 引用化、reranker 与 ModelRun 前置契约已完成；真表 adapter/client 仍是后续功能待办 |
| Phase 6 | 产品工作台可用化 | 五页入口、数据源契约、registry、Studio/Retrieval 单点读取和 Runs 后端最小契约已完成全局收口；本轮不继续扩数据源 |
| Phase 7 | 发布与运维治理 | 当前阶段；收口 `.env.example`、迁移、OpenAPI、启动手册、发布清单、故障手册和本地验证记录 |

暂缓事项包括插件市场、完整账单结算、外部发行平台、微服务拆分、有声书和封面营销包。

## 重要文档

- 总重规划：`docs/superpowers/plans/2026-05-17-storyforge-master-replan.md`
- 中文主规格：`docs/superpowers/specs/2026-05-12-dual-mode-ai-novel-platform-design.zh-CN.md`
- Phase 4 计划：`docs/superpowers/plans/2026-05-17-storyforge-phase4-engineering-plan.md`
- OpenAPI 契约：`packages/shared/src/contracts/storyforge.openapi.json`
- Phase 6 工作台契约：`docs/architecture/phase6-workbench-contract.md`
- Workflow ModelRun adapter 契约：`docs/architecture/workflow-modelrun-adapter-contract.md`
- 当前 Phase 摘要：`.codex/current-phase.md`
- 运维文档索引：`docs/operations/README.md`
- 本地启动手册：`docs/operations/local-start.md`
- 发布清单：`docs/operations/release-checklist.md`
- 故障手册：`docs/operations/troubleshooting.md`
- Alembic 验证记录：`docs/operations/alembic-validation.md`
- 验证报告：`.codex/verification-report.md`
- 操作日志：`.codex/operations-log.md`

## 贡献与交付要求

- 所有文档、注释、测试描述、日志和提交信息必须使用简体中文。
- 任何任务开始前必须生成或更新 `.codex/context-summary-[任务名].md`。
- 代码变更必须配套本地自动化验证。
- 不要从 Phase 1 重新实现；当前主线是 Phase 0、Phase 5、Phase 6、Phase 7。
