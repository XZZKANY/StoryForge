## 项目上下文摘要（Phase9 完整本地 verify 复验）

生成时间：2026-06-04 08:08:00 +08:00

### 1. 相似实现分析

- **实现1**: `package.json`
  - 模式：根脚本 `verify` 指向 `pnpm run verify:ci`。
  - 可复用：直接运行项目既定核心门禁入口。
  - 需注意：本地 verify 通过不等于远端 GitHub Actions 通过。
- **实现2**: `scripts/verify-ci.mjs`
  - 模式：按顺序执行根 lint/Prettier、Web lint、Shared 测试、Web 测试、API 全量 pytest、API ruff、Workflow 全量 pytest、Workflow ruff、OpenAPI refresh 与摘要漂移检查。
  - 可复用：作为本轮唯一验证入口。
  - 需注意：若任一 gate 失败，脚本会立即退出。
- **实现3**: `README.md`
  - 模式：本地快速验证建议包含 `pnpm verify`。
  - 可复用：本轮结果可补强 README 中建议门禁的实际证据。
  - 需注意：不能替代远端 E2E 或真实长程。
- **实现4**: `.codex/verification-report.md`
  - 模式：记录完整本地 E2E、事实源同步和剩余边界。
  - 可复用：本轮追加完整本地 verify 结果。
  - 需注意：避免整文件格式化或清理历史噪音。

### 2. 项目约定

- **命名约定**: 验证记录使用“Phase9 完整本地 verify 复验”。
- **文件组织**: `.codex/context-summary-*`、`.codex/operations-log.md`、`.codex/verification-report.md`。
- **导入顺序**: 本轮不修改代码导入。
- **代码风格**: 本轮是验证型任务，不新增运行时代码。

### 3. 可复用组件清单

- `pnpm verify`: 根级核心门禁入口。
- `scripts/verify-ci.mjs`: 核心门禁聚合脚本。
- `packages/shared/src/contracts/storyforge.openapi.json`: OpenAPI 漂移检查目标。
- `.codex/operations-log.md` 与 `.codex/verification-report.md`: 审计记录。

### 4. 测试策略

- **测试框架**: ESLint/Prettier、Node/TS 测试、pytest、ruff。
- **测试模式**: 运行完整默认 `pnpm verify`，读取退出码和各 gate 输出摘要。
- **参考文件**: `scripts/verify-ci.mjs`。
- **覆盖要求**: 根静态检查、Web lint、Shared/Web/API/Workflow 测试、API/Workflow ruff、OpenAPI refresh/drift。

### 5. 依赖和集成点

- **外部依赖**: pnpm、Node.js、uv、Python 虚拟环境。
- **内部依赖**: Web、Shared、API、Workflow、OpenAPI 契约。
- **集成方式**: 只执行既有脚本，不修改运行时代码。
- **配置来源**: 使用当前 shell 环境和仓库本地配置；不读取 `.env`。

### 6. 技术选型理由

- **为什么用这个方案**: `pnpm verify` 是 CI 核心门禁的本地等价入口，能验证当前工作区是否满足核心合并质量。
- **优势**: 覆盖范围广，和远端 CI workflow 的核心命令一致。
- **劣势和风险**: 运行成本较高；本地通过仍不能证明远端 E2E 或真实长程。

### 7. 关键风险点

- **并发问题**: 无并发代码改动。
- **边界条件**: OpenAPI refresh 可能产生漂移；若发生必须如实记录。
- **性能瓶颈**: 全量 pytest 和前端测试耗时较长，但属于核心门禁合理成本。
- **安全考虑**: 不读取 `.env`；不记录外部 provider 地址、密钥、认证头或任何可还原凭据片段。
