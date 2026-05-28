## 项目上下文摘要（P0 旧 5 页 IDE 内可达）

生成时间：2026-05-29 03:25:00 +0800

### 1. 相似实现分析

- **实现1**: `components/ide/shell/EditorArea.tsx`
  - 模式：`legacy:*` tab 渲染占位卡片和旧页面链接。
  - 可复用：已有 legacy label 表，可扩展为 IDE 内嵌摘要而不是跳出旧路由。
  - 需注意：master plan 要求旧 5 页在 `/ide` 内访问，单纯“打开旧页面”链接证据偏弱。
- **实现2**: `components/ide/shell/SidePanel.tsx`
  - 模式：Explorer 中列出五个 legacy tab，点击打开标签。
  - 可复用：证明 Studio/Retrieval/Runs/Artifacts/Evaluations 都可作为 IDE tab 打开。
  - 需注意：`search` 面板目前也渲染 Explorer 列表，没有专门 Retrieval 视图语义。
- **实现3**: `components/ide/shell/BottomPanel.tsx`
  - 模式：`runs` 和 `artifacts` 已替换为 IDE 原生 Run/Artifact 视图；`evaluation` 仅显示“当前底部面板”。
  - 可复用：补 Evaluation legacy summary 可以满足旧页面内嵌访问证据。
  - 需注意：不要重写旧业务逻辑，只做 P0 子视图挂载/摘要入口。
- **实现4**: `tests/ide-components.test.tsx`
  - 模式：使用 `renderToStaticMarkup` 验证 shell/面板/视图输出。
  - 可复用：新增测试覆盖五个 legacy tab 和 evaluation 底部子视图。
  - 需注意：测试要锁定 `/ide` 内渲染，而不是外链跳出。

### 2. 项目约定

- **命名约定**：React 组件 PascalCase，测试中文名。
- **文件组织**：IDE shell 组件在 `components/ide/shell/`，视图在 `components/ide/views/`。
- **导入顺序**：类型导入在前，组件导入按相邻模块组织。
- **代码风格**：两空格缩进，Tailwind className，数据属性辅助契约测试。

### 3. 可复用组件清单

- `EditorArea`: legacy tab 渲染入口。
- `BottomPanel`: bottom panel 子视图入口。
- `ArtifactViewer` / `BookRunEventsPanel`: 已覆盖 artifacts/runs 终态视图。

### 4. 测试策略

- **测试框架**：node:test + React SSR。
- **红灯测试**：渲染 `EditorArea` 五个 legacy tab，断言 `data-legacy-view`、标题、旧路由 href，并断言文案说明“在 IDE 内访问”。
- **验证命令**：`pnpm --filter @storyforge/web test -- ide-components`、`pnpm --filter @storyforge/web lint`。
- **覆盖要求**：旧 5 页均可作为 IDE tab/子视图访问；evaluation 底部面板不再只是占位文本。

### 5. 依赖和集成点

- **外部依赖**：无新增依赖。
- **内部依赖**：EditorArea、BottomPanel、IdeShell。
- **集成方式**：legacy tab 显示 IDE 内嵌子视图摘要；保留旧路由链接作为兼容跳转。
- **配置来源**：master plan P0 “旧 5 页全部可在 `/ide` 内访问”。

### 6. 技术选型理由

- **为什么补内嵌摘要**：P0 明确不重写旧业务，摘要卡片能证明路由已进入 IDE，同时保留旧路由兼容。
- **优势**：改动小、可测试、不会触碰旧业务逻辑。
- **劣势和风险**：不是完整旧页面组件复用；若严格要求原组件内嵌，后续需进一步抽取旧页面内容组件。

### 7. 关键风险点

- **边界条件**：重定向到 `/ide?panel.bottom=artifacts` 时如果没有 artifact 参数，应显示 Artifact 空态。
- **一致性**：legacy label/route 不应分散多处漂移。
- **可验证性**：SSR 静态渲染证明 IDE 内可见，真实浏览器切换已由后续 e2e 可补强。