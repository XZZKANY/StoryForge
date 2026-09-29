# StoryForge 本地启动手册

更新时间：2026-09-28

## 1. 适用范围

本文用于在本地 Windows PowerShell 环境启动和验证 `D:/StoryForge`。当前默认开发入口是 Desktop IDE；旧 Web 与独立 Workflow 入口均已退役。内容只引用当前仓库中已经存在的脚本、配置和服务，不把真实外部 LLM、embedding 或 reranker 作为本地启动前置条件。

当前处于 Desktop IDE-first 收口阶段：对话式 Agent 与权限感知写回是主体验，BookRun 退居后台工具。阶段边界以 `docs/internal/current-phase.md`、`docs/internal/TODO.md`、`docs/internal/PROJECT_SUMMARY.md` 和 `README.md` 为准；2026-06 的 Phase 9 验收记录统一收在本文附录，仅作时点参考。

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
- `API_BASE_URL`、`STORYFORGE_API_BASE_URL`：对应本地 API 与 Desktop IDE。
- `STORYFORGE_API_KEY`：本地默认值与 API、Desktop IDE 默认访问密钥保持一致。
- `STORYFORGE_CORS_ORIGINS`：默认允许本地 Desktop Vite `3007` 访问。
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

## 6. 启动 Desktop IDE 主体验

```powershell
cd D:/StoryForge
pnpm dev
```

等价显式命令：

```powershell
pnpm desktop:dev
```

该入口会启动桌面 Vite dev server（`http://localhost:3007`）、Tauri 桌面窗口，并由 Tauri 主进程检查 Docker 服务、执行 Alembic 迁移和启动或复用 API。API 维护入口仍可单独启动：

```powershell
pnpm dev:maintenance
pnpm dev:api
```

## 7. 私测 Alpha 单机桌面模式

私测 alpha 可以不启动 Docker/PostgreSQL/Redis/MinIO。桌面主进程会用 sqlite 作为本机数据库；设置页保存的模型配置由 API 在下一次调用时读取：

```powershell
cd D:/StoryForge
$env:STORYFORGE_DESKTOP_SKIP_SERVICES = "1"
pnpm desktop:dev
```

模型服务在桌面应用内配置：打开「设置 → 模型服务」，填写 provider、base URL、model 和 API key，点击「保存并应用」。API key 保存在本机应用配置目录，不写入 `localStorage`、仓库或日志。API 会在下一次调用时重新读取 `llm-provider.json`，无需重启桌面主进程或它托管的 API 子进程；若你显式设置 `STORYFORGE_DESKTOP_REUSE_API=1` 复用外部 API，则需要自行重启那个外部 API 后再测试连接。

首次运行可以在欢迎页点击「创建示例项目」，选择一个父目录后会生成 `StoryForge 示例项目`，包含 `正文/第01章.md`、`大纲/总纲.md` 和 `人物/主角.md`，用于快速验证打开项目、上下文索引、agent 建议和写回流程。

## 8. 打包桌面安装器

Windows 私测包从 desktop 包目录构建：

```powershell
cd D:/StoryForge
npm --prefix apps/desktop run build
```

该命令先运行 `apps/desktop/scripts/prepare-bundled-git.mjs`（准备随包 MinGit），再运行 `apps/desktop/scripts/build-api-sidecar.mjs`，用 PyInstaller 将 `apps/api/run_windows.py` 打为 Tauri sidecar，最后执行 `tauri build`。常见输出路径（版本号以 `apps/desktop/src-tauri/tauri.conf.json` 为准，当前为 0.1.10）：

- `apps/desktop/src-tauri/target/release/bundle/msi/StoryForge IDE_<version>_x64_en-US.msi`
- `apps/desktop/src-tauri/target/release/bundle/nsis/StoryForge IDE_<version>_x64-setup.exe`

构建产物和 `apps/desktop/src-tauri/binaries/` 属于本机生成物；准备提交时不要把安装包、sidecar exe、PyInstaller build 缓存或真实 provider 配置加入 Git。

## 9. 本地验证顺序

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

- `pnpm verify` 执行当前 Desktop、shared、project-core 与 API 核心门禁：lint、typecheck、各栈测试（含 API pytest 与 `tests/test_alembic_heads.py` 的 Alembic 单 head 预检）、Ruff、daily 档 sidecar smoke 和 OpenAPI drift；详细结果以 `.codex/verification-report.md` 的最近记录为准（历史 Phase 9 结果见附录）。
- `pnpm e2e` 只做 OpenAPI 刷新/漂移检查和 Node 契约断言（`tests/e2e/`，秒级）；它不执行 HTTP pytest 或历史所称的 API verification，那些归 `pnpm verify` / `pnpm test`。
- `pnpm test` 用于补充执行 Desktop、shared、project-core 和 API 的测试集合。
- `pnpm openapi` 用于刷新 `packages/shared/src/contracts/storyforge.openapi.json`；如果产生 diff，必须解释来源并补充测试证据。

