## 项目上下文摘要（本地核心门禁快照）

生成时间：2026-06-03 06:35:00 +08:00

### 1. 相似实现分析

- **实现1**: `package.json`
  - 模式：根 `verify` 调用 `verify:ci`，作为项目核心门禁聚合入口。
  - 可复用：`pnpm verify`。
  - 需注意：该门禁是本地核心验证，不包含真实外部 LLM 长程验收。
- **实现2**: `scripts/verify-ci.mjs`
  - 模式：顺序执行根 lint、Web 类型检查、Shared 契约测试、Web 契约测试、API pytest、API Ruff、Workflow pytest、Workflow Ruff、OpenAPI 生成和漂移检查。
  - 可复用：核心门禁阶段划分和失败阶段输出。
  - 需注意：OpenAPI 检查比较刷新前后 digest，契约未刷新时第一次会失败，刷新后需重跑。
- **实现3**: `apps/web/scripts/verify-continuous-session-browser.mjs`
  - 模式：Playwright 浏览器脚本验证 Assistant 连续会话参数保留和刷新恢复。
  - 可复用：`verify:browser-session`。
  - 需注意：脚本内部 `page.evaluate()` 运行在浏览器环境，根 ESLint 需要针对该脚本声明浏览器全局。
- **实现4**: `apps/web/scripts/verify-settings-browser.mjs`
  - 模式：Playwright 浏览器脚本验证 settings 页本地存储和模型检测请求体安全边界。
  - 可复用：`verify:settings-browser`。
  - 需注意：同样需要浏览器全局 lint 配置。

### 2. 项目约定

- **命名约定**: 根脚本使用 `verify:*`；Web 包浏览器脚本使用 `verify-*-browser.mjs`。
- **文件组织**: 根门禁脚本位于 `scripts/`；Web 专属验证脚本位于 `apps/web/scripts/`；共享契约位于 `packages/shared/src/contracts/`。
- **代码风格**: JavaScript/TypeScript 走 ESLint 与 Prettier；API 和 Workflow 走 pytest 与 Ruff。

### 3. 可复用组件清单

- `pnpm verify`: 本地核心门禁入口。
- `pnpm --filter @storyforge/shared generate:types`: 从 OpenAPI 合约生成共享类型。
- `pnpm openapi`: 刷新 `storyforge.openapi.json`。
- `git diff --check`: 检查空白与行尾问题。

### 4. 测试策略

- **初始验证**: `pnpm verify` 首次失败于根 lint，暴露浏览器脚本在 ESLint 中缺少浏览器全局声明，以及两个测试文件需 Prettier 格式化。
- **修复验证**: `pnpm run lint` 通过。
- **契约验证**: 第二次 `pnpm verify` 通过 Web/API/Workflow 等阶段，但失败于 OpenAPI 契约刷新前后 digest 不一致。
- **同步验证**: 运行 `pnpm --filter @storyforge/shared generate:types` 后第三次 `pnpm verify` 通过。

### 5. 本轮最终验证结果

- `pnpm verify`：通过。
- 覆盖结果：
  - 根静态检查与格式检查通过。
  - Web 类型检查通过。
  - Shared 契约测试通过。
  - Web 契约测试：209 passed。
  - API 单元测试：376 passed，6 warnings。
  - API Ruff：通过。
  - Workflow 单元测试：164 passed。
  - Workflow Ruff：通过。
  - OpenAPI 契约刷新后无漂移。

### 6. 依赖和集成点

- **外部依赖**: pnpm、uv、pytest、Ruff、ESLint、Prettier、openapi-typescript。
- **内部依赖**: Web、API、Workflow、Shared、OpenAPI 生成脚本。
- **集成方式**: 根 `verify-ci` 串行运行各门禁，任一失败即终止。
- **配置来源**: 不读取 `.env`；本轮不运行真实外部 LLM。

### 7. 关键风险点

- **真实长程边界**: `pnpm verify` 不等于真实外部 LLM 10 章或 3-5 万字长程验收。
- **OpenAPI 契约**: 本轮刷新了 OpenAPI 和 shared generated types，后续提交前必须保留二者一致。
- **工作树风险**: 当前工作树存在大量既有脏改，本轮未回滚非本阶段改动。
- **安全考虑**: 未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘 provider 信息。
