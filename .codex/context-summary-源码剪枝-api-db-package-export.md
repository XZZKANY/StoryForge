## 项目上下文摘要（源码剪枝 api-db-package-export）

生成时间：2026-06-05 13:32:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/db/__init__.py`
  - 模式：当前从 `app.db.base` 重新导出 ORM 基类和公共混入，并维护 `__all__`。
  - 可复用：无；该入口属于重复公共出口。
  - 需注意：仓库存在 `from app.db import session as db_session`，本批不能禁止 app.db 包级 session 子模块语义。
- **实现2**: `apps/api/app/db/base.py`
  - 模式：集中定义 SQLAlchemy `DeclarativeBase` 和公共 ORM 混入。
  - 可复用：所有模型、迁移和元数据测试应继续显式从该模块导入。
  - 需注意：本批不修改 ORM 基类、混入字段、metadata 或 registry。
- **实现3**: `apps/api/app/db/session.py`
  - 模式：集中定义懒加载 engine、SessionLocal 和请求会话 provider。
  - 可复用：保留 `from app.db import session as db_session` 子模块语义。
  - 需注意：本批不修改连接池、环境变量、事务回滚或关闭逻辑。
- **实现4**: `apps/api/tests/test_db_session.py`
  - 模式：通过 `from app.db import session as db_session` 验证数据库会话子模块行为。
  - 可复用：作为本批保留 session 子模块语义的关键证据。
  - 需注意：不能把 session 子模块语义误判为具体符号转导出。
- **实现5**: `apps/api/tests/test_source_pruning.py`
  - 模式：API 剪枝防回归测试，已有多个包级重复模型或服务函数出口护栏。
  - 可复用：新增 app.db ORM 符号转导出护栏。
  - 需注意：护栏只禁止具体 ORM 符号和转导出 import，不禁止 session 子模块。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_` 前缀，docstring 使用简体中文。
- **文件组织**: ORM 基类和混入事实源位于 `app/db/base.py`；数据库会话事实源位于 `app/db/session.py`；包级初始化文件不承担重复具体符号公共出口。
- **导入顺序**: 标准库导入在前，第三方和项目内导入按现有 ruff 规则整理；本批不新增业务导入。
- **代码风格**: ruff 目标 Python 3.11，行宽 120；source-pruning 护栏使用朴素字符串检查。

### 3. 可复用组件清单

- `apps/api/app/db/base.py`: ORM 基类和公共混入事实源。
- `apps/api/app/db/session.py`: 数据库会话事实源。
- `apps/api/tests/test_db_session.py`: 数据库会话和 session 子模块包语义验证。
- `apps/api/tests/test_domain_schema.py`: 领域模型和 ORM metadata 验证。
- `apps/api/tests/test_alembic_schema_current_orm.py`: 迁移与当前 ORM 元数据一致性验证。
- `apps/api/tests/test_source_pruning.py`: 本批剪枝护栏。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 先扩展 source-pruning 红灯测试，再移除包级具体 ORM 符号转导出。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_db_session.py`、`tests/test_domain_schema.py`、`tests/test_alembic_schema_current_orm.py`。
- **覆盖要求**: `app/db/__init__.py` 不再转导出具体 ORM 符号；ORM 元数据、迁移测试和数据库会话主链路不变；session 子模块包语义不被禁止。

### 5. 依赖和集成点

- **外部依赖**: pytest、ruff、SQLAlchemy、Alembic。
- **内部依赖**: 模型、迁移和测试直接导入 `app.db.base`；数据库会话测试合法使用 `from app.db import session` 子模块。
- **集成方式**: 移除重复包级具体符号出口，不修改 ORM 事实源、数据库会话、domain models、`app/models.py`、alembic、路由或安全中间件。
- **配置来源**: `apps/api/pyproject.toml` 指定 pytest 和 ruff 规则。

### 6. 技术选型理由

- **为什么用这个方案**: 当前仓库无具体 ORM 符号包级调用，包级转导出只增加重复入口；SQLAlchemy 官方文档说明 DeclarativeBase 关联 metadata 和 registry，项目已将该事实源集中在 `app.db.base`。
- **优势**: `app.db.base` 成为唯一具体 ORM 符号入口，降低维护面，同时不干扰现存 session 子模块包语义。
- **劣势和风险**: 外部未记录包级具体符号导入会失效；当前仓库内无此调用。

### 7. 关键风险点

- **并发问题**: 不修改数据库会话、连接池或事务处理。
- **边界条件**: 不删除或修改 `app/db/base.py`、`app/db/session.py`、domain models、`app/models.py`、alembic、路由或安全中间件。
- **性能瓶颈**: 无性能影响。
- **安全考虑**: 不修改认证、鉴权、限流、请求超时、安全响应头或审计逻辑。
