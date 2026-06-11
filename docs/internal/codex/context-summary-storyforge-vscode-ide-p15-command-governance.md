## 项目上下文摘要（StoryForge VSCode IDE P1.5 命令治理）

生成时间：2026-05-28 14:25:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/ide/commands/palette.tsx`
  - 模式：`filterCommands` 按命令 ID、标题、分类过滤，`CommandPalette` 渲染列表。
  - 可复用：命令展示和搜索逻辑。
  - 需注意：当前没有执行按钮和 `onExecuteCommand` 契约。
- **实现2**: `apps/web/components/ide/keymap/index.ts`
  - 模式：`ideKeymap` 定义快捷键到 commandId 的映射，`findCommandByShortcut` 解析快捷键。
  - 可复用：快捷键解析和自定义覆盖合并。
  - 需注意：当前没有统一调用 `CommandRegistry.execute` 的 helper。
- **实现3**: `apps/web/components/ide/agent/AgentSidebar.tsx`
  - 模式：从 `builtinCommands` 过滤 Agent 可用工具并显示约束说明。
  - 可复用：工具命令来源和 Agent 工具列表。
  - 需注意：当前缺少机器可读 command 消息 payload 和 `data-command-id`。
- **实现4**: `apps/api/tests/test_ide_command_registry.py`
  - 模式：后端已测试 Agent WebSocket 只能发送 command，并返回 `audit_event_id` 或未知命令错误。
  - 可复用：后端治理证据。
  - 需注意：本切片不重复后端 WS 实现，只补前端契约。
### 2. 项目约定

- **命名约定**: 命令 ID 使用点分命名；React 组件 PascalCase；helper 使用 camelCase。
- **文件组织**: 命令面板在 `components/ide/commands/`，快捷键在 `components/ide/keymap/`，Agent UI 在 `components/ide/agent/`。
- **导入顺序**: 类型导入使用 `import type`，项目相对导入保持局部模块边界。
- **代码风格**: readonly props，SSR 测试用 `data-*` 证明契约。

### 3. 可复用组件清单

- `CommandRegistry`: `register/list/get/execute` 是唯一命令执行接口。
- `builtinCommands`: 前端命令目录。
- `filterCommands`: 命令面板搜索逻辑。
- `findCommandByShortcut`: 快捷键到命令 ID 的解析逻辑。

### 4. 测试策略

- **测试框架**: Web 使用 `node:test` + `renderToStaticMarkup`。
- **参考文件**: `apps/web/tests/ide-command-registry.test.tsx`、`apps/api/tests/test_ide_command_registry.py`。
- **覆盖要求**: 命令面板执行按钮、快捷键统一调用 registry、Agent 工具 command payload、后端 WS 既有治理测试。

### 5. 依赖和集成点

- **内部依赖**: `CommandPalette` 和 `executeShortcutCommand` 都只调用 `CommandRegistry.execute`。
- **后端集成**: Agent WebSocket 已通过 `/api/ide/agent/sessions/{session_id}` 转发到 `execute_ide_command_by_id`。
- **配置来源**: `builtinCommands` 和 `ideKeymap`。

### 6. 技术选型理由

- **为什么用这个方案**: 任务 D 要统一命令入口，不需要新增命令系统；扩展现有组件和 helper 即可形成可验证治理链。
- **优势**: 小改动、强契约、可由 SSR 和单元测试直接验证。
- **劣势和风险**: 真实键盘监听仍需后续接入 tinykeys 或浏览器事件绑定，本切片先保证执行 helper 正确。

### 7. 关键风险点

- **边界条件**: 未匹配快捷键时应返回 undefined，不执行命令。
- **审计链**: 所有写命令仍由 `CommandRegistry.execute` 间接调用 `/api/ide/commands/{id}`。
- **测试缺口**: 浏览器级快捷键事件未覆盖，后续 e2e 可补。
