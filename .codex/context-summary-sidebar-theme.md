## 项目上下文摘要（侧边栏主题颜色修复）

生成时间：2026-06-10 11:06:42 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/site-nav/UnifiedSidebar.tsx`
  - 模式：主导航项用 `isActive` 拼接 Tailwind 类，普通态 `text-muted-foreground`，激活态 `text-foreground`。
  - 可复用：现有 `primaryNavItems`、`aria-current`、`transition-colors`、`rounded-full` 结构。
  - 需注意：当前仍使用 `bg-nav-active`、`bg-nav-hover` 和底部 `text-accent`，会引入独立暖色系。
- **实现2**: `apps/web/components/site-nav/CollapsibleNavItem.tsx`
  - 模式：折叠菜单与普通导航共享相同 active/hover 拼接逻辑。
  - 可复用：同样的 `text-muted-foreground` 与 `text-foreground` 文字层级。
  - 需注意：用户截图中的“创作工作台”走该组件，必须同步修复。
- **实现3**: `apps/web/components/site-nav/RecentItemsList.tsx`
  - 模式：侧栏子列表使用 `text-muted-foreground`，hover 后提升到 `text-foreground`。
  - 可复用：保留子项轻量字重和语义文字 token。
  - 需注意：hover 背景仍使用 `bg-nav-hover`。
- **实现4**: `apps/web/components/site-nav/StudioProjectsList.tsx`
  - 模式：折叠后的项目链接使用轻量 `text-xs text-muted-foreground`。
  - 可复用：子导航不需要额外强调字重，hover 只提升前景色。
  - 需注意：仍使用 `hover:bg-nav-hover`。
- **实现5**: `apps/web/components/site-nav/ThemeToggle.tsx`
  - 模式：图标按钮使用 `text-muted-foreground` 与 `hover:text-foreground`。
  - 可复用：图标按钮尺寸和主题切换逻辑保持不变。
  - 需注意：hover 背景仍使用旧导航 token。

### 2. 项目约定

- **命名约定**: React 组件使用 PascalCase，布尔状态使用 `is*`，只读 props 使用 `readonly`。
- **文件组织**: 站点导航组件集中在 `apps/web/components/site-nav/`，测试集中在 `apps/web/tests/`。
- **导入顺序**: 外部库导入在前，项目内相对导入在后，类型导入用 `import type`。
- **代码风格**: TypeScript 严格模式，Tailwind 类直接写在 `className` 字符串中，测试使用中文断言说明。
### 3. 可复用组件清单

- `apps/web/components/site-nav/CollapsibleNavItem.tsx`: “创作工作台”折叠主项。
- `apps/web/components/site-nav/StudioProjectsList.tsx`: 工作台子项目列表。
- `apps/web/components/site-nav/RecentItemsList.tsx`: 最近记录子列表。
- `apps/web/components/site-nav/ThemeToggle.tsx`: 底部主题切换按钮。
- `apps/web/app/globals.css`: Tailwind 4 `@theme` 颜色 token 来源。

### 4. 测试策略

- **测试框架**: `node:test` + `node:assert/strict`。
- **测试模式**: `apps/web/scripts/phase1-contract-test.mjs` 执行 `apps/web/tests/*.test.tsx`。
- **参考文件**: `apps/web/tests/phase1-navigation.test.tsx` 通过读取源码建立导航契约。
- **覆盖要求**: 新增源码契约测试，检查侧栏不再依赖棕色/导航专属 token，并要求使用 `text-muted-foreground`、`text-foreground`、`bg-muted`。

### 5. 依赖和集成点

- **外部依赖**: Next.js 15.3.2、React 19.1.0、Tailwind CSS 4.3.0、lucide-react。
- **内部依赖**: `UnifiedSidebar` 调用 `CollapsibleNavItem`、`StudioProjectsList`、`RecentItemsList`、`ThemeToggle`。
- **集成方式**: `ThemeToggle` 通过 `document.documentElement.dataset.theme = 'dark'` 触发 `globals.css` 的 dark variant。
- **配置来源**: `apps/web/app/globals.css` 中 `@theme` 将 `--color-foreground`、`--color-muted-foreground`、`--color-panel` 等映射到 CSS 变量。
### 6. 技术选型理由

- **为什么用这个方案**: `--accent` 在当前项目是棕色，`--nav-active`/`--nav-hover` 是侧栏专属暖色变量；用户目标是黑白灰并跟随右侧主题，因此应改为 `foreground`、`muted-foreground`、`muted`、`panel`、`border` 这类全局语义 token。
- **优势**: 明暗主题自动继承全局变量，不再维护左侧独立色系。
- **劣势和风险**: 透明度类需要确保 Tailwind 4 能生成；本项目已有大量 `text-muted/70`、`bg-muted/20` 类似用法，可沿用。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: `/?view=projects` 和 `/studio` 的 active 判断必须保持不变。
- **性能瓶颈**: 仅 className 调整，无额外渲染或 I/O。
- **安全考虑**: 不触碰认证、鉴权、网络请求或配置校验。

### 8. 上下文充分性检查

- 能说出至少 3 个相似实现：是，见 UnifiedSidebar、CollapsibleNavItem、RecentItemsList、StudioProjectsList、ThemeToggle。
- 理解实现模式：是，导航通过 `isActive` 条件拼接 Tailwind 类并使用语义 token。
- 知道可复用工具：是，继续复用现有组件和 `globals.css` token。
- 理解命名与风格：是，组件 PascalCase、中文测试说明、Tailwind 类字符串。
- 知道如何测试：是，在 `phase1-navigation.test.tsx` 添加源码契约测试并运行 `pnpm --filter @storyforge/web test`。
- 确认未重复造轮子：是，只替换已有样式 token，不新增组件或自研主题系统。
- 理解依赖和集成点：是，主题由 `ThemeToggle` 写入 `data-theme` 并由 `globals.css` 映射。
