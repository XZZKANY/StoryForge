## 项目上下文摘要（StoryForge VSCode IDE P1.5 Judge 闭环）

生成时间：2026-05-28 13:45:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/ide/editors/ChapterEditor.tsx`
  - 模式：客户端 React 组件封装 CodeMirror 6，props 接收 `content`、`diagnostics`、`onChange`。
  - 可复用：`ChapterEditor` 与 `createJudgeIssueDecorations` 可直接用于正文和诊断装饰。
  - 需注意：SSR 只能验证静态契约，CodeMirror 交互在客户端生效。
- **实现2**: `apps/web/components/ide/panels/ProblemsPanel.tsx`
  - 模式：诊断列表组件通过回调暴露选择和 Quick Fix 操作。
  - 可复用：`Diagnostic.quickFixes[].command_id` 是 Repair 命令入口。
  - 需注意：当前缺少 `data-command-id`、range 与诊断 ID 的可断言标记。
- **实现3**: `apps/web/components/ide/views/DiffViewer.tsx`
  - 模式：纯展示组件，用 before/after 两栏呈现修复差异。
  - 可复用：可扩展 approve 按钮和 `audit_event_id` 展示，无需重写 diff 展示。
  - 需注意：Approve 写回必须经 `CommandRegistry`，不能直接调用 API。
- **实现4**: `apps/web/components/ide/commands/registry.ts`
  - 模式：`createCommandRegistry` 统一注册、列举、查询和执行 IDE 命令。
  - 可复用：`commands.execute(commandId, args)` 是所有写操作入口。
  - 需注意：未知命令会抛出简体中文错误，测试可覆盖命令目录同步。
- **实现5**: `apps/api/app/domains/ide/service.py`
  - 模式：`_BUILTIN_COMMANDS` 是后端命令真相目录，写命令返回 `audit_event_id`。
  - 可复用：新增 `judge.approve` 只需追加 `IdeCommandDefinition`，保持薄壳协议。
  - 需注意：当前不做真实写回，后续应接入既有 Studio approval action。

### 2. 项目约定

- **命名约定**: React 组件使用 PascalCase，props 类型为 `XxxProps`，命令 ID 使用点分命名。
- **文件组织**: IDE 组件位于 `apps/web/components/ide/`，命令在 `commands/`，面板在 `panels/`，视图在 `views/`。
- **导入顺序**: Node/React 导入在前，项目相对导入在后，类型导入使用 `import type`。
- **代码风格**: TypeScript 使用 readonly props；Python 使用类型注解和简体中文 docstring。
### 3. 可复用组件清单

- `apps/web/components/ide/editors/ChapterEditor.tsx`: 章节正文和诊断装饰容器。
- `apps/web/components/ide/panels/ProblemsPanel.tsx`: Problems 列表、诊断选择和 Quick Fix 回调。
- `apps/web/components/ide/views/DiffViewer.tsx`: 修复前后差异展示。
- `apps/web/components/ide/commands/registry.ts`: 命令注册与统一执行入口。
- `apps/web/components/ide/commands/registerBuiltinCommands.ts`: 前端内置命令目录。
- `packages/shared/src/diagnostic.ts`: `Diagnostic` 类型和 JudgeIssue 到 IDE 诊断映射。

### 4. 测试策略

- **测试框架**: Web 使用 `node:test` + `renderToStaticMarkup`，经 `apps/web/scripts/phase1-contract-test.mjs` 转译运行。
- **测试模式**: 组件 SSR 契约测试、命令注册测试、API pytest。
- **参考文件**: `apps/web/tests/ide-components.test.tsx`、`apps/web/tests/ide-command-registry.test.tsx`、`apps/api/tests/test_ide_commands.py`。
- **覆盖要求**: 正常流程覆盖诊断选择、Quick Fix、Diff、Approve、审计 ID；错误流程覆盖未知命令 404。

### 5. 依赖和集成点

- **外部依赖**: React、CodeMirror 6、FastAPI、Pydantic、SQLAlchemy。
- **内部依赖**: `CommandRegistry` → `executeIdeCommand` → `/api/ide/commands/{id}` → `_BUILTIN_COMMANDS`。
- **集成方式**: UI 按钮只调用 `commands.execute`；后端命令薄壳负责返回 `audit_event_id`。
- **配置来源**: 前端命令目录和后端命令目录需要同步维护。
### 6. 技术选型理由

- **为什么用这个方案**: P1.5 目标是打通既有骨架，不重写业务；新增工作流组合组件可复用已有组件并把命令审计契约集中表达。
- **优势**: 改动面小，测试可直接证明 `judge.repair` 和 `judge.approve` 都通过命令系统。
- **劣势和风险**: API 仍是命令薄壳，不代表真实 Repair Patch 生成和批准写回完成；后续必须接入 Studio 现有批准写回逻辑。

### 7. 关键风险点

- **并发问题**: 当前组件只声明命令契约，真实异步状态竞争留给后续查询缓存或事件流处理。
- **边界条件**: 空诊断、缺少 quickFixes、缺少 repairResult 时必须可渲染稳定空状态。
- **性能瓶颈**: 当前只处理小诊断列表；大量 Problems 后续应接虚拟列表。
- **安全考虑**: 按项目要求不新增安全设计；本任务只保留审计链，不引入绕行写入路径。

### 8. 外部资料与工具缺口

- **Context7**: 查询 `/reactjs/react.dev`，确认 `renderToStaticMarkup` 生成非交互静态 HTML，适合作为 SSR 契约测试依据。
- **GitHub 搜索**: 当前会话未暴露 `github.search_code` 工具；已记录缺口，改用项目内 5 个实现和官方 React 文档作为替代证据。
