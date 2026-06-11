# 项目上下文摘要（StoryForge VS Code IDE P7 个性化）

生成时间：2026-05-28 05:35:18 +08:00

## 1. 相似实现分析

- **实现1**：pps/web/components/site-nav/ThemeToggle.tsx
  - 模式：客户端组件通过 localStorage 与自定义事件持久化主题。
  - 可复用：storyforge-theme 存储键、data-theme="dark" DOM 约定。
  - 需注意：SSR 时必须避免直接访问 window 和 document。
- **实现2**：pps/web/components/ide/shell/ide-store.ts
  - 模式：createInitialIdeState(overrides) 合并 URL/外部状态与默认 IDE 状态。
  - 可复用：统一入口生成 tabs、activeTabId、leftPanel、bottomPanel。
  - 需注意：当前只覆盖分享态，还没有非分享态布局持久化。
- **实现3**：pps/web/components/ide/keymap/index.ts
  - 模式：静态 ideKeymap 与
indCommandByShortcut。
  - 可复用：快捷键条目类型和查找函数。
  - 需注意：P7 需要支持用户覆盖，同时保留默认键位。
- **实现4**：pps/web/components/ide/shell/EditorArea.tsx
  - 模式：中央编辑器通过 active tab 分支渲染视图。
  - 可复用：tab id 与 /ide?tab=&active= URL 状态。
  - 需注意：pop-out 需要生成可分享的新窗口 URL，不应依赖浏览器全局才能 SSR 渲染。
- **实现5**：pps/web/components/ide/shell/IdeShell.tsx
  - 模式：组合 ActivityBar、SidePanel、EditorArea、RightDock、BottomPanel。
  - 可复用：header 区域适合放置主题、布局和多窗口入口。
  - 需注意：现有测试用
enderToStaticMarkup，新增组件必须 SSR-safe。

## 2. 项目约定

- **命名约定**：React 组件使用 PascalCase；纯工具模块使用 camelCase 函数；测试文件使用 ide-*.test.tsx。
- **文件组织**：IDE 相关组件放在 pps/web/components/ide/*；URL 工具放在 components/ide/url；shell 组件放在 components/ide/shell。
- **导入顺序**：React/Node 标准库在前，项目相对路径在后。
- **代码风格**：TypeScript 只读类型、函数组件、SSR-safe 判断 	ypeof window。

## 3. 可复用组件清单

- pps/web/components/site-nav/ThemeToggle.tsx：主题 localStorage 与 DOM 约定参考。
- pps/web/components/ide/shell/ide-store.ts：IDE 初始状态合并入口。
- pps/web/components/ide/keymap/index.ts：默认键位与快捷键查找。
- pps/web/components/ide/url/ide-url-state.ts：IDE URL 状态序列化。
- pps/web/components/ide/shell/EditorArea.tsx：active tab 与中央编辑区入口。
- pps/web/scripts/phase1-contract-test.mjs：Web node:test 转译执行器。

## 4. 测试策略

- **测试框架**：Node 内置
ode:test + ssert，通过 pps/web/scripts/phase1-contract-test.mjs 转译 TS/TSX。
- **测试模式**：纯函数测试 +
enderToStaticMarkup SSR 组件快照式断言。
- **参考文件**：pps/web/tests/ide-command-registry.test.tsx、pps/web/tests/ide-url-state.test.ts、pps/web/tests/ide-components.test.tsx。
- **覆盖要求**：默认偏好、非法存储恢复、键位覆盖、布局合并、pop-out URL、IDE 壳层渲染入口。

## 5. 依赖和集成点

- **外部依赖**：React、TypeScript、Next App Router；不新增第三方依赖。
- **内部依赖**：ide-store、keymap、ide-url-state、EditorArea、IdeShell。
- **集成方式**：纯工具负责偏好解析与 URL 生成，组件只消费结果并提供可见入口。
- **配置来源**：本阶段使用浏览器 localStorage；服务端/API 不变。

## 6. 技术选型理由

- **为什么用纯工具 + 客户端组件**：测试可在 Node 环境稳定运行，运行时又能对接 localStorage。
- **优势**：不新增状态库、不破坏 URL 分享态、避免 SSR 崩溃。
- **劣势和风险**：多窗口仅生成 pop-out URL 和新窗口入口，尚未实现跨窗口同步编辑锁。

## 7. 关键风险点

- **并发问题**：多个窗口同时编辑同一 tab 可能需要后续锁定或冲突提示。
- **边界条件**：localStorage 损坏、未知主题、无效快捷键、空 tab 需要回退默认值。
- **性能瓶颈**：偏好解析应为 O(n) 小数据操作，不引入阻塞依赖。
- **安全考虑**：不执行存储中的脚本；只解析 JSON 白名单字段。

## 8. 充分性检查

- 能定义接口契约：是，偏好输入为 JSON 字符串或对象，输出为受控 IdePersonalizationPreferences。
- 理解技术选型：是，延续 ThemeToggle/localStorage 与 ide-store 合并模式。
- 识别风险点：是，已记录损坏存储、多窗口并发与 SSR 访问边界。
- 知道如何验证：是，新增 ide-personalization.test.tsx 并纳入 phase1 契约测试。
