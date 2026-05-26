## 项目上下文摘要（Step B-1b）

生成时间：2026-05-26 00:00:00

### 1. 相似实现分析

- **实现1**: `scripts/run-e2e.mjs`
  - 模式：顺序执行四个验证阶段并用退出码控制流程。
  - 可复用：B-1a 新增的阶段日志、`runCommand()`、`runApiVerification()`、`runWorkflowVerification()`。
  - 需注意：默认 fail-fast 必须保持不变。
- **实现2**: `package.json`
  - 模式：根脚本 `e2e` 直接调用 `node scripts/run-e2e.mjs`，可透传 CLI 参数。
  - 可复用：无需新增 package script。
  - 需注意：新增 flag 不应破坏既有无参数调用。
- **实现3**: `apps/web/scripts/phase1-contract-test.mjs`
  - 模式：通过 `process.argv.slice(2)` 解析过滤参数。
  - 可复用：先解析 CLI 参数再确定测试集合。
  - 需注意：`--continue-on-error` 必须从测试文件列表中过滤。

### 2. 项目约定

- JavaScript 使用 ESM、camelCase、两空格缩进、单引号。
- 自动化脚本通过 `process.exitCode` 返回最终状态。
- 诊断输出使用简体中文或清晰英文阶段标签；B-1 已采用 `[n/4]` 标签。

### 3. 可复用组件清单

- `runCommand()`：执行命令并返回退出码。
- `refreshOpenApiContract()`：第 1 阶段。
- `runApiVerification()`：第 3 阶段。
- `runWorkflowVerification()`：第 4 阶段。

### 4. 测试策略

- 运行 `node --check scripts/run-e2e.mjs` 验证语法。
- 运行 `node scripts/run-e2e.mjs --continue-on-error 2>&1 | Select-Object -Last 10` 验证尾部汇总表。
- 若既有测试失败或管道截断导致非零退出，应记录原因和输出证据。

### 5. 依赖和集成点

- CLI flag 只影响 `scripts/run-e2e.mjs` 内部控制流。
- 不新增依赖、不修改 `package.json`。

### 6. 风险点

- flag 被误当成测试文件会导致 copyFile 失败，必须过滤。
- continue 模式应返回首个失败退出码，不能因后续阶段成功而掩盖失败。
- 默认模式不能输出 summary 或继续后续阶段。