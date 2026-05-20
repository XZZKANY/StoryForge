# 项目上下文摘要（Phase 7 发布治理）

生成时间：2026-05-20 18:40:00 +08:00

## 1. ph7 任务定义

- 用户“做ph7”对应 `D:/StoryForge/Untitled.md` 中的 Phase 7 发布与治理收口要求。
- 当前边界：只做发布治理校准、验证留痕和环境样例/迁移/OpenAPI/启动手册/发布清单/故障手册对齐。
- 禁止事项：不自动提交、不新增产品功能、不继续扩 Phase 6 页面或数据源、不做大型架构模块。

## 2. 相似实现分析

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/operations/local-start.md`
  - 模式：按工具、环境文件、Docker 服务、验证顺序和失败处理分节。
  - 可复用：Docker 服务端口、`pnpm verify`、`pnpm openapi`、`pnpm e2e` 验证顺序。
  - 需注意：不能把真实 AI/RAG provider 当作本地启动前置条件。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/operations/release-checklist.md`
  - 模式：发布前门禁按 Git、环境、OpenAPI、本地测试、文档和回滚拆分。
  - 可复用：失败必须写入 `.codex/verification-report.md`，OpenAPI diff 必须解释来源。
  - 需注意：发布治理问题优先做最小修复。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/operations/troubleshooting.md`
  - 模式：每类故障都有现象、排查和处理命令。
  - 可复用：Docker、FastAPI TestClient、OpenAPI、provider 未配置、`pnpm verify` 的处理路径。
  - 需注意：环境限制必须记录，不能伪装为通过。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/operations/alembic-validation.md`
  - 模式：只记录本机真实执行结果，区分 head 检查、离线 SQL 和在线升级。
  - 可复用：Docker/PostgreSQL 不可用时只记录限制；可用后补跑 `uv run alembic upgrade head` 与 `uv run alembic current`。
  - 需注意：当前文档中 head 记录落后于实际 Alembic head，需要校准。

## 3. 项目约定

- 命名约定：文档使用中文标题；审计产物放入项目本地 `.codex/`；运行脚本沿用根 `package.json`。
- 文件组织：`apps/api` 是业务真相源；`apps/web` 是工作台；`apps/workflow` 是长任务 runtime；`docs/operations` 是发布治理手册。
- 导入顺序：本轮不改运行时代码；如需 Python 文件，保持标准库、第三方、项目内导入顺序。
- 代码风格：Markdown 短节、表格和命令块；所有说明使用简体中文。

## 4. 可复用组件清单

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/package.json`：根验证脚本入口。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/verify-local.ps1`：工具、路径和 Docker 容器状态检查。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/generate-openapi.ps1`：OpenAPI 刷新入口。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/alembic/versions/`：Alembic 迁移链事实源。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/docker-compose.yml`：PostgreSQL、Redis、MinIO 本地服务定义。
## 5. 测试策略

- 测试框架：Web 使用 Vitest；根 e2e 使用 Node `node:test`；API 与 Workflow 当前根级脚本使用 `python -m compileall`，细粒度测试优先 `uv run pytest`。
- 参考文件：`tests/e2e/phase1-closed-loop.spec.ts`、`tests/e2e/phase4-contract.spec.ts`、`apps/api/tests/test_retrieval_workbench_api.py`。
- 本轮验证重点：`pnpm verify`、`uv run alembic heads`、`uv run alembic upgrade head`、`uv run alembic current --check-heads`、文档关键字检查和 Git 状态。

## 6. 依赖和集成点

- 外部依赖：Docker Desktop、PostgreSQL/pgvector、Redis、MinIO、Alembic、SQLAlchemy、pnpm、Python 3.11+。
- 内部依赖：`.env.example` 的 `DATABASE_URL` 指向 `127.0.0.1:55432`；Alembic 配置位于 `apps/api/alembic.ini` 与 `apps/api/alembic/env.py`。
- 集成方式：`pnpm verify` 调用 `scripts/verify-local.ps1` 检查容器；Alembic CLI 读取 API 应用迁移配置。
- 配置来源：`docker-compose.yml`、`.env.example`、`apps/api/alembic.ini`。

## 7. 技术选型理由与风险

- 选择最小治理修复：当前代码功能边界已冻结，Phase 7 应优先消除验证记录与实际环境状态不一致。
- Alembic 官方文档确认：`alembic heads` 查看脚本 head，`alembic upgrade head` 执行迁移，`alembic current` 查看数据库当前版本，`alembic current --check-heads` 可检查数据库是否在全部 head。
- 关键风险：Docker 服务状态会随本机变化；在线迁移通过只代表当前本地 PostgreSQL 状态，不等价于所有机器均已验证。
- 充分性检查：已能定义接口契约、识别验证方式、定位风险和复用发布治理文档模式，可以进入实施。
