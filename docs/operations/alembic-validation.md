# StoryForge Alembic 验证手册

更新时间：2026-09-28

## 1. 目标

本文说明 `D:/StoryForge` 仓库 Alembic 迁移图的现行验证方法：如何确认单 head、如何离线生成 SQL、如何区分 SQLite 与 PostgreSQL 的验证路径。历史实测记录（含 2026-06-04 的在线 PostgreSQL 输出）原样收在附录，仅作时点参考；本文不凭历史输出宣称当前环境已完成在线迁移。

## 2. 迁移配置来源

- 配置文件：`apps/api/alembic.ini`
- 环境入口：`apps/api/alembic/env.py`
- 默认数据库：`postgresql+psycopg://storyforge:storyforge@127.0.0.1:55432/storyforge`
- 环境变量覆盖：`DATABASE_URL`
- 版本目录：`apps/api/alembic/versions/`
- 当前 head：`20260703_0001`（由 `tests/test_alembic_heads.py` 锁定；历史 merge `20260604_0001` 见附录）

查询当前 head 的方式：

```powershell
cd D:/StoryForge/apps/api
uv run alembic heads
```

## 3. 现行验证方法

### 3.1 单 head 预检

```powershell
cd D:/StoryForge/apps/api
uv run pytest tests/test_alembic_heads.py -q
```

当前 `tests/test_alembic_heads.py` 要求 `ScriptDirectory.get_heads()` 只返回当前 head（现为 `20260703_0001`，新增迁移后应同步更新期望），并要求离线 SQL 生成成功且包含当前 head。该测试由 `pnpm verify` 的 API pytest 阶段覆盖。

### 3.2 离线 SQL 生成

无数据库连接时的补偿验证：

```powershell
cd D:/StoryForge/apps/api
uv run alembic upgrade head --sql
```

离线 SQL 能证明迁移脚本可以解析迁移链并生成 SQL，但不等于任何数据库已完成在线升级。

### 3.3 SQLite 与 PostgreSQL 分开验证

- SQLite：`alembic/env.py` 支持注入连接与 `render_as_batch`；sidecar 起服会对已纳管库执行 `uv run alembic upgrade head`、对存量 `create_all` 库做备份 + `quick_check` + `stamp head` 纳管（实现见 `apps/api/app/db/migrations.py`）。本机桌面模式验证走这条路径，不需要 Docker。
- PostgreSQL：需要 Docker 启动 `storyforge-postgres` 后，用独立临时数据库执行 `uv run alembic upgrade head` 与 `uv run alembic current --check-heads`，期望输出显示当前 head（现为 `20260703_0001`），验证后删除临时库。2026-06-04 的原样流程与输出见附录，复跑时以当时查询到的当前 head 为准，不要照搬历史输出中的 revision。

## 4. 附录：2026-06-04 历史验证记录（原样保留）

> 以下为 2026-06-04 时点的原始记录，输出中的 revision（`20260604_0001`）是当时的 head，不代表当前 head。2026-09-28 整理本文时未重新执行在线迁移，在线结果以原时点为准。

历史 merge head：`20260604_0001`；历史 merge parents：`20260514_phase2` 与 `20260602_0003`。

当时 `tests/test_alembic_heads.py` 覆盖：`ScriptDirectory.get_heads()` 只返回 `20260604_0001`；`uv run alembic upgrade head --sql` 退出码为 0；离线 SQL 输出包含 `20260604_0001`。该测试当时纳入本地 `pnpm e2e` 的 API verification；远端 `.github/workflows/e2e.yml` 的接入仅属于 2026-06 的历史记录，GitHub Actions workflow 已于 2026-06-30 退役。

当时离线补偿验证结论：离线 SQL 生成已通过，可生成到 `20260604_0001`，不等于在线 PostgreSQL 数据库已经完成升级。

当时在线验证环境：

- `docker --version` 可执行，当时客户端版本为 Docker `29.2.1`。
- `docker compose version` 可执行，当时 Compose 版本为 `v5.1.0`。
- Docker Desktop 已通过隐藏启动请求拉起，Docker daemon 已启动，`docker info` 返回 server `29.2.1`。
- 旧 compose 项目遗留的 `storyforge-postgres` 容器占用同名容器；当时没有删除该容器，而是直接 `docker start storyforge-postgres` 复用。
- `storyforge-postgres` 已进入 healthy 状态，端口映射为 `0.0.0.0:55432->5432/tcp`。

在线 PostgreSQL 迁移已在本轮复验，使用独立临时数据库 `storyforge_phase9_online_verify`，没有对默认 `storyforge` 数据库执行破坏性操作。执行结果：

```text
RUNNING_ALEMBIC_UPGRADE_HEAD
ALEMBIC_UPGRADE_EXIT=0
RUNNING_ALEMBIC_CURRENT_CHECK_HEADS
20260604_0001 (head) (mergepoint)
ALEMBIC_CURRENT_EXIT=0
TEMP_DB_DROP_EXIT=0
```

该结果只证明 2026-06-04 时点的工作树可以在本机 PostgreSQL 上从空临时库在线升级到 `20260604_0001`。远端 `master` E2E run `26944063055` 已包含该修复并成功跑通。

当时使用的复验步骤：

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

当时通过条件：`uv run alembic upgrade head` 退出码为 0；`uv run alembic current --check-heads` 退出码为 0；输出显示数据库位于 `20260604_0001`；临时数据库验证后已删除。

历史远端门禁边界：

- 历史远端 `E2E` run `26915457170`，触发时间 `2026-06-03T21:55:39Z`，曾失败于 `uv run alembic upgrade head`，失败原因为 Alembic `Multiple head revisions`。
- 本地新增 `20260604_0001` merge revision，并通过 `tests/test_alembic_heads.py` 约束单 head 与离线 SQL。
- 修复已合入远端 `master`；最新远端 `master` E2E run `26944063055`（2026-06-04T09:45:05Z，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`）已成功，关键步骤 `执行 Alembic 迁移预检`、`执行数据库迁移`、`运行 E2E` 均为 success，即远端 `master` E2E 已通过。

## 5. 当前结论

- 当前迁移图为单一 head `20260703_0001`，由 `tests/test_alembic_heads.py` 持续锁定。
- 离线 SQL 生成作为无数据库环境补偿验证保留。
- 在线 PostgreSQL 验证的最近一次实测为 2026-06-04（附录）；不能以迁移门禁替代真实 3-5 万字长程验收。
