## 项目上下文摘要（CI 与本地验证对齐）

生成时间：2026-05-29 17:07:04 +08:00

### 1. 相似实现分析

- **实现1**: `package.json`
  - 模式：根脚本集中声明 lint、test、openapi 等验证命令。
  - 可复用：`lint`、`test:web`、`test:api`、`test:workflow`、`openapi`。
  - 需注意：原 `verify` 指向 PowerShell infra 检查，不等于 CI 门禁。
- **实现2**: `.github/workflows/ci.yml`
  - 模式：GitHub Actions 安装 Node、Python、uv、pnpm 后分别运行检查。
  - 可复用：依赖安装步骤和 OpenAPI drift 检查。
  - 需注意：多 job 重复安装依赖，且本地没有同款入口。
- **实现3**: `scripts/run-e2e.mjs`
  - 模式：Node ESM 脚本编排命令并在失败时退出。
  - 可复用：用 Node 跨平台编排验证命令，避免 PowerShell 与 Linux CI 分叉。

### 2. 项目约定

- **命名约定**: 脚本使用 kebab-case 文件名，Node 内部变量 camelCase。
- **文件组织**: 根验证脚本放在 `scripts/`，GitHub workflow 放在 `.github/workflows/`。
- **导入顺序**: Node 内置模块导入在文件顶部。
- **代码风格**: ESM、单引号、2 空格缩进、中文日志。

### 3. 可复用组件清单

- `package.json#lint`: ESLint 与 Prettier 共同门禁。
- `pnpm --filter @storyforge/web test`: Web 契约测试。
- `uv run pytest` / `uv run ruff check .`: Python 子项目测试与 lint。
- `pnpm openapi`: OpenAPI 契约生成。

### 4. 测试策略

- **语法检查**: `node --check scripts/verify-ci.mjs`。
- **格式检查**: Prettier 检查 workflow、package、scripts 和计划文档。
- **核心门禁**: `pnpm run verify:ci`。
- **差异检查**: `git diff --check` 与 OpenAPI drift 检查。

### 5. 依赖和集成点

- **外部依赖**: Node.js、pnpm、uv、Python、GitHub Actions。
- **内部依赖**: Web、shared、API、workflow 四个工作区。
- **集成方式**: 本地 `pnpm run verify` 和 CI workflow 都调用 `pnpm run verify:ci`。
- **配置来源**: `package.json` 和 `.github/workflows/ci.yml`。

### 6. 技术选型理由

- **为什么用这个方案**: 单一 Node 脚本能在 Windows 本地和 Ubuntu CI 上复用，避免本地/远端验证分叉。
- **优势**: 门禁命令可复制、失败位置明确、减少 CI 重复 job 和重复安装。
- **劣势和风险**: 单 job 牺牲 CI 并行度，但提升本地复现一致性。

### 7. 关键风险点

- **边界条件**: Web 测试会刷新 `.codex/ide-performance-baseline.json`，不得将机器耗时漂移纳入配置提交。
- **性能瓶颈**: `verify:ci` 约包含 API 全量测试，耗时高于单独 lint，但作为核心门禁更可靠。
- **安全考虑**: 不处理密钥、不改变部署权限。
