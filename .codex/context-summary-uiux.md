## 项目上下文摘要（UI/UX 优化）

生成时间：2026-06-01 15:33:05 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/home/HomeShell.tsx`
  - 模式：首页采用专用组件组合，`app/page.tsx` 保持薄入口。
  - 可复用：`HomeSidebar`、`HomeComposer`、`HomeQuickActions`、`HomeContextStrip`。
  - 需注意：首页在 `Chrome` 中跳过全局 `SiteNav`，视觉与其他页面隔离。
- **实现2**: `apps/web/components/ide/shell/IdeShell.tsx`
  - 模式：深色生产力工作台，使用 CSS 变量控制左右和底部面板尺寸。
  - 可复用：工作台式信息密度、URL 状态同步、面板分区。
  - 需注意：当前 IDE 组件多为深色 `stone` 体系，与首页深色但不同色板。
- **实现3**: `apps/web/app/studio/StudioFlow.tsx`
  - 模式：客户端步骤流，使用完成、当前、等待三种状态 class。
  - 可复用：步骤状态、自动滚动、`aria-current="step"` 可访问性模式。
  - 需注意：Studio 仍偏浅色卡片和大圆角，与首页/IDE 视觉断裂。
- **实现4**: `apps/web/components/site-nav/SiteNav.tsx`
  - 模式：移动端折叠侧栏，桌面端固定导航。
  - 可复用：`aria-expanded`、遮罩关闭、`primaryNavLinks` 数据驱动菜单。
  - 需注意：全局导航使用浅色默认和暗色变体，首页另有专用侧栏数据。

### 2. 项目约定

- **命名约定**: React 组件使用 PascalCase；数据常量使用 camelCase；测试名称使用中文描述。
- **文件组织**: `apps/web/app/*/page.tsx` 倾向薄入口；共享 UI 位于 `apps/web/components/*`；首页专用组件位于 `apps/web/components/home`。
- **导入顺序**: 外部库优先，然后空行分隔内部组件和本地数据。
- **代码风格**: TypeScript、React 函数组件、Tailwind utility class；项目已有 Prettier 配置。
- **语言要求**: 用户侧、文档、注释、测试描述必须使用简体中文；代码标识符保留既有英文风格。

### 3. 可复用组件清单

- `apps/web/components/home/home-data.ts`: 首页导航、快捷动作、空状态文案。
- `apps/web/components/site-nav/site-nav-links.ts`: 全局导航事实源。
- `apps/web/components/ui/LoadingSkeleton.tsx`: 加载骨架模式。
- `apps/web/components/ui/ErrorCard.tsx`: 错误提示卡片。
- `apps/web/components/judge-panel/JudgeIssueList.tsx`: 评审问题列表和批量操作。
- `apps/web/components/diff-viewer/RepairDiffViewer.tsx`: 修订差异展示。

### 4. 测试策略

- **测试框架**: Node 内置 `node:test`，结合 `react-dom/server` 的静态渲染断言。
- **测试模式**: 文本契约测试、组件静态渲染测试、少量命令/状态纯函数测试。
- **参考文件**:
  - `apps/web/tests/home-page.test.tsx`
  - `apps/web/tests/phase1-navigation.test.tsx`
  - `apps/web/tests/studio.test.tsx`
  - `apps/web/tests/ide-components.test.tsx`
- **覆盖要求**: UI 优化需覆盖核心文案、真实路由、可访问性属性、响应式 class、禁止虚假能力文案。
- **本地命令**: `pnpm --filter @storyforge/web test`、`pnpm --filter @storyforge/web lint`，必要时运行根级 `pnpm verify`。

### 5. 依赖和集成点

- **外部依赖**: Next.js 15.3.2、React 19.1.0、Tailwind CSS 4.3.0、Zustand、CodeMirror。
- **内部依赖**: `Chrome` 根据 pathname 控制全局导航；首页快捷动作映射到既有路由；IDE 旧页面通过 redirect 进入 `/ide`。
- **集成方式**: 页面薄入口组合组件；交互组件使用 `'use client'`；服务端页面通过 API client 读取数据。
- **配置来源**: `apps/web/package.json`、`apps/web/next.config.ts`、`apps/web/app/globals.css`。

### 6. 技术选型理由

- **为什么用这个方案**: 现有项目已采用 Next App Router 与 Tailwind utility class，继续局部组件级优化可降低改动面。
- **优势**: 可复用既有测试契约；保持页面入口轻薄；减少后端契约风险。
- **劣势和风险**: 首页、IDE、Studio、全局导航目前视觉不统一；全局 CSS 对 `section`、`nav li` 有默认卡片样式，局部组件经常用 `!` 覆盖。

### 7. 关键风险点

- **并发问题**: UI 本身无并发风险，但客户端状态如 IDE 面板和主题切换需保持 URL/本地存储同步。
- **边界条件**: 移动端导航、长中文文案、按钮换行、空状态和暗色模式。
- **性能瓶颈**: 避免大范围动画、复杂阴影和不必要客户端化；Next 文档建议布局默认保留 Server Component，只把交互小组件客户端化。
- **安全考虑**: 不削弱已有 API Key 注入、写操作 CommandRegistry、Provider 检测和审计入口。

### 8. 外部资料来源与工具缺口

- **Context7 / Next.js**: 查询 `/vercel/next.js`，确认 App Router layout 组合、薄页面、客户端组件隔离与 `router.push()` 事件导航模式。
- **Context7 / Tailwind CSS**: 查询 `/tailwindlabs/tailwindcss.com`，确认响应式、data 属性、hover/focus/dark 变体可组合使用。
- **工具缺口**: 当前会话未暴露 `desktop-commander` 与 `github.search_code`，已使用 PowerShell、`rg`、Context7 作为替代，并在操作日志记录。

### 9. 充分性检查

- 能定义接口契约：是。UI 优化应保持现有路由、组件 props 与测试入口不破坏。
- 理解技术选型：是。Next App Router + Tailwind 是既有栈，优先复用。
- 识别主要风险：是。重点风险是视觉体系断裂、全局样式覆盖、移动端溢出和测试契约漂移。
- 知道如何验证：是。Web 测试、TypeScript 检查、必要时 Playwright/截图验证。
