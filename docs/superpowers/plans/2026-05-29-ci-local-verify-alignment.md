# CI Local Verify Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 GitHub CI 和本地验证共享同一个核心门禁命令，减少 push 噪音但保留自动门禁。

**Architecture:** 新增 `scripts/verify-ci.mjs` 作为唯一核心验证入口；`package.json` 和 `.github/workflows/ci.yml` 都调用它。E2E 保留为手动和夜间任务，不再默认卡 push/PR。

**Tech Stack:** Node.js ESM、pnpm、uv、GitHub Actions、PowerShell infra 验证脚本。

---

### Task 1: 共享验证脚本

**Files:**
- Create: `scripts/verify-ci.mjs`
- Modify: `package.json`

- [ ] **Step 1: 新增 `scripts/verify-ci.mjs`**

实现顺序执行：`pnpm run lint`、`pnpm --filter @storyforge/web lint`、`pnpm --filter @storyforge/shared test`、`pnpm --filter @storyforge/web test`、API pytest/ruff、Workflow pytest/ruff、`pnpm openapi`、OpenAPI diff 检查。

- [ ] **Step 2: 更新 package scripts**

设置 `verify` 和 `verify:ci` 都调用 `node scripts/verify-ci.mjs`，新增 `verify:infra` 保留现有 Docker/容器健康检查。

- [ ] **Step 3: 验证脚本语法**

运行：`node --check scripts/verify-ci.mjs`。

### Task 2: GitHub Actions 收敛

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/e2e.yml`

- [ ] **Step 1: 收敛 CI**

把多个重复 job 收敛为一个 `core-gate` job，安装 Node/Python/uv/依赖后运行 `pnpm run verify:ci`。

- [ ] **Step 2: 调整 E2E 触发**

将 E2E workflow 改为 `workflow_dispatch` 和每日夜间 `schedule`，移除 push/pull_request 默认触发。

- [ ] **Step 3: 本地同款验证**

运行：`pnpm run verify:ci`、`git diff --check`。