## 项目上下文摘要（Assistant 最近记录）

生成时间：2026-06-03 04:55:00

### 1. 相似实现分析

- **实现1**: `apps/web/app/page.tsx`
  - 模式：首页 Server Component 解析 `searchParams`，调用服务端 helper 读取数据，再把结果通过 props 传给 `HomeShell`。
  - 可复用：`readRecentAssistantSessions()`、`recentSessions.status === 'ready' ? recentSessions.data : []`。
  - 需注意：API 失败时当前选择回退为空数组，不伪造静态历史。
- **实现2**: `apps/web/components/home/assistant-session-store.ts`
  - 模式：统一封装 Assistant 会话读写，复用 `apiFetch`/`readJson`，校验响应结构后映射为 UI 需要的 `HomeRecentItem`。
  - 可复用：`mapAssistantSessionToHomeRecentItem()`、`buildAssistantSessionHref()`、`readRecentAssistantSessions()`。
  - 需注意：最近记录点击当前依靠 URL query 回到会话上下文；项目尚未提供按 `assistant_session_id` 拉取完整会话历史的前端恢复链路。
- **实现3**: `apps/web/components/home/HomeSidebar.tsx`
  - 模式：客户端侧栏只消费上游传入的 `recentItems`，有数据则渲染可追溯链接，无数据则展示 `homeRecentEmpty`。
  - 可复用：`recentItems = []` 默认值、`href={item.href}`、`title={item.summary}`。
  - 需注意：侧栏不直接 fetch，避免客户端绕过服务端 API 边界。
- **实现4**: `apps/api/app/domains/assistant/router.py`
  - 模式：FastAPI router 暴露 `GET /api/assistant/sessions`、`POST /api/assistant/sessions`、`POST /api/assistant/sessions/{assistant_session_id}/messages`。
  - 可复用：`limit` 夹到 `1..50`、`AssistantSessionRead` 响应字段。
  - 需注意：当前没有 `GET /api/assistant/sessions/{id}` 详情端点；首页最近记录展示不依赖详情端点。

### 2. 项目约定

- **命名约定**: 前端变量和函数使用 camelCase；API JSON 字段沿用 snake_case，例如 `task_type`、`book_run_id`、`artifact_id`。
- **文件组织**: 首页数据读取在 `apps/web/app/page.tsx`；Assistant 会话 helper 在 `components/home/assistant-session-store.ts`；API 领域在 `apps/api/app/domains/assistant/`。
- **导入顺序**: Web 文件先导入组件/工具，再导入类型；API 文件按标准库、第三方、项目模块排序。
- **代码风格**: Web 测试使用 `node:test` 与 `assert`；API 测试使用 pytest 与 FastAPI `TestClient`；可读文本使用简体中文。

### 3. 可复用组件清单

- `apps/web/lib/api-client.ts`: 统一 API base URL、`cache: 'no-store'` 和受控 API key header 注入。
- `apps/web/components/home/assistant-session-store.ts`: Assistant 会话创建、追加、最近列表读取和 UI 映射。
- `apps/web/components/home/HomeShell.tsx`: 将 `recentItems` 传入 `HomeSidebar`。
- `apps/web/components/home/HomeSidebar.tsx`: 展示最近记录链接或真实空状态。
- `apps/api/app/domains/assistant/service.py`: 创建、追加、读取最近 Assistant 会话。

### 4. 测试策略

- **测试框架**: Web 使用 `node:test`；API 使用 pytest。
- **测试模式**: 源码契约测试确认首页不使用静态伪历史；helper 单元测试确认 API 读取、header 注入、响应校验和 href 映射；API 测试确认创建、追加、最近列表和敏感字段拒收。
- **参考文件**: `apps/web/tests/home-page.test.tsx`、`apps/web/tests/assistant-session-store.test.ts`、`apps/api/tests/test_assistant_sessions.py`。
- **覆盖要求**: 正常返回、异常响应、空状态不伪造、可追溯 href、敏感字段拒收。

### 5. 依赖和集成点

- **外部依赖**: Next.js App Router、FastAPI、SQLAlchemy、pytest、node:test。
- **内部依赖**: `api-client.ts`、Assistant sessions API、HomeShell/HomeSidebar props。
- **集成方式**: `HomePage` 服务端调用 `readRecentAssistantSessions()`，ready 时传入 `HomeShell`；`HomeSidebar` 渲染 `HomeRecentItem.href`。
- **配置来源**: 不读取 `.env`；`api-client.ts` 通过当前进程环境变量或本地默认值注入 API 访问配置，本阶段不输出、不落盘任何凭据。

### 6. 技术选型理由

- **为什么用这个方案**: 最近记录属于服务端数据读取和首页展示，沿用 `api-client` 与 Server Component 读取可以保持鉴权和 no-store 边界。
- **优势**: 不新增客户端 fetch；不引入状态库；最近记录链接可携带 `assistant_session_id`、`book_run_id`、`artifact_id`、`blueprint_id` 追溯上下文。
- **劣势和风险**: 列表 API 当前返回完整 messages，首页只展示摘要时可能偏重；没有详情 GET，因此不能据此宣称完整会话历史恢复。

### 7. 关键风险点

- **并发问题**: 最近列表按 `updated_at desc, id desc` 排序；多会话排序边界当前未单独补测。
- **边界条件**: API 失败时回退空状态；这满足“不伪造历史”，但不向用户展示错误摘要。
- **性能瓶颈**: `selectinload(messages)` 会带完整消息；如果会话变多或消息变长，后续应考虑列表摘要 DTO。
- **安全考虑**: Assistant 会话 schema `extra="forbid"`，API 测试覆盖敏感载荷拒收；前端 helper 只读取普通会话字段，不保存凭据。
