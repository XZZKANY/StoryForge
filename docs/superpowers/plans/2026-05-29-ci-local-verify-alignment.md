# CI Local Verify Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让本地验证成为唯一核心门禁命令，远程 GitHub workflow 仅保留手动提示检查，避免把远程 CI 当成交付验收来源。

**Architecture:** 新增 `scripts/verify-local.mjs` 作为唯一核心本地验证入口；`package.json` 的 `verify` 调用它。GitHub workflow 仅保留 `workflow_dispatch`，不监听 push/PR/schedule。

**Tech Stack:** Node.js ESM、pnpm、uv、GitHub Actions、PowerShell infra 验证脚本。

---

### Task 1: 共享验证脚本

**Files:**
- Create: `scripts/verify-local.mjs`
- Modify: `package.json`

- [ ] **Step 1: 新增 `scripts/verify-local.mjs`**

实现顺序执行：`pnpm run lint`、`pnpm --filter @storyforge/web lint`、`pnpm --filter @storyforge/shared test`、`pnpm --filter @storyforge/web test`、API pytest/ruff、Workflow pytest/ruff、`pnpm openapi`、OpenAPI diff 检查。

- [ ] **Step 2: 更新 package scripts**

设置 `verify` 调用 `pnpm run verify:local`，`verify:local` 调用 `node scripts/verify-local.mjs`，保留 `verify:infra` 作为 Docker/容器健康检查。

- [ ] **Step 3: 验证脚本语法**

运行：`node --check scripts/verify-local.mjs`。

### Task 2: GitHub Actions 收敛

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/e2e.yml`

- [ ] **Step 1: 收敛 CI**

把多个重复 job 收敛为一个手动 `core-gate` job，安装 Node/Python/uv/依赖后运行 `pnpm run verify:local`。

- [ ] **Step 2: 调整 E2E 触发**

将 E2E workflow 改为仅 `workflow_dispatch`，移除 push/pull_request/schedule 默认触发。

- [ ] **Step 3: 本地同款验证**

运行：`pnpm run verify:local`、`git diff --check`。
