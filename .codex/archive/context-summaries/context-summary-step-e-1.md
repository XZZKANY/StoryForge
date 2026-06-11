## 项目上下文摘要（E-1 连接池耗尽测试）

生成时间：2026-05-26 02:45:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_db_session.py`
  - 模式：使用 pytest、中文 docstring、直接调用 `app.db.session` 内部 helper 验证数据库 session 行为。
  - 可复用：沿用同文件测试命名、monkeypatch/tmp_path 风格和显式资源清理。
  - 需注意：测试文件目前没有真实 QueuePool 耗尽覆盖。
- **实现2**: `apps/api/app/db/session.py`
  - 模式：`_build_engine_options()` 为非 SQLite URL 返回 pool_size/max_overflow/pool_timeout/pool_recycle，SQLite 跳过生产池参数。
  - 可复用：E-1 不需要修改生产 helper，只验证 SQLAlchemy QueuePool 的 timeout 行为。
  - 需注意：SQLite 默认池不适合测试 QueuePool，需要显式 `poolclass=QueuePool`。
- **实现3**: `.dev_plan.md` E-1
  - 模式：要求测试创建 pool_size=2、max_overflow=0、pool_timeout=1 的 engine，持有 2 个连接后第三次连接抛 TimeoutError。
  - 可复用：验证命令固定为 `cd apps/api && python -m pytest tests/test_db_session.py -q`。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_*` snake_case。
- **文件组织**: 数据库 session 单元测试集中在 `apps/api/tests/test_db_session.py`。
- **导入顺序**: 标准库、第三方库、项目内模块。
- **代码风格**: 中文 docstring，显式 finally 清理资源。

### 3. 可复用组件清单

- `pytest.raises`: 断言 TimeoutError。
- `sqlalchemy.create_engine`: 构造测试 engine。
- `sqlalchemy.pool.QueuePool`: 强制使用队列池触发 pool_timeout。
- `time.perf_counter`: 验证等待时间在合理范围内。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 单元测试真实 SQLAlchemy QueuePool 行为，不连接外部 PostgreSQL。
- **参考文件**: `apps/api/tests/test_db_session.py`。
- **覆盖要求**: 正常持有两条连接 + 第三条连接池耗尽错误 + 资源释放。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy 已在 `apps/api/pyproject.toml`。
- **内部依赖**: 无生产代码依赖变更。
- **集成方式**: 增加测试用例；验证命令仍是原计划命令。
- **配置来源**: 测试内显式 pool 参数。

### 6. 技术选型理由

- **为什么用这个方案**: 文件 SQLite + QueuePool 可本地复现连接池耗尽，不依赖外部数据库。
- **优势**: 快速、可重复、能直接证明 `pool_timeout` 行为。
- **劣势和风险**: `pool_timeout=1` 会让测试耗时约 1 秒；用 `<2.0s` 阈值抵御系统调度抖动。

### 7. 关键风险点

- **并发问题**: 测试故意持有连接模拟并发耗尽。
- **边界条件**: 必须在 finally 中关闭全部连接并 dispose engine。
- **性能瓶颈**: 单测增加约 1 秒运行时间，可接受。
- **安全考虑**: 仅创建本地临时 SQLite 文件，不访问外部服务。
