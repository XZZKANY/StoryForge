## 项目上下文摘要（Phase 6 Studio 章节目标真实联动）

生成时间：2026-05-19 16:55:00 +08:00

### 1. 相似实现分析

- `apps/api/app/domains/studio/router.py`：Studio API 使用 `APIRouter(prefix="/api/studio")`、`Annotated[int | None, Query(gt=0)]` 和 `response_model` 暴露最小读取端点。
- `apps/api/app/domains/studio/service.py`：服务层用 SQLAlchemy `select()` 聚合章节编号，返回 Pydantic schema，不把 ORM 延迟关系暴露给页面。
- `apps/api/tests/test_studio_book_list_api.py`：API 测试用 SQLite 内存库、`app.dependency_overrides[get_session]` 和 `TestClient` 做可重复本地验证。
- `apps/web/app/studio/page.tsx`：Web Studio 只做页面级单点 `fetch(new URL(...), { cache: "no-store" })`，失败时展示可重试错误摘要，不新增全量 client。
- `apps/api/app/domains/continuity/service.py`：章节批准后将 `previous_chapter_summary` 与 `next_chapter_constraints` 写入 `ContinuityRecord.payload`，可作为章节目标的数据事实源。

### 2. 项目约定

- Python 后端按 `schemas.py`、`service.py`、`router.py` 分层；路由只处理依赖注入、查询参数和 HTTP 错误转换。
- 主键和外键均以 SQLAlchemy 模型为准：`Book.id`、`Chapter.id`、`ContinuityRecord.book_id`、`ContinuityRecord.scene_id` 都是 `int`。
- 前端页面使用 async Server Component 做单点读取；当前禁止引入全量 API client、缓存平台或大型状态管理。
- 所有文档、注释和测试描述使用简体中文；代码标识符沿用英文。
### 3. 可复用组件清单

- `StudioBookListItem`、`list_studio_books()`、`list_studio_books_endpoint()`：复用 Studio API 最小端点模式。
- `Chapter`：章节目标、章节编号、标题和摘要的真相源。
- `ContinuityRecord`：上章批准后的摘要与下一章继承约束真相源。
- `phase6DataSources.studio`：章节目标 API 的页面契约来源。

### 4. 测试策略

- 后端优先新增 `apps/api/tests/test_studio_book_list_api.py` 内的 Studio API 测试，沿用 SQLite 内存库和 TestClient fixture。
- 前端继续使用 `apps/web/tests/phase1-navigation.test.tsx` 做中文契约与页面读取边界保护。
- 验证命令优先使用 `uv run pytest`、`uv run python -m compileall`、`pnpm --filter @storyforge/web test` 和 `pnpm --filter @storyforge/web exec tsc --noEmit`。

### 5. 依赖和集成点

- 后端：`app.main` 已 include `studio_router`，新增 `/api/studio/chapter-goals` 不需要新增 router 注册。
- 数据：只读取 `books`、`chapters`、`continuity_records` 现有表，不新增迁移。
- 前端：在 `apps/web/app/studio/page.tsx` 中追加章节目标单点读取状态，不触碰其他页面。

### 6. 技术选型理由

- 选择“章节目标 API”符合 TODO P2、`.codex/current-phase.md` 后续建议和总计划第 11 节 Phase 6 连续化优先级。
- 选择 GET 查询端点而不是新执行流，是因为本轮只做真实读取联动，避免进入 Scene Packet 生成、Judge 或 Repair 执行链。
- 使用现有 SQLAlchemy 模型读取，不凭空新增 UUID 或新表。

### 7. 关键风险点

- 目标章节不存在时必须返回可验证的 404，而不是空对象。
- 连续性约束可能不存在，页面应能展示空约束状态。
- Docker/PostgreSQL 不可用不影响本轮 SQLite 服务层与 TestClient 验证；在线迁移不在本轮范围。
- `github.search_code` 工具在当前会话不可用，已以项目内相似实现和 Context7 FastAPI 官方文档作为替代证据。
