# 项目上下文摘要（storyforge-vscode-ide-p5-command-agent）

生成时间：2026-05-28 05:18:00

## 1. 相似实现分析

- **实现1**: `apps/web/components/ide/commands/command-client.ts`
  - 模式：前端写操作统一通过 `executeIdeCommand(commandId, args)` POST 到 `/api/ide/commands/{id}`。
  - 可复用：响应类型 `IdeCommandResponse`、动态导入 `apiFetch`。
  - 需注意：当前只有客户端薄壳，没有 registry、palette、keymap 或 Agent 工具边界。
- **实现2**: `apps/api/app/domains/ide/router.py`
  - 模式：IDE 聚合端点集中在同一 router；`/commands/{command_id}` 当前显式拒绝未知命令。
  - 可复用：`IdeCommandResult` 响应模型和 404 错误路径。
  - 需注意：P5 要把薄壳正式化，已知写命令必须返回可追溯 `audit_event_id`。
- **实现3**: `apps/web/components/ide/shell/RightDock.tsx`
  - 模式：右侧 Dock 已作为 AI Sidebar 集成位置，但目前只有占位文案。
  - 可复用：`RightDock` 布局和 aria-label。
  - 需注意：P5 应把 Agent Sidebar 放入 Right Dock，且所有写操作显示为通过 CommandRegistry。
- **实现4**: `apps/web/scripts/phase1-contract-test.mjs`
  - 模式：Web SSR/单元测试需要把生产模块登记进 `runtimeModules` 和 `importRewrites`。
  - 可复用：新增 `registry.ts`、`registerBuiltinCommands.ts`、`palette.tsx`、`keymap/index.ts`、`AgentSidebar.tsx` 时必须登记。

## 2. 项目约定

- API：继续使用 `apps/api/app/domains/ide/{schemas,service,router}.py` 分层。
- Web：IDE 交互组件放在 `apps/web/components/ide/` 下，SSR-safe 组件使用 `renderToStaticMarkup` 测试。
- 测试：API 使用 `uv run pytest`；Web 使用 `pnpm --filter @storyforge/web test` 的 `node:test` 合同测试脚本。
- 自然语言：文档、注释、UI 中文；命令 ID、代码标识符保持英文。

## 3. 可复用组件清单

- `IdeCommandResult`: `apps/api/app/domains/ide/schemas.py`
- `executeIdeCommand`: `apps/web/components/ide/commands/command-client.ts`
- `RightDock`: `apps/web/components/ide/shell/RightDock.tsx`
- `phase1-contract-test.mjs`: Web 本地合同测试转译入口。

## 4. 测试策略

- API：新增 `apps/api/tests/test_ide_command_registry.py`，覆盖已知命令 accepted、未知命令 404、Agent WS 写命令经同一命令执行器并返回 `audit_event_id`。
- Web：新增 `apps/web/tests/ide-command-registry.test.tsx`，覆盖 registry 注册/执行、palette 模糊匹配、keymap 查找、AgentSidebar 渲染命令工具入口。
- 契约：运行 `pnpm openapi` 确认 `/api/ide/commands/{command_id}` 正式请求体与 `/api/ide/agent/sessions/{session_id}` WS 路由存在于运行时；OpenAPI 不记录 WS 是 FastAPI 约束。

## 5. 依赖和集成点

- 外部依赖：不新增 Fuse.js 或 tinykeys，先用轻量本地过滤和 keymap，避免未确认依赖扩大面。
- 内部依赖：前端 registry handler 默认调用 `executeIdeCommand`；AgentSidebar 只展示并声明写工具走 `commands.execute`。
- API 集成：新增内存型命令目录与审计事件 ID 生成，作为后续接真实 audit_event 表的边界。

## 6. 技术选型理由

- P5 重点是统一命令面和 Agent 不绕过审计；当前先落 registry schema、palette/keymap/Agent 工具边界和 API 正式命令执行契约。
- 不引入新包，避免为了模糊搜索和快捷键提前扩大依赖；现有测试可验证核心契约。

## 7. 关键风险点

- `audit_event_id` 当前为命令执行器生成的追踪 ID，并非真实持久化 audit 表记录；报告中必须列为后续接入项。
- WS 端点不会进入 OpenAPI JSON；需用 TestClient websocket 作为权威验证。
- 100% 写操作静态扫描仍需后续补规则；本轮先把已知 P4 写入口和 Agent 工具收敛到 CommandRegistry 语义。