## 10. 附录：2026-06 历史远端门禁与迁移证据（原样保留）

> 以下为 2026-06-04 时点记录；其中「本地 E2E 的 API verification 预检」是当时的脚本归属，现行归属为 `pnpm verify` 的 API pytest（见第 9 节）。远端 GitHub Actions workflow 已于 2026-06-30 退役。历史 Phase 9 全量结果为 `API 405 passed`。

- 远端 `CI` run `26857864662` 已成功，但只覆盖 `CI / Core verification` 子集。
- 历史远端 `E2E` run `26915457170`（2026-06-03T21:55:39Z）曾失败于 Alembic `Multiple head revisions`。
- 最新远端 `master` E2E run `26944063055`（2026-06-04T09:45:05Z，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`）已成功；`执行 Alembic 迁移预检`、`执行数据库迁移`、`运行 E2E` 均为 success。
- 本地已新增 Alembic merge revision `20260604_0001`，并将 `tests/test_alembic_heads.py` 纳入本地 E2E 的 API verification 预检；在线 PostgreSQL 迁移已在本轮复验。

## 11. 真实 LLM smoke 入口

真实 LLM smoke 只在私有运行时变量已经由当前进程提供时执行；命令不读取 `.env`，不得输出或保存 provider token。

```powershell
cd D:/StoryForge/apps/api
uv run python -m app.domains.book_runs.book_generation --chapter-count 1 --token-budget 8000
uv run python -m app.domains.book_runs.book_generation --chapter-count 3 --token-budget 24000
```

当前脱敏证据：

- 1 章 smoke：`.codex/real-llm-1ch-20260603-142925`。
- 3 章 smoke：`.codex/real-llm-3ch-20260603-173932`。
- 10 章 smoke：`.codex/real-llm-10ch-20260604-110831`，最终门禁 `gate: pass_for_real_10ch_final_acceptance`，人工通读已完成。

这些证据只覆盖 1 章、3 章与 10 章 smoke。真实 3-5 万字长程仍未完成。

## 12. 常见失败处理

### Docker 容器未运行

现象：`pnpm dev` 默认开发启动提示 Docker 命令不可用，或 PostgreSQL、Redis、MinIO 容器未运行，API 迁移、数据库连接或对象存储步骤无法继续。`pnpm verify` 本身不探活 Docker（见 troubleshooting.md 第 2 节）。

处理：

```powershell
cd D:/StoryForge
docker compose up -d postgres redis minio
pnpm dev
```

### OpenAPI 刷新失败

现象：`pnpm openapi` 或 `pnpm e2e` 在刷新契约阶段失败。

处理：

1. 确认 `uv`、`python3` 或 `python` 至少一个可用，且 Python 版本满足项目要求。
2. 确认 `apps/api/app/main.py` 可导入。
3. 在 `apps/api` 中运行相关 pytest 排除语法或导入错误。
4. 再运行 `pnpm openapi` 重新生成契约。

OpenAPI 生成失败时不得继续使用旧契约作为发布依据。

### FastAPI HTTP pytest 失败

现象：`pnpm verify` 或 `pnpm test` 在 API pytest 阶段失败，或直接在 `apps/api` 运行某个 HTTP route pytest 返回非零退出码。

处理：

- 这是发布门禁红灯，不能降级为服务层补偿验收。
- 先在 `apps/api` 中复跑失败目标，例如 `uv run pytest tests/test_alembic_heads.py -q` 或具体失败测试。
- 修复 router、service、schema、Alembic、测试夹具或 OpenAPI 契约后，回到仓库根重新运行 `pnpm verify`（契约断言另跑 `pnpm e2e`）。

### 远端 E2E 失败（历史流程，已退役）

现象（历史）：GitHub Actions `E2E` 曾有失败 run。该远端 workflow 已于 2026-06-30 退役，当前验证直接运行本地 `pnpm verify` / `pnpm e2e`；下面命令仅适用于仍存在于远端的历史副本，不是现行操作步骤。

```powershell
gh run list --repo XZZKANY/StoryForge --workflow E2E --limit 5
gh run view <run-id> --repo XZZKANY/StoryForge --log-failed
```

历史记录：当时失败点为 Alembic `Multiple head revisions`，由包含本地 `20260604_0001` 修复的提交解决；当时已知通过证据为 `master` run `26944063055`。

## 13. Git 检查

每轮启动或提交前执行：

```powershell
cd D:/StoryForge
git fetch origin --prune
git status --short --branch
git log --oneline --decorate -5
git diff --stat
```

通过条件：清楚知道当前未提交文件归属；如果准备提交，必须先完成本地验证、更新 `docs/internal/TODO.md` 和 `.codex/verification-report.md`。
