## 项目上下文摘要（源码剪枝 web-test-transpile-stale-assistant）

生成时间：2026-06-05 10:48:00

### 1. 相似实现分析

- **实现1**: `apps/web/tests/source-pruning.test.ts`
  - 模式：通过 `existsSync` 和 `readFileSync` 检查已下线 Web 模块不得回归。
  - 可复用：继续在该文件新增剪枝护栏。
  - 需注意：测试标题和失败提示使用简体中文。
- **实现2**: `apps/web/scripts/phase1-contract-test.mjs`
  - 模式：将测试依赖的 TS/TSX 生产模块转译到临时目录，并用 `importRewrites` 重写导入路径。
  - 可复用：保留现有 runtimeModules/importRewrites 结构，仅删除已下线模块条目。
  - 需注意：脚本对不存在的 runtime module 使用 `existsSync(src)` 跳过，因此残留不会导致测试失败，但会污染源码扫描。
- **实现3**: `apps/web/components/home/assistant-tool-node-mapper.ts`
  - 模式：当前 Assistant 工具树生产映射模块，仍被 `AssistantToolTree` 和测试引用。
  - 可复用：保留当前真实工具映射链路。
  - 需注意：本批只处理已删除的 `assistant-tool-events` 与 `assistant-workflows`，不触碰仍接入的 mapper/catalog/session/action 模块。

### 2. 项目约定

- **命名约定**: Web 测试文件使用 `*.test.ts` 或 `*.test.tsx`；测试标题使用简体中文。
- **文件组织**: 测试运行器位于 `apps/web/scripts/`；Web 剪枝护栏位于 `apps/web/tests/source-pruning.test.ts`。
- **导入顺序**: Web 测试先导入 Node 内置模块，再定义本地 helper。
- **代码风格**: `phase1-contract-test.mjs` 使用数组字面量维护 runtimeModules 与 importRewrites，删除条目不引入抽象。

### 3. 可复用组件清单

- `apps/web/tests/source-pruning.test.ts`: 本批新增脚本残留防回归断言。
- `apps/web/scripts/phase1-contract-test.mjs`: 本批清理已删模块 runtimeModules/importRewrites 条目。
- `apps/web/components/home/assistant-tool-node-mapper.ts`: 保留的真实工具树映射模块。
- `apps/web/components/home/assistant-tool-catalog.ts`: 保留的 Assistant 工具目录模块。

### 4. 测试策略

- **测试框架**: `node:test`，通过 `pnpm --filter @storyforge/web test` 调用脚本。
- **测试模式**: 先扩展 source-pruning 红灯测试，再删除测试脚本残留条目。
- **参考文件**: `apps/web/tests/source-pruning.test.ts`、`apps/web/tests/home-page.test.tsx`、`apps/web/scripts/phase1-contract-test.mjs`。
- **覆盖要求**: 防止 `assistant-tool-events` 与 `assistant-workflows` 在测试转译 runtimeModules/importRewrites 中回归。

### 5. 依赖和集成点

- **外部依赖**: TypeScript `transpileModule`、Node test runner。
- **内部依赖**: Web 全量测试依赖 `phase1-contract-test.mjs` 转译仍存在的生产模块。
- **集成方式**: 删除已下线模块的转译和导入重写条目，不改变脚本执行流程。
- **配置来源**: `apps/web/package.json` 的 `test` 脚本指向 `node scripts/phase1-contract-test.mjs`。

### 6. 技术选型理由

- **为什么用这个方案**: 已下线模块不应继续出现在测试基础设施中，否则源码扫描会持续出现幽灵引用。
- **优势**: 降低剪枝扫描噪声，让测试转译清单与当前代码保持一致。
- **劣势和风险**: 若仍有测试间接导入已删模块，删除 rewrite 会暴露失败；Web 全量测试可验证。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 只删除已下线模块条目，不删除仍存在的 `assistant-tool-node-mapper`、`assistant-tool-catalog` 或 Assistant action 模块。
- **性能瓶颈**: 删除无效转译条目可略微减少扫描和脚本维护噪声。
- **安全考虑**: 不修改 API Key、Provider 设置、认证、CSP 或请求逻辑。
