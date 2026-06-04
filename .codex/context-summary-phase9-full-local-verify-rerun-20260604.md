## 项目上下文摘要（Phase9 完整本地 verify 复验）

生成时间：2026-06-04 08:00:00 +08:00

### 1. 相似实现分析

- **实现1**: `package.json`
  - 模式：根级 `verify` 脚本委托 `pnpm run verify:ci`，即 `node scripts/verify-ci.mjs`。
  - 可复用：直接运行 `pnpm verify`，不绕过任何 gate。
  - 需注意：`verify` 与 `e2e` 覆盖范围不同，不能互相替代。
- **实现2**: `scripts/verify-ci.mjs`
  - 模式：顺序执行 lint、Web 类型检查、Shared/Web/API/Workflow 测试、API/Workflow Ruff、OpenAPI refresh 和 drift 检查。
  - 可复用：以该脚本输出的 gate 名称和退出码作为本轮报告事实。
  - 需注意：任一 gate 失败都会退出，必须记录失败 gate。
- **实现3**: `.codex/verification-report.md`
  - 模式：记录每轮验证命令、结果、评分和剩余风险。
  - 可复用：追加本轮完整本地 verify 结果，不覆盖历史。
  - 需注意：本地 verify 通过不代表远端 E2E 或真实长程完成。

### 2. 项目约定

- **命名约定**：验证记录标题使用 `Phase9 完整本地 verify 复验`。
- **文件组织**：上下文、操作日志和验证报告写入项目本地 `.codex/`。
- **导入顺序**：本轮不修改代码导入。
- **代码风格**：本轮不改业务代码；记录使用简体中文。

### 3. 可复用组件清单

- `package.json`: `verify` 脚本入口。
- `scripts/verify-ci.mjs`: 核心本地门禁编排。
- `.codex/verification-report.md`: 验证报告事实源。
- `.codex/operations-log.md`: 操作日志事实源。

### 4. 测试策略

- **测试框架**：ESLint/Prettier、TypeScript/Web lint、Node test、pytest、Ruff、OpenAPI refresh/drift。
- **测试模式**：运行完整 `pnpm verify`，读取退出码和输出。
- **参考文件**：`scripts/verify-ci.mjs`。
- **覆盖要求**：根静态检查与格式检查、Web 类型检查、Shared 契约测试、Web 契约测试、API 单元测试、API Ruff、Workflow 单元测试、Workflow Ruff、OpenAPI refresh/drift 均需通过才可记录为完整本地 verify 通过。

### 5. 依赖和集成点

- **外部依赖**：pnpm、Node.js、uv/Python。
- **内部依赖**：`apps/web`、`packages/shared`、`apps/api`、`apps/workflow`、`packages/shared/src/contracts/storyforge.openapi.json`。
- **集成方式**：只运行现有脚本，不新增脚本或业务代码。
- **配置来源**：不读取 `.env`；当前验证只覆盖本地测试和静态门禁。

### 6. 技术选型理由

- **为什么用这个方案**：上一轮完整本地 `pnpm e2e` 已通过；提交和远端 E2E 重跑前仍需要当前工作树的核心 `pnpm verify` 证据。
- **优势**：覆盖 lint、测试、Ruff 和 OpenAPI drift，能补足 e2e 之外的质量门禁。
- **劣势和风险**：本地通过不等于远端通过；完整 verify 耗时较长。

### 7. 关键风险点

- **并发问题**：无业务并发改动；验证期间不启动真实外部 LLM。
- **边界条件**：不得将本地 `pnpm verify` 通过写成远端 E2E 完成；不得将真实 1 章/3 章 smoke 写成真实长程完成。
- **性能瓶颈**：完整 verify 会运行多组测试和 lint，属于当前门禁必要成本。
- **安全考虑**：不读取 `.env`，不输出 provider token、API key、secret 或 password。

### 8. 当前状态证据

- `gh run list --repo XZZKANY/StoryForge --workflow E2E --limit 3`: 最新远端 `E2E` run `26915457170` 仍为 failure。
- 上一轮本地 `pnpm e2e`: 退出码 0，OpenAPI refresh/drift、Node 29、API 61 和 workflow 37 均通过。
- `TODO.md`: 远端 E2E、真实长程和长程人工通读仍未完成。
