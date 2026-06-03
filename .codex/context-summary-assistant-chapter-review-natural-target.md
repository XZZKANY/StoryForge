## 项目上下文摘要（Assistant 章节审阅自然语言定位）

生成时间：2026-06-03 00:22:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/home/assistant-intent.ts`
  - 模式：确定性正则意图解析，先识别 `taskType`，再派生目标章节数、字数、卷数和交付物。
  - 可复用：`parseCountBeforeUnit()`、`parseCountToken()` 已支持阿拉伯数字和“一二三十”等中文数字。
  - 需注意：`targetChapterCount` 仅用于生成类任务，章节审阅需要独立字段，避免把“写 10 章”误当目标章序。
- **实现2**: `apps/web/components/home/assistant-chapter-review-actions.ts`
  - 模式：Server Action 通过注入式 `apiFetch`、`redirect`、`writeAssistantChapterReviewSession` 完成可测试链路。
  - 可复用：`fetchJson()`、短摘要压缩、AssistantSession 写入、`revalidatePath('/')` 和 redirect URL 契约。
  - 需注意：URL 和会话摘要不能包含章节正文、补丁全文或凭据。
- **实现3**: `apps/web/app/studio/api.ts`
  - 模式：Studio 读取链路用 `book_id + target_ordinal` 调 `/api/studio/scene-packets`，再从 ready 状态读取 `scene_packet_id`。
  - 可复用：后端契约和前端校验思路；本阶段 Server Action 直接调用同一 API，避免引入页面层依赖。
  - 需注意：缺少 `book_id` 时不能请求 API，也不能伪造默认作品。
- **实现4**: `apps/web/components/home/AssistantConversation.tsx` 与 `AssistantActionBar.tsx`
  - 模式：从 URL query 读取真实 ID，传给操作条 hidden 字段；结果再通过 query 状态回写消息流。
  - 可复用：`chapter_review_status=select_chapter/ready/failed` 的可读消息模式。
  - 需注意：自然语言输入要保留 `book_id`，否则只能提示用户选择真实作品。

### 2. 项目约定

- **命名约定**: 前端 TypeScript 使用 camelCase；API query 和 JSON 字段沿用 snake_case，例如 `scene_packet_id`、`target_ordinal`。
- **文件组织**: Assistant 解析在 `components/home`，Studio API 契约在 `app/studio` 和后端 `domains/studio`，测试在 `apps/web/tests`。
- **导入顺序**: React/Next 导入在前，本地 helper 在后，类型按现有文件风格就近导入。
- **代码风格**: Prettier 格式化，Server Action 使用简体中文错误消息，测试使用 `node:test` 和 `assert`。

### 3. 可复用组件清单

- `parseCountToken()`：中文数字和阿拉伯数字解析。
- `submitAssistantChapterReview()`：章节审阅 Server Action 主入口。
- `apiFetch()`：统一 API client，注入本地默认开发 key，不读取 `.env`。
- `/api/studio/scene-packets`：通过 `book_id + target_ordinal` 读取最新 Scene Packet。
- `/api/studio/chapter-review`：通过 `scene_packet_id` 主动创建 Judge/Repair。

### 4. 测试策略

- **测试框架**: `node:test`，通过 `apps/web/scripts/phase1-contract-test.mjs` 执行。
- **测试模式**: 依赖注入 mock `apiFetch`、`redirect`、会话写入；源码契约测试锁定 Home 层参数传递。
- **参考文件**:
  - `apps/web/tests/assistant-intent.test.ts`
  - `apps/web/tests/assistant-chapter-review-actions.test.ts`
  - `apps/web/tests/home-page.test.tsx`
- **覆盖要求**:
  - “审阅第二章/第2章/2章”解析为 `targetChapterOrdinal=2`。
  - 生成类“写 10 章短篇”不产生 `targetChapterOrdinal`。
  - 有 `book_id + target_chapter_ordinal` 时先定位 Scene Packet，再 POST 审阅。
  - 缺 `book_id` 或定位失败时回流可读状态，不写会话、不假装成功。

### 5. 依赖和集成点

- **外部依赖**: Next.js Server Action 的 `redirect` 和 `revalidatePath`；Context7 已查询官方文档，确认 mutation 后可 `revalidatePath` 再 `redirect`。
- **内部依赖**:
  - `HomeComposer` 保留当前 URL 的 `book_id` 等上下文。
  - `AssistantConversation` 解析 intent 并传递 `targetChapterOrdinal`。
  - `AssistantActionBar` 提交 `book_id`、`target_chapter_ordinal`、`scene_packet_id`。
  - `submitAssistantChapterReview` 串联 Scene Packet 定位和章节审阅。
- **配置来源**: `apiFetch()` 使用进程环境或默认本地开发 key；本阶段未读取 `.env`。

### 6. 技术选型理由

- **为什么用这个方案**: 后端已有 `/api/studio/scene-packets` 和 `/api/studio/chapter-review`，前端只需补自然语言章序解析和薄编排，符合“标准化 + 生态复用”。
- **优势**: 不新增后端路由，不改 OpenAPI/shared types，不复制 Judge/Repair 逻辑；失败路径可由现有 Assistant 消息流展示。
- **劣势和风险**: 仍依赖 URL 或最近记录提供真实 `book_id`；没有真实作品上下文时只能提示选择作品。

### 7. 关键风险点

- **并发问题**: 无新增共享状态；Server Action 每次请求只定位一次最新 Scene Packet。
- **边界条件**: 缺 `book_id`、缺章序、Scene Packet 404、API 返回格式错误、Judge/Repair 失败均需可读回流。
- **性能瓶颈**: 缺 `scene_packet_id` 时多一次 GET；只按精确 `book_id + target_ordinal` 查询，不扫描。
- **安全考虑**: 未读取 `.env`；未输出或落盘 API Key；URL 摘要只含短问题摘要和证据引用，不含正文全文。

### 8. 工具与资料来源

- `desktop-commander` 未在当前工具集中暴露，已改用 PowerShell 与 `rg` 做本地只读检索。
- Context7 查询 `/vercel/next.js`：确认 Server Action mutation 后使用 `revalidatePath` 和 `redirect` 的官方模式。
- GitHub `search_code` 搜索中文数字解析 TypeScript 示例：仅作为参考，最终复用项目内已有解析函数。
- 子代理只读核查：
  - 意图解析字段与测试缺口。
  - Assistant 前端数据流和 `book_id` 来源。
  - `/api/studio/scene-packets` 契约。
  - 前端测试注入策略。
