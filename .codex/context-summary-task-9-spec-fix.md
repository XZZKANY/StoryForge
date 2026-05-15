## 项目上下文摘要（Task 9 规格修复）

生成时间：2026-05-13 00:00:00

### 1. 相似实现分析

- `apps/api/tests/test_scene_packet.py`: 使用 `TestClient`、SQLite `StaticPool`、`app.dependency_overrides[get_session]`，直接准备 Book/Chapter/Scene，并通过 `/api/continuity/chapter-approval` 与 `/api/scene-packets` 验证连续性和上下文包。
- `apps/api/tests/test_judge_repair.py`: 使用同样内存库夹具，通过 `/api/judge/issues` 与 `/api/repair/patches` 验证结构化问题单和定向补丁。
- `apps/api/tests/test_exports.py`: 使用内存库准备已批准章节与场景，通过 `/api/books/{book_id}/exports/markdown` 与 `/api/books/{book_id}/exports/epub` 验证导出。

### 2. 项目约定

- Python 测试使用 pytest 函数、snake_case 命名、中文 docstring。
- FastAPI 测试通过 `TestClient(app)` 发起真实 HTTP 路由调用，通过依赖覆盖隔离数据库。
- 数据库测试使用 `sqlite+pysqlite:///:memory:`、`StaticPool`、`Base.metadata.create_all/drop_all`。

### 3. 可复用组件清单

- `app.main.app`: FastAPI 应用入口。
- `app.db.session.get_session`: 测试中覆盖的数据库依赖。
- `app.db.base.Base`: 测试内存库建表入口。
- `app.domains.books.lineage_service.approve_chapter_writeback`: Phase 1 当前批准回写服务边界。

### 4. 测试策略

- `pnpm e2e` 先执行 Node TS 契约检查，再进入 `apps/api` 执行 `uv run pytest tests/test_phase1_closed_loop_api.py -q`。
- 新 pytest 覆盖资产创建、连续性写入、Scene Packet、Judge、Repair、批准回写、下一章继承、Markdown/EPUB 导出。

### 5. 依赖和集成点

- 外部依赖：FastAPI `TestClient`、pytest、SQLAlchemy、SQLite 内存库。
- 内部集成：assets、continuity、scene_packets、judge、repair、books lineage_service、exports 路由。
- Context7 查询：FastAPI 官方测试文档确认 `TestClient` 与 `app.dependency_overrides` 是推荐测试方式。

### 6. 技术选型理由

- 复用现有 API 测试模式，不新增框架。
- SQLite 内存库隔离状态，适合闭环验收。
- 批准回写目前无 HTTP 路由，因此测试显式调用服务层并在命名与文档说明 Phase 1 服务边界。

### 7. 关键风险点

- Scene Packet 只继承与当前 `chapter_id` 或全局绑定的连续性记录，下一章继承需写入全局约束或使用当前章节记录验证。
- 导出只包含状态为 `approved` 的章节和场景，必须经过回写服务更新状态。
- e2e 脚本需要正确传递退出码，避免 pytest 失败被吞掉。
