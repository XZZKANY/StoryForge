# StoryForge Alembic 本地验证记录

更新时间：2026-05-24 20:45:00 +08:00

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
- `c0ffee20260519_add_memory_atoms.py`
- `c0ffee20260520_add_compiled_contexts.py`
- `20260520_0001_add_pgvector_retrieval_index.py`

## 3. 已执行命令与结果

### 3.1 迁移脚本语法检查

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
python -m compileall apps/api/alembic
```

最近记录：此前通过。当前本轮未新增迁移脚本，只同步验证记录。

### 3.2 Alembic head 检查

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run alembic heads
```

结果：通过，当前 head 为：

```text
20260520_0001 (head)
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
- `Running upgrade 9f2b3c4d5e6f -> c0ffee20260519`
- `CREATE TABLE memory_atoms`
- `Running upgrade c0ffee20260519 -> c0ffee20260520`
- `CREATE TABLE compiled_contexts`
- `UPDATE alembic_version SET version_num='c0ffee20260520'`
- `Running upgrade c0ffee20260520 -> 20260520_0001`
- `CREATE EXTENSION IF NOT EXISTS vector`
- `ALTER TABLE retrieval_chunks ADD COLUMN IF NOT EXISTS embedding_vector vector(4)`
- `CREATE INDEX IF NOT EXISTS ix_retrieval_chunks_embedding_vector_hnsw`
- `UPDATE alembic_version SET version_num='20260520_0001'`

这说明迁移链可以生成从空库到当前 head 的 PostgreSQL SQL。

### 3.4 在线数据库状态检查

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run alembic upgrade head
uv run alembic current
```

结果：通过。本轮 Docker Desktop 可用，`storyforge-postgres` 处于 healthy 状态；在线命令输出包含：

```text
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
20260520_0001 (head)
```

补充执行：

```powershell
uv run alembic current --check-heads
```

结果：通过，输出 `20260520_0001 (head)`，说明当前数据库版本已处于 Alembic 脚本目录的全部 head。

### 3.5 干净临时数据库升级验证

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
docker exec storyforge-postgres psql -U storyforge -d postgres -c "DROP DATABASE IF EXISTS storyforge_phase7_clean_verify;"
docker exec storyforge-postgres psql -U storyforge -d postgres -c "CREATE DATABASE storyforge_phase7_clean_verify OWNER storyforge;"

cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
$env:DATABASE_URL='postgresql+psycopg://storyforge:storyforge@127.0.0.1:55432/storyforge_phase7_clean_verify'
uv run alembic upgrade head
uv run alembic current --check-heads
Remove-Item Env:DATABASE_URL

cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
docker exec storyforge-postgres psql -U storyforge -d postgres -c "DROP DATABASE storyforge_phase7_clean_verify;"
```

结果：通过。最近复验时间：2026-05-24 20:45:00 +08:00；临时数据库名：`storyforge_phase7_20260524_verify`。`upgrade head` 从空库依次执行 `71dfabf6badf`、`9f2b3c4d5e6f`、`c0ffee20260519`、`c0ffee20260520`、`20260520_0001`，`current --check-heads` 输出 `20260520_0001 (head)`；验证后已删除临时数据库。

## 4. 当前结论

- Alembic head 检查通过，当前 head 为 `20260520_0001`。
- 离线 SQL 生成通过，能生成从空库到当前 head 的 SQL。
- 离线 SQL 已覆盖 `memory_atoms`、`compiled_contexts` 和 `retrieval_chunks.embedding_vector` / HNSW 索引相关迁移。
- 在线升级到真实 PostgreSQL 已在本机通过，`uv run alembic current` 与 `uv run alembic current --check-heads` 均输出 `20260520_0001 (head)`。
- 干净临时数据库 `storyforge_phase7_clean_verify` 已完成从空库升级到 `20260520_0001 (head)` 的在线验证，验证后已删除临时库，不影响主数据库。

## 5. 后续复核步骤

在新机器或重置数据库后执行：

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
docker compose up -d postgres redis minio
pnpm verify
cd apps/api
uv run alembic upgrade head
uv run alembic current
uv run alembic current --check-heads
```

通过条件：

- `pnpm verify` 通过，PostgreSQL、Redis、MinIO 均正在运行。
- `uv run alembic upgrade head` 退出码为 0。
- `uv run alembic current` 输出 `20260520_0001 (head)`。
- `uv run alembic current --check-heads` 退出码为 0。

## 6. 风险记录

本轮已使用独立临时数据库证明“空库到最新 head”路径可执行，但该验证仍依赖当前本机 Docker Desktop、当前镜像和当前代码工作区。跨机器复现时仍需按第 5 节重新执行；不得把本机结果等同于所有环境已经通过。
