## 项目上下文摘要（Step B-3）

生成时间：2026-05-26 00:00:00

### 1. 相似实现分析

- **实现1**: `scripts/run-e2e.mjs`
  - 模式：Node ESM 脚本串联四阶段验证，当前使用 `console.log` / `console.error`。
  - 可复用：B-1a/B-1b 已形成阶段标签和汇总表输出。
  - 需注意：子进程 `stdio: inherit` 输出不属于脚本自身 console，不能无损统一。
- **实现2**: `scripts/verify-local.ps1`
  - 模式：通过 `Write-Ok` / `Write-Fail` 统一多数验证输出，少量 `Write-Host` 用于跳过、开始、最终结果。
  - 可复用：保留函数集中输出和颜色。
  - 需注意：更新 helper 可覆盖大多数调用点。
- **实现3**: `scripts/generate-openapi.ps1`
  - 模式：PowerShell 启动 Python 生成 OpenAPI，一处 `Write-Host` 输出运行时信息。
  - 可复用：新增轻量 `Write-Info`，不改变 Python heredoc。

### 2. 项目约定

- Node: ESM、camelCase、两空格缩进、单引号。
- PowerShell: PascalCase 函数、四空格缩进、`Write-Host` 颜色输出。
- 日志文本使用简体中文，代码标识符保持英文。

### 3. 可复用组件清单

- `run-e2e.mjs` 阶段输出与 `printPhaseSummary()`。
- `verify-local.ps1` 的 `Write-Ok` / `Write-Fail`。
- `generate-openapi.ps1` 的单点运行时输出。

### 4. 测试策略

- `node --check scripts/run-e2e.mjs`。
- 使用 PowerShell AST 解析 `scripts/generate-openapi.ps1` 与 `scripts/verify-local.ps1`。
- 运行 `node scripts/run-e2e.mjs 2>&1 | Select-String -Pattern '^\[20' | Select-Object -First 5` 验证日志前缀。

### 5. 依赖和集成点

- 不新增依赖、不改 `package.json`。
- 不改变 e2e 四阶段控制流。
- 不改变 PowerShell 脚本退出码。

### 6. 风险点

- 替换 console 时需保留换行开头，避免计划验证匹配失败。
- PowerShell 输出应保留颜色语义。
- 子进程输出仍可能无前缀，应在报告中说明范围为脚本自身输出。
