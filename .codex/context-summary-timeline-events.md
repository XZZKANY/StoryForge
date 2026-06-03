## 项目上下文摘要（TimelineEvent 持久化/API 闭环）

生成时间：2026-06-02 18:30:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/assets/{models,schemas,service,router}.py`
  - 模式：SQLAlchemy 2.0 ORM 模型 + Pydantic v2 请求/响应契约 + service 负责引用校验和事务提交 + router 负责 HTTP 状态转换。
  - 可复用：`SessionDependency`、`InputError/NotFoundError` 派生错误、`select(...).order_by(...)` 列表查询。
  - 需注意：创建接口在 service 层校验 `Book` 与 `Scene` 归属，避免依赖外键异常。
- **实现2**: `apps/api/app/domains/prompt_packs/{models,schemas,service,router}.py`
  - 模式：领域目录内拆分模型、schema、service、router；列表函数返回 `Sequence`，router 可直接返回 ORM 对象由 Pydantic `from_attributes` 转换。
  - 可复用：创建后 `session.add/commit/refresh`，列表查询按主键稳定排序。
  - 需注意：请求 schema 用 `Field` 和 `model_validator` 在入库前约束业务输入。
- **实现3**: `apps/api/app/domains/model_runs/{models,schemas,service,router}.py`
  - 模式：多外键可选引用、JSON payload、create/list API、分页查询构造函数。
  - 可复用：JSON 字段声明、`build_*_list_query` 与 service/list 分层。
  - 需注意：引用对象存在性和作用域一致性由 service 统一校验。
- **测试参考**: `apps/api/tests/test_assets_api.py`、`apps/api/tests/test_prompt_packs.py`、`apps/api/tests/test_story_memory_persistence.py`
  - 模式：用 `session_factory` 构造 Book/Chapter/Scene 前置数据，用 `TestClient` 调 API，断言状态码、响应契约和数据库持久化事实。

### 2. 项目约定

- **命名约定**: Python 文件 snake_case；领域模型类 PascalCase；接口函数使用 `create_*_endpoint`、`list_*_endpoint`；服务函数使用 `create_*`、`list_*`。
- **文件组织**: 每个 API 领域位于 `apps/api/app/domains/<domain>/`，包含 `models.py`、`schemas.py`、`service.py`、`router.py`。
- **导入顺序**: `from __future__ import annotations` 后标准库、第三方库、项目内模块；遵循 ruff import 排序。
- **代码风格**: 120 列，Pydantic v2，SQLAlchemy 2.0 `Mapped/mapped_column`，中文注释描述意图。

### 3. 可复用组件清单

- `apps/api/app/db/deps.py`: `SessionDependency`，API 路由注入数据库会话。
- `apps/api/app/db/base.py`: `Base`、`IdMixin`、`TimestampMixin`，统一模型元数据和审计字段。
- `apps/api/app/common/exceptions.py`: `InputError`、`NotFoundError`，服务层领域错误基类。
- `apps/api/app/domains/books/models.py`: `Book`、`Chapter`，TimelineEvent 的作品/章节引用校验依据。
- `apps/api/app/main.py`: 全局认证、限流、请求超时、安全响应头 middleware；新增 router 必须挂载到该 app 才受安全基线保护。

### 4. 测试策略

- **测试框架**: pytest + FastAPI TestClient。
- **测试模式**: 定向 API 测试先红后绿；内存 SQLite 通过 `Base.metadata.create_all` 创建当前 ORM 表。
- **参考文件**: `apps/api/tests/conftest.py`、`apps/api/tests/test_assets_api.py`、`apps/api/tests/test_alembic_schema_current_orm.py`。
- **覆盖要求**: create 返回完整字段并入库；list 按作品过滤并按 `time_order` 稳定排序；错误路径覆盖章节不属于作品；迁移/模型注册导入检查。

### 5. 依赖和集成点

- **外部依赖**: FastAPI、Pydantic v2、SQLAlchemy 2.0、Alembic。
- **内部依赖**: `Book`、`Chapter`；`app.models` 必须注册新增模型，测试与 Alembic metadata 才能发现表。
- **集成方式**: 新增 `app.domains.timeline` 领域目录；`app.main` include router；`app.models` 导入并导出 `TimelineEventRecord`。
- **配置来源**: API 安全基线来自 `app.main` 的 middleware 与 `STORYFORGE_API_KEY`。

### 6. 技术选型理由

- **为什么用这个方案**: 项目已有稳定领域分层，新增 timeline 领域可避免继续扩大 `story_memory`，也符合 worker 写集边界。
- **优势**: create/list 最小闭环清晰；保持认证、限流、数据库会话、测试 fixture 与既有 API 一致。
- **劣势和风险**: 需要触碰当前已被其他 worker 修改的 `app/main.py` 和 `app/models.py`，必须只追加 timeline 导入/注册，避免覆盖他人改动。

### 7. 关键风险点

- **并发问题**: create/list 无共享缓存，事务粒度为单次请求；暂无额外并发风险。
- **边界条件**: `chapter_id` 必须属于 `book_id`；`project_id`、`volume_id` 当前无对应 ORM 真表，只作为整数作用域字段持久化。
- **性能瓶颈**: 列表按 `book_id/project_id/volume_id/chapter_id` 可选过滤，需在模型和迁移中建索引。
- **安全考虑**: 只通过 `main.py` 注册 router，不新增认证例外，不修改公共路径。
