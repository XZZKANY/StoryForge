# StoryForge 本地启动手册

更新时间：2026-06-04 07:20:43 +08:00

## 1. 适用范围

本文用于在本地 Windows PowerShell 环境启动和验证 `D:/StoryForge`。内容只引用当前仓库中已经存在的脚本、配置和服务，不把真实外部 LLM、embedding 或 reranker 作为本地启动前置条件。

当前阶段仍处于 Phase 9 真实 LLM 长程验收准备阶段：本地 Phase 9A/9B/9C 能力已有验证证据，真实 10 章 smoke 已完成最终验收，远端 `master` E2E 已通过，真实 3-5 万字长程仍未完成。详细阶段边界以 `docs/internal/current-phase.md`、`docs/internal/TODO.md`、`docs/internal/PROJECT_SUMMARY.md` 和 `README.md` 为准。

## 2. 前置工具

- Node.js：运行前端、共享包和 Node 契约测试。
- pnpm：根包管理器，版本以 `package.json` 中的 `pnpm@9.15.4` 为准。
- Python 3.11 或更高版本：运行 FastAPI、OpenAPI 生成、API 语法验证和真实 HTTP pytest。
- uv：推荐用于 Python 依赖与测试，`scripts/run-e2e.mjs` 会优先使用它。
- Docker：启动 PostgreSQL、Redis 和 MinIO。

## 3. 环境文件

首次启动前可复制样例环境文件：

```powershell
cd D:/StoryForge
Copy-Item .env.example .env
```

本地启动不需要填写真实 LLM 密钥。真实 provider 配置只能保存在本机私有运行时环境中；不要读取 `.env` 来生成报告，不要把 provider token、API key、secret 或 password 写入仓库、日志或验证报告。

当前 `.env.example` 覆盖以下配置类别：

- `DATABASE_URL`：对应 `docker-compose.yml` 中的 PostgreSQL。
- `REDIS_URL`：对应本地 Redis。
- `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`：对应本地 MinIO。
- `API_BASE_URL`、`STORYFORGE_API_BASE_URL`、`WEB_BASE_URL`：对应本地 API 与 Web 入口。
- `STORYFORGE_API_KEY`：本地默认值与 API 和 Web 默认访问密钥保持一致。
- `STORYFORGE_CORS_ORIGINS`：默认允许本地 Web 访问。
- `WORKFLOW_RUNTIME_MODE`、`WORKFLOW_CHECKPOINT_BACKEND`、`STORYFORGE_WORKFLOW_SQLITE_PATH`：workflow 本地 runtime checkpoint。
- `STORYFORGE_LLM_*`、`STORYFORGE_EMBEDDING_*`、`STORYFORGE_RERANKER_*`、`STORYFORGE_RAG_*`：真实模型、embedding、reranker 与 RAG 预算预留；缺少真实私有配置时不得宣称真实外部 provider 端到端完成。

## 4. 启动基础服务

```powershell
cd D:/StoryForge
docker compose up -d postgres redis minio
```

服务与端口来自 `docker-compose.yml`：

| 服务 | 容器名 | 用途 |
| --- | --- | --- |
| PostgreSQL + pgvector | `storyforge-postgres` | API 业务数据库与向量能力 |
| Redis | `storyforge-redis` | 任务状态、缓存或运行时协作 |
| MinIO | `storyforge-minio` | 本地对象存储与控制台 |

## 5. 安装依赖

```powershell
cd D:/StoryForge
pnpm install
```

Python 依赖由各应用目录的 `pyproject.toml` 和 `uv.lock` 管理；执行 `pnpm e2e`、`pnpm openapi` 或 API pytest 时会通过 `uv` 或本机 Python 运行相关验证。

## 6. 本地验证顺序

常用本地门禁：

- `pnpm verify`
- `pnpm e2e`
- `pnpm test`
- `pnpm openapi`

建议按下列顺序执行：

```powershell
cd D:/StoryForge
pnpm verify
pnpm e2e
pnpm test
pnpm openapi
```

验证说明：

