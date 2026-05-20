## 项目上下文摘要（StoryForge 后端重构计划）

生成时间：2026-05-20

### 1. 相似实现分析

- **实现1**: `app/domains/assets/router.py`
  - 模式：路由层局部声明 `SessionDependency = Annotated[Session, Depends(get_session)]`
  - 可复用：`app.db.deps.SessionDependency`
  - 需注意：文件中同时使用 `Annotated` 做 `Query` 参数，迁移时不能删掉 `Annotated` 导入
- **实现2**: `app/domains/analytics/service.py`
  - 模式：服务层内联 `_safe_ratio`
  - 可复用：`app.common.math.safe_ratio`
  - 需注意：返回值需要四舍五入到 4 位，分母为 0 时返回 0.0
- **实现3**: `app/domains/quality/service.py`
  - 模式：服务层内联 `_safe_ratio` 与系列记忆最新版本查询
  - 可复用：`app.common.math.safe_ratio`、`app.db.queries.latest_by_lineage`
  - 需注意：系列记忆查询只统计 active 状态
- **实现4**: `app/domains/prompt_packs/service.py`
  - 模式：作用域校验 + latest lineage 查询
  - 可复用：`app.common.scope.validate_scope`、`app.db.queries.latest_by_lineage`
  - 需注意：错误消息必须保持中文业务语义

### 2. 项目约定

- **命名约定**: 领域服务使用 `snake_case` 函数名，异常类使用 `PascalCase`，路由统一命名为 `*_endpoint`
- **文件组织**: 领域代码放在 `app/domains/<domain>/` 下；公共工具优先放在 `app/common/` 或 `app/db/`
- **导入顺序**: 标准库、第三方库、项目内导入分层排列
- **代码风格**: 保持简洁直接，注释使用简体中文，避免多余抽象

### 3. 可复用组件清单

- `app/db/deps.py:SessionDependency`：统一数据库会话依赖
- `app/db/base.py`：ORM 基类与混入
- `app/models.py`：统一模型注册入口
- `app/domains/analytics/service.py`：`_safe_ratio` 的抽取来源
- `app/domains/prompt_packs/service.py`：作用域校验和谱系查询的抽取来源

### 4. 测试策略

- **测试框架**: `pytest`
- **测试模式**: FastAPI `TestClient` + SQLite 内存库 + `StaticPool`
- **参考文件**: `tests/test_assets_api.py`、`tests/test_evaluations.py`、`tests/test_prompt_packs.py`、`tests/test_retrieval_index.py`
- **覆盖要求**: 正常流程 + 边界条件 + 错误响应格式

### 5. 依赖和集成点

- **外部依赖**: FastAPI、SQLAlchemy、pytest
- **内部依赖**: `app.db.session.get_session`、各领域 models/service/router、`app.models`
- **集成方式**: 路由通过依赖注入获取 Session；服务层直接使用 ORM `Session`
- **配置来源**: `alembic/env.py`、`app/main.py`、测试文件中的 fixture

### 6. 技术选型理由

- **为什么用这个方案**: 这些逻辑在仓库中已经重复出现多次，适合抽成小型公共工具而不改动外部接口
- **优势**: 降低重复代码，减少路由和服务层噪音，便于后续统一维护
- **劣势和风险**: 模型注册副作用清理对导入链敏感，必须逐步验证

### 7. 关键风险点

- **并发问题**: 当前改动主要是编译期与导入期重构，并发风险低
- **边界条件**: 分母为 0、空作用域、缺失实体、谱系最新版本查询为空
- **性能瓶颈**: 大部分改动是静态抽取，不新增复杂查询；`latest_by_lineage` 只是封装现有 SQL
- **安全考虑**: 本次任务不涉及安全策略变更，重点是保持现有行为稳定