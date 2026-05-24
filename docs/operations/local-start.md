# StoryForge 本地启动手册

更新时间：2026-05-18 17:10:00 +08:00

## 1. 适用范围

本文用于在本地 Windows PowerShell 环境启动和验证 `D:/StoryForge/1-renovel-ai-ai-rag-tavern`。内容只引用当前仓库中已经存在的脚本、配置和服务，不把未接入的真实 AI/RAG Provider 作为启动前置条件。

## 2. 前置工具

- Node.js：运行前端、共享包和 Node 契约测试。
- pnpm：根包管理器，版本以 `package.json` 中的 `pnpm@9.15.4` 为准。
- Python 3.11 或更高版本：运行 FastAPI、OpenAPI 生成、API 语法验证和真实 HTTP pytest。
- uv：推荐用于 Python 依赖与测试，`scripts/run-e2e.mjs` 会优先使用它。
- Docker：启动 PostgreSQL、Redis 和 MinIO。

## 3. 环境文件

在首次启动前复制样例环境文件：

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
Copy-Item .env.example .env
```

当前 `.env.example` 覆盖以下配置：

- `DATABASE_URL`：对应 `docker-compose.yml` 中的 PostgreSQL `127.0.0.1:55432`。
- `REDIS_URL`：对应 Redis `127.0.0.1:6379`。
- `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`：对应 MinIO `127.0.0.1:9000`。
- `API_BASE_URL`、`STORYFORGE_API_BASE_URL`、`WEB_BASE_URL`：对应本地 API、Web 入口；当前 Web 读取统一使用 `STORYFORGE_API_BASE_URL`。
- `STORYFORGE_API_KEY`：本地默认值为 `local-dev-key`，与 API 和 Web 默认访问密钥保持一致。
- `STORYFORGE_CORS_ORIGINS`：默认允许 `localhost:3000` 与 `127.0.0.1:3000`。
- `WORKFLOW_RUNTIME_MODE`、`WORKFLOW_CHECKPOINT_BACKEND`、`STORYFORGE_WORKFLOW_SQLITE_PATH`：workflow 默认使用本地 SQLite runtime checkpoint。
- `STORYFORGE_LLM_*`：Phase 5 Provider Gateway 真实化预留，默认保持 deterministic；workflow 真实 HTTP provider 仅在配置真实 `STORYFORGE_LLM_API_KEY` 后使用。
- `STORYFORGE_EMBEDDING_*`：Phase 5 embedding 客户端预留，默认保持本地假 embedding。
- `STORYFORGE_RERANKER_*`、`STORYFORGE_RAG_*`：Phase 5 reranker 和上下文预算预留，默认不启用 reranker。
- `STORYFORGE_MODEL_RUN_LOG_LEVEL`：后续模型运行日志粒度预留。

AI/RAG 相关变量当前会由 Provider Gateway 的运行时配置读取；本地启动不要求填写真实密钥，缺少密钥时会按能力回退到 deterministic、local 或 disabled，因此不能据此声称真实外部 provider、embedding 或 reranker 端到端已接入。

## 4. 启动基础服务

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
docker compose up -d postgres redis minio
```

服务与端口来自 `docker-compose.yml`：

| 服务 | 容器名 | 本地端口 | 用途 |
| --- | --- | --- | --- |
| PostgreSQL + pgvector | `storyforge-postgres` | `55432` | API 业务数据库与后续向量能力 |
| Redis | `storyforge-redis` | `6379` | 任务状态、缓存或运行时协作 |
| MinIO | `storyforge-minio` | `9000`、`9001` | 本地对象存储与控制台 |

## 5. 安装依赖

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm install
```

Python 依赖由各应用目录的 `pyproject.toml` 和 `uv.lock` 管理；执行 `pnpm e2e` 或 `pnpm openapi` 时会通过 `uv` 或本机 Python 运行相关验证。

## 6. 本地验证顺序

建议按从环境到契约的顺序执行：

```powershell
pnpm verify
pnpm openapi
pnpm e2e
pnpm run test:web
pnpm run test:api
pnpm run test:workflow
```

验证说明：

- `pnpm verify` 检查工具、路径和 Docker 容器状态；如果 Docker 未启动，会按预期失败并提示启动命令。
- `pnpm openapi` 严格刷新 `packages/shared/src/contracts/storyforge.openapi.json`，并按 `uv`、`python3`、`python` 顺序选择可用运行时。
- `pnpm e2e` 会先刷新 OpenAPI；刷新失败会停止，避免沿用陈旧契约。
- `pnpm e2e` 固定执行真实 FastAPI HTTP pytest 目标；如果 HTTP pytest 失败，e2e 直接失败，不再降级为补偿验收。

## 7. 常见失败处理

### Docker 容器未运行

现象：`pnpm verify` 提示 PostgreSQL、Redis 或 Docker 状态失败。

处理：

```powershell
docker compose up -d postgres redis minio
pnpm verify
```

### OpenAPI 刷新失败

现象：`pnpm openapi` 或 `pnpm e2e` 在刷新契约阶段失败。

处理：

1. 确认 `uv`、`python3` 或 `python` 至少一个可用，且 Python 版本满足项目要求。
2. 确认 `apps/api/app/main.py` 可导入。
3. 先运行 `pnpm run test:api` 排除语法错误。
4. 再运行 `pnpm openapi` 重新生成契约；脚本会输出实际使用的 Python 运行时。

### FastAPI HTTP pytest 失败

现象：`pnpm e2e` 在 API HTTP pytest 阶段失败。

处理：

- 这是发布门禁红灯，不能降级为服务层补偿验收。
- 先在 `apps/api` 中复跑失败的 `uv run pytest <失败目标> -q`，定位路由、TestClient 或数据夹具问题。
- 修复后重新执行 `pnpm e2e`，确认真实 HTTP pytest 目标通过。

## 8. Git 检查

每轮启动或提交前执行：

```powershell
git fetch origin --prune
git status --short --branch
git log --oneline --decorate -5
git diff --stat
```

通过条件：清楚知道当前未提交文件归属；如果准备提交，必须先完成本地验证、更新 `TODO.md` 和 `.codex/verification-report.md`。
