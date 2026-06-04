## 项目上下文摘要（Phase9 Alembic 多 head 修复）

生成时间：2026-06-04 05:12:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/alembic/versions/20260514_phase2_创建_phase_2_领域模型.py`
  - 模式：标准 Alembic revision 文件，包含 `revision`、`down_revision`、`branch_labels`、`depends_on`、`upgrade` 与 `downgrade`。
  - 可复用：文件头说明、`collections.abc.Sequence` 类型标注、简体中文 docstring。
  - 需注意：当前它是 head，父节点为 `9f2b3c4d5e6f`。
- **实现2**: `apps/api/alembic/versions/20260602_0003_add_character_bible_version_sync.py`
  - 模式：线性迁移链尾部 revision，当前另一个 head。
  - 可复用：同样使用 `Sequence` 类型标注和空 `branch_labels/depends_on`。
  - 需注意：父节点为 `20260602_0002`，属于主线迁移链尾端。
- **实现3**: `apps/api/tests/test_assistant_sessions_migration.py`
  - 模式：pytest 静态读取迁移文件并断言关键片段。
  - 可复用：新增迁移图测试可沿用 `Path.read_text(encoding="utf-8")` 与普通 `assert`。
  - 需注意：现有测试只验证单个迁移内容，没有验证全局 head 数量。
- **实现4**: `apps/api/tests/test_pgvector_migration.py`
  - 模式：读取版本文件并断言 `down_revision` 和 SQL 片段。
  - 可复用：迁移契约测试风格。
- **实现5**: `.github/workflows/e2e.yml`
  - 模式：远端 E2E 在 `apps/api` 执行 `uv run alembic upgrade head` 后再运行 `pnpm e2e`。
  - 可复用：本轮验证必须覆盖该失败命令。

### 2. 项目约定

- **命名约定**: 迁移文件采用 `YYYYMMDD_NNNN_说明.py` 或历史 revision ID 文件名；revision 字符串保持短且稳定。
- **文件组织**: 迁移文件统一放在 `apps/api/alembic/versions/`，测试放在 `apps/api/tests/`。
- **导入顺序**: `from __future__ import annotations`、标准库、第三方库、`from alembic import op`。
- **代码风格**: Alembic `upgrade/downgrade` 使用简体中文 docstring；pytest 使用普通 `assert`。

### 3. 可复用组件清单

- `apps/api/alembic/env.py`: 读取 `DATABASE_URL` 并加载完整 ORM 元数据。
- `apps/api/alembic/versions/20260514_phase2_创建_phase_2_领域模型.py`: head 之一。
- `apps/api/alembic/versions/20260602_0003_add_character_bible_version_sync.py`: head 之一。
- `apps/api/tests/test_assistant_sessions_migration.py`: 迁移静态契约测试模式。
- `.github/workflows/e2e.yml`: 远端 E2E 迁移命令来源。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 新增迁移图完整性测试，使用 Alembic `ScriptDirectory` 读取版本目录，要求 `get_heads()` 只有一个 head。
- **红灯命令**: `uv run pytest tests/test_alembic_heads.py -q` 应在多 head 状态失败。
- **绿灯命令**: 新增 merge revision 后，目标测试通过，且 `uv run alembic heads --verbose` 只显示一个 mergepoint head。
- **E2E 对应验证**: 在无数据库或未启动 Postgres 的环境中，`uv run alembic upgrade head --sql` 可证明 `head` 目标解析不再因多 head 失败；若有数据库，再执行在线 `uv run alembic upgrade head`。

### 5. 依赖和集成点

- **外部依赖**: Alembic 官方 merge revision 机制。
- **官方文档结论**: `alembic merge` 用于合并多个 head；生成文件的 `down_revision` 是被合并 revision 的元组，`upgrade/downgrade` 可为空操作。
- **开源实现参考**: GitHub code search 显示多个项目在 `alembic/versions` 中使用 `down_revision = (...)` 的 merge migration。
- **远端证据**: 最新远端 E2E run `26850336742` 在 `uv run alembic upgrade head` 失败，错误为 `Multiple head revisions are present for given argument 'head'`。
- **本地证据**: `uv run alembic heads --verbose` 显示 `20260514_phase2` 与 `20260602_0003` 两个 head；`uv run alembic branches --verbose` 显示分叉点为 `9f2b3c4d5e6f`。

### 6. 技术选型理由

- **为什么用 merge revision**: 这是 Alembic 标准机制，可保留两条已存在迁移历史，不需要重写历史或改动已有迁移。
- **优势**: 最小化风险，直接消除 `upgrade head` 多 head 解析错误。
- **劣势和风险**: merge revision 只修复迁移图拓扑，不证明远端 E2E 已通过；远端仍需重新运行。

### 7. 关键风险点

- **迁移顺序**: 两个分支都源自同一历史链，merge revision 应只合并头，不改变既有迁移内容。
- **数据库状态**: 本地若未启动 Postgres，在线 `upgrade head` 可能因连接失败；应至少用 `--sql` 与 `heads` 证明目标解析。
- **远端状态漂移**: GitHub Actions 后续 run 可能变化，文档只能记录本轮查询时状态。
- **敏感信息**: 不读取 `.env`，不写入 provider 私有端点或凭据。

### 8. 上下文充分性检查

- 能定义接口契约：是，迁移图必须只有一个 head。
- 理解技术选型：是，使用 Alembic 官方 merge revision。
- 识别主要风险：是，merge 不等于远端 E2E 已通过。
- 知道如何验证：是，pytest 迁移图测试、`alembic heads`、`alembic upgrade head --sql`、相关回归和敏感扫描。
