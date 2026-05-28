## 项目上下文摘要（StoryForge VS Code IDE P1.5 退出审计）

生成时间：2026-05-28 15:08:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/ide/workflows/JudgeRepairWorkbench.tsx`
  - 模式：组合 ChapterEditor、ProblemsPanel、DiffViewer，使用同一个 `CommandRegistry` 执行 quick fix 和 approve。
  - 可复用：`commands.execute(...)`、`data-selected-diagnostic-id`、`data-selected-range`。
  - 需注意：当前闭环缺少 Workbench 内显式 `judge.run` 入口。
- **实现2**: `apps/web/components/ide/panels/ProblemsPanel.tsx`
  - 模式：诊断项与 quick fix 均暴露 `data-*` 契约，按钮回调交给上层。
  - 可复用：`data-command-id`、`data-command-args`、range 属性。
  - 需注意：Problems 只处理诊断展示和 quick fix，不负责运行 Judge。
- **实现3**: `apps/web/components/ide/views/DiffViewer.tsx`
  - 模式：Diff 展示与批准按钮分离，批准写回通过 `approveCommandId` 和 `onApprove` 注入。
  - 可复用：`judge.approve`、`audit_event_id` 展示、`data-command-args`。
  - 需注意：批准动作必须继续经 CommandRegistry。
- **实现4**: `apps/web/components/ide/commands/registerBuiltinCommands.ts`
  - 模式：内置写命令统一注册，包含 `judge.run`、`judge.repair`、`judge.approve`。
  - 可复用：`judge.run` 已有快捷键和命令目录，无需新增命令系统。
  - 需注意：Workbench 应复用已有命令 ID，不新增平行入口。

### 2. 项目约定

- **命名约定**: React 组件使用 PascalCase，props 使用 camelCase，命令 ID 使用点分命名。
- **文件组织**: Workbench 位于 `apps/web/components/ide/workflows/`，组件契约测试位于 `apps/web/tests/`，e2e 契约位于 `tests/e2e/`。
- **导入顺序**: Node 内置模块、React、项目组件依次导入。
- **代码风格**: 纯展示组件使用 `readonly` props；写操作只调用 `CommandRegistry.execute`。

### 3. 可复用组件清单

- `CommandRegistry`: 统一命令执行接口。
- `registerBuiltinCommands`: 已注册 `judge.run`、`judge.repair`、`judge.approve`。
- `ProblemsPanel`: 一键 Repair 入口。
- `DiffViewer`: Approve 入口和 audit_event 展示。

### 4. 测试策略

- **测试框架**: Web 组件使用 `node:test` + `renderToStaticMarkup`；e2e 契约使用 `node:test` 读取源码和 OpenAPI 证据。
- **测试模式**: 先补 e2e 源码证据和组件 SSR 断言红灯，再实现 Workbench 的 Judge 运行入口。
- **参考文件**: `apps/web/tests/ide-components.test.tsx`、`tests/e2e/ide-judge-repair.spec.ts`。
- **覆盖要求**: 同一闭环内必须同时有 `judge.run`、`judge.repair`、`judge.approve`、diagnostic range、Diff 和 audit_event。

### 5. 依赖和集成点

- **外部依赖**: React 静态渲染。
- **内部依赖**: Workbench 通过 props 接收命令参数并调用同一 `CommandRegistry`。
- **集成方式**: UI 按钮暴露 `data-command-id="judge.run"`，点击时执行 `commands.execute('judge.run', args)`。
- **配置来源**: 无新增配置。

### 6. 技术选型理由

- **为什么用这个方案**: 主计划 P1 闭环从运行 Judge 开始，命令目录已存在 `judge.run`，在 Workbench 补入口是最小一致改动。
- **优势**: 不新增命令系统，不新增 API，能被组件测试和 e2e 契约同时验证。
- **劣势和风险**: 当前仍是契约型 e2e，不是浏览器真实点击；全量 `pnpm e2e` 仍需验证。

### 7. 关键风险点

- **并发问题**: 无新增共享状态。
- **边界条件**: `judgeRunArgs` 为空时仍应稳定执行空参数。
- **性能瓶颈**: 新增一个按钮，无运行时性能风险。
- **安全考虑**: 本任务不处理安全控制；写入口仍经 CommandRegistry。
