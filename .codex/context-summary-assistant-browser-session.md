## 项目上下文摘要（Assistant 连续会话浏览器验证）

生成时间：2026-06-03 02:46:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/scripts/verify-legacy-redirects-http.mjs`
  - 模式：脚本自启 Next dev，等待服务就绪，执行 HTTP 验证，失败时输出中文错误并设置非零退出码。
  - 可复用：`parseArgs()`、`waitForReady()`、`withStartedServer()`、Windows `taskkill.exe` 进程树清理模式。
  - 需注意：该脚本只做 HTTP smoke；本阶段需要真实浏览器点击，因此只复用启动和清理结构。
- **实现2**: `apps/web/scripts/verify-bookrun-eventsource-reconnect.mjs`
  - 模式：独立 Node smoke 脚本，使用 `node:assert/strict` 做可重复断言，异常统一转为中文失败信息。
  - 可复用：轻量脚本风格和退出码语义。
  - 需注意：该脚本不启动 Next dev，本阶段需要浏览器和页面服务。
- **实现3**: `apps/web/components/home/HomeComposer.tsx`
  - 模式：真实页面输入框通过 `aria-label="给 StoryForge Assistant 发送消息"` 定位；提交按钮通过 `aria-label="发送"` 定位；上下文参数由 `preservedContextQueryKeys` 保留。
  - 可复用：浏览器脚本可通过可访问名称定位真实控件，而不是依赖脆弱 CSS 选择器。
  - 需注意：需同时验证客户端 `router.push()` 后 URL 保留和刷新后 hidden input 保留。
- **实现4**: `apps/web/components/home/AssistantConversation.tsx`
  - 模式：服务端读取 `searchParams` 并传给 `HomeComposer initialSearchParams`。
  - 可复用：刷新后服务端渲染 hidden input 的事实来源。
  - 需注意：有 `book_run_id` 时会读取 BookRun；浏览器验证可不携带 `book_run_id`，避免依赖本地 API。
- **实现5**: `apps/web/package.json`
  - 模式：Web 包已有 `verify:legacy-redirects`、`verify:eventsource-reconnect` 等 `verify:*` 本地验证入口。
  - 可复用：新增 `verify:browser-session`，保持命名一致。

### 2. 项目约定

- **命名约定**: Node 脚本使用 camelCase 函数和变量；URL/query 字段保持 snake_case。
- **文件组织**: Web 专属验证脚本放在 `apps/web/scripts/`；脚本入口挂到 `apps/web/package.json`。
- **错误输出**: 本地验证脚本输出中文摘要，失败设置 `process.exitCode = 1`。
- **代码风格**: ESM `.mjs`，优先复用 Node 内置模块；不新增 `@playwright/test` 或配置文件。

### 3. 可复用组件清单

- `verify-legacy-redirects-http.mjs`: Next dev 自启、探活和进程清理模式。
- `HomeComposer`: 浏览器可访问控件、上下文 hidden input 和客户端提交逻辑。
- `AssistantConversation`: 服务端 `searchParams` 透传给输入框。
- 根 `package.json`: 已提供 `playwright` devDependency。
- `apps/web/package.json`: 可挂接 `verify:browser-session`。

### 4. 测试策略

- **浏览器工具**: Playwright 普通 Node 库，使用 `chromium.launch()`，不引入 `@playwright/test`。
- **验证路径**:
  1. 打开 `/?assistant_session_id=31&book_id=12&target_chapter_ordinal=2&artifact_id=88`。
  2. 检查 `form[action="/"]` 内 hidden input 保留上下文。
  3. 通过 aria-label 填写 `继续审阅第二章` 并点击“发送”。
  4. 等待 URL 中出现 `intent`，并确认四个上下文参数未丢失。
  5. 刷新页面，再次确认 URL 和 hidden input 仍保留上下文。
- **回归验证**: 同时运行 `pnpm --filter @storyforge/web test -- home-page` 和 `pnpm --filter @storyforge/web lint`。

### 5. 依赖和集成点

- **外部依赖**: Playwright `chromium`；Next.js dev server。
- **内部依赖**: 首页 Assistant 首屏、`HomeComposer`、`AssistantConversation`。
- **服务依赖**: 不需要 API 或真实 LLM；不携带 `book_run_id`，避免触发 BookRun 详情读取。
- **配置来源**: 不读取 `.env`；脚本仅使用 CLI 参数、默认本地端口和当前进程环境中非敏感的 `NEXT_TELEMETRY_DISABLED`。

### 6. 技术选型理由

- **为什么用这个方案**: 项目已有 `playwright` 包但没有正式 `@playwright/test` 入口；普通 Node 脚本能最小补齐真实浏览器点击证据。
- **优势**: 可重复、范围窄、无需新测试框架；能验证源码契约无法证明的浏览器行为。
- **劣势和风险**: 依赖本地 Chromium 浏览器资产；若缺失需安装 Playwright 浏览器资产后再验证。

### 7. 关键风险点

- **并发问题**: 脚本自启 dev server 时需保证端口可用；支持 `--base-url` 复用已有服务。
- **边界条件**: URL query 多值不验证；本阶段只验证单值业务上下文。
- **性能瓶颈**: Next dev 启动较慢，脚本提供 timeout 参数。
- **安全考虑**: 不读取 `.env`，不输出或写入 provider 凭据；不调用真实外部 LLM。

### 8. 外部资料与工具记录

- Context7 `/microsoft/playwright`：确认普通 Node 脚本可用 `chromium.launch()` 启动浏览器，并可用 locator、`getByLabel()`、`getByRole()` 进行真实页面交互。
- GitHub `search_code`：查询 `waitForURL getByLabel chromium.launch language:JavaScript playwright`，仅作为通用脚本形态参考；最终实现以本仓库验证脚本风格为准。
- 工具缺失：当前会话未暴露 `desktop-commander` 或 Browser 点击工具，本地文件操作使用 PowerShell、`rg` 和 `apply_patch` 替代。
