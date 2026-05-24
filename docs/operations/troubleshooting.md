# StoryForge 故障手册

更新时间：2026-05-18 17:10:00 +08:00

## 1. 使用原则

本文只记录当前仓库中已经出现或已经由脚本显式处理的故障场景。排查时先保留原始命令和输出，再按下列步骤缩小范围，避免把环境限制误判为功能缺陷。

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
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
docker compose up -d postgres redis minio
pnpm verify
```

如果 Docker 本身不可用，先启动 Docker Desktop 或安装 Docker，再重新运行验证。

## 3. FastAPI HTTP pytest 失败

### 现象

- `pnpm e2e` 在真实 FastAPI HTTP pytest 阶段失败。
- 直接运行某个 HTTP route pytest 返回非零退出码。

### 判断

这是当前发布门禁红灯。根级 `scripts/run-e2e.mjs` 已固定执行真实 API HTTP pytest 目标，不再探测或切换到服务层补偿验收。

### 处理

- 不要删除 HTTP route 测试文件，也不要把失败改写为补偿通过。
- 在 `apps/api` 下复跑失败目标，例如 `uv run pytest tests/test_model_runs.py -q`。
- 根据失败信息修复 API router、service、schema、测试夹具或 OpenAPI 契约。
- 修复后回到仓库根重新运行 `pnpm e2e`。

## 4. OpenAPI 刷新失败

### 现象

- `pnpm openapi` 失败。
- `pnpm e2e` 在刷新 OpenAPI 契约阶段停止。
- 输出包含 `OpenAPI 契约刷新失败`。

### 排查

```powershell
pnpm run test:api
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

## 5. Provider、embedding 或 reranker 未配置

### 现象

- Phase 5 真实 AI/RAG 接入前，系统仍使用 deterministic provider、假 embedding 或关键词检索路径。
- `.env.example` 已提供 `STORYFORGE_LLM_*`、`STORYFORGE_EMBEDDING_*`、`STORYFORGE_RERANKER_*` 和 `STORYFORGE_RAG_*` 变量；Provider Gateway 会读取 LLM、embedding、reranker 变量，并在缺少真实密钥时回退。

### 判断

这是当前路线中的已知降级路径，不是 Phase 1 到 Phase 4 的回归缺陷。样例变量已绑定到 Provider Gateway 运行时配置，但未配置真实密钥时会回退到本地默认实现；这不代表真实外部 provider、embedding 或 reranker 已经端到端接入。

### 处理

- 当前阶段不要把真实 provider 调用作为本地启动前置条件。
- 本地保持 `STORYFORGE_LLM_PROVIDER=deterministic`、`STORYFORGE_EMBEDDING_PROVIDER=local`、`STORYFORGE_RERANKER_PROVIDER=disabled`。
- 调整这些变量后，优先运行 Provider Gateway、Embedding、Reranker 相关本地测试；真实外部密钥不可用时只接受回退路径验证。
- 文档中不得承诺未接入的真实 AI/RAG 能力已经可用。

## 6. `pnpm verify` 失败

### 现象

- 工具缺失：Node.js、pnpm、Python、Docker 不可用。
- 必需文件缺失：`package.json`、`docker-compose.yml`、`.env.example` 或应用配置不存在。
- 基础服务容器未运行。

### 排查

```powershell
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
- 若失败属于当前环境限制，必须写入 `.codex/verification-report.md`，不能声称完整通过。

## 7. Git 工作区不干净

### 现象

- `git status --short --branch` 显示未提交修改或未跟踪文件。
- 当前分支显示 ahead/behind。

### 处理

```powershell
git status --short --branch
git diff --stat
git diff
```

- 将每个修改归属到具体任务。
- 不提交临时文件、缓存、私有配置或无法解释来源的文件。
- 本任务明确禁止自动提交时，只能记录状态并在汇报中说明。
