## 项目上下文摘要（Phase 6 Studio Judge 评审单数据源）

生成时间：2026-05-19 20:00:00 +08:00

### 1. 相似实现分析

- `apps/api/app/domains/studio/router.py`：已使用 `APIRouter(prefix="/api/studio")`、`Annotated[int, Query(gt=0)]`、`response_model` 和领域异常转 404。
- `apps/api/app/domains/studio/service.py`：作品列表、章节目标、Scene Packet 均通过 SQLAlchemy 查询现有表并返回 Pydantic 摘要，不触发生成流程。
- `apps/api/tests/test_studio_book_list_api.py`：使用 SQLite `StaticPool`、`Base.metadata.create_all()` 和 FastAPI `dependency_overrides` 做完全本地 TestClient 验证。
- `apps/api/app/domains/judge/*`：已有 `JudgeIssue` 持久化模型、`POST /api/judge/issues` 创建评审问题和 `JudgeIssueRead.from_issue()` 展开 payload。
- `apps/web/app/studio/page.tsx`：已按作品列表、章节目标、Scene Packet 顺序做页面级单点 `fetch`，没有全量 API client。

### 2. 项目约定

- API 分层：`schemas.py` 定义响应契约，`service.py` 查询和转换，`router.py` 负责 Query 参数与 HTTP 异常。
- 主键类型：`IdMixin.id` 是 `Integer`，`ScenePacket.id`、`JudgeIssue.id`、`scene_packet_id` 均为 `int`，不得假设 UUID。
- Web 风格：使用 async Server Component、局部类型守卫、`fetch(new URL(endpoint, STORYFORGE_API_BASE_URL), { cache: "no-store" })`。

### 3. 可复用组件清单

- `JudgeIssueRead.from_issue()`：可复用 payload 展开逻辑，避免泄漏 JudgeIssue 内部 JSON 结构。
- `StudioScenePacketRead` 模式：可复用同页面前置数据源摘要读取边界。
- `phase6DataSources.studio`：Judge 状态收口必须同步此 registry，但第1/2轮不提前把状态改为已实现。

### 4. 测试策略

- API：继续在 `apps/api/tests/test_studio_book_list_api.py` 中追加 Studio 数据源定向测试，优先运行 `uv run pytest tests/test_studio_book_list_api.py -q`。
- Web：继续用 `apps/web/tests/phase1-navigation.test.tsx` 的中文契约断言检查端点、状态文案和失败态。
- 类型：运行 `pnpm --filter @storyforge/web exec tsc --noEmit`。

### 5. 依赖和集成点

- Judge 读取依赖 `JudgeIssue.scene_packet_id:int`、`JudgeIssue.payload` 中的 `span_start`、`span_end`、`recommended_repair_mode` 与 `evidence_links`。
- Studio 页面读取顺序应为作品列表 → 章节目标 → Scene Packet → Judge 评审。
- 本轮只读已持久化 JudgeIssue 摘要，不创建 RepairPatch，不触碰 `/api/repair/patches`。

### 6. 风险点

- 若没有 JudgeIssue，应返回 404 供 Web 展示可重试错误摘要，而不是伪造评审结果。
- 评审分数只能作为最小摘要派生值，不能引入复杂评分平台。
- GitHub 开源搜索工具当前不可用；已记录限制并以项目内实现、FastAPI Context7 文档作为主要依据。
