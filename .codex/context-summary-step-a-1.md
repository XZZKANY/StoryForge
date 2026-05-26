## 项目上下文摘要（Step A-1）

生成时间：2026-05-25 23:00:00

### 1. 相似实现分析

- `apps/api/app/db/session.py`: `_get_int_env` 已用于 `pool_size` 与 `max_overflow`，负数和非法整数回落默认值。
- `apps/api/app/db/session.py`: `_get_bool_env` 已用于 `pool_pre_ping`，说明连接池配置集中在 `_build_engine_options()`。
- `apps/api/tests/test_db_session.py`: 使用 `monkeypatch` 清理或覆盖环境变量，并直接断言 `_build_engine_options()` 返回字典。
- `apps/api/tests/conftest.py`: SQLite 测试替身使用 `StaticPool`，说明 `_build_engine_options()` 对 SQLite 返回空字典是现有约束。

### 2. 项目约定

- Python 文件使用 `from __future__ import annotations`。
- 测试函数命名为 `test_具体行为`，中文 docstring 说明意图。
- 配置读取集中封装为私有辅助函数，业务调用只消费构造后的 options 字典。

### 3. 可复用组件清单

- `apps/api/app/db/session.py::_get_int_env`: 读取非负整数环境变量。
- `apps/api/app/db/session.py::_get_bool_env`: 读取布尔环境变量。
- `apps/api/app/db/session.py::_build_engine_options`: 按数据库 URL 构造 SQLAlchemy engine 参数。

### 4. 测试策略

- 测试框架：pytest。
- 参考文件：`apps/api/tests/test_db_session.py`。
- 覆盖策略：默认值、环境变量覆盖、SQLite 兼容分支。

### 5. 依赖和集成点

- 外部依赖：SQLAlchemy `create_engine` 支持 `pool_timeout`、`pool_recycle`、`pool_pre_ping` 等关键字参数。
- 内部依赖：模块级 `engine = create_engine(DATABASE_URL, **_build_engine_options(DATABASE_URL))`。
- 配置来源：`STORYFORGE_DB_POOL_TIMEOUT` 与 `STORYFORGE_DB_POOL_RECYCLE` 环境变量。

### 6. 技术选型理由

- 复用 `_get_int_env` 避免重复解析逻辑。
- 保持 SQLite 返回 `{}`，避免 QueuePool 参数破坏测试替身。
- Context7 SQLAlchemy 文档确认常见连接池调优参数可直接传给 `create_engine()`。

### 7. 关键风险点

- PostgreSQL 分支新增键会使现有精确字典断言失败，需要同步测试预期。
- SQLite 分支不能新增连接池参数。
- 本步骤不触碰后续 lazy engine 或 rollback 改造，避免扩大范围。
