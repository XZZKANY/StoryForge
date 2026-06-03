## 项目上下文摘要（Assistant 会话详情恢复）

生成时间：2026-06-03 04:58:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/assistant/router.py`
  - 模式：FastAPI `APIRouter(prefix="/api/assistant")` 暴露会话创建、最近列表和消息追加端点。
  - 可复用：`AssistantSessionRead`、`AssistantSessionNotFoundError`、`get_assistant_session()`。
  - 需注意：编码前 router 尚未暴露 `GET /api/assistant/sessions/{id}`；本轮已补齐详情端点。
- **实现2**: `apps/api/app/domains/assistant/service.py`
  - 模式：service 层用 SQLAlchemy `selectinload(AssistantSession.messages)` 读取会话和消息。
  - 可复用：`get_assistant_session()` 已具备详情读取语义。
  - 需注意：router 需要把 not found 转为 404，不应在 service 外重复查询。
- **实现3**: `apps/web/components/home/assistant-session-store.ts`
  - 模式：前端通过统一 `api-client` 读取最近会话、创建会话、追加消息，并用类型守卫校验响应。
  - 可复用：`AssistantSessionRead`、`isAssistantSessionRead()`、`readJson()`。
  - 需注意：编码前只导出最近列表；本轮已补齐 `readAssistantSession()`。
- **实现4**: `apps/web/components/home/AssistantConversation.tsx`
  - 模式：Server Component 读取 `searchParams`，再根据 `intent`、`book_run_id`、状态 query 构造消息流。
  - 可复用：Next App Router 服务端取数模式、`AssistantMessageList`、`AssistantActionBar`。
  - 需注意：编码前读到 `assistant_session_id` 后只用于 action 延续；本轮已补齐历史消息读取和缺失提示。
- **实现5**: `apps/web/tests/assistant-session-store.test.ts`
  - 模式：用 `globalThis.fetch` mock 统一 API client，断言 URL、header 和响应校验。
  - 可复用：详情 helper 的 TDD 测试模式。
  - 需注意：测试不应触发真实外部网络。

### 2. 项目约定

- **命名约定**: 后端字段和 URL 参数使用 snake_case；前端函数使用 camelCase；React 组件使用 PascalCase。
- **文件组织**: Assistant 后端位于 `apps/api/app/domains/assistant/`；首页 Assistant 前端位于 `apps/web/components/home/`。
- **导入顺序**: Python 先标准库/框架再项目模块；TypeScript 先 API helper，再本地类型/组件。
- **代码风格**: API 测试使用 pytest + FastAPI TestClient；Web 测试使用 `node:test` + `assert`。

### 3. 可复用组件清单

- `get_assistant_session()`：后端详情读取事实源。
- `AssistantSessionRead`：详情和列表共用响应 schema。
- `readJson()`：前端 GET helper，统一 API base URL 与受控 header。
- `isAssistantSessionRead()`：前端详情响应类型守卫。
- `AssistantMessageList`：渲染恢复的历史消息。

### 4. 测试策略

- **后端红灯**: `apps/api/tests/test_assistant_sessions.py` 增加 GET 详情和 404 测试。
- **前端红灯**: `apps/web/tests/assistant-session-store.test.ts` 增加 `readAssistantSession()` 测试；`apps/web/tests/home-page.test.tsx` 增加源码契约断言 AssistantConversation 读取详情并映射历史消息。
- **绿灯验证**: 运行 `pnpm --filter @storyforge/web test -- assistant-session-store home-page`、`cd apps/api; uv run pytest tests/test_assistant_sessions.py -q`、`pnpm --filter @storyforge/web lint`、`git diff --check`。

### 5. 依赖和集成点

- **外部依赖**: FastAPI、Next.js App Router、React Server Components。
- **内部依赖**: Assistant sessions API、统一 `api-client`、Home `searchParams`、Assistant 消息类型。
- **集成方式**: 最近记录 href 携带 `assistant_session_id`；HomePage 将 searchParams 传给 AssistantConversation；AssistantConversation 服务端读取详情后合并历史消息。
- **配置来源**: 不读取 `.env`；API 请求继续通过现有 `api-client` 边界。

### 6. 技术选型理由

- **为什么用这个方案**: 后端 service 已有详情读取函数，前端已有 session store 和 Server Component 取数模式，补薄层最小且可验证。
- **优势**: 最近记录跳回后能恢复真实历史消息；不新增数据库表；不调用真实外部 LLM。
- **劣势和风险**: 历史消息与 URL query 现场消息可能重复，需要按来源清晰排序并避免重复显示同一 `intent`。

### 7. 关键风险点

- **重复消息**: 如果 URL 同时有 `intent` 和 session 历史，需要避免把同一用户输入重复展示。
- **不存在会话**: 详情接口 404，前端应显示可读提示而不是空白。
- **安全考虑**: 会话 schema `extra="forbid"` 已拒绝敏感额外字段；本轮不得读取 `.env` 或落盘 provider 信息。

### 8. 外部资料记录

- Context7 `/fastapi/fastapi`：确认 APIRouter GET path operation、path 参数和 `HTTPException` 404 是标准模式。
- Context7 `/vercel/next.js`：确认 App Router Server Component 可 await `searchParams`，并可在服务端基于 search 参数取数。
- GitHub `search_code`：查询 FastAPI item detail/404 模式，仅作通用参考；最终实现复用本仓库 service/router 风格。

### 9. 充分性检查

- □ 我能定义清晰接口契约吗？是：`GET /api/assistant/sessions/{assistant_session_id}` 返回 `AssistantSessionRead`，不存在返回 404。
- □ 我理解关键技术选型理由吗？是：复用已有 `get_assistant_session()` 和前端 `readJson()`。
- □ 我识别主要风险点吗？是：重复消息、404 提示、敏感字段不进入普通业务流。
- □ 我知道如何验证实现吗？是：按后端 API、前端 helper、页面源码契约和 lint/diff check 验证。

### 10. 实施后补充

更新时间：2026-06-03 05:03:38 +08:00。

- 后端已新增 `GET /api/assistant/sessions/{assistant_session_id}`，复用 `get_assistant_session()`，找不到时返回 404。
- 前端已新增 `readAssistantSession()` 和 `AssistantSessionDetail`，并用 `Omit<AssistantSessionRead, 'messages'>` 确保 `messages` 被 TypeScript 收窄为 `AssistantMessageRead[]`。
- `AssistantConversation` 已在存在 `assistant_session_id` 时读取详情、映射历史 messages，并避免 URL `intent` 与历史消息重复展示；详情读取失败时显示可读提示。
- 本地验证：`pnpm --filter @storyforge/web test -- assistant-session-store home-page` 21 passed；`cd apps/api; uv run pytest tests/test_assistant_sessions.py -q` 3 passed；`pnpm --filter @storyforge/web lint` 通过。
- 边界：本轮未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘 provider 信息；真实外部 LLM 长程验收仍未完成。
