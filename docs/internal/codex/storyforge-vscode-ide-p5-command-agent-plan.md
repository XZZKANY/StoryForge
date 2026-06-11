# Command Registry + Agent Sidebar P5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 IDE 写操作收敛到 CommandRegistry，并提供 Agent Sidebar 的命令工具边界，确保 Agent 写操作只能通过命令系统产生可追溯结果。

**Architecture:** API 将 `/api/ide/commands/{command_id}` 从薄壳升级为正式命令执行器，返回 `audit_event_id` 和命令元数据；新增 Agent WS 端点，收到写命令时调用同一执行器。Web 新增 `CommandRegistry`、内置命令注册、Palette、keymap 与 `AgentSidebar`，Right Dock 渲染 Agent 工具入口。

**Tech Stack:** FastAPI + WebSocket；React SSR；TypeScript 纯 registry；pytest；node:test。

---

### Task 1: API Command Registry

**Files:**
- Modify: `apps/api/app/domains/ide/schemas.py`
- Modify: `apps/api/app/domains/ide/service.py`
- Modify: `apps/api/app/domains/ide/router.py`
- Test: `apps/api/tests/test_ide_command_registry.py`

- [ ] Write failing tests for accepted known command, unknown command 404, and Agent WS command execution.
- [ ] Run RED: `cd apps/api; uv run pytest tests/test_ide_command_registry.py -q`.
- [ ] Add `IdeCommandRequest`, command metadata, `execute_ide_command_by_id`, and websocket route.
- [ ] Run GREEN with the same command.

### Task 2: Web CommandRegistry, Palette, Keymap, AgentSidebar

**Files:**
- Create: `apps/web/components/ide/commands/registry.ts`
- Create: `apps/web/components/ide/commands/registerBuiltinCommands.ts`
- Create: `apps/web/components/ide/commands/palette.tsx`
- Create: `apps/web/components/ide/keymap/index.ts`
- Create: `apps/web/components/ide/agent/AgentSidebar.tsx`
- Modify: `apps/web/components/ide/shell/RightDock.tsx`
- Modify: `apps/web/scripts/phase1-contract-test.mjs`
- Test: `apps/web/tests/ide-command-registry.test.tsx`

- [ ] Write failing tests for command execution, palette filtering, keymap lookup, and AgentSidebar rendering.
- [ ] Run RED: `pnpm --filter @storyforge/web test -- ide-command-registry`.
- [ ] Implement minimal registry and UI wiring.
- [ ] Run GREEN with the same command.

### Task 3: Verification and Documentation

- [ ] Run `pnpm openapi`.
- [ ] Run `cd apps/api; uv run pytest tests/test_ide_command_registry.py tests/test_ide_commands.py -q`.
- [ ] Run `pnpm --filter @storyforge/web test`, `pnpm --filter @storyforge/web lint`, `pnpm --filter @storyforge/shared test`.
- [ ] Run `git diff --check`.
- [ ] Write `.codex/operations-log-p5-command-agent.md` and `.codex/verification-report-ide-p5.md`.

---

## Self-Review

- 覆盖 P5 关键文件：`registry.ts`、`registerBuiltinCommands.ts`、`palette.tsx`、`keymap/index.ts`、`AgentSidebar.tsx`。
- 覆盖 API 改动：`POST /ide/commands/{id}` 正式化与 `WS /ide/agent/sessions/{id}`。
- 覆盖退出标准的可验证子集：已知写命令统一走 CommandRegistry；Agent WS 写命令调用同一命令执行器并返回 `audit_event_id`。
- 不伪造真实持久化 audit 表，明确将当前 `audit_event_id` 作为后续接表边界。
