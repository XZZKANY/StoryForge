## 项目上下文摘要（UIUX 主界面优化）

生成时间：2026-06-02 02:30

### 1. 相似实现分析

- **实现1**: `apps/web/components/home/HomeProjectsPanel.tsx`
  - 模式：`max-w-[770px]` 内容宽度，透明外层，标题与操作控件直接落在页面上。
  - 可复用：页面比例、去卡片化 section 约束、真实 `button` 交互。
  - 需注意：本地项目读取放在 `useEffect`，避免预渲染阶段访问浏览器对象。
- **实现2**: `apps/web/components/home/HomeShell.tsx`
  - 模式：通过 `activeView` 在右侧主区域切换整块内容，Assistant 与子页共用右侧背景。
  - 可复用：Assistant 使用 `max-w-[770px]`，子页重置全局 section 卡片样式。
  - 需注意：不要恢复 `flex-1` 居中英雄布局。
- **实现3**: `apps/web/components/home/HomeSidebar.tsx`
  - 模式：左侧导航只保留 Projects 与 Artifacts，底部工作区菜单承载设置入口。
  - 可复用：`createHomeViewHref` 导航、真实 Link 跳转。
  - 需注意：最近记录必须由上游真实数据传入，不能内置伪历史。

### 2. 项目约定

- **命名约定**: React 组件使用 PascalCase，函数和状态使用 camelCase。
- **文件组织**: 首页 UI 集中在 `apps/web/components/home/`，页面入口由 `apps/web/app/page.tsx` 调用 `HomeShell`。
- **导入顺序**: 外部依赖在前，内部模块在后。
- **代码风格**: TypeScript + React + Tailwind 原子类，测试使用 `node:test` 读取源码进行契约断言。

### 3. 可复用组件清单

- `apps/web/components/home/createHomeViewHref`: 生成首页子页 query 链接。
- `apps/web/components/home/HomeProjectsPanel.tsx`: Projects 的桌面比例和去卡片化参考。
- `apps/web/components/home/HomeShell.tsx`: 右侧主内容布局与 view 分发。

### 4. 测试策略

- **测试框架**: `node:test`，由 `pnpm --filter @storyforge/web test` 执行。
- **测试模式**: 源码契约测试 + TypeScript lint。
- **参考文件**: `apps/web/tests/home-page.test.tsx`。
- **覆盖要求**: 主界面比例、无大卡片、真实提交/导航、无渲染期当前时间水合风险。

### 5. 依赖和集成点

- **外部依赖**: Next.js App Router、React、Tailwind CSS。
- **内部依赖**: `HomeShell` -> `HomeGreeting` / `HomeComposer` / `HomeProjectsPanel` / `ArtifactsPageContent`。
- **集成方式**: `view` query 驱动右侧整块内容切换。
- **配置来源**: `apps/web/package.json` 中 `lint` 和 `test` 脚本。

### 6. 技术选型理由

- **为什么用这个方案**: 用户要求主界面跟 Projects 同一比例且不要大卡片，直接调整现有组件最小、最符合边界。
- **优势**: 不新增依赖，不改变路由契约，按钮保持真实可用。
- **劣势和风险**: 当前仍是桌面优先，移动端后续需要单独调。

### 7. 关键风险点

- **并发问题**: 无共享异步写入，本轮不涉及。
- **边界条件**: 表单未水合时仍应 GET 到 `/?view=projects`。
- **性能瓶颈**: 无新增昂贵计算。
- **安全考虑**: 不新增外部输入执行路径，保留 URLSearchParams 编码。
