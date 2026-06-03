## 项目上下文摘要（Assistant 连续会话上下文保留）

生成时间：2026-06-03 03:25:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/home/HomeComposer.tsx:24-45`
  - 模式：客户端组件读取 `useSearchParams()`，用 `URLSearchParams` 白名单复制当前 query，再通过 `router.push()` 提交新的 `intent`。
  - 可复用：现有白名单循环和 `params.set()` 写法。
  - 需注意：当前工作树已保留 `target_chapter_ordinal` 和 `artifact_id`；剩余缺口是原生 GET 降级表单仅携带 `view` 与 `intent`，未把已有上下文渲染为 hidden input。
- **实现2**: `apps/web/components/home/AssistantActionBar.tsx:56-106`
  - 模式：Server Action 表单用 hidden input 携带 `assistant_session_id`、`book_id`、`target_chapter_ordinal`、`scene_packet_id`、`repair_patch_id` 和 `book_run_id`。
  - 可复用：表单降级和服务端动作均依赖 snake_case 字段名，适合作为 `HomeComposer` GET 降级的本地模式。
  - 需注意：不应渲染空上下文参数，避免污染 query。
- **实现3**: `apps/web/components/home/assistant-session-store.ts:48-59`
  - 模式：最近会话链接用 `URLSearchParams` 生成可追溯 href。
  - 可复用：`assistant_session_id` 为基础参数，再按存在性追加 `book_run_id`、`artifact_id`、`blueprint_id`。
  - 需注意：最近产物入口已经能带回 `artifact_id`，后续用户继续发言时客户端和 GET 降级路径都应保留该参数。
- **实现4**: `apps/web/components/home/assistant-chapter-review-actions.ts:57-119`
  - 模式：章节审阅 Server Action 在缺少目标或定位失败时用 `URLSearchParams` 回流状态，并保留 `target_chapter_ordinal` 与 `assistant_session_id`。
  - 可复用：参数命名继续使用 URL/FormData snake_case。
  - 需注意：章节目标已经从 action 回流到 URL，后续输入必须继续保留。
- **实现5**: `apps/web/tests/home-page.test.tsx`
  - 模式：Web 首页测试采用源码契约断言，直接读取组件源码确认关键字符串和行为约束。
  - 可复用：在既有 `HomeComposer 是底部 Assistant 输入框且没有模式按钮` 测试中追加 GET 降级上下文保留契约。
  - 需注意：源码契约不等同真实浏览器点击；本阶段不能把它表述为 Playwright/Browser 级验证完成。

### 2. 项目约定

- **命名约定**: TypeScript 标识符使用 camelCase；URL/FormData 字段沿用 snake_case，例如 `assistant_session_id`、`target_chapter_ordinal`、`artifact_id`。
- **文件组织**: 首页 Assistant 组件位于 `apps/web/components/home/`；对应源码契约测试位于 `apps/web/tests/home-page.test.tsx`。
- **导入顺序**: React/Next 导入在前，项目内相对导入在后；类型从本地模块导入时使用 `type`。
- **代码风格**: TypeScript 使用分号；测试使用 `node:test` 与 `node:assert/strict`；断言说明使用简体中文。

### 3. 可复用组件清单

- `apps/web/components/home/HomeComposer.tsx`: 当前提交输入和 query 白名单逻辑。
- `apps/web/components/home/AssistantConversation.tsx`: 从 URL 读取 Assistant 会话、BookRun、章节审阅和导出状态，并渲染 `HomeComposer`。
- `apps/web/components/home/AssistantActionBar.tsx`: hidden input 透传上下文的既有表单模式。
- `apps/web/components/home/assistant-session-store.ts`: 最近记录 href 保留 `assistant_session_id`、`book_run_id`、`artifact_id`。
- `apps/web/components/home/home-view.ts`: `HomeSearchParams` 类型可复用为 `HomeComposer` 初始查询参数 props。

### 4. 测试策略

- **测试框架**: `node:test` + `node:assert/strict`，通过 `pnpm --filter @storyforge/web test -- home-page` 运行。
- **测试模式**: 源码契约测试；先加入缺失 GET 降级上下文断言并观察红灯，再修改组件。
- **参考文件**: `apps/web/tests/home-page.test.tsx`、`apps/web/tests/assistant-session-store.test.ts`、`apps/web/tests/assistant-chapter-review-actions.test.ts`、`apps/web/tests/assistant-artifact-export-actions.test.ts`、`apps/web/tests/assistant-book-run-actions.test.ts`。
- **覆盖要求**: 验证 `HomeComposer` 客户端提交和 GET 降级表单共用同一保留参数列表；确认 `AssistantConversation` 将 `searchParams` 传入 `HomeComposer`。

### 5. 依赖和集成点

- **外部依赖**: Next.js `useSearchParams()`、`useRouter()`、浏览器 `URLSearchParams`。
- **内部依赖**: `parseAssistantIntent()` 决定是否切到 `projects`；`AssistantConversation` 负责读取和传递 URL 参数；`assistant-session-store` 负责最近记录 href。
- **集成方式**: 客户端表单 `onSubmit` 阻止默认提交，构造 query 并 `router.push()` 回首页；无 JS 或未水合时 GET 表单通过 hidden input 保留已知上下文。
- **配置来源**: 无新增配置；不读取 `.env`。

### 6. 技术选型理由

- **为什么用这个方案**: 当前仓库已经在 `HomeComposer` 内使用白名单保留 query，且 `AssistantActionBar` 已用 hidden input 传递上下文；抽取同一保留参数列表并复用于两条提交路径是最小一致修复。
- **优势**: 不新增外部依赖，不改变 API 或 Server Action 契约，能减少客户端水合状态差异导致的会话上下文丢失。
- **劣势和风险**: 仍是源码契约与本地单元级验证，不等同真实浏览器点击/刷新恢复；后续仍需独立 Playwright 或 Browser 验证才能关闭浏览器级缺口。

### 7. 关键风险点

- **并发问题**: 无共享异步状态修改，仅 URL 参数复制和 hidden input 渲染。
- **边界条件**: 空字符串参数不复制；多值参数只保留首个值，沿用 `firstParam`/`URLSearchParams.get()` 的既有语义。
- **性能瓶颈**: 渲染少量 hidden input，开销可忽略。
- **安全考虑**: 只保留业务 ID 和章节序号，不保留凭据类字段；不读取 `.env`，不落盘密钥。

### 8. 外部资料与工具记录

- Context7 `/vercel/next.js`：用于复核 Client Component 可通过 `useSearchParams()` 读取 query，Server Component 可通过 page `searchParams` prop 读取查询，客户端 URL 更新可用 `URLSearchParams` 合并后导航。
- GitHub `search_code`：查询 `useSearchParams URLSearchParams router.push preserve query params language:TypeScript`，仅作为通用模式参考；最终实现以本仓库现有 `HomeComposer` 与 `AssistantActionBar` 模式为准。
- 工具缺失：当前会话未暴露 `desktop-commander`，本地文件搜索与读取使用 PowerShell 和 `rg` 替代。
