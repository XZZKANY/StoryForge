## 项目上下文摘要（本地浏览器与 E2E 门禁复验）

生成时间：2026-06-03 06:10:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/scripts/verify-continuous-session-browser.mjs:150-222`
  - 模式：Playwright 启动 Chromium，打开带上下文 query 的 Assistant 首页，提交真实输入后检查 URL 参数，并刷新验证 hidden input 恢复。
  - 可复用：`verify:browser-session` 本地浏览器验证入口。
  - 需注意：真实浏览器里 React 水合与受控输入状态可能回写按钮 disabled，提交动作必须和填入动作放在同一重试循环中。
- **实现2**: `apps/web/scripts/verify-settings-browser.mjs:152-245`
  - 模式：Playwright 打开 settings 页，通过循环填入和点击等待 localStorage 写入稳定，再验证模型检测请求体不携带凭据形态字段。
  - 可复用：水合后重试交互模式和本地浏览器安全边界验证。
  - 需注意：该脚本只使用示例 Base URL，不读取 `.env`，不运行真实外部 LLM。
- **实现3**: `apps/web/tests/home-page.test.tsx:457-485`
  - 模式：源码契约测试要求连续会话浏览器验证脚本存在、使用 Playwright/Chromium、覆盖真实点击、刷新恢复和关键上下文字段。
  - 可复用：用源码契约锁住浏览器脚本的关键行为，避免脚本退化为只读或 jsdom 级验证。
  - 需注意：源码契约不替代浏览器脚本运行，必须配合 `verify:browser-session` 新鲜执行结果。
- **实现4**: `scripts/run-e2e.mjs`
  - 模式：根 E2E 顺序执行 OpenAPI 刷新与漂移检查、Node 合约测试、API pytest 和 Workflow pytest。
  - 可复用：`pnpm e2e` 作为本地发布候选级合约门禁。
  - 需注意：该门禁不包含真实外部 LLM 长程验收。

### 2. 项目约定

- **命名约定**: Web 包浏览器验证入口使用 `verify:browser-session` 和 `verify:settings-browser`；脚本文件使用 `verify-*-browser.mjs`。
- **文件组织**: 浏览器验证脚本位于 `apps/web/scripts/`；对应源码契约位于 `apps/web/tests/home-page.test.tsx`；根 E2E 位于 `scripts/run-e2e.mjs`。
- **导入顺序**: Node 内置模块在前，Playwright 导入在后；测试使用 `node:test` 和 `node:assert/strict`。
- **代码风格**: 文档与断言说明使用简体中文；脚本保持直接、可重复、无真实 provider 依赖。

### 3. 可复用组件清单

- `pnpm --filter @storyforge/web test -- home-page`: 首页与连续会话源码契约。
- `pnpm --filter @storyforge/web verify:browser-session`: Assistant 连续会话真实 Chromium 验证。
- `pnpm --filter @storyforge/web verify:settings-browser`: settings 页真实 Chromium 安全边界验证。
- `pnpm --filter @storyforge/web lint`: Web TypeScript 类型检查。
- `pnpm e2e`: 根 E2E 合约、API 与 Workflow 门禁。
- `git diff --check`: 空白和行尾检查。

### 4. 测试策略

- **测试框架**: Node test 源码契约、Playwright 普通 Node 库、pytest、根 E2E 聚合脚本。
- **TDD 红灯**: `pnpm --filter @storyforge/web test -- home-page` 先失败于缺少 `submitIntentAfterHydration` 和 `lastClickError` 契约，证明测试能捕捉浏览器脚本对 React 水合竞态处理不足。
- **故障复现**: `pnpm --filter @storyforge/web verify:browser-session` 初次失败，Playwright 显示提交按钮在点击阶段仍为 disabled。
- **修复策略**: 将填入、按钮状态读取、点击和 URL intent 等待合并到同一重试循环，失败时输出最后一次状态和点击错误。
- **绿灯验证**: 重新运行源码契约、连续会话浏览器脚本、settings 浏览器脚本、Web lint 和 `pnpm e2e`。

### 5. 依赖和集成点

- **外部依赖**: Playwright、Next.js dev server、pnpm、uv、pytest。
- **内部依赖**: `HomeComposer` GET 降级 hidden input、Assistant URL query 上下文、settings Provider localStorage、安全请求体验证、OpenAPI 契约。
- **集成方式**: 浏览器脚本自启 Next dev 并用 Chromium 操作本地页面；根 E2E 刷新 OpenAPI 并比较刷新前后漂移。
- **配置来源**: 本轮不读取 `.env`，不使用用户提供的 provider 配置，不运行真实外部 LLM。

### 6. 技术选型理由

- **为什么用这个方案**: 现有项目已经有 Playwright 普通 Node 库和 Web 包验证脚本；修复脚本竞态比新增正式 Playwright test runner 更小、更符合当前仓库验证方式。
- **优势**: 真实 Chromium 覆盖点击、URL 参数保留和刷新恢复；源码契约防止脚本退化；根 E2E 补足 OpenAPI/API/Workflow 合约证据。
- **劣势和风险**: 浏览器脚本验证的是本地页面与本地状态，不代表真实外部 LLM 长程生产；Next/Sentry warnings 不阻断本轮验证，但可在后续独立清理。

### 7. 关键风险点

- **并发问题**: 真实浏览器水合期间按钮状态可能回写，本轮通过重试提交循环降低误判。
- **边界条件**: 连续会话脚本覆盖 `assistant_session_id`、`book_id`、`target_chapter_ordinal`、`artifact_id`；其余上下文参数仍由源码白名单和 hidden input 契约覆盖。
- **性能瓶颈**: 浏览器脚本会启动 Next dev，耗时高于源码契约，但只作为本地门禁执行。
- **安全考虑**: 未读取 `.env`，未运行真实外部 LLM，未输出或落盘任何 provider 凭据；敏感信息扫描需在文档回填后执行。

### 8. 本轮验证结果

- `pnpm --filter @storyforge/web test -- home-page` 红灯：13 passed，1 failed；失败命中浏览器脚本缺少水合后重试提交契约。
- `pnpm --filter @storyforge/web verify:browser-session` 初次失败：Playwright 点击提交按钮超时，按钮仍为 disabled。
- `pnpm --filter @storyforge/web test -- home-page` 绿灯：14 passed。
- `pnpm --filter @storyforge/web verify:browser-session` 绿灯：通过；真实 Chromium 提交后 URL 保留 `assistant_session_id`、`book_id`、`target_chapter_ordinal`、`artifact_id` 和 `intent`，刷新后 hidden input 恢复通过。
- `pnpm --filter @storyforge/web verify:settings-browser`：通过。
- `pnpm --filter @storyforge/web lint`：通过。
- `pnpm e2e`：通过；OpenAPI refresh/drift passed，Node 合约 28 passed，API verification 59 passed，Workflow verification 37 passed。
- `git diff --check`：通过。

### 9. 外部资料与工具记录

- Context7 `/microsoft/playwright`：确认 Playwright Node 库支持 `chromium.launch()`、`page.goto()`、`page.waitForFunction()` 等浏览器自动化能力。
- GitHub `search_code`：检索到公开项目中也存在 `verify-browser.mjs`、`verify-session-export.mjs` 一类普通 Node 浏览器验证脚本；本轮仍以本仓库既有脚本模式为准。
- 子代理只读核验：一个子代理确认主计划当前状态无明显漂移，真实 LLM 长程仍未完成；另一个子代理确认 HomeComposer 已保留关键参数，浏览器脚本为真实 Playwright/Chromium 级。
