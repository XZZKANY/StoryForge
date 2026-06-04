# StoryForge Alembic 本地验证记录

更新时间：2026-06-04 09:02:00 +08:00

## 1. 目标

记录当前 `D:/StoryForge` 仓库 Alembic 迁移图、离线 SQL 生成和在线 PostgreSQL 迁移验证状态。本文只记录当前工作树已经实际执行或已经明确失败的事实，不把本地补偿验证、Docker 不可用状态或远端旧 run 误写成通过。

## 2. 迁移配置来源

- 配置文件：`apps/api/alembic.ini`
- 环境入口：`apps/api/alembic/env.py`
- 默认数据库：`postgresql+psycopg://storyforge:storyforge@127.0.0.1:55432/storyforge`
- 环境变量覆盖：`DATABASE_URL`
- 版本目录：`apps/api/alembic/versions/`
- 当前 merge head：`20260604_0001`
- 当前 merge parents：`20260514_phase2` 与 `20260602_0003`

## 3. 当前 Phase 9 验证事实

### 3.1 迁移图单 head 预检

本地预检入口：

```powershell
cd D:/StoryForge/apps/api
uv run pytest tests/test_alembic_heads.py -q
```

当前 `tests/test_alembic_heads.py` 覆盖：

- Alembic `ScriptDirectory.get_heads()` 必须只返回 `20260604_0001`。
- `uv run alembic upgrade head --sql` 必须退出码为 0。
- 离线 SQL 输出必须包含 `20260604_0001`。

该测试已经纳入本地 `pnpm e2e` 的 API verification，并已接入远端 `.github/workflows/e2e.yml` 的 `执行 Alembic 迁移预检` 步骤。

### 3.2 离线 SQL 生成

离线补偿验证命令：

```powershell
cd D:/StoryForge/apps/api
uv run alembic upgrade head --sql
```

当前结论：离线 SQL 生成已通过，可生成到 `20260604_0001`。这证明迁移脚本可以在无数据库连接时解析迁移链并生成 PostgreSQL SQL，但不等于在线 PostgreSQL 数据库已经完成升级。

### 3.3 在线 PostgreSQL 迁移状态

在线验证目标命令：

```powershell
cd D:/StoryForge
docker compose up -d postgres

cd D:/StoryForge/apps/api
$env:DATABASE_URL='postgresql+psycopg://storyforge:storyforge@127.0.0.1:55432/storyforge_phase9_online_verify'
uv run alembic upgrade head
uv run alembic current --check-heads
Remove-Item Env:DATABASE_URL
```

当前环境事实：

- `docker --version` 可执行，当前客户端版本为 Docker `29.2.1`。
- `docker compose version` 可执行，当前 Compose 版本为 `v5.1.0`。
- Docker Desktop 已通过隐藏启动请求拉起，Docker daemon 已启动，`docker info` 返回 server `29.2.1`。
- 旧 compose 项目遗留的 `storyforge-postgres` 容器占用同名容器；本轮没有删除该容器，而是直接 `docker start storyforge-postgres` 复用。
- `storyforge-postgres` 已进入 healthy 状态，端口映射为 `0.0.0.0:55432->5432/tcp`。

在线 PostgreSQL 迁移已在本轮复验，使用独立临时数据库 `storyforge_phase9_online_verify`，没有对默认 `storyforge` 数据库执行破坏性操作。

执行结果：

```text
RUNNING_ALEMBIC_UPGRADE_HEAD
ALEMBIC_UPGRADE_EXIT=0
RUNNING_ALEMBIC_CURRENT_CHECK_HEADS
20260604_0001 (head) (mergepoint)
ALEMBIC_CURRENT_EXIT=0
TEMP_DB_DROP_EXIT=0
```

该结果证明当前工作树可以在本机 PostgreSQL 上从空临时库在线升级到 `20260604_0001`。远端 `master` E2E run `26944063055` 已包含该修复并成功跑通。

## 4. 远端 E2E 边界

- 历史远端 `E2E` run `26915457170`，触发时间 `2026-06-03T21:55:39Z`，曾失败于 `uv run alembic upgrade head`。
- 失败原因为 Alembic `Multiple head revisions`。
- 本地已新增 `20260604_0001` merge revision，并通过 `tests/test_alembic_heads.py` 约束单 head 与离线 SQL。
- 修复已合入远端 `master`；最新远端 `master` E2E run `26944063055`（2026-06-04T09:45:05Z，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`）已成功，关键步骤 `执行 Alembic 迁移预检`、`执行数据库迁移`、`运行 E2E` 均为 success。

## 5. Docker daemon 恢复后的复验步骤

Docker daemon 可用后，使用独立临时数据库执行在线迁移，避免污染主开发库：

```powershell
cd D:/StoryForge
docker compose up -d postgres
docker exec storyforge-postgres psql -U storyforge -d postgres -c "DROP DATABASE IF EXISTS storyforge_phase9_online_verify;"
docker exec storyforge-postgres psql -U storyforge -d postgres -c "CREATE DATABASE storyforge_phase9_online_verify OWNER storyforge;"

cd D:/StoryForge/apps/api
$env:DATABASE_URL='postgresql+psycopg://storyforge:storyforge@127.0.0.1:55432/storyforge_phase9_online_verify'
uv run alembic upgrade head
uv run alembic current --check-heads
Remove-Item Env:DATABASE_URL

cd D:/StoryForge
docker exec storyforge-postgres psql -U storyforge -d postgres -c "DROP DATABASE storyforge_phase9_online_verify;"
```

通过条件：

- `uv run alembic upgrade head` 退出码为 0。
- `uv run alembic current --check-heads` 退出码为 0。
- 输出显示当前数据库位于 `20260604_0001`。
- 临时数据库验证后已删除。

## 6. 当前结论

- 当前迁移图已收敛到单一 head：`20260604_0001`。
- 当前离线 SQL 生成已作为无数据库环境补偿验证通过。
- 在线 PostgreSQL 迁移已在本轮复验：临时库 `storyforge_phase9_online_verify` 执行 `uv run alembic upgrade head` 与 `uv run alembic current --check-heads` 均退出码为 0，验证后临时库已删除。
- 远端 `master` E2E 已通过；仍不能用迁移门禁替代真实 3-5 万字长程验收。
