# 项目上下文摘要（Task 7：前端工作台界面）

生成时间：2026-05-13 03:25:00 +08:00

## 1. 相似实现分析

- `apps/web/package.json`
  - 模式：当前前端子项目仅有 Next/React 依赖与配置检查脚本。
  - 可复用：使用 Next.js App Router 约定创建 `app/**/page.tsx`。
  - 注意：当前没有 ESLint/Vitest/Testing Library；测试需在现有依赖基础上保持本地可重复。
- `packages/shared/package.json`
  - 模式：使用 Node 脚本做轻量配置验证。
  - 可复用：前端测试可先使用 Node 内置脚本读取文件和断言静态契约，避免额外工具。
- `apps/api/tests/*`
  - 模式：测试说明和断言使用简体中文，覆盖交付物真实字段。
  - 可复用：前端测试也应检查页面标题、导航入口和组件关键内容。

## 2. 官方文档要点

- Context7 查询 `/vercel/next.js`：App Router 页面通过在 `app` 目录内创建 `page.tsx` 并默认导出 React 组件实现。
- 页面组件可使用 `next/link` 进行导航。

## 3. 项目约定

- 文案、标题、测试描述使用简体中文。
- React 组件使用 PascalCase，文件按组件名命名。
- 页面路径：`/studio`、`/refinery`、`/assets`、`/jobs`。

## 4. Task 7 交付物

- 页面：`apps/web/app/studio/page.tsx`、`refinery/page.tsx`、`assets/page.tsx`、`jobs/page.tsx`。
- 组件：`ScenePacketPanel.tsx`、`JudgeIssueList.tsx`、`RepairDiffViewer.tsx`。
- 测试：`apps/web/tests/phase1-navigation.test.tsx` 或可执行 JS 测试脚本。

## 5. 测试策略

- `pnpm test phase1-navigation`：验证首页可进入 Studio、Refinery、Asset Center、Job Center，且每页有明确中文标题。
- `pnpm test`：运行全部前端契约测试，覆盖 Scene Packet 证据链接、JudgeIssueList 严重级别和位置、RepairDiffViewer 原文与修订文本。
- `pnpm lint`：使用 TypeScript `tsc --noEmit` 检查页面和组件类型。

## 6. 风险点

- 当前无 tsconfig/app 目录，需补足 Next.js 最小工程文件。
- 若新增测试框架会扩大维护面；优先使用现有 Node/TypeScript 能力。
- 静态测试需覆盖具体页面/组件文件内容，避免只检查 package.json。


## 8. ??????

?????2026-05-13 03:11:31 +08:00

- ?? Context7 `/vercel/next.js` ???? App Router?`app/layout.tsx` ??????`app/**/page.tsx` ???????
- ??? Node ???????`apps/web/scripts/phase1-contract-test.mjs` ?????????????????????????
- ??? TypeScript ???????`@types/node`?`@types/react`?`@types/react-dom`??? `tsc --noEmit` ?? lint?
- ?????`pnpm test phase1-navigation`?`pnpm test`?`pnpm lint`?`pnpm --filter @storyforge/web test` ????
