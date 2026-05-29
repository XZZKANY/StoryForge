## 项目上下文摘要（CI Prettier 格式检查）

生成时间：2026-05-29 16:39:51 +08:00

### 1. 相似实现分析

- **实现1**: `package.json`
  - 模式：根脚本 `lint` 同时执行 `eslint .` 和 CI 同款 `prettier --check`。
  - 可复用：直接复用根脚本中的 Prettier glob。
  - 需注意：格式修复应使用项目已有 `lint:fix` 等价命令范围。
- **实现2**: `.prettierrc.json`
  - 模式：项目统一使用 `semi: true`、`singleQuote: true`、`trailingComma: all`、`printWidth: 100`。
  - 可复用：所有格式化必须由 Prettier 配置驱动。
  - 需注意：不手工调整格式细节。
- **实现3**: `apps/web/tests/ide-components.test.tsx`
  - 模式：Web 契约测试通过 `phase1-contract-test.mjs` 转译并运行。
  - 可复用：格式化后用 Web 全量契约测试确认无行为回归。
  - 需注意：Windows 沙箱下测试可能需要提升权限避免 `spawn EPERM`。

### 2. 项目约定

- **命名约定**: TypeScript 使用 camelCase/PascalCase，测试描述使用中文。
- **文件组织**: Web 应用在 `apps/web`，共享包在 `packages/shared/src`，根脚本在 `scripts`。
- **导入顺序**: 由 eslint 与 Prettier 共同约束。
- **代码风格**: 使用 Prettier 3.8.3 统一格式。

### 3. 可复用组件清单

- `.prettierrc.json`: 格式化配置真相源。
- `package.json#scripts.lint`: CI 格式检查命令来源。
- `apps/web/scripts/phase1-contract-test.mjs`: Web 契约测试入口。

### 4. 测试策略

- **格式检查**: `pnpm exec prettier --check "apps/web/**/*.{ts,tsx}" "packages/shared/src/**/*.ts" "scripts/**/*.mjs"`。
- **静态检查**: `pnpm exec eslint .`。
- **类型检查**: `pnpm --filter @storyforge/web lint`。
- **回归测试**: `pnpm --filter @storyforge/web test`。

### 5. 依赖和集成点

- **外部依赖**: Prettier、ESLint、TypeScript。
- **内部依赖**: 根 `lint` 脚本和 Web 契约测试。
- **集成方式**: CI push 阶段运行根目录格式检查。
- **配置来源**: `.prettierrc.json` 与 `package.json`。

### 6. 技术选型理由

- **为什么用这个方案**: CI 明确要求 Prettier 格式，机械执行 `prettier --write` 是最小风险修复。
- **优势**: 不改变业务逻辑，直接消除格式漂移。
- **劣势和风险**: 格式化范围较大，需用测试确认无非格式回归。

### 7. 关键风险点

- **边界条件**: 全量 Web 测试会刷新本地性能基线文件，需排除该生成产物漂移。
- **性能瓶颈**: 不涉及运行时性能变更。
- **安全考虑**: 不涉及安全逻辑。
