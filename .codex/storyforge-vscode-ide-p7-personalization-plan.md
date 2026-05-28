# StoryForge VS Code IDE P7 Personalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 实现 IDE 主题切换、键位自定义、布局持久化和编辑器 pop-out 新窗口入口。

**Architecture:** P7 采用纯 TypeScript 偏好工具作为核心，React 客户端组件只负责呈现与 localStorage 写入。URL 仍是分享态真相源，localStorage 只保存主题、键位、布局尺寸和多窗口偏好等非分享态。

**Tech Stack:** React 19、Next App Router、TypeScript、node:test、Tailwind/CSS variables、localStorage。

---

### Task 1: 个性化偏好核心模型

**Files:**
- Create: pps/web/components/ide/personalization/preferences.ts
- Test: pps/web/tests/ide-personalization.test.tsx

- [ ] **Step 1: Write failing tests**
  - 测试默认主题为 dark、解析损坏 JSON 回退默认值、合并布局与键位覆盖、生成 pop-out URL。
- [ ] **Step 2: Run red test**
  - pnpm --filter @storyforge/web test -- ide-personalization
  - Expected: FAIL，模块不存在。
- [ ] **Step 3: Implement preferences utilities**
  - 定义 IdePersonalizationPreferences、parseIdePreferences、serializeIdePreferences、mergeIdePreferences、createEditorPopoutUrl。
- [ ] **Step 4: Run green test**
  - pnpm --filter @storyforge/web test -- ide-personalization
  - Expected: PASS。

### Task 2: 键位自定义接入

**Files:**
- Modify: pps/web/components/ide/keymap/index.ts
- Test: pps/web/tests/ide-personalization.test.tsx

- [ ] **Step 1: Write failing tests**
  - 验证用户把 judge.run 改为 Alt+J 后，查找结果命中自定义键位且默认表不被修改。
- [ ] **Step 2: Run red test**
  - pnpm --filter @storyforge/web test -- ide-personalization
  - Expected: FAIL，缺少
esolveIdeKeymap。
- [ ] **Step 3: Implement keymap merge**
  - 新增
esolveIdeKeymap(customKeybindings)，
indCommandByShortcut 支持可选 keymap 参数。
- [ ] **Step 4: Run green test**
  - pnpm --filter @storyforge/web test -- ide-personalization
  - Expected: PASS。

### Task 3: IDE 壳层展示主题、布局、pop-out 入口

**Files:**
- Create: pps/web/components/ide/personalization/PersonalizationPanel.tsx
- Modify: pps/web/components/ide/shell/IdeShell.tsx
- Modify: pps/web/components/ide/shell/EditorArea.tsx
- Modify: pps/web/scripts/phase1-contract-test.mjs
- Test: pps/web/tests/ide-personalization.test.tsx

- [ ] **Step 1: Write failing tests**
  - 验证 PersonalizationPanel 渲染主题、键位、布局持久化文案。
  - 验证 IdeShell 中存在 data-testid="ide-personalization" 和 	arget="_blank" pop-out 链接。
- [ ] **Step 2: Run red test**
  - pnpm --filter @storyforge/web test -- ide-personalization
  - Expected: FAIL，组件未创建或脚本未转译。
- [ ] **Step 3: Implement components and script wiring**
  - PersonalizationPanel SSR-safe 展示偏好摘要；IdeShell header 接入；EditorArea 显示 active tab pop-out 链接。
- [ ] **Step 4: Run green test**
  - pnpm --filter @storyforge/web test -- ide-personalization
  - Expected: PASS。

### Task 4: 全量验证与报告

**Files:**
- Create: .codex/operations-log-p7-personalization.md
- Create: .codex/verification-report-ide-p7.md

- [ ] **Step 1: Run web tests**
  - pnpm --filter @storyforge/web test
- [ ] **Step 2: Run type checks**
  - pnpm --filter @storyforge/web lint
  - pnpm --filter @storyforge/shared test
- [ ] **Step 3: Run diff check**
  - git diff --check
- [ ] **Step 4: Write logs and verification report**
  - 记录 RED/GREEN、命令结果、风险和后续审计事项。
