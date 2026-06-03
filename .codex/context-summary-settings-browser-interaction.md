## 项目上下文摘要（settings 浏览器交互验证）

生成时间：2026-06-03 03:45:00

### 1. 相似实现分析

- **实现1**: `apps/web/scripts/verify-continuous-session-browser.mjs`
  - 模式：独立 Node 脚本启动或复用 Next dev，使用 Playwright Chromium 打开真实页面并断言 DOM、URL 与刷新后的状态。
  - 可复用：`parseArgs`、`stopProcessTree`、`waitForReady`、`withStartedServer`、浏览器生命周期和页面错误收集模式。
  - 需注意：脚本只验证本地浏览器交互，不运行真实外部 LLM，也不代表长程生成验收。
- **实现2**: `apps/web/tests/settings-page.test.ts`
  - 模式：`node:test` + `assert` 源码契约测试，使用 `readFileSync` 读取组件、API route 与 package 配置。
  - 可复用：`root`、`read(path)`、字符串契约断言方式。
  - 需注意：源码契约不能冒充真实浏览器点击验证，因此本轮新增独立 Playwright 脚本入口并由契约测试守住。
- **实现3**: `apps/web/app/settings/ProviderSettingsPanel.tsx`
  - 模式：客户端组件读取表单值，保存 `storyforge-provider-settings`，通过 `/api/provider-models` POST 当前 Provider Base URL。
  - 可复用：稳定字段 `provider-base-url`、按钮文案“保存设置”“检测并拉取模型”、localStorage key。
  - 需注意：只允许保存 `baseUrl`，不得保存 API Key、token、Authorization、Bearer、secret 等凭据形态。
- **实现4**: `apps/web/app/settings/CreativePreferencesPanel.tsx`
  - 模式：客户端组件保存 `storyforge-creative-preferences`，字段包含 `genres`、`style`、`assistantBehavior`、`defaultFlow`。
  - 可复用：稳定字段 `creative-genres`、`creative-style`、`creative-assistant-behavior`、按钮文案“保存创作偏好”。
  - 需注意：创作偏好必须与 Provider 设置分离，不能混入 Provider Base URL 或凭据字段。

### 2. 项目约定

- **命名约定**: Web 脚本使用 `verify-*.mjs`，package 脚本使用 `verify:*`；React 组件使用 PascalCase，局部函数使用 camelCase。
- **文件组织**: 浏览器级验证脚本放在 `apps/web/scripts/`；源码契约测试放在 `apps/web/tests/`；审计产物放在项目本地 `.codex/`。
- **导入顺序**: Node 内置模块优先，然后第三方依赖；现有脚本使用 ESM import。
- **代码风格**: TypeScript/JavaScript 使用 2 空格缩进、单引号、简洁中文错误信息；测试沿用 `node:test` 与 `assert`。

### 3. 可复用组件清单

- `apps/web/scripts/verify-continuous-session-browser.mjs`: Next dev 自启、服务等待、Playwright Chromium 生命周期和页面断言结构。
- `apps/web/tests/settings-page.test.ts`: settings 页面源码契约测试入口。
- `apps/web/app/settings/ProviderSettingsPanel.tsx`: Provider Base URL 表单、保存和模型检测交互。
- `apps/web/app/settings/CreativePreferencesPanel.tsx`: 创作偏好表单和独立 localStorage 保存。

### 4. 测试策略

- **测试框架**: `node:test`、`assert`、Playwright Chromium 脚本。
- **测试模式**: 先用源码契约测试要求浏览器验证入口存在，红灯后实现脚本；再用真实浏览器脚本验证 localStorage、API 请求体和 UI 渲染。
- **参考文件**: `apps/web/tests/settings-page.test.ts`、`apps/web/scripts/verify-continuous-session-browser.mjs`。
- **覆盖要求**: Provider 保存正常流程、模型检测请求体安全边界、mock 模型列表渲染、创作偏好保存与 Provider 设置分离。

### 5. 依赖和集成点

- **外部依赖**: `playwright`，由根依赖提供并已被现有 `verify:browser-session` 使用。
- **内部依赖**: Next dev、本地 `/settings` 页面、`/api/provider-models` route。
- **集成方式**: package 脚本 `verify:settings-browser` 调用 `node scripts/verify-settings-browser.mjs`；脚本通过 `page.route('**/api/provider-models')` mock 本地 API 响应。
- **配置来源**: 不读取 `.env`；不使用真实 provider 配置；测试使用非真实示例 Base URL。

### 6. 技术选型理由

- **为什么用这个方案**: 项目已经采用脚本式 Playwright 浏览器验证，新增同类脚本能补齐真实交互证据，同时避免引入 Playwright config 或新测试框架。
- **优势**: 本地可重复、不会调用外部 Provider、能直接检查浏览器 localStorage 和真实 fetch body。
- **劣势和风险**: 需要启动 Next dev，耗时高于源码契约；选择器若过宽可能误点，因此使用 label、按钮文案和 localStorage key 组合验证。

### 7. 关键风险点

- **并发问题**: 默认端口可能被占用，脚本保留 `--port` 与 `--base-url` 参数以便本地规避。
- **边界条件**: 请求体必须只含 `baseUrl`；localStorage value 必须只含允许字段；创作偏好和 Provider 设置必须互不污染。
- **性能瓶颈**: 单页面 Chromium 验证资源成本可控；脚本结束后必须关闭浏览器和 Next dev 进程树。
- **安全考虑**: 不读取 `.env`；不落盘真实 provider 配置；不输出或复述凭据；断言禁止凭据字段进入 localStorage 或 API body。
