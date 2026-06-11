## 项目上下文摘要（Phase 6 Studio Scene Packet 真实联动）

生成时间：2026-05-19 18:10:00 +08:00

### 1. 相似实现分析

- `apps/api/app/domains/studio/router.py`：Studio API 使用 `APIRouter(prefix="/api/studio")`、`Annotated + Query` 和 `response_model` 暴露页面读取端点。
- `apps/api/app/domains/studio/service.py`：作品列表与章节目标均通过 SQLAlchemy `select()` 读取现有真相源，并返回 Pydantic schema。
- `apps/api/tests/test_studio_book_list_api.py`：使用 SQLite 内存库、`TestClient` 和 `get_session` override 做 Studio 单点 API 验证。
- `apps/api/app/domains/scene_packets/router.py`：已有 `POST /api/scene-packets` 负责组装和持久化 Scene Packet，本轮不得重做生成逻辑。
- `apps/api/tests/test_scene_packet.py` 与 `test_scene_packet_context_compiler.py`：证明 `ScenePacket` 使用 `int` 主键、`scene_id:int`、`packet:dict` 和预算/证据字段。

### 2. 项目约定

- 后端按 `schemas.py`、`service.py`、`router.py` 分层；路由负责 HTTP 参数和错误转换，服务负责查询。
- SQLAlchemy 模型事实：`Book.id`、`Chapter.id`、`Scene.id`、`ScenePacket.id`、`ScenePacket.scene_id` 均为 `int`。
- Web Studio 延续页面级 `fetch(new URL(...), { cache: "no-store" })`，不新增全量 API client。
- 测试先红灯再实现；使用 `uv run pytest` 和 `pnpm --filter @storyforge/web test` 本地验证。

### 3. 可复用组件清单

- `ScenePacket`：现有持久化模型，字段包含 `id:int`、`scene_id:int`、`status`、`packet`、`version`。
- `Scene` 与 `Chapter`：用于从 `book_id`、`target_ordinal` 定位章节下的场景和 Scene Packet。
- `StudioChapterGoalRead` 与 `read_studio_chapter_goal()`：复用 Studio 页面读取链路，Scene Packet 读取可跟随同一输入。
- `phase6DataSources.studio`：Scene Packet API 的状态和边界事实源。

### 4. 测试策略

- 第1轮：在 `apps/api/tests/test_studio_book_list_api.py` 增加 `/api/studio/scene-packets` 红灯测试，证明当前 Studio 尚无 Scene Packet 读取端点。
- 第2轮：实现最小读取后，运行 `uv run pytest tests/test_studio_book_list_api.py -q`、Web 契约测试和 TypeScript。
- 第3轮：补无 Scene Packet 的 404 或空态测试，并同步 registry、文档、TODO 和 current-phase。

### 5. 依赖和集成点

- 后端只读现有 `scene_packets` 表，不新增迁移，不调用真实 LLM，不创建新的 Scene Packet。
- Web 只在 Studio 页面读取 `/api/studio/scene-packets`，不联通 Judge、Repair、批准回写或失败恢复。
- Docker/PostgreSQL 在线迁移不在本轮范围；本轮使用 SQLite/TestClient 补偿验证。

### 6. 技术选型理由

- 用户固定优先 Scene Packet；TODO 与 current-phase 均要求 Studio 下一步从 Scene Packet 单数据源继续。
- 读取 API 只返回摘要：`scene_packet_id`、`scene_id`、状态、证据数量和预算摘要，避免把完整 prompt 或大上下文复制进页面状态。
- Context7 已查询 FastAPI 官方文档，确认 `Annotated + Query` 与 `response_model` 适合作为本轮查询端点模式。

### 7. 关键风险点

- 不得重写 `POST /api/scene-packets` 的组装逻辑；本轮只做读取。
- 无已组装 Scene Packet 时必须给 Web 可重试错误摘要，不应伪造数据。
- `phase6FirstDataSourceSpike` 仍指向作品列表历史起点，不能把它当作本轮新增全局状态管理。
