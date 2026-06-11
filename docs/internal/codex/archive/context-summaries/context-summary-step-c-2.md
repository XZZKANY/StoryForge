## 项目上下文摘要（Step C-2）

生成时间：2026-05-26 00:00:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/db/session.py`
  - 模式：`get_session()` 是 FastAPI dependency 生成器，当前 `yield` 后只在 `finally` 中 `close()`。
  - 可复用：`SessionLocal()`、`get_session()` 生成器结构。
  - 需注意：C-2 只新增异常 rollback，不改 C-1 懒 engine。
- **实现2**: `apps/api/tests/conftest.py`
  - 模式：测试 override 的 `get_session` 也使用 `try/finally close`。
  - 可复用：生成器 dependency 测试思路。
  - 需注意：本步骤验证生产 `get_session()` 即可。
- **实现3**: `apps/api/tests/test_db_session.py`
  - 模式：已有 monkeypatch 测试 `_build_engine_options`、`get_engine`、`SessionLocal`。
  - 可复用：继续在同文件追加 fake session 测试。

### 2. 项目约定

- 测试说明使用中文 docstring。
- 使用 pytest 与 monkeypatch 隔离依赖。
- 生产代码保持简单 try/except/finally，异常重抛。

### 3. 可复用组件清单

- `db_session.get_session()`：被测生成器。
- `db_session.SessionLocal`：可 monkeypatch 为 fake factory。

### 4. 测试策略

- 先新增 `test_get_session_rolls_back_and_closes_on_exception`。
- 通过 `provider.throw(RuntimeError(...))` 模拟路由处理中抛出的异常。
- 断言 `rollback` 与 `close` 都调用，且异常不被吞掉。
- 运行 `python -m pytest tests/test_db_session.py -q` 观察 RED/GREEN。

### 5. 依赖和集成点

- 不触发真实数据库。
- 不修改 FastAPI 路由或后台任务。

### 6. 风险点

- 如果吞掉异常会破坏 HTTP 错误处理，测试需断言重抛。
- 正常路径不应 rollback，当前计划只覆盖异常路径。
