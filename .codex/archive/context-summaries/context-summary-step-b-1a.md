## 项目上下文摘要（Step B-1a）

生成时间：2026-05-26 00:00:00

### 1. 相似实现分析

- **实现1**: `scripts/run-e2e.mjs`
  - 模式：根级 Node ESM 脚本，按 OpenAPI 刷新、契约测试、API pytest、workflow pytest 顺序执行。
  - 可复用：`runCommand()`、`runPythonCommand()`、`refreshOpenApiContract()`。
  - 需注意：默认失败即停止，B-1a 不实现继续执行。
- **实现2**: `scripts/verify-local.ps1`
  - 模式：本地验证脚本通过明确的成功/失败输出提示诊断结果。
  - 可复用：阶段性诊断思想；PowerShell 函数不直接复用于 Node 脚本。
  - 需注意：B-3 才要求统一时间戳和等级，本步骤不提前抽象。
- **实现3**: `apps/web/scripts/phase1-contract-test.mjs`
  - 模式：Node ESM 脚本使用 `console.log` 输出中文诊断，使用 `process.exitCode` 传递结果。
  - 可复用：简单直接的日志输出与退出码处理方式。
  - 需注意：错误处理改造属于 B-2，不在本步骤完成。

### 2. 项目约定

- **命名约定**: JavaScript 使用 camelCase，常量数组使用描述性复数名。
- **文件组织**: 根级自动化脚本放在 `scripts/`，Web 专属脚本放在 `apps/web/scripts/`。
- **导入顺序**: Node 内建模块位于文件顶部，采用 ESM `import`。
- **代码风格**: 两空格缩进、单引号字符串、中文诊断消息。
### 3. 可复用组件清单

- `scripts/run-e2e.mjs::runCommand`: 统一执行外部命令并返回退出码。
- `scripts/run-e2e.mjs::runPythonCommand`: 为 `uv` 与普通 Python 命令提供适配。
- `scripts/run-e2e.mjs::runWorkflowVerification`: workflow 阶段封装点。
- `scripts/run-e2e.mjs::runApiVerification`: API 阶段封装点。

### 4. 测试策略

- **测试框架**: Node 内建 test runner、pytest、PowerShell 本地验证脚本。
- **测试模式**: B-1a 采用脚本冒烟验证，检查前 20 行是否出现阶段进度日志。
- **参考文件**: `package.json` 中 `e2e` 脚本指向 `node scripts/run-e2e.mjs`。
- **覆盖要求**: 至少覆盖阶段开始日志；如后续阶段失败，记录失败码和已出现日志。

### 5. 依赖和集成点

- **外部依赖**: Node.js、Python/uv、pytest。
- **内部依赖**: `packages/shared/src/contracts/storyforge.openapi.json`、`apps/api`、`apps/workflow`、`tests/e2e/*`。
- **集成方式**: 根脚本串联多个验证入口。
- **配置来源**: `process.argv` 传入测试过滤参数；Python 命令由 `resolvePythonCommand()` 探测。

### 6. 技术选型理由

- **为什么用这个方案**: B-1a 只要求可见进度和结果日志，直接在阶段调用点添加输出最小且可审查。
- **优势**: 不改变执行语义，便于后续 B-1b 收集阶段状态。
- **劣势和风险**: 仅完成日志增强，不解决继续执行和汇总需求。

### 7. 关键风险点

- **并发问题**: 无新增并发。
- **边界条件**: OpenAPI 刷新失败时应输出 `[1/4] ... FAILED` 并保持失败即停止。
- **性能瓶颈**: 日志输出开销可忽略。
- **安全考虑**: 本步骤不涉及安全控制。
