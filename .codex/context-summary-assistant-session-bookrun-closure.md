## 项目上下文摘要（Assistant 会话 BookRun 闭环）

生成时间：2026-06-02 17:45:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/home/assistant-session-store.ts`
  - 模式：通过统一 `readJson` API client 读取 `/api/assistant/sessions`，并用响应校验函数保护最近记录映射。
  - 可复用：`ApiResult`、`HomeRecentItem`、`mapAssistantSessionToHomeRecentItem`、响应校验模式。
  - 需注意：后端字段为 snake_case，前端展示保留 `BookRun #`、`Blueprint #` 追溯引用。
- **实现2**: `apps/web/components/home/assistant-book-run-actions.ts`
  - 模式：Server Action 使用依赖注入的 `apiFetch`、`revalidatePath`、`redirect`，成功后刷新首页并 redirect。
  - 可复用：`readPositiveInt`、`buildResultUrl`、命令分支和失败回流模式。
  - 需注意：`redirect` 是抛出式控制流，必须在所有成功副作用完成后调用。
- **实现3**: `apps/web/components/home/assistant-artifact-export-actions.ts`
  - 模式：成功链路先完成业务 POST，再 `revalidatePath('/')`，最后 redirect；失败链路不刷新首页。
  - 可复用：测试中的依赖注入断言方式、错误状态回流方式。
  - 需注意：该文件属于禁止修改范围，只作为参考。
- **实现4**: `apps/api/app/domains/assistant/router.py`
  - 模式：后端已提供 `POST /api/assistant/sessions` 创建会话和 `POST /api/assistant/sessions/{id}/messages` 追加消息。
  - 可复用：现有 API 契约，不需要新增后端。
  - 需注意：`AssistantSessionCreate` 禁止 extra 字段，不能传入敏感配置。

### 2. 项目约定

- **命名约定**: TypeScript 函数和局部变量使用 camelCase；后端 API payload 字段使用 snake_case。
- **文件组织**: 首页 Assistant 相关 action/helper 位于 `apps/web/components/home/`，测试位于 `apps/web/tests/`。
- **导入顺序**: Node 标准库在测试顶部，随后导入目标模块；业务文件先导入 Next，再导入本地 API helper。
- **代码风格**: 两空格缩进，TypeScript 使用 readonly 类型，测试使用 `node:test` 与 `node:assert/strict`。

### 3. 可复用组件清单

- `apps/web/lib/api-client.ts`: `apiFetch`、`readJson`、`ApiResult`。
- `apps/web/components/home/assistant-session-store.ts`: 最近会话响应校验和映射。
- `apps/api/app/domains/assistant/schemas.py`: Assistant 会话创建和消息追加请求契约。

### 4. 测试策略

- **测试框架**: Node 内置 `node:test`。
- **测试模式**: 单元级 Server Action/helper 测试，通过依赖注入或 mock `globalThis.fetch` 捕获请求。
- **参考文件**: `apps/web/tests/assistant-session-store.test.ts`、`apps/web/tests/assistant-book-run-actions.test.ts`、`apps/web/tests/assistant-artifact-export-actions.test.ts`。
- **覆盖要求**: 创建会话成功、追加消息成功、异常响应错误、BookRun 成功后创建或追加会话、失败路径不写会话。

### 5. 依赖和集成点

- **外部依赖**: Next.js Server Action 的 `revalidatePath` 与 `redirect`；Context7 官方文档确认成功变更后应先刷新缓存再 redirect。
- **内部依赖**: BookRun command action 调用 `/api/book-runs/{id}/{command}`；Assistant session helper 调用 `/api/assistant/sessions` 或 `/messages`。
- **集成方式**: 前端通过统一 `apiFetch` 写入后端；最近记录继续通过 `readRecentAssistantSessions` 映射。
- **配置来源**: `apps/web/lib/api-client.ts` 负责 API base URL 和本地 API key 头。

### 6. 技术选型理由

- **为什么用这个方案**: 后端 Assistant 会话 API 已存在，前端缺少写入 helper；直接复用 API 契约比新增后端或改 UI 组件更小、更可验证。
- **优势**: 修改范围窄，符合依赖注入测试模式，成功后最近记录自然读取真实数据。
- **劣势和风险**: 如果表单没有 `blueprint_id`，创建的 session 只能追溯 `book_run_id`；已有 session 追加消息不会更新外键，只能在消息文本中记录引用。

### 7. 关键风险点

- **并发问题**: 用户重复提交可能创建多条 session；本次不做幂等，保持与现有 action 简单 POST 模式一致。
- **边界条件**: 缺少 `book_run_id` 或命令非法时不写 session；BookRun API 失败时不写 session。
- **性能瓶颈**: 成功路径增加一次轻量 POST，无持续轮询或大 payload。
- **安全考虑**: session helper 只发送 title、task_type、业务 id 和短消息，不发送 API key 或正文敏感内容。
