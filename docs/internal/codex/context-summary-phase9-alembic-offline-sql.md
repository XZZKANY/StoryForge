## 项目上下文摘要（Phase9 Alembic 离线 SQL 生成）

生成时间：2026-06-04 05:42:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/alembic/env.py`
  - 模式：使用 Alembic `context.is_offline_mode()` 分流在线/离线迁移。
  - 可复用：离线模式通过 `context.configure(url=..., literal_binds=True)` 生成 SQL。
  - 需注意：迁移脚本本身也需要避免离线时执行数据库 inspection。
- **实现2**: `apps/api/alembic/versions/20260528_0001_backfill_current_orm_schema.py`
  - 模式：历史 backfill migration，为兼容已被本地补表过的开发库，使用 `_table_exists/_column_exists/_index_exists/_fk_exists` 做在线幂等检查。
  - 可复用：在线幂等检查仍应保留。
  - 需注意：离线 `--sql` 下 `op.get_bind()` 是 mock connection，`inspect(op.get_bind())` 会触发 `NoInspectionAvailable`。
- **实现3**: `apps/api/tests/test_alembic_heads.py`
  - 模式：迁移门禁测试，使用 Alembic API 在无数据库环境验证迁移图。
  - 可复用：本轮可在同文件新增离线 SQL smoke，继续聚焦 E2E 迁移门禁。
- **实现4**: `apps/api/tests/test_alembic_schema_current_orm.py`
  - 模式：静态验证 backfill migration 覆盖当前 ORM 关键表和列。
  - 可复用：继续作为相关回归。
- **实现5**: `.github/workflows/e2e.yml`
  - 模式：远端 E2E 在线执行 `uv run alembic upgrade head`。
  - 可复用：本轮离线 SQL 只作为本地无 Docker 时的补偿验证，不能替代远端 E2E。

### 2. 项目约定

- **命名约定**: pytest 测试使用 `test_*`；迁移 helper 使用 snake_case。
- **文件组织**: Alembic 迁移留在 `apps/api/alembic/versions/`，迁移门禁测试放在 `apps/api/tests/test_alembic_heads.py`。
- **导入顺序**: Python 文件由 ruff 管理 import 排序。
- **代码风格**: 注释和 docstring 使用简体中文，测试使用普通 `assert`。

### 3. 可复用组件清单

- `alembic.context.is_offline_mode()`: 官方 offline mode 判断。
- `apps/api/alembic/env.py`: 已使用 offline/online 分流。
- `apps/api/tests/test_alembic_heads.py`: 迁移门禁测试入口。
- `apps/api/alembic/versions/20260528_0001_backfill_current_orm_schema.py`: 需要最小修复的历史迁移。

### 4. 测试策略

- **测试框架**: pytest。
- **红灯测试**: 新增 subprocess 测试运行 `python -m alembic upgrade head --sql`，要求返回 0；当前应失败于 `NoInspectionAvailable`。
- **绿灯测试**: 修复离线 inspection 后，离线 SQL smoke 返回 0，并输出 merge revision 或迁移 SQL。
- **相关回归**: 迁移图单 head、backfill migration 静态测试、ruff、py_compile。

### 5. 依赖和集成点

- **外部依赖**: Alembic runtime context。
- **官方文档结论**: `context.is_offline_mode()` 在 `--sql` 模式返回 true；`--sql` 会生成迁移 SQL 到标准输出。
- **内部依赖**: 只修改历史 backfill migration helper，不影响在线 E2E 的数据库连接方式。
- **配置来源**: 不读取 `.env`；命令使用 `apps/api/alembic.ini` 默认连接串生成 PostgreSQL 方言 SQL。

### 6. 技术选型理由

- **为什么用 offline mode guard**: 这是 Alembic 官方运行态判断，可精准区分无连接 SQL 生成和在线迁移。
- **优势**: 不改变在线幂等保护；让无 Docker 环境也能证明迁移图可解析到 head。
- **劣势和风险**: 离线 SQL 无法根据真实数据库状态跳过已存在对象，不能替代在线 Postgres E2E。

### 7. 关键风险点

- **在线行为回归**: 不能削弱 `_table_exists` 等在线检查，否则可能影响旧开发库幂等迁移。
- **离线 SQL 语义**: 离线模式应生成完整迁移 SQL，不执行 runtime inspection。
- **远端边界**: 远端 E2E 尚未重新运行，不能宣称远端门禁完成。
- **敏感信息**: 不读取 `.env`，不写入 provider 私有端点或凭据。

### 8. 上下文充分性检查

- 能定义接口契约：是，`python -m alembic upgrade head --sql` 必须返回 0。
- 理解技术选型：是，使用 Alembic 官方 `context.is_offline_mode()`。
- 识别主要风险：是，离线 SQL 不是在线 E2E 替代品。
- 知道如何验证：是，红绿 pytest、直接 alembic --sql、迁移测试、ruff、py_compile、敏感扫描。
