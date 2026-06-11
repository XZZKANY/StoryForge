## 项目上下文摘要（修复侧栏按钮嵌套）

生成时间：2026-06-09 16:41:58 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/site-nav/UnifiedSidebar.tsx:146`
  - 模式：底部账号菜单使用 `button` 控制 `role="menu"` 面板。
  - 可复用：账号菜单状态 `isAccountMenuOpen`、`aria-controls`、`aria-expanded`。
  - 需注意：当前 `ThemeToggle` 位于账号触发按钮内部，形成 `button` 嵌套。
- **实现2**: `apps/web/components/site-nav/ThemeToggle.tsx:71`
  - 模式：主题切换是独立 `button`，使用 `aria-pressed` 与 `aria-label`。
  - 可复用：无需改动 ThemeToggle API，只调整父级结构。
  - 需注意：主题点击不应触发账号菜单。
- **实现3**: `apps/web/components/home/HomeSidebar.tsx:105`
  - 模式：同类账号菜单触发按钮只包含头像、文本与状态符号。
  - 可复用：账号触发器保持单一职责，其他动作作为兄弟控件。
  - 需注意：保持按钮内无第二个交互控件。

### 2. 项目约定

- **命名约定**: React 组件使用 PascalCase，状态变量使用 camelCase。
- **文件组织**: 站点导航组件位于 `apps/web/components/site-nav/`。
- **导入顺序**: 外部依赖在前，本地组件在后。
- **代码风格**: TypeScript + React client component，样式使用 Tailwind class。

### 3. 可复用组件清单

- `ThemeToggle`: 主题切换按钮，位于 `apps/web/components/site-nav/ThemeToggle.tsx`。
- `UnifiedSidebar`: 当前全局侧栏入口，位于 `apps/web/components/site-nav/UnifiedSidebar.tsx`。
- `HomeSidebar`: 同类账号菜单参考，位于 `apps/web/components/home/HomeSidebar.tsx`。

### 4. 测试策略

- **测试框架**: Node 内置 `node:test` + `assert`。
- **测试模式**: `apps/web/scripts/phase1-contract-test.mjs` 转译并运行 `tests/*.test.tsx?`。
- **参考文件**: `apps/web/tests/phase8-stage4.test.tsx`。
- **覆盖要求**: 新增静态契约测试，确认 `ThemeToggle` 不在 `account-menu` 触发按钮内。

### 5. 依赖和集成点

- **外部依赖**: Next.js 15.3.2、React 19.1.0。
- **内部依赖**: `Chrome` 装配 `UnifiedSidebar`，`layout` 装配 `Chrome`。
- **集成方式**: `UnifiedSidebar` 直接渲染账号菜单与主题切换。
- **配置来源**: `apps/web/package.json` 提供 `test` 与 `lint` 脚本。

### 6. 技术选型理由

- **为什么用这个方案**: Next.js 官方文档确认交互内容嵌套会触发 hydration error，应通过合法 DOM 结构修复。
- **优势**: 只调整父级布局，不改变主题切换组件职责。
- **劣势和风险**: 账号按钮宽度会从整行变为 `flex-1`，需要保留视觉边框与点击区域。

### 7. 关键风险点

- **并发问题**: 无。
- **边界条件**: 主题按钮点击必须独立，不得打开账号菜单。
- **性能瓶颈**: 无新增计算或 I/O。
- **安全考虑**: 不涉及认证、鉴权或外部输入。
