# StoryForge 项目总结

生成时间：2026-05-20 17:09:56 +08:00

## 1. 项目定位

StoryForge 是面向长篇小说创作的 AI/RAG 创作工作台。它把作品资产、章节连续性、检索证据、结构化评审、定向修复、模型运行日志、制品和评测纳入同一条可验证链路，目标是支撑可追溯、可恢复、可评估的长篇创作流程，而不是只生成孤立文本。

## 2. 技术栈与仓库结构

- 仓库：`https://github.com/XZZKANY/StoryForge.git`，主分支 `master`。
- 根包：`storyforge@0.1.0`，包管理器 `pnpm@9.15.4`。
- API：FastAPI、Pydantic、SQLAlchemy、Alembic、PostgreSQL/pgvector、Redis。
- Web：Next.js App Router、React、TypeScript。
- Workflow：LangGraph 或本地兼容运行时，负责长任务、checkpoint 和运行态记录。
- 共享契约：`packages/shared/src/contracts/storyforge.openapi.json` 保存 OpenAPI 快照。

## 3. 架构边界

- `apps/api` 是业务真相源，负责领域模型、控制面 API、持久化和 OpenAPI。
- `apps/workflow` 负责长任务编排、checkpoint、运行失败恢复边界和模型运行 payload。
- `apps/web` 负责 Studio、Retrieval、Runs、Artifacts、Evaluations 等工作台页面，不直接持有长任务真相状态。
- `packages/shared` 保存共享契约，避免前后端接口漂移。
- `docs/` 与 `.codex/` 分别承担项目知识库和本地审计留痕。
## 4. 当前阶段

项目已完成 Phase 1 到 Phase 4 的工程闭环，并完成 Phase 5/6 的主要收口验证。当前主线进入 Phase 7 发布与治理收口，重点是校准环境样例、OpenAPI、Alembic、启动手册、发布清单、故障手册和审计状态；除非另行批准，不继续扩展 Studio/Retrieval/Runs/Artifacts/Evaluations 数据源。

已完成能力包括：

- Phase 1：作品资产、章节生成、Scene Packet、Judge、Repair、批准回写和下一章继承。
- Phase 2：系列记忆、世界观中心、批量精修、风格包和质量看板。
- Phase 3：团队工作区、协作审批、商业化控制、Provider Gateway、事件流和分析扩展。
- Phase 4：检索中心、Prompt Pack、模型运行日志、持久化 workflow runtime、制品中心和评测系统。
- Phase 5/6：story memory、compiled contexts、Workflow State 引用化、retrieval reranker、Scene Packet 检索证据、Studio/Retrieval/Runs 最小 API 或页面契约。

## 5. 本版主要交付

- Provider Gateway 已接入运行时配置解析和 Redis 缓存，缺少真实密钥时稳定回退。
- 检索链路补齐 pgvector migration、embedding fallback、refresh run 元数据和 Scene Packet 证据透传。
- Studio 已单点读取作品、章节目标、Scene Packet、Judge 评审和 Repair 修订 API。
- Retrieval 已单点读取资料源、刷新任务、搜索请求和命中预览 API。
- Runs 已具备 JobRun、checkpoint 和 ModelRun 摘要后端最小契约。
- 运维侧已补齐本地启动、发布清单、故障手册、OpenAPI 刷新和 Alembic 验证记录。

## 6. 本地验证入口

推荐发布前验证顺序：

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm verify
pnpm test
pnpm e2e
pnpm openapi
```

已有本地验证证据显示：Docker PostgreSQL/Redis 在线验证、Alembic 升级、pgvector extension/列/索引检查、相关 API 回归和全量 API 测试已通过。后续推送前仍应至少复核 Git 状态、文档存在性和可重复验证命令。

## 7. 当前风险与待办

- Workflow-to-API ModelRun 真表 adapter/client 仍是后续待办。
- Studio 批准回写、失败恢复，Retrieval 独立证据跳转和重排状态，Runs 页面读取和失败重试，Artifacts/Evaluations 真实数据读取仍未联通。
- 真实外部 LLM、embedding、reranker 的端到端生产接入仍需要独立验证，不能仅凭环境变量存在宣称完成。
- 发布前必须避免把未验证的产品功能扩展混入 Phase 7 治理收口。

## 8. 事实来源

- `README.md`：项目定位、架构边界、本地命令和后续路线。
- `TODO.md`：当前阶段、任务池和最近迭代记录。
- `.codex/current-phase.md`：当前 Phase 事实入口。
- `.codex/verification-report.md`：本地验证结果与评分。
- `docs/architecture/phase6-workbench-contract.md`：Phase 6 工作台数据源契约。
- `docs/operations/README.md`、`docs/operations/release-checklist.md`、`docs/operations/local-start.md`、`docs/operations/troubleshooting.md`：发布治理和运维事实源。
