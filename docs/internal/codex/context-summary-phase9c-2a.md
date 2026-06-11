## 项目上下文摘要（Phase 9C-2a Character Bible 最小表与 CRUD）

生成时间：2026-05-27 12:00:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/assets/`
  - 模式：`models.py` 定义 SQLAlchemy 表，`schemas.py` 定义 Create/Update/Read，`service.py` 处理作品归属和版本写入，`router.py` 转换 HTTP 错误。
  - 可复用：Book 存在性校验、JSON payload 字段、TestClient API 测试风格。
  - 需注意：Assets 是版本化真相源，Character Bible 计划只要求普通 CRUD，不需要版本谱系。
- **实现2**: `apps/api/app/domains/blueprints/`
  - 模式：最小 domain 由 model/schema/service/router 四件套组成，router 挂载到 `app/main.py`。
  - 可复用：`BookBlueprintCreate/Read` 的 JSON 字段别名处理、`BlueprintError` 到 HTTP 响应映射。
  - 需注意：迁移中 JSON 字段使用 `sa.JSON()`，模型字段使用 `mapped_column(JSON, default=dict)`。
- **实现3**: `apps/api/app/domains/story_memory/`
  - 模式：领域服务集中校验归属关系，schema 使用 Pydantic Field 限制长度和范围。
  - 可复用：`InputError`、`NotFoundError`、章节/作品归属校验写法。
  - 需注意：新增模型必须导入到 `app/models.py`，否则测试内存数据库不会建表。

### 2. 项目约定

- **命名约定**: Python 文件和字段使用 snake_case；Pydantic 类使用 PascalCase；测试函数以 `test_` 开头。
- **文件组织**: 新 domain 放在 `apps/api/app/domains/character_bible/`，包含 `models.py`、`schemas.py`、`service.py`、`router.py`。
- **导入顺序**: `from __future__ import annotations` 后标准库、第三方、本地导入，由 ruff 校验。
- **代码风格**: 服务层返回 ORM 对象，router 使用 response_model 输出契约；测试断言 HTTP 状态和 JSON。

### 3. 可复用组件清单

- `Book`: Character Bible 必须绑定已有作品。
- `Asset`: `character_id` 可引用角色资产；若提供则必须是同作品的 `asset_type="character"`。
- `InputError` / `NotFoundError`: 复用为领域错误基类。
- `SessionDependency`: router 统一注入数据库会话。

### 4. 测试策略

- **测试框架**: API 使用 pytest + FastAPI TestClient。
- **红灯测试**: 新建 `apps/api/tests/test_character_bible_api.py`，覆盖 create/list/read/update/delete 与迁移字段。
- **覆盖要求**: 正常 CRUD、缺失 book、错误 character asset 归属或类型、JSON 字段保真。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy 2.0、Pydantic、FastAPI、Alembic。
- **内部依赖**: `Book`、`Asset`、`app.models`、`app.main` router 注册。
- **集成方式**: 新 router 挂载 `/api/character-bible`，schema 暴露 aliases、voice_traits、forbidden_traits。
- **配置来源**: 无新增环境变量。

### 6. 技术选型理由

- **为什么用这个方案**: .dev_plan.md 只要求最小表和 CRUD API，复用现有 domain 四件套最直接且可本地验证。
- **优势**: 范围清晰，后续 9C-2b Judge 可直接查询 Character Bible。
- **劣势和风险**: 当前仅保存硬规则，不主动参与 Judge；9C-2b 才接入一致性评分。

### 7. 关键风险点

- **并发问题**: CRUD 单行事务，当前无批量并发写入。
- **边界条件**: character_id 可空；非空时必须存在且属于同作品角色资产。
- **性能瓶颈**: 按 book_id 列表查询，需索引 `book_id` 和 `character_id`。
- **安全考虑**: 不新增认证路径，沿用全局 API Key/JWT 中间件。
