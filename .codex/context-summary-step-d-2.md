## 项目上下文摘要（D-2 OpenAPI 契约漂移检查）

生成时间：2026-05-26 02:23:00

### 1. 相似实现分析

- **实现1**: `scripts/run-e2e.mjs`
  - 模式：四阶段 e2e 流水线，使用 `runCommand()` 收集退出码，`rememberPhaseResult()` 支持 fail-fast 与 `--continue-on-error`。
  - 可复用：新增 drift check 应作为 OpenAPI 刷新后的独立阶段结果，继续复用 `runCommand()` 与结构化 `log()`。
  - 需注意：默认 fail-fast 不应在契约漂移后继续跑后续测试。
- **实现2**: `scripts/generate-openapi.ps1`
  - 模式：生成同一个 `packages/shared/src/contracts/storyforge.openapi.json` 快照。
  - 可复用：D-2 不重写生成逻辑，只检查刷新后 git diff。
  - 需注意：PowerShell 脚本面向手动刷新；e2e 中的检查应给出修复指令。
- **实现3**: `package.json`
  - 模式：`pnpm run openapi` 是正式契约刷新入口；`pnpm run e2e` 调用 `node scripts/run-e2e.mjs`。
  - 可复用：漂移提示应引用 `pnpm run openapi`。
  - 需注意：根目录执行，不进入子包。

### 2. 项目约定

- **命名约定**: JavaScript 使用 camelCase，内部 helper 用动词开头。
- **文件组织**: e2e 管线逻辑集中在 `scripts/run-e2e.mjs`。
- **导入顺序**: Node 内置模块 import 位于文件顶部。
- **代码风格**: ESM、单引号、两空格缩进、中文诊断日志。

### 3. 可复用组件清单

- `log(level, message)`: 结构化日志输出。
- `runCommand(command, args, cwd)`: 子命令执行与退出码收集。
- `rememberPhaseResult(phase, exitCode)`: fail-fast / continue-on-error 控制。
- `printPhaseSummary(phaseResults)`: continue 模式汇总。

### 4. 测试策略

- **测试框架**: Node 语法检查与结构测试。
- **测试模式**: 先新增结构断言，要求 run-e2e 包含 `git diff --exit-code packages/shared/src/contracts/storyforge.openapi.json` 与陈旧契约提示。
- **参考文件**: `apps/web/tests/phase1-navigation.test.tsx` 已包含脚本结构断言模式。
- **覆盖要求**: 结构测试 + `node --check scripts/run-e2e.mjs`；计划命令可用 grep/Select-String 验证 contract 日志。

### 5. 依赖和集成点

- **外部依赖**: `git` 命令。
- **内部依赖**: `refreshOpenApiContract()` 先写入契约快照，随后 drift check 检查工作树差异。
- **集成方式**: 在 OpenAPI refresh 阶段之后、contract tests 之前插入 OpenAPI contract drift check 阶段。
- **配置来源**: 固定契约路径 `packages/shared/src/contracts/storyforge.openapi.json`。

### 6. 技术选型理由

- **为什么用这个方案**: `.dev_plan.md` 明确要求 `git diff --exit-code`，复用现有 `runCommand()` 最小改动。
- **优势**: 直接使用 Git 工作树状态判断快照是否陈旧，与开发提交流程一致。
- **劣势和风险**: 若工作树已有该文件未提交改动，e2e 会失败；这正是漂移检查预期行为。

### 7. 关键风险点

- **边界条件**: continue 模式应继续执行后续阶段但最终退出码保留失败。
- **性能瓶颈**: 单次 git diff 成本很低。
- **安全考虑**: 仅本地只读 diff 检查，不读取凭据。
