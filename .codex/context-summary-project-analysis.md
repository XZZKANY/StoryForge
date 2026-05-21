# 项目上下文摘要（项目情况分析）

生成时间：2026-05-21 11:00:00 +08:00

## 1. 项目定位

StoryForge 是面向长篇小说创作的 AI/RAG 创作工作台，目标是把作品资产、章节连续性、检索证据、评审修复、模型运行日志、制品和评测放入同一条可验证链路。

## 2. 仓库结构

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api`：FastAPI 后端、领域模型、业务服务、OpenAPI。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web`：Next.js App Router 前端工作台。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow`：LangGraph 或本地兼容工作流运行时。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/packages/shared`：共享契约与 OpenAPI 快照。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/tests/e2e`：阶段级契约测试。

## 3. 技术栈

- 根包：`storyforge@0.1.0`，包管理器 `pnpm@9.15.4`。
- API：FastAPI、Pydantic、SQLAlchemy、Alembic、PostgreSQL/pgvector、Redis、pytest。
- Web：Next.js `15.3.2`、React `19.1.0`、TypeScript `5.8.3`。
- Workflow：LangGraph、Pydantic、Redis、psycopg、pytest。

## 4. 当前阶段

依据 `README.md`、`PROJECT_SUMMARY.md` 和 `.codex/current-phase.md`，当前主线是 Phase 7 发布与治理收口。Phase 5/6 的最小执行或摘要读取边界已收口，后续不应随意扩展 Studio、Retrieval、Runs、Artifacts、Evaluations 数据源。

## 5. 验证入口

根级脚本包括：

- `pnpm verify`：检查本地工具、关键路径、Docker 基础服务。
- `pnpm test`：组合执行 Web、API、Workflow 验证。
- `pnpm e2e`：执行阶段契约测试。
- `pnpm openapi`：刷新 OpenAPI 契约。

本次已执行 `pnpm verify`，结果通过：Node.js、pnpm、Python 3.12.10、Docker、PostgreSQL、Redis、MinIO 和关键路径均满足要求。

## 6. 当前工作区状态

`git status --short` 显示已有未提交修改，涉及 `.codex`、`TODO.md`、`apps/web/app/studio/page.tsx`、`apps/web/tests/phase1-navigation.test.tsx`、`docs/architecture/phase6-workbench-contract.md`，并存在未跟踪上下文摘要文件。

## 7. 主要风险

- 工作区已有脏改，继续开发前需要确认改动归属。
- `apps/web/app/studio/page.tsx` 文件较大，职责集中，后续修改需谨慎拆分。
- 真实 LLM、embedding、reranker 端到端能力仍需独立验证。
- 发布治理验证依赖本地 Docker 基础服务可用。
