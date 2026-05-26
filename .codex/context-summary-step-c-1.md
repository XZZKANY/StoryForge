## 项目上下文摘要（Step C-1）

生成时间：2026-05-26 00:00:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/db/session.py`
  - 模式：当前模块导入时读取 `DATABASE_URL` 并创建 SQLAlchemy engine。
  - 可复用：`_build_engine_options()`、`_get_int_env()`、`_get_bool_env()`、`get_session()`。
  - 需注意：C-1 要移除模块级 engine 创建，不提前实现 C-2 rollback。
- **实现2**: `apps/api/tests/conftest.py`
  - 模式：测试通过 `sessionmaker(bind=engine, ...)` 和 dependency override 隔离数据库。
  - 可复用：`sessionmaker` 配置参数与 `get_session` 生成器协议。
  - 需注意：测试不应连接默认 PostgreSQL。
- **实现3**: `apps/api/app/domains/batch_refinery/service.py`
  - 模式：后台任务直接调用 `SessionLocal()` 创建独立 session。
  - 可复用：保持 `SessionLocal()` 可调用接口。
  - 需注意：不能把 `SessionLocal` 改成不可调用对象或要求额外参数。

### 2. 项目约定

- Python 使用类型注解、中文文档字符串、snake_case 内部 helper。
- SQLAlchemy ORM 使用 `Session` 类型和 `sessionmaker(..., expire_on_commit=False)`。
- 测试使用 pytest、monkeypatch 和中文测试说明。

### 3. 可复用组件清单

- `_build_engine_options(database_url)`：按数据库类型生成 engine 参数。
- `get_session()`：FastAPI dependency 的会话生成器。
- `SessionLocal()`：后台任务和测试 monkeypatch 依赖的会话工厂入口。

### 4. 测试策略

- 先新增测试证明 `get_engine()` 首次调用读取当前 `DATABASE_URL` 并缓存结果。
- 新增测试证明 `SessionLocal()` 返回绑定到懒加载 engine 的 session。
- 运行 `python -m pytest tests/test_db_session.py -q`。
- 尽量运行 `python -m pytest tests/ -q`。

### 5. 依赖和集成点

- 外部依赖：SQLAlchemy `create_engine`、`Engine`、`Session`、`sessionmaker`。
- 内部依赖：`batch_refinery.service` 直接导入 `SessionLocal`。
- Context7 资料：SQLAlchemy 2.0 文档确认 `sessionmaker` 可生成 Session，并可在无 bind 时配置或调用。

### 6. 技术选型理由

- 使用 `@lru_cache(maxsize=1)` 满足计划要求并避免重复创建连接池。
- `SessionLocal()` 保持为无参可调用函数，兼容现有后台任务。

### 7. 关键风险点

- 模块级 `DATABASE_URL` 常量会固化环境变量，应避免在 `get_engine()` 使用它。
- `SessionLocal` 不能在导入时绑定 engine，否则仍会提前创建 engine。
- 全量测试可能暴露既有失败，需记录证据。
