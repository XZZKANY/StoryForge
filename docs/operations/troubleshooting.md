# StoryForge 故障手册

更新时间：2026-06-04 07:36:00 +08:00

## 1. 使用原则

本文只记录当前仓库中已经出现或已经由脚本显式处理的故障场景。排查时先保留原始命令和输出，再按下列步骤缩小范围，避免把环境限制误判为功能缺陷。

当前本地仓库路径为 `D:/StoryForge`。本文中的本地命令默认在 Windows PowerShell 中执行；如果使用其他 shell，先等价切换到相同目录。

## 2. Docker 或基础容器未运行

### 现象

- `pnpm verify` 提示 Docker 命令不可用。
- `pnpm verify` 提示 PostgreSQL、Redis 或 MinIO 容器未运行。
- API 迁移、数据库连接或对象存储相关步骤无法继续。

### 排查

```powershell
docker version
docker compose ps
docker ps --filter "name=storyforge"
```

### 处理

```powershell
cd D:/StoryForge
docker compose up -d postgres redis minio
pnpm verify
```

如果 Docker 本身不可用，先启动 Docker Desktop 或安装 Docker，再重新运行验证。若失败属于当前环境限制，必须写入 `docs/internal/codex/verification-report.md`，不能声称完整通过。

## 3. FastAPI HTTP pytest 或 API verification 失败

### 现象

- `pnpm e2e` 在 API verification 或真实 FastAPI HTTP pytest 阶段失败。
- 直接运行某个 HTTP route pytest 返回非零退出码。

### 判断

这是发布门禁红灯。根级 `scripts/run-e2e.mjs` 会执行真实 API HTTP pytest 与 API verification，不得探测失败后改写为服务层补偿验收。

### 处理

- 不要删除 HTTP route 测试文件，也不要把失败改写为补偿通过。
- 在 `apps/api` 下复跑失败目标，例如 `uv run pytest tests/test_model_runs.py -q` 或日志中点名的具体测试。
- 根据失败信息修复 API router、service、schema、测试夹具、Alembic 迁移或 OpenAPI 契约。
- 修复后回到仓库根重新运行 `pnpm e2e`。

## 4. Alembic 多 head 曾导致远端 E2E 失败

### 现象

- 历史远端 `E2E` run `26915457170`（2026-06-03T21:55:39Z）失败。
- 失败点为 `uv run alembic upgrade head`。
- 错误包含 Alembic `Multiple head revisions`。

### 判断

这是 Phase 9 远端 E2E 的历史失败边界。本地已新增 Alembic merge revision `20260604_0001`，并将 `tests/test_alembic_heads.py` 纳入本地 `pnpm e2e` 的 API verification 预检，用于验证 Alembic 单 head 与离线 SQL smoke；在线 PostgreSQL 迁移已在本轮复验，临时库 `storyforge_phase9_online_verify` 执行 `uv run alembic upgrade head` 与 `uv run alembic current --check-heads` 均退出码为 0，验证后已删除。修复已合入 `master`，最新远端 `master` E2E run `26944063055`（2026-06-04T09:45:05Z）已通过。

该状态不能替代真实 10 章或 3-5 万字长程验收。

### 排查

```powershell
cd D:/StoryForge/apps/api
uv run pytest tests/test_alembic_heads.py -q
uv run alembic heads --verbose
```

如需核对远端失败日志：

```powershell
gh run list --repo XZZKANY/StoryForge --workflow E2E --limit 5
gh run view 26915457170 --repo XZZKANY/StoryForge --log-failed
```

### 处理

1. 确认本地迁移图只剩一个 Alembic head。
2. 确认 `tests/test_alembic_heads.py` 在本地通过，并保留在 `pnpm e2e` 的 API verification 中。
3. 确认包含 `20260604_0001` 的提交进入远端分支后，再重新运行远端 E2E。
4. 若未来远端 E2E 再次失败，所有计划、README、TODO、故障手册和验证报告都必须记录新的失败 run、提交和失败步骤。

## 5. OpenAPI 刷新失败

### 现象

- `pnpm openapi` 失败。
- `pnpm e2e` 在刷新 OpenAPI 契约阶段停止。
- 输出包含 `OpenAPI 契约刷新失败`。

### 排查

```powershell
cd D:/StoryForge
pnpm openapi
git diff -- packages/shared/src/contracts/storyforge.openapi.json
```

### 处理

1. 确认 `uv`、`python3` 或 `python` 至少一个可用，且 Python 版本满足项目要求。
2. 先修复 API 语法或导入错误。
3. 确认 `apps/api/app/main.py` 可以导入 `app`。
4. 重新执行 `pnpm openapi`；脚本会输出实际使用的 Python 运行时。
5. 如果契约发生变化，检查 `docs/api/` 中对应审查文档是否需要更新。

OpenAPI 生成失败时不得继续使用旧契约作为发布依据。

## 6. Provider、embedding 或 reranker 未配置

### 现象

- 真实 LLM、embedding 或 reranker 私有变量未在当前进程中提供。
- Phase 9 真实 LLM smoke 以外的本地启动仍使用 deterministic provider、本地 embedding 或禁用 reranker 路径。

### 判断

这是本地开发与验证的已知降级路径，不是基础功能回归。真实 provider token、API key、secret 或 password 只能存在于本机私有运行时环境，不得写入仓库、日志、验证报告或截图。

### 处理

- 当前阶段不要把真实 provider 调用作为本地启动前置条件。
- 本地保持 `STORYFORGE_LLM_PROVIDER=deterministic`、`STORYFORGE_EMBEDDING_PROVIDER=local`、`STORYFORGE_RERANKER_PROVIDER=disabled`。
- 调整这些变量后，优先运行 Provider Gateway、Embedding、Reranker 相关本地测试；真实外部密钥不可用时只接受回退路径验证。
- 真实 LLM smoke 只依据脱敏证据目录记录结果，不能输出 provider token。

## 7. `pnpm verify` 失败

### 现象

- 工具缺失：Node.js、pnpm、Python、Docker 不可用。
- 必需文件缺失：`package.json`、`docker-compose.yml`、`.env.example` 或应用配置不存在。
- 基础服务容器未运行。

### 排查

```powershell
cd D:/StoryForge
pnpm verify
node --version
pnpm --version
python --version
docker compose ps
```

### 处理

- 工具缺失：安装对应工具后重试。
- 文件缺失：检查 Git 工作区是否误删文件，必要时从当前分支恢复。
- 容器缺失：执行 `docker compose up -d postgres redis minio` 后重试。
- 若失败属于当前环境限制，必须写入 `docs/internal/codex/verification-report.md`，不能声称完整通过。

## 8. Git 工作区不干净

### 现象

- `git status --short --branch` 显示未提交修改或未跟踪文件。
- 当前分支显示 ahead/behind。

### 处理

```powershell
cd D:/StoryForge
git status --short --branch
git diff --stat
git diff
```

- 将每个修改归属到具体任务。
- 不提交临时文件、缓存、私有配置或无法解释来源的文件。
- 本任务明确禁止自动提交时，只能记录状态并在汇报中说明。