- `pnpm verify` 执行本地核心门禁；最近一次完整复验记录为 Web 209 passed、API 405 passed、Workflow 164 passed，Ruff 与 OpenAPI drift 检查通过，API pytest 仍有 7 个非阻塞 warning。
- `pnpm e2e` 会刷新 OpenAPI，并执行 Node 端契约、API verification 和 workflow verification；最近一次完整复验记录为 Node 29 passed、API verification 61 passed、workflow verification 37 passed。
- `pnpm e2e` 的 API verification 已纳入 `tests/test_alembic_heads.py`，会先验证 Alembic 单 head 与离线 SQL smoke；在线 PostgreSQL 迁移已在本轮复验，临时库 `storyforge_phase9_online_verify` 执行 `uv run alembic upgrade head` 与 `uv run alembic current --check-heads` 均退出码为 0。
- `pnpm test` 用于补充执行 Web、API、workflow 的测试集合。
- `pnpm openapi` 用于刷新 `packages/shared/src/contracts/storyforge.openapi.json`；如果产生 diff，必须解释来源并补充测试证据。

## 7. 当前远端门禁边界

- 远端 `CI` run `26857864662` 已成功，但只覆盖 `CI / Core verification` 子集。
- 历史远端 `E2E` run `26915457170`（2026-06-03T21:55:39Z）曾失败于 Alembic `Multiple head revisions`。
- 最新远端 `master` E2E run `26944063055`（2026-06-04T09:45:05Z，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`）已成功；`执行 Alembic 迁移预检`、`执行数据库迁移`、`运行 E2E` 均为 success。
- 本地已新增 Alembic merge revision `20260604_0001`，并将 `tests/test_alembic_heads.py` 纳入本地 E2E 的 API verification 预检；在线 PostgreSQL 迁移已在本轮复验。

## 8. 真实 LLM smoke 入口

真实 LLM smoke 只在私有运行时变量已经由当前进程提供时执行；命令不读取 `.env`，不得输出或保存 provider token。

```powershell
cd D:/StoryForge/apps/api
uv run python -m app.domains.book_runs.phase9b_real_llm_smoke --chapter-count 1 --token-budget 8000
uv run python -m app.domains.book_runs.phase9b_real_llm_smoke --chapter-count 3 --token-budget 24000
```

当前脱敏证据：

- 1 章 smoke：`docs/internal/codex/real-llm-1ch-20260603-142925`。
- 3 章 smoke：`docs/internal/codex/real-llm-3ch-20260603-173932`。
- 10 章 smoke：`docs/internal/codex/real-llm-10ch-20260604-110831`，最终门禁 `gate: pass_for_real_10ch_final_acceptance`，人工通读已完成。

这些证据只覆盖 1 章、3 章与 10 章 smoke。真实 3-5 万字长程仍未完成。

## 9. 常见失败处理

### Docker 容器未运行

现象：`pnpm verify` 提示 PostgreSQL、Redis、MinIO 或 Docker 状态失败。

处理：

```powershell
cd D:/StoryForge
docker compose up -d postgres redis minio
pnpm verify
```

### OpenAPI 刷新失败

现象：`pnpm openapi` 或 `pnpm e2e` 在刷新契约阶段失败。

处理：

1. 确认 `uv`、`python3` 或 `python` 至少一个可用，且 Python 版本满足项目要求。
2. 确认 `apps/api/app/main.py` 可导入。
3. 在 `apps/api` 中运行相关 pytest 排除语法或导入错误。
4. 再运行 `pnpm openapi` 重新生成契约。

OpenAPI 生成失败时不得继续使用旧契约作为发布依据。

### FastAPI HTTP pytest 或 API verification 失败

现象：`pnpm e2e` 在 API verification 或真实 FastAPI HTTP pytest 阶段失败。

处理：

- 这是发布门禁红灯，不能降级为服务层补偿验收。
- 先在 `apps/api` 中复跑失败目标，例如 `uv run pytest tests/test_alembic_heads.py -q` 或具体失败测试。
- 修复 router、service、schema、Alembic、测试夹具或 OpenAPI 契约后，回到仓库根重新运行 `pnpm e2e`。

### 远端 E2E 失败

现象：GitHub Actions `E2E` 最新 run 失败。

处理：

```powershell
gh run list --repo XZZKANY/StoryForge --workflow E2E --limit 5
gh run view <run-id> --repo XZZKANY/StoryForge --log-failed
```

如果失败点仍是 Alembic `Multiple head revisions`，先确认包含本地 `20260604_0001` 修复的提交已经进入远端分支，再重新运行远端 E2E。当前已知通过证据为 `master` run `26944063055`。

## 10. Git 检查

每轮启动或提交前执行：

```powershell
cd D:/StoryForge
git fetch origin --prune
git status --short --branch
git log --oneline --decorate -5
git diff --stat
```

通过条件：清楚知道当前未提交文件归属；如果准备提交，必须先完成本地验证、更新 `docs/internal/TODO.md` 和 `docs/internal/codex/verification-report.md`。
