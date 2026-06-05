## 项目上下文摘要（源码剪枝 Web IDE palette/keymap）

生成时间：2026-06-05 14:30:45 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/tests/source-pruning.test.ts`
  - 模式：用 `existsSync` 断言已下线文件不应存在，并读取 `scripts/phase1-contract-test.mjs` 检查转译残留。
  - 可复用：`root`、`read()`、`join()` 和 forbidden 字符串循环。
  - 需注意：红灯应由目标文件存在或脚本残留触发，不能由路径错误触发。
- **实现2**: `apps/web/tests/ide-command-registry.test.tsx`
  - 模式：真实命令链路围绕 `createCommandRegistry()` 与 `registerBuiltinCommands()` 验证。
  - 可复用：保留 CommandRegistry、AgentSidebar、RightDock 和写操作按钮扫描护栏。
  - 需注意：不能删除 `registry.ts`、`registerBuiltinCommands.ts`、`command-client.ts` 或内置命令 shortcut 字段。
- **实现3**: `apps/web/tests/ide-personalization.test.tsx`
  - 模式：个性化偏好允许保存任意 `keybindings`，但生产没有接入 `resolveIdeKeymap()` 快捷键执行入口。
  - 可复用：保留偏好解析、存储、控件、面板和 IdeShell 水合测试。
  - 需注意：删除 keymap 测试时不应削弱偏好存储能力。
- **实现4**: `apps/web/tests/ide-performance-budget.test.tsx`
  - 模式：性能基线只应覆盖仍接入运行链路的 IDE 面板和编辑器。
  - 可复用：保留 ProblemsPanel 与 ChapterEditor 预算。
  - 需注意：删除 CommandPalette 预算项时同步清理 baseline 输入。

### 2. 项目约定

- **命名约定**: Web 测试使用 `node:test` 的中文测试名，React 组件使用 PascalCase，工具函数使用 camelCase。
- **文件组织**: IDE 命令链路在 `components/ide/commands/`，个性化在 `components/ide/personalization/`，性能预算在 `components/ide/performance/`。
- **导入顺序**: Node 内置模块、测试/React 依赖、共享类型、项目相对导入。
- **代码风格**: TypeScript 使用 `readonly` 类型、单引号、尾逗号和简体中文断言说明。

### 3. 可复用组件清单

- `apps/web/components/ide/commands/registry.ts`: 真实命令注册表。
- `apps/web/components/ide/commands/registerBuiltinCommands.ts`: 内置命令注册入口。
- `apps/web/components/ide/commands/command-client.ts`: 远程命令 API 客户端。
- `apps/web/components/ide/personalization/preferences.ts`: 个性化偏好解析、合并和存储。
- `apps/web/tests/source-pruning.test.ts`: 源码剪枝红灯与回归护栏模式。

### 4. 测试策略

- **测试框架**: Node `node:test`，通过 `pnpm --filter @storyforge/web test -- ...` 运行。
- **测试模式**: 先在 `source-pruning.test.ts` 增加红灯护栏，再删除文件和测试残留让护栏转绿。
- **参考文件**: `apps/web/tests/source-pruning.test.ts`、`apps/web/tests/ide-command-registry.test.tsx`、`apps/web/tests/ide-personalization.test.tsx`。
- **覆盖要求**: 文件存在性、phase1 转译残留、真实 CommandRegistry 链路、个性化偏好存储、性能预算回归。

### 5. 依赖和集成点

- **外部依赖**: React、`react-dom/server`、Node `assert`/`fs`/`path`/`test`。
- **内部依赖**: `CommandRegistry`、`registerBuiltinCommands`、`PersonalizationControls`、`ProblemsPanel`、`ChapterEditor`。
- **集成方式**: 当前 `CommandPalette` 与 `keymap/index.ts` 仅被测试和 phase1 转译脚本导入，未进入生产组件树或快捷键事件监听链路。
- **配置来源**: `apps/web/scripts/phase1-contract-test.mjs` 负责测试运行时模块转译和 import rewrite。

### 6. 技术选型理由

- **为什么用这个方案**: 本批是源码剪枝，优先用本仓库已存在的 source-pruning 护栏表达“不应存在”的目标状态。
- **优势**: 删除未接入模块后，测试会防止 phase1 转译脚本或孤立测试重新引用已下线文件。
- **劣势和风险**: `builtinCommands.shortcut` 字段仍保留为命令元数据，不等于运行时快捷键解析；后续若真正实现快捷键监听，应基于生产事件入口重新设计。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动，本批不接触生产事件监听。
- **边界条件**: 个性化仍能保存任意键位偏好，但不再承诺 `keymap/index.ts` 的默认解析行为。
- **性能瓶颈**: 删除 CommandPalette 性能预算项后，基线只覆盖仍保留的 ProblemsPanel 和 ChapterEditor。
- **安全考虑**: 不削弱命令执行审计链路，继续保留 CommandRegistry 的远程执行和写操作按钮不得直连 API 的扫描护栏。
