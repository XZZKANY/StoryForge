# P5 Command Registry + Agent Sidebar 操作日志

时间：2026-05-28 05:18:00

## 工具降级说明

- 用户规范要求的 sequential-thinking、shrimp-task-manager、desktop-commander、context7、github.search_code 在当前 Codex 工具集中不可用。
- 已降级为：PowerShell 聚焦文件操作、本地文件检索、Superpowers 写计划/TDD/验证技能、`pnpm`、`uv run pytest`、`pnpm openapi`。
- 未使用远程 CI 或人工外包验证。

## 编码前检查 - Command Registry + Agent Sidebar

- 已查阅主计划：`D:/StoryForge/.codex/storyforge-vscode-ide-master-plan.md` P5。
- 已生成上下文摘要：`.codex/context-summary-storyforge-vscode-ide-p5-command-agent.md`。
- 已生成实施计划：`.codex/storyforge-vscode-ide-p5-command-agent-plan.md`。
- 相似实现：
  - `apps/web/components/ide/commands/command-client.ts`：前端统一命令 POST 薄壳。
  - `apps/api/app/domains/ide/router.py`：IDE 聚合端点和 P1 命令薄壳。
  - `apps/web/components/ide/shell/RightDock.tsx`：AI Sidebar 集成位置。
  - `apps/web/scripts/phase1-contract-test.mjs`：SSR 合同测试转译机制。
- 可复用组件：`IdeCommandResult`、`executeIdeCommand`、`RightDock`、现有 `node:test` 与 pytest 编排。
- 不重复造轮子证明：未引入 Fuse.js/tinykeys 新依赖，先用轻量本地 registry/filter/keymap 满足 P5 核心契约。

## TDD 记录

### API RED

- 新增 `apps/api/tests/test_ide_command_registry.py`。
- 首次正确目录运行：`uv run pytest tests/test_ide_command_registry.py -q`。
- 预期失败：已知命令 `bookrun.start` 仍返回 404；Agent WS 端点不存在导致 websocket close。

### API GREEN

- 新增 `IdeCommandRequest`。
- 在 `apps/api/app/domains/ide/service.py` 增加内置命令目录、`IdeCommandNotFoundError`、`execute_ide_command_by_id`。
- 将 `POST /api/ide/commands/{command_id}` 正式化为已知命令返回 `audit_event_id`，未知命令 404。
- 新增 `WS /api/ide/agent/sessions/{session_id}`，Agent command 消息转发到同一命令执行器。
- 验证：`cd apps/api; uv run pytest tests/test_ide_command_registry.py tests/test_ide_commands.py -q`，5 passed。

### Web RED

- 新增 `apps/web/tests/ide-command-registry.test.tsx`。
- 运行：`pnpm --filter @storyforge/web test -- ide-command-registry`。
- 预期失败：缺少 `AgentSidebar`、registry、palette、keymap 等模块。

### Web GREEN

- 新增：
  - `apps/web/components/ide/commands/registry.ts`
  - `apps/web/components/ide/commands/registerBuiltinCommands.ts`
  - `apps/web/components/ide/commands/palette.tsx`
  - `apps/web/components/ide/keymap/index.ts`
  - `apps/web/components/ide/agent/AgentSidebar.tsx`
- 修改：
  - `apps/web/components/ide/shell/RightDock.tsx` 接入 `AgentSidebar`。
  - `apps/web/scripts/phase1-contract-test.mjs` 登记新增运行时模块和 import rewrite。
- 验证：`pnpm --filter @storyforge/web test -- ide-command-registry`，5 passed。

## 编码后声明 - Command Registry + Agent Sidebar

### 1. 复用了以下既有组件

- `executeIdeCommand`：registry 默认远程执行 handler 复用现有 API client。
- `IdeCommandResult`：API 和 Web 都沿用统一命令响应结构。
- `RightDock`：作为 Agent Sidebar 的 IDE 右侧 Dock 集成点。
- `phase1-contract-test.mjs`：沿用现有本地合同测试机制。

### 2. 遵循了以下项目约定

- API 仍在 `apps/api/app/domains/ide` 内按 schema/service/router 分层。
- Web 新模块按职责放入 `components/ide/commands`、`components/ide/keymap`、`components/ide/agent`。
- 测试沿用 `pytest` 和 `node:test`，未新增测试框架。
- UI 文案和注释使用简体中文；命令 ID 保持英文代码标识。

### 3. 对比了以下相似实现

- 与 P1 `command-client.ts` 相比：本轮增加本地 registry 与内置命令目录，但远程执行仍复用薄壳。
- 与 P4 `BookRunPanel` 相比：P4 只展示禁用写入口，本轮提供 `bookrun.*` 命令 ID 与统一执行路径。
- 与 `RightDock` 旧占位相比：本轮替换为 Agent 工具面板，并明确写操作经 `commands.execute`。

### 4. 未重复造轮子的证明

- 未接入真实模型或制品生成，Agent 仅暴露工具边界，不产生绕过审计链的写入。
- 未新增外部 fuzzy/keymap 依赖，避免过早扩大维护面。
- 未伪造真实持久化 audit 表；当前 `audit_event_id` 是命令执行追踪 ID，后续可替换为持久化审计记录 ID。

## 验证命令与结果

- `pnpm openapi`：通过，已刷新 OpenAPI 契约。
- `pnpm --filter @storyforge/web test`：94 passed，0 failed。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 退出码 0。
- `pnpm --filter @storyforge/shared test`：`tsc --noEmit` 退出码 0。
- `git diff --check`：退出码 0，仅有既有 CRLF 提示，无 whitespace error。
- `cd apps/api; uv run pytest tests/test_ide_command_registry.py tests/test_ide_commands.py tests/test_ide_run_events.py tests/test_ide_story_memory.py tests/test_ide_context_snapshot.py tests/test_ide_workspace_tree.py tests/test_ide_diagnostics.py -q`：17 passed。

## 风险与后续

- P5 的 `audit_event_id` 当前尚未持久化到 audit_event 表；后续需要接真实审计存储。
- WS 端点不会出现在 OpenAPI JSON 中，已通过 TestClient websocket 测试覆盖。
- 100% 写操作静态扫描规则尚未实现；当前已将新增 Agent 工具和内置写入口统一到 CommandRegistry。
