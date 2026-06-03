## 项目上下文摘要（Assistant 章节审阅主动创建）

生成时间：2026-06-03 00:02:17 +08:00

### 1. 相似实现分析

- `apps/api/app/domains/studio/service.py`: 既有 Studio 只读摘要通过 `ScenePacket -> Scene -> Chapter` join 定位章节事实，新增主动审阅沿用同一查询链路。
- `apps/api/app/domains/judge/service.py`: `create_judge_issues()` 已接收 `scene_id`、`scene_packet_id`、正文、必含事实、风格规则和证据链接，新增端点只负责组装请求。
- `apps/api/app/domains/repair/service.py`: `create_repair_patch()` 已按 JudgeIssue span 生成局部补丁，新增端点只对可安全匹配的 issue 调用它。
- `apps/web/components/home/assistant-chapter-review-actions.ts`: 原链路只读三个 Studio GET；本次改为主动 POST 聚合端点，并保留 redirect 与 AssistantSession 契约。

### 2. 项目约定

- 后端使用 FastAPI router + service + schema 分层，异常在路由层转换为 HTTP 404/400。
- Studio 层只做业务能力编排，不复制 Judge/Repair 领域逻辑。
- 前端 Server Action 使用 `apiFetch`、`unknown` 解析和短 URL 摘要，不能把章节正文或补丁全文放入 URL。
- 所有说明、错误和留痕使用简体中文。

### 3. 可复用组件清单

- `JudgeIssueCreate` 与 `create_judge_issues`: 创建结构化评审问题。
- `RepairPatchCreate` 与 `create_repair_patch`: 创建定向修复补丁。
- `_studio_judge_issue` 与 `_studio_repair_patch`: 复用 Studio 摘要投影。
- `read_studio_approval_summary`: 复用批准资格摘要。
- `submitAssistantChapterReview`: 复用既有会话写入、revalidate 和 redirect 结果 URL。

### 4. 测试策略

- API 测试新增在 `apps/api/tests/test_studio_book_list_api.py`，覆盖主动创建 Judge/Repair、clean 空态和空正文错误。
- Web 测试更新在 `apps/web/tests/assistant-chapter-review-actions.test.ts`，覆盖一次 POST、摘要压缩、会话写入、缺少 Scene Packet 和失败回流。
- Redis 缓存全量测试失败已通过 `apps/api/tests/test_redis_cache_strategy.py` 补回归，确保不完整 Redis 客户端按缓存不可用降级。

### 5. 依赖和集成点

- 新端点：`POST /api/studio/chapter-review`。
- 请求：`{ "scene_packet_id": number }`。
- 响应：`scene_packet_id`、`judge_review`、`repair_patches`、`approval_summary`。
- OpenAPI 与 shared types 已通过 `pnpm openapi` 和 `pnpm --filter @storyforge/shared generate:types` 同步。

### 6. 技术选型理由

- 选择后端薄端点，是因为前端只有 `scene_packet_id`，无法安全获得 `scene_id`、正文和 packet 约束。
- 不保留旧 GET fallback，是为了避免只读旧路径掩盖“主动创建 Judge/Repair”的真实闭环。
- clean 空态直接构造 `status=clean`、`score=100`，避免旧只读函数在无 issue 时返回 404。

### 7. 关键风险点

- 自然语言“审阅第二章”到具体 `scene_packet_id` 的解析仍未完成。
- 真实外部 LLM 10 章或 3-5 万字短篇仍未完成验收，不能宣称长程稳定生产。
- 浏览器级连续会话点击测试仍未补齐；当前证据主要来自 Server Action 与 API 单元/契约测试。
