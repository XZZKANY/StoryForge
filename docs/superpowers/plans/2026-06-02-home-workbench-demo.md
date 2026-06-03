# Home Workbench Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 制作桌面端首页工作台演示版，让 New project、Projects、Artifacts 按创作生命周期组织，Customize 并入项目偏好。

**Architecture:** 首页仍由 `HomeShell` 按 `view` query 切换主内容；`home-view.ts` 定义允许的 view，`home-data.ts` 定义左侧导航。演示版复用 `BlueprintWorkspacePanel`、`StudioWorkbench`、`ArtifactsPageContent`、`CreativePreferencesPanel`，只调整首页包装、文案和导航，不伪造真实数据。

**Tech Stack:** Next.js App Router、React Server/Client Components、TypeScript、Node test 契约测试、Tailwind CSS。

---

### Task 1: 契约测试红灯

**Files:**
- Modify: `apps/web/tests/home-page.test.tsx`
- Modify: `apps/web/tests/phase1-navigation.test.tsx`
- Modify: `apps/web/tests/settings-page.test.ts`

- [ ] **Step 1: 写失败测试**
  - `homeViews` 只允许 `assistant/new-project/projects/artifacts`。
  - 左侧导航不再包含 `Customize 创作偏好`。
  - `HomeShell` 必须包含 `当前项目工作台`、`Overview`、`Blueprint`、`Write`、`Review`、`Artifacts`、`Preferences`。
  - `CreativePreferencesPanel` 必须出现在 New project 和 Projects 中。

- [ ] **Step 2: 运行红灯**
  - Run: `pnpm --filter @storyforge/web test -- home-page phase1-navigation settings-page`
  - Expected: FAIL，失败原因指向旧 `customize` view 和缺失的新工作台文案。

### Task 2: 实现演示结构

**Files:**
- Modify: `apps/web/components/home/home-view.ts`
- Modify: `apps/web/components/home/home-data.ts`
- Modify: `apps/web/components/home/HomeComposer.tsx`
- Modify: `apps/web/components/home/HomeShell.tsx`

- [ ] **Step 1: 移除独立 Customize view**
  - `homeViews` 删除 `customize`。
  - `homeNavItems` 删除 Customize。

- [ ] **Step 2: New project 改为创建向导**
  - 包装 `BlueprintWorkspacePanel`。
  - 嵌入 `CreativePreferencesPanel` 作为创建前偏好。

- [ ] **Step 3: Projects 改为当前项目工作台**
  - 顶部显示当前项目工作台和下一步。
  - 内部分区为 Overview、Blueprint、Write、Review、Artifacts、Preferences。
  - 复用 `StudioWorkbench` 和 `CreativePreferencesPanel`。

- [ ] **Step 4: Artifacts 改为当前项目产物库**
  - 包装 `ArtifactsPageContent`。
  - 文案强调当前项目产物、导出、审计和版本追溯。

### Task 3: 验证

**Files:**
- Modify: `.codex/verification-report.md`

- [ ] **Step 1: 运行定向测试**
  - Run: `pnpm --filter @storyforge/web test -- home-page phase1-navigation settings-page`
  - Expected: PASS。

- [ ] **Step 2: 运行类型检查**
  - Run: `pnpm --filter @storyforge/web lint`
  - Expected: PASS。

- [ ] **Step 3: 浏览器验证**
  - 使用 in-app browser 或本机 Chrome Playwright 验证 `/?view=new-project`、`/?view=projects`、`/?view=artifacts` 不显示错误页。
