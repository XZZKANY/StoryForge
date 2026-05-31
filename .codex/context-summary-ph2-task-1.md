# 项目上下文摘要（PH2 Task 1：领域模型与迁移）

生成时间：2026-05-14 00:00:00 +08:00

## 1. 相似实现分析

- `apps/api/app/domains/assets/models.py`
  - 模式：使用 `IdMixin`、`TimestampMixin`、`VersionMixin`、`Mapped`、`mapped_column` 和 `relationship` 建模。
  - 可复用：版本化实体统一继承 `VersionMixin`，JSON 业务载荷统一使用 `payload`。
  - 需注意：单独导入领域模型时，要在文件底部预加载关系目标模型。
- `apps/api/app/domains/books/models.py`
  - 模式：`Book -> Chapter -> Scene` 使用 `relationship(back_populates=...)` 表达层级关系。
  - 可复用：PH2 的 `SeriesBook` 应作为 `Series -> Book` 的关联表，不直接把系列字段塞进 `books`。
  - 需注意：新增 `Book` 关系时要同步 `TYPE_CHECKING` 和文件底部领域导入。
- `apps/api/tests/test_domain_schema.py`
  - 模式：直接检查 ORM 元数据、公共列、版本列、外键和独立 mapper 配置。
  - 可复用：PH2 模型测试应先验证表注册和关系链，再进入 API 行为测试。
  - 需注意：测试只检查 schema，不依赖真实 PostgreSQL。

## 2. 项目约定

- Python 模块使用 snake_case，类名使用 PascalCase。
- 模型注释使用简体中文，说明业务意图而不是重复字段。
- 新模型必须注册到 `apps/api/app/models.py`，保证 Alembic 读取完整元数据。
- 迁移文件位于 `apps/api/alembic/versions/`，函数内注释和 docstring 使用简体中文。

## 3. 可复用组件清单

- `app.db.base.Base`
- `app.db.base.IdMixin`
- `app.db.base.TimestampMixin`
- `app.db.base.VersionMixin`
- `Book`、`Asset`、`ContinuityRecord`、`JobRun`

## 4. 测试策略

- 先创建 `apps/api/tests/test_phase2_domain_schema.py`。
- 红灯命令：`uv run pytest tests/test_phase2_domain_schema.py -q`。
- 绿灯命令：同一测试通过后，再运行 `uv run pytest tests/test_domain_schema.py tests/test_phase2_domain_schema.py -q`。
- 编译验证：`python -m compileall apps/api/app apps/api/tests` 或根脚本中的 API 编译命令。

## 5. 依赖和集成点

- `SeriesBook.book` 需要 `Book.series_links`。
- `SeriesMemorySnapshot.book` 需要 `Book.series_memory_snapshots`。
- `StylePackApplication.book` 需要 `Book.style_pack_applications`。
- `StylePackApplication.style_pack_asset` 指向 `Asset`。

## 6. 风险点

- 循环导入：新增 `series` 领域后，`books.models` 底部需要预加载 `series`，但不能在类定义前做运行时导入。
- 迁移命名：计划中固定迁移文件名便于审计，但 Alembic 自动生成会先生成随机前缀，需要重命名或手写迁移。
- SQLite 兼容：测试用 SQLite 内存库，迁移和模型字段不能使用 PostgreSQL 专属类型。
