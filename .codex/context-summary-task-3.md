# 项目上下文摘要（Task 3：资产中心 API）

生成时间：2026-05-12 22:05:00 +08:00

## 1. 相似实现分析

- **实现1：Task 2 领域模型**：`apps/api/app/domains/assets/models.py`
  - 模式：`Asset` 是资产真相源，包含 `book_id`、`scene_id`、`asset_type`、`name`、`status`、`payload`、`version`。
  - 可复用：服务层应基于 `Asset` 实体实现创建、查询和版本更新。
  - 需注意：更新资产不能覆盖历史，必须新建更高版本记录。
- **实现2：Task 2 数据库基础设施**：`apps/api/app/db/base.py` 与 `apps/api/alembic/env.py`
  - 模式：所有 ORM 模型共享 `Base.metadata`，Alembic 使用 PostgreSQL 作为最终验证数据库。
  - 可复用：Task 3 需要新增会话依赖和 FastAPI 应用入口，但不得破坏迁移结构。
  - 需注意：本地 PostgreSQL 端口为 `55432`。
- **实现3：计划 Task 3**：`docs/superpowers/plans/2026-05-12-storyforge-phase1-engineering-plan.md:209-265`
  - 模式：先写失败测试，再实现 `/api/assets` APIRouter，再生成 OpenAPI 契约。
  - 可复用：测试覆盖清单和提交范围。
  - 需注意：响应体必须使用 Pydantic schema。

## 2. 项目约定

- Python 文件和包名使用 `snake_case`；Pydantic schema 和 SQLAlchemy 模型类使用 `PascalCase`。
- API 层放在 `apps/api/app/domains/assets/`，应用入口为 `apps/api/app/main.py`。
- 测试位于 `apps/api/tests/`，使用 `uv run pytest ... -q` 执行。
- 文档、注释、测试说明和提交信息使用简体中文。

## 3. 可复用组件清单

- `apps/api/app/domains/assets/models.py`：资产 ORM 模型。
- `apps/api/app/domains/books/models.py`：`Book` 是资产 API 的归属根实体。
- `apps/api/tests/test_domain_schema.py`：pytest 风格与模型导入约定。
- `apps/api/alembic/env.py`：PostgreSQL 连接默认值与 metadata 聚合方式。

## 4. 官方文档依据

- FastAPI Context7：`APIRouter` 与 `response_model` 用于路由响应校验和 OpenAPI 文档生成。
- Pydantic Context7：Pydantic v2 使用 `ConfigDict(from_attributes=True)` 支持从 ORM 对象读取属性。

## 5. 测试策略

- 先写 `tests/test_assets_api.py`，验证 `/api/assets` 路由不存在时失败。
- 使用 FastAPI `TestClient` 覆盖：创建角色资产、创建地点资产、创建风格规则、查询作品资产列表、更新资产版本、读取资产变更历史。
- 使用测试数据库会话隔离 API 数据，避免依赖生产数据。
- 验证 OpenAPI 生成到 `packages/shared/src/contracts/storyforge.openapi.json`。

## 6. 依赖和集成点

- 需要新增 `apps/api/app/main.py` 提供 FastAPI 应用。
- 需要新增数据库会话依赖，供 router/service 复用。
- 需要新增 `scripts/generate-openapi.ps1` 或等价脚本以满足计划命令。
- 需要更新根 `package.json` 的 `openapi` 脚本，使其调用真实 OpenAPI 生成逻辑。

## 7. 风险点

- 更新资产必须新建记录而非覆盖历史，否则违反版本谱系要求。
- 测试若直接依赖全局 PostgreSQL 状态，可能污染后续任务；应在测试中创建并清理数据。
- OpenAPI 文件生成要稳定排序，避免非确定性差异。
