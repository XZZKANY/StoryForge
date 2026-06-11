## 项目上下文摘要（Phase9 Alembic 在线迁移复验）

生成时间：2026-06-04 09:11:51 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_alembic_heads.py`
  - 模式：使用 Alembic `ScriptDirectory` 检查迁移图，并用离线 SQL smoke 守卫关键建表和索引输出。
  - 可复用：`test_alembic_migration_graph_has_single_head`、离线 SQL 断言模式。
  - 需注意：离线模式不能替代真实 PostgreSQL 反射行为。
- **实现2**: `apps/api/tests/test_phase9_fact_sources.py`
  - 模式：读取活文档并断言当前 Phase 9 事实，防止旧状态回流。
  - 可复用：`Path.read_text(encoding="utf-8")`、正向事实和旧事实负向断言。
  - 需注意：事实源只能写入已本地验证的结论，不能把远端 E2E 写成通过。
- **实现3**: `docs/operations/alembic-validation.md`
  - 模式：分层记录本地迁移图、离线 SQL、在线 PostgreSQL 和远端 E2E 边界。
  - 可复用：当前 head `20260604_0001`、临时库验证步骤、Docker/PostgreSQL 运行状态记录。
  - 需注意：旧的“Docker daemon 不可用、在线未复验”事实已被本轮在线复验替换。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 snake_case；Alembic revision 文件沿用时间戳命名；Markdown 文件使用小写连字符。
- **文件组织**: 迁移逻辑位于 `apps/api/alembic/versions/`；API 测试位于 `apps/api/tests/`；运维事实源位于 `docs/operations/` 和根级活文档。
- **导入顺序**: Python 文件保持标准库、第三方、项目内导入分组，遵循 Ruff 现有规则。
- **代码风格**: pytest plain assert；文档、日志和报告全部使用简体中文。

### 3. 可复用组件清单

- `apps/api/tests/test_alembic_heads.py`: Alembic 单 head、离线 SQL 和在线表存在性回归测试入口。
- `apps/api/tests/test_phase9_fact_sources.py`: Phase 9 活文档事实源守卫。
- `docs/operations/alembic-validation.md`: Alembic 验证手册与在线迁移证据事实源。
- `docker-compose.yml`: 本地 PostgreSQL 服务定义；当前复用既有 `storyforge-postgres` 容器，端口 `55432->5432`。

### 4. 测试策略

- **测试框架**: pytest、Ruff、Python `py_compile`、Git diff 空白检查。
- **测试模式**: 先用回归测试证明在线模式必须真实 inspect 表存在性，再修复迁移 helper，随后执行事实源测试和静态检查。
- **参考文件**: `apps/api/tests/test_alembic_heads.py`、`apps/api/tests/test_phase9_fact_sources.py`。
- **覆盖要求**: 覆盖 Alembic 在线空库反射、离线 SQL 输出、文档事实同步、Ruff、编译和尾随空白。

### 5. 依赖和集成点

- **外部依赖**: Docker Desktop、Docker Compose、PostgreSQL、Alembic、SQLAlchemy、pytest、Ruff。
- **内部依赖**: `20260528_0001_backfill_current_orm_schema.py` 与 Phase2 分支表集合、`20260604_0001` merge revision。
- **集成方式**: 本地 Docker PostgreSQL 临时库 `storyforge_phase9_online_verify` 执行 `uv run alembic upgrade head` 和 `uv run alembic current --check-heads`。
- **配置来源**: 进程级 `DATABASE_URL`，本轮未读取 `.env`，未写入 provider 敏感信息。

### 6. 技术选型理由

- **为什么用这个方案**: 在线迁移失败来自 SQLAlchemy inspect 与 Alembic helper 行为差异，必须修复 helper 并用真实 PostgreSQL 复验。
- **优势**: 保留离线 SQL 兼容，同时让在线模式只信任数据库真实表状态，避免空库迁移跳过建表。
- **劣势和风险**: 复用旧容器可能保留外部项目标签；本轮通过临时库隔离并最终删除临时库降低风险。

### 7. 关键风险点

- **并发问题**: 旧项目同名容器冲突，未删除旧容器，改为复用已存在 `storyforge-postgres`。
- **边界条件**: 离线 SQL 生成需要把 Phase2 分支表视作已存在，在线空库不能这么处理。
- **性能瓶颈**: 在线迁移只在临时库执行，未引入额外长耗时测试入口。
- **安全考虑**: 未读取 `.env`，未输出或落盘 provider token，不提交、不推送、不触发远端 E2E。

### 8. 充分性检查

- 能定义接口契约：是。`_table_exists(bind, table_name)` 在线模式返回真实 inspect 结果，离线模式仅对 Phase2 分支表做兼容。
- 理解技术选型：是。离线 SQL 和在线 PostgreSQL 反射语义不同，必须分支处理。
- 识别主要风险：是。容器冲突、临时库清理、远端 E2E 仍失败、真实长程未完成。
- 知道如何验证：是。已执行 pytest、ruff、py_compile、在线迁移和 diff 空白检查。
