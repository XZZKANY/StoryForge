## 项目上下文摘要（Step B-2）

生成时间：2026-05-26 00:00:00

### 1. 相似实现分析

- **实现1**: `apps/web/scripts/phase1-contract-test.mjs`
  - 模式：Node ESM 同步脚本，创建临时目录、转译 TSX 测试、用 Node test runner 执行。
  - 可复用：现有 `try/finally` 临时目录清理和 `process.exitCode`。
  - 需注意：新增 catch 不能破坏 finally 清理。
- **实现2**: `scripts/run-e2e.mjs`
  - 模式：命令失败时输出诊断并返回退出码。
  - 可复用：清晰错误消息与 `process.exitCode` 风格。
  - 需注意：不引入结构化 logger，B-3 另行处理。
- **实现3**: `scripts/generate-openapi.ps1`
  - 模式：前置解析运行时，失败时抛出明确诊断。
  - 可复用：预检后再执行主体操作的思路。

### 2. 项目约定

- Node 脚本使用 ESM、两空格缩进、双引号保持原文件风格。
- 错误诊断使用简洁中文或计划指定英文前缀。
- 失败通过 `process.exitCode = 1` 暴露给调用方。

### 3. 可复用组件清单

- `mkdtempSync` / `rmSync`: 临时目录生命周期。
- `spawnSync`: 执行 Node test runner。
- `ts.transpileModule`: 转译测试源。

### 4. 测试策略

- `node --check apps/web/scripts/phase1-contract-test.mjs`。
- 在 `apps/web` 目录运行 `node scripts/phase1-contract-test.mjs`。

### 5. 依赖和集成点

- 依赖 `typescript` 包、`tests/phase1-navigation.test.tsx`。
- 不新增依赖，不改测试源。

### 6. 风险点

- catch 必须位于 finally 前，确保异常被诊断且临时目录仍被清理。
- 文件缺失预检应给出路径上下文。
