# StoryForge Alembic 本地验证记录

更新时间：2026-05-18 13:05:00 +08:00

## 1. 目标

记录当前仓库 Alembic 从空数据库升级到最新模型的验证状态。本文只记录本机真实执行结果，不把未完成的在线数据库升级伪装为通过。

## 2. 迁移配置来源

- 配置文件：`apps/api/alembic.ini`
- 环境入口：`apps/api/alembic/env.py`
- 默认数据库：`postgresql+psycopg://storyforge:storyforge@127.0.0.1:55432/storyforge`
- 环境变量覆盖：`DATABASE_URL`
- 当前版本目录：`apps/api/alembic/versions/`

当前检测到的版本文件：

- `71dfabf6badf_创建_phase_1_领域模型.py`
- `9f2b3c4d5e6f_为资产增加版本谱系键.py`

## 3. 已执行命令与结果

### 3.1 迁移脚本语法检查

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
python -m compileall apps/api/alembic
```

结果：通过。`env.py` 与两个版本脚本均可编译。

### 3.2 Alembic head 检查

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run alembic heads
```

结果：通过，当前 head 为：

```text
9f2b3c4d5e6f (head)
```

### 3.3 离线 SQL 生成

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run alembic upgrade head --sql
```

结果：通过。命令输出包含：

- `CREATE TABLE alembic_version`
- `Running upgrade  -> 71dfabf6badf`
- `Running upgrade 71dfabf6badf -> 9f2b3c4d5e6f`
- `ALTER TABLE assets ADD COLUMN lineage_key`
- `COMMIT`

这说明迁移链可以生成从空库到当前 head 的 PostgreSQL SQL。

### 3.4 在线数据库状态检查

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run alembic current
```

结果：未通过，命令在 64 秒后超时。结合本轮 `pnpm verify` 输出，当前本机 Docker 服务不可查询，因此 PostgreSQL 容器状态无法确认。

## 4. 当前结论

- Alembic 迁移脚本语法检查通过。
- Alembic head 检查通过，当前 head 为 `9f2b3c4d5e6f`。
- 离线 SQL 生成通过，能生成从空库到当前 head 的 SQL。
- 在线升级到真实 PostgreSQL 尚未完成验证，原因是当前 Docker/PostgreSQL 状态不可用。

## 5. 补跑步骤

在 Docker 可用后执行：

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
docker compose up -d postgres redis minio
pnpm verify
cd apps/api
uv run alembic upgrade head
uv run alembic current
```

通过条件：

- `pnpm verify` 通过，PostgreSQL、Redis、MinIO 均正在运行。
- `uv run alembic upgrade head` 退出码为 0。
- `uv run alembic current` 输出 `9f2b3c4d5e6f`。

## 6. 风险记录

在线迁移未验证前，不应声称“干净数据库升级已完整通过”。当前可交付结论仅限于脚本语法、head 检查和离线 SQL 生成通过。
