## 项目上下文摘要（fix-home-regression）

生成时间：2026-06-09 17:35:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/app/layout.tsx`
  - 模式：根布局通过 `Chrome` 包裹全部页面内容。
  - 可复用：`Chrome` 作为全站外壳唯一入口。
  - 需注意：不要在首页绕过根布局，否则 `/` 与其他页面会出现两套导航。
- **实现2**: `apps/web/components/site-nav/Chrome.tsx`
  - 模式：只负责装配 `UnifiedSidebar` 和右侧 `main`。
  - 可复用：`UnifiedSidebar`。
  - 需注意：不得再保留 `pathname === '/'`、`return <>{children}</>` 或 `usePathname` 首页分叉残留。
- **实现3**: `apps/web/components/site-nav/UnifiedSidebar.tsx`
  - 模式：统一承载主导航、最近记录、账号菜单和主题切换。
  - 可复用：`RecentItemsList`、`ThemeToggle`、`CollapsibleNavItem`、`StudioProjectsList`。
  - 需注意：`usePathname` 只用于 active 状态，不应上移为 `Chrome` 的布局分叉。
- **实现4**: `apps/web/components/home/HomeShell.tsx`
  - 模式：首页只承载右侧 Assistant、Projects、Artifacts 内容。
  - 可复用：`AssistantConversation`、`HomeProjectsPanel`、`ArtifactsPageContent`、`readHomeProjects`。
  - 需注意：不得再导入 `HomeSidebar`，不得自建 `md:grid-cols-[288px_minmax(0,1fr)]` 旧双栏壳。

### 2. 项目约定

- **命名约定**: React 组件使用 PascalCase，helper 使用 camelCase，测试描述使用简体中文。
- **文件组织**: 全局导航在 `components/site-nav`，首页内容在 `components/home`，首页入口在 `app/page.tsx`。
- **导入顺序**: React/Next 类型在前，内部组件和 helper 在后，类型导入使用 `type`。
- **代码风格**: Next App Router 根布局提供共享 UI，客户端交互组件使用 `'use client'`。

### 3. 可复用组件清单

- `apps/web/components/site-nav/UnifiedSidebar.tsx`: 全站唯一主侧栏。
- `apps/web/components/site-nav/RecentItemsList.tsx`: 最近记录展示。
- `apps/web/components/site-nav/ThemeToggle.tsx`: 主题切换。
- `apps/web/components/home/HomeShell.tsx`: 首页右侧内容壳。
- `apps/web/components/home/home-view.ts`: 首页 query 到 `HomeView` 的解析入口。
### 4. 测试策略

- **测试框架**: `node:test` + `node:assert/strict`，由 `apps/web/scripts/phase1-contract-test.mjs` 转译执行。
- **红灯证据**: 新增 `Chrome 不应再依赖路径为首页分叉布局` 断言后，`pnpm.cmd --filter @storyforge/web test home-page` 失败 1 项，证明测试能抓住 `usePathname` 残留。
- **绿灯策略**: 删除 `Chrome` 中 `usePathname` 导入与变量，确认首页和设置页都通过统一 `Chrome` 渲染 `UnifiedSidebar`。
- **浏览器验证**: Playwright 打开 `http://localhost:3000/` 和 `/settings`，截图均显示同一套左侧导航。

### 5. 依赖和集成点

- **外部依赖**: Next.js App Router、React、lucide-react、Playwright。
- **内部依赖**: `RootLayout` -> `Chrome` -> `UnifiedSidebar` + `children`；`HomePage` -> `HomeShell` -> 首页右侧内容。
- **配置来源**: 当前变更不新增配置；保留既有 API client 与项目读取路径。
- **路由集成**: `/`、`/settings` 共享同一全局导航壳，不再让首页拥有专属侧栏事实源。
### 6. 技术选型理由

- **为什么用这个方案**: 用户期望首页与设置页使用同一套新导航；Next.js 根布局本身适合提供共享外壳，避免页面各自维护侧栏。
- **优势**: 删除旧 `HomeSidebar` 后，旧界面没有可复活的组件入口；测试同时禁止首页绕过 `Chrome`。
- **劣势和风险**: `UnifiedSidebar` 现在成为全站关键组件，后续导航改动必须覆盖首页与设置页截图或 DOM 验证。

### 7. 关键风险点

- **边界条件**: 首页 query `?view=projects` 和 `?view=artifacts` 仍由 `HomeShell` 处理右侧内容，不影响全局侧栏。
- **性能瓶颈**: `HomeShell` 只在 Projects 视图读取项目列表，Assistant 首屏不额外读取 Projects。
- **安全考虑**: 本次不改认证、API Key 或服务端代理；删除旧侧栏不会削弱安全基线。

### 8. 外部资料来源

- Context7 `/vercel/next.js`: 确认 App Router root layout 会包裹 nested routes/pages，并且服务端 layout 可以导入客户端布局组件提供共享 UI。
- 本地 Playwright: 用真实浏览器渲染验证 `http://localhost:3000/` 与 `/settings` 左侧导航一致。
