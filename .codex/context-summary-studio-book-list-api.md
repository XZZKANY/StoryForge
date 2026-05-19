## 项目上下文摘要（Studio 作品列表 API）

生成时间：2026-05-19 08:35:00 +08:00

### 1. 相似实现分析

- **实现1**：`apps/api/app/domains/workspaces/router.py`
  - 模式：`APIRouter(prefix="/api/workspaces")` + `SessionDependency` + service 调用。
  - 可复用：GET 列表端点 `list_workspaces_endpoint()` 返回 Pydantic read schema 列表。
  - 需注意：路由只做依赖注入和异常转换，查询逻辑放 service。
- **实现2**：`apps/api/app/domains/assets/router.py`
  - 模式：GET 列表端点使用 `Query(gt=0)` 验证 int 查询参数。
  - 可复用：`SessionDependency = Annotated[Session, Depends(get_session)]`、中文 docstring、service 分层。
  - 需注意：作品相关输入 `book_id` 已按 int 处理。
- **实现3**：`apps/api/tests/test_assets_api.py`
  - 模式：每个测试用 SQLite 内存库、覆盖 `get_session`、使用 `TestClient(app)`。
  - 可复用：`session_factory`、`client` fixture、直接插入 `Book` 后调用 HTTP endpoint。
  - 需注意：当前环境已有 TestClient 可用测试样例，但历史报告记录过阻塞风险，必要时可退回 service 层验证。
### 2. 项目约定

- **模型主键**：`app.db.base.IdMixin` 定义 `id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)`。
- **作品模型**：`Book` 继承 `IdMixin`，因此 `books.id` 是 int，不是 UUID。
- **工作区关联**：`Book.workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id", ondelete="SET NULL"), index=True)`。
- **路由分层**：`router.py` 只声明 HTTP 契约，`service.py` 执行查询，`schemas.py` 输出 Pydantic read schema。

### 3. 可复用组件清单

- `Book`：`apps/api/app/domains/books/models.py`，作品根实体，字段包含 `id/title/status/premise/workspace_id`。
- `Workspace`：`apps/api/app/domains/workspaces/models.py`，用于按当前工作区过滤作品。
- `get_session`：`apps/api/app/db/session.py`，FastAPI 数据库依赖。
- `app.main.app.include_router(...)`：API router 注册入口。

### 4. 测试策略

- **测试框架**：pytest + FastAPI `TestClient` + SQLite 内存库。
- **参考文件**：`apps/api/tests/test_assets_api.py`。
- **测试覆盖**：作品列表成功态、空列表态、工作区过滤态；后续失败态可在 Web 层或 service 异常层补充。
### 5. 依赖和集成点

- **API 入口**：需要在 `app.main` 注册最小 studio router，保持模块化单体。
- **内部依赖**：`Book` 查询可左关联或子查询 `Chapter`，计算最近章节编号。
- **Web 边界**：`phase6FirstDataSourceSpike` 仍是 Studio 页面首个数据源；本轮事实定位不实现 Web HTTP client。
- **配置来源**：无新增配置或环境变量。

### 6. 技术选型理由

- 复用已有 FastAPI router/service/schema 分层，避免把 Studio 读取做成前端自定义协议。
- 只新增最小作品列表契约时，可直接服务 Studio 的第一个真实 API spike。
- 使用 int 主键是现有 SQLAlchemy 模型事实，符合总计划第 11 节硬约束。

### 7. 关键风险点

- **范围风险**：不得从作品列表扩展到章节目标、Scene Packet、Judge 或 Repair。
- **类型风险**：不得假设 UUID；`Book.id` 和 `Workspace.id` 均来自 `IdMixin` int。
- **验证风险**：若 TestClient 在当前环境阻塞，应记录并使用 service 层 pytest 或 compileall 作为补偿验证。
