# 首页视觉一致性实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将实际 Next 首页 `http://127.0.0.1:3000/?intent=111` 调整为已确认静态预览的深色极简首页，同时保持 StoryForge 的 Blueprint、BookRun、Studio、Retrieval、Artifacts、Runs 业务入口。

**Architecture:** 保留现有 `app/page.tsx` 薄入口和 `components/home/*` 拆分结构，只重写首页组件的视觉 class 与少量文案/结构。快捷动作继续使用现有路由跳转，不新增后端契约，不修改 OpenAPI。

**Tech Stack:** Next.js App Router、React 19、TypeScript、Tailwind CSS 4、Node 内置测试。

---

### Task 1: 更新首页视觉契约测试

**Files:**
- Modify: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\web\tests\phase1-navigation.test.tsx`

- [ ] **Step 1: 写入失败测试**

在 `首页只保留真实数据流入口并删除占位页` 测试后追加一个测试，完整代码如下：

```ts
test('首页采用深色创作入口并保留 StoryForge 业务动作', () => {
  const home =
    read('components/home/HomeShell.tsx') +
    '\n' +
    read('components/home/HomeSidebar.tsx') +
    '\n' +
    read('components/home/HomeComposer.tsx') +
    '\n' +
    read('components/home/HomeQuickActions.tsx') +
    '\n' +
    read('components/home/HomeContextStrip.tsx') +
    '\n' +
    read('components/home/home-data.ts');

  for (const required of [
    'grid-cols-[290px_1fr]',
    'bg-[#1f1f1d]',
    'font-serif',
    '今天要锻造哪段故事？',
    '输入故事想法、章节目标或修订要求',
    '创建 Blueprint',
    '启动 BookRun',
    '审阅并批准',
    '核对证据',
    '导出审计',
    '当前作品',
    '运行状态',
    '下一步建议',
  ] as const) {
    assert.ok(home.includes(required), `首页应包含 StoryForge 首页元素：${required}`);
  }

  for (const forbidden of ['Code', 'Learn', 'Life stuff', "Claude's choice"] as const) {
    assert.ok(!home.includes(forbidden), `首页不应残留无关 Claude 分类：${forbidden}`);
  }
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\web
pnpm test
```

Expected: FAIL，失败原因至少包含 `grid-cols-[290px_1fr]` 或 `bg-[#1f1f1d]` 未出现。

### Task 2: 重写首页组件视觉

**Files:**
- Modify: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\web\components\home\HomeShell.tsx`
- Modify: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\web\components\home\HomeSidebar.tsx`
- Modify: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\web\components\home\HomeComposer.tsx`
- Modify: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\web\components\home\HomeQuickActions.tsx`
- Modify: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\web\components\home\HomeContextStrip.tsx`
- Modify: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\web\components\home\home-data.ts`

- [ ] **Step 1: 保持业务数据，补充最近记录结构**

在 `home-data.ts` 增加 `HomeRecentItem` 类型和 `homeRecentItems` 空状态列表，导航和快捷动作保持现有路由。不得加入 Code/Learn/Life stuff。

- [ ] **Step 2: 将 `HomeShell` 改为固定高度深色两栏布局**

使用 `min-h-screen bg-[#1f1f1d] text-[#e8decb] md:grid md:grid-cols-[290px_1fr]`，顶部状态胶囊居中，主内容居中。

- [ ] **Step 3: 将 `HomeSidebar` 改为新首页侧边栏**

使用深色侧栏、顶部 StoryForge serif 标识、导航列表、最近记录和底部本地工作区块。导航仍使用真实 `Link`。

- [ ] **Step 4: 将 `HomeComposer` 改为居中大标题和大输入框**

标题使用 `font-serif`、45px 近似大小，输入框为 `132px` 高深色圆角面板，底部包含“附加资料 / 世界观 / 上章摘要”、模式、开始按钮。提交仍默认 `router.push('/blueprints')`。

- [ ] **Step 5: 将 `HomeQuickActions` 改为胶囊按钮组**

保留 5 个动作，使用深灰胶囊按钮视觉和真实 Link。

- [ ] **Step 6: 将 `HomeContextStrip` 改为三张深色状态卡**

展示当前作品、运行状态、下一步建议；使用真实空状态文案，不伪造成功态。

### Task 3: 验证和截图对比

**Files:**
- Modify: `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\verification-report.md`

- [ ] **Step 1: 运行 Web 测试**

Run:

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\web
pnpm test
```

Expected: PASS。

- [ ] **Step 2: 运行 TypeScript 检查**

Run:

```powershell
cd D:\StoryForge\1-renovel-ai-ai-rag-tavern\apps\web
pnpm lint
```

Expected: PASS。

- [ ] **Step 3: 对本地页面截图**

若 dev server 已在 3000 运行，访问 `http://127.0.0.1:3000/?intent=111` 生成截图到：

```text
D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\visual-preview\next-home-3000-after.png
```

- [ ] **Step 4: 更新验证报告**

在 `.codex/verification-report.md` 追加本次本地验证时间、命令、结果和截图路径。
