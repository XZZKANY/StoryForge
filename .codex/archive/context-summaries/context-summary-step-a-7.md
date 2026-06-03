## 项目上下文摘要（Step A-7）

生成时间：2026-05-26 01:08:00

### 1. 相似实现分析

- `apps/api/app/domains/retrieval/service.py:74-83`
  - 模式：使用 SQLAlchemy `select(...)` 构建查询，并按 `RetrievalSource.id` 稳定排序。
  - 可复用：`RetrievalSource` 过滤条件与 `Session` 执行方式。
  - 需注意：普通资料源列表会 `selectinload(chunks)`，workbench 列表不能加载 chunk 大字段。
- `apps/api/app/domains/retrieval/service.py:384-408`（修改前）
  - 模式：通过聚合子查询读取每个 source 的最新 refresh run。
  - 可复用：`func.max(RetrievalRefreshRun.id)` 表示最新运行记录。
  - 需注意：若只返回 max id 会丢失 `status`，因此需要在同一 SELECT 中再关联 `RetrievalRefreshRun`。
- `apps/api/tests/test_retrieval_workbench_api.py:154-223`
  - 模式：使用 SQLAlchemy `before_cursor_execute` 事件统计 SELECT，并捕获 SQL 确认未读取 chunk payload。
  - 可复用：查询次数断言、refresh status 断言、chunk_count 聚合断言。
  - 需注意：测试文件实际名称为 `test_retrieval_workbench_api.py`，不是计划中旧名称。

### 2. 项目约定

- 命名约定：Python 函数使用 `snake_case`，内部 helper 以 `_` 前缀命名。
- 文件组织：retrieval 领域业务逻辑集中在 `app/domains/retrieval/service.py`，测试集中在 `tests/test_retrieval_workbench_api.py`。
- 导入顺序：标准库、第三方库、项目模块分组；本步骤未新增导入。
- 代码风格：SQLAlchemy 查询使用链式构建，返回对象组装复用 schema helper。
### 3. 可复用组件清单

- `_build_workbench_source(...)`：统一组装 `RetrievalWorkbenchSourceRead`，本步骤继续复用。
- `RetrievalSource`：workbench 来源主实体与过滤条件来源。
- `RetrievalChunk`：仅用于子查询统计 `count(id)`，不得加载 `content` 或 `embedding`。
- `RetrievalRefreshRun`：通过最新 id 子查询关联完整运行记录以读取 `status`。

### 4. 测试策略

- 测试框架：pytest。
- 测试模式：服务层集成测试，使用 SQLite 内存数据库与 SQLAlchemy event 统计 SQL。
- 参考文件：`apps/api/tests/test_retrieval_workbench_api.py`、`apps/api/tests/test_retrieval_index.py`。
- 覆盖要求：单次 SELECT、最新刷新状态、chunk_count 聚合、不加载 chunk 大字段、检索索引无回归。
### 5. 依赖和集成点

- 外部依赖：SQLAlchemy 2.0；Context7 查询确认 `select(...).subquery()`、聚合计数与 `Session.execute()` 用法。
- 内部依赖：retrieval models 与 workbench schema helper。
- 集成方式：保持 `list_retrieval_workbench_sources(session, book_id, series_id)` 公开接口不变。
- 配置来源：无新增配置。

### 6. 技术选型理由

- 方案：使用 `chunk_counts` 与 `latest_run_ids` 两个聚合子查询，再由主查询 outer join 到 `RetrievalSource`。
- 优势：单次数据库往返，避免 chunk/run 双联接造成计数倍增，保留完整 latest run status。
- 劣势和风险：查询结构比三次独立查询更复杂，需要测试约束防止回归。

### 7. 关键风险点

- 并发问题：本步骤只读查询，无状态写入。
- 边界条件：无 chunk 的资料源应返回 `0`；无刷新记录应返回 `not_refreshed`。
- 性能瓶颈：不得加载 `RetrievalChunk.content` 或 `embedding`。
- 安全考虑：未新增认证、鉴权或外部输入路径。
