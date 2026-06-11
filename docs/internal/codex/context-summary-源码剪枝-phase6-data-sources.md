## 项目上下文摘要（源码剪枝 phase6-data-sources）

生成时间：2026-06-05 02:55:09 +08:00

### 1. 相似实现分析

- **Web 测试契约**: `apps/web/tests/phase1-navigation.test.tsx`
  - 模式：通过 `node:test`、`assert`、`existsSync/readFileSync` 对文件存在性、入口路由和源码契约做静态回归检查。
  - 可复用：`root = process.cwd()` 与 `join(root, path)` 的路径读取模式。
  - 需注意：测试描述和断言消息使用简体中文，适合作为剪枝回归护栏。
- **Settings 页面静态测试**: `apps/web/tests/settings-page.test.ts`
  - 模式：读取页面、组件和包脚本，断言交互入口与本地验证脚本存在。
  - 可复用：文件存在性断言用于证明某个能力入口是否应保留。
  - 需注意：测试文件不导入目标业务模块，降低删除文件后的耦合风险。
- **Web 本地测试 runner**: `apps/web/scripts/phase1-contract-test.mjs`
  - 模式：将测试与必要 runtime modules 转译到临时目录后用 `node --test` 执行。
  - 可复用：新增测试只要位于 `apps/web/tests/*.test.ts` 即会被包测试发现。
  - 需注意：若测试需要导入生产模块，必须加入 runtimeModules；本轮测试只用 Node 内置模块，无需修改 runner。

### 2. 项目约定

- **命名约定**：TypeScript 测试文件使用短横线文件名；测试标题和断言消息使用简体中文。
- **文件组织**：Web 侧契约测试位于 `apps/web/tests`；源码工具文件位于 `apps/web/lib`。
- **导入顺序**：Node 内置模块在前，随后 `node:test`。
- **代码风格**：Prettier 单引号、分号、尾逗号；测试使用 `assert.ok` 和明确中文失败消息。

### 3. 可复用组件清单

- `apps/web/tests/phase1-navigation.test.tsx`: 文件存在性与剪枝类契约测试模式。
- `apps/web/scripts/phase1-contract-test.mjs`: Web 测试发现和执行入口。
- `apps/web/package.json`: `test` 调用 `node scripts/phase1-contract-test.mjs`，`lint` 调用 `tsc --noEmit`。
- `packages/shared/package.json`: `test` 调用 `tsc --noEmit`。

### 4. 测试策略

- **红灯测试**：新增 `apps/web/tests/source-pruning.test.ts`，断言 `apps/web/lib/phase6-data-sources.ts` 不应继续存在；删除前应失败。
- **绿灯测试**：删除目标文件后运行 `pnpm --filter @storyforge/web test source-pruning`。
- **目标回归**：运行 `pnpm --filter @storyforge/web test`、`pnpm --filter @storyforge/web lint`、`pnpm --filter @storyforge/shared test`。
- **静态验证**：运行 `rg` 确认生产和测试源码不再引用目标模块，运行 `git diff --check` 检查空白错误。

### 5. 依赖和集成点

- **外部依赖**：Node.js `node:test`、TypeScript、Next.js、pnpm workspace。
- **内部依赖**：目标文件当前不被 `apps/web`、`packages/shared` 或 `apps/web/tests` 引用；文档 `docs/architecture/phase6-workbench-contract.md` 仍有历史描述，需要同步修正为已下线状态。
- **配置来源**：`apps/web/package.json`、`apps/web/tsconfig.json`、`package.json`。

### 6. 技术选型理由

- **为什么删除**：`phase6-data-sources.ts` 是阶段性页面数据源 registry，但当前精确引用搜索只命中自身；实际页面已通过 `api-client`、页面 API helper 和集中 validators 读取真实数据。
- **为什么加测试**：删除文件本身没有可导入行为，最小自动护栏是断言该历史 registry 不再回归。
- **为什么修正文档**：架构契约仍声称五个页面从该 registry 渲染，删除源码后若不修正会形成错误事实源。

### 7. 关键风险点

- **误删风险**：动态导入或字符串路径可能漏检；通过标识符、路径和 import 形态搜索降低风险。
- **文档漂移风险**：历史计划文件保留旧任务清单是正常归档，不作为当前代码事实；架构事实源必须同步。
- **验证风险**：当前工作区已有其他未提交改动；本轮验证若失败，需要区分目标剪枝失败和既有改动影响。
