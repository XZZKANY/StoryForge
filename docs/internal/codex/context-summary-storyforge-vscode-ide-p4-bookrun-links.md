## 项目上下文摘要（StoryForge VS Code IDE P4 BookRun 跳转）

生成时间：2026-05-28 00:00:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/ide/views/BookRunPanel.tsx`
  - 模式：纯展示 Run 状态、checkpoint、blocked_chapter、provider_fallback，并通过 `data-command-id` 暴露写命令。
  - 可复用：现有 `formatRecord`、checkpoint/blocked 区块和 `CommandBar`。
  - 需注意：当前 checkpoint 和 blocked_chapter 只有文本，没有可点击 IDE 跳转。

- **实现2**: `apps/web/components/ide/views/ArtifactViewer.tsx`
  - 模式：TraceItem 使用 `data-trace-kind`、`data-trace-id`、`data-trace-href` 和 anchor 暴露追溯链。
  - 可复用：用静态 href 和机器可读 data 属性表达 IDE 内跳转。
  - 需注意：P4 不需要抽象 TraceItem，只沿用契约形态。

- **实现3**: `apps/api/tests/test_ide_run_events.py`
  - 模式：BookRun SSE 事件包含 checkpoint、blocked、budget、provider_fallback，并验证 endpoint 返回 text/event-stream。
  - 可复用：checkpoint 字段 `chapter_index`、`model_run_id`、`judge_report_id`、`approved_scene_id`。
  - 需注意：后端事件没有真实 `chapter_id`，前端只能按 `chapter_index` 生成临时 chapter tab。

### 2. 项目约定

- **命名约定**：React 组件 PascalCase；helper 使用 camelCase；后端字段保持 snake_case。
- **文件组织**：Run Panel 展示留在 `apps/web/components/ide/views/BookRunPanel.tsx`；组件契约测试留在 `apps/web/tests/ide-components.test.tsx`。
- **导入顺序**：本切片不新增导入。
- **代码风格**：纯渲染 helper，SSR 可断言 `data-*` 属性，文案使用简体中文。

### 3. 可复用组件清单

- `BookRunPanel`: Run 状态和命令按钮主组件。
- `BookRunEventsPanel`: SSE 快照入口，继续包裹 `BookRunPanel`。
- `ArtifactViewer.TraceItem`: 作为 href/data 属性表达方式参考。
- `test_ide_run_events.py`: 作为 checkpoint 和 blocked 事件字段来源证据。
### 4. 测试策略

- **测试框架**：前端使用 `node:test` 与 `renderToStaticMarkup`。
- **测试模式**：扩展 BookRunPanel 静态 HTML 断言，覆盖 checkpoint 与 blocked chapter 的 href 和 data 属性。
- **参考文件**：`apps/web/tests/ide-components.test.tsx`、`apps/api/tests/test_ide_run_events.py`。
- **覆盖要求**：checkpoint chapter/modelRun/judgeReport/approve 跳转；blocked chapter 一键打开；现有命令按钮不回退。

### 5. 依赖和集成点

- **外部依赖**：React props 和条件渲染，已通过 Context7 查询 React 官方文档。
- **内部依赖**：`BookRunPanelRun.checkpoint` 和 `blocked_chapter` 中的 `chapter_index`、`model_run_id`、`judge_report_id`、`approved_scene_id`。
- **集成方式**：只渲染 `/ide?...` 链接，不新增 API 请求。
- **配置来源**：无新增配置。

### 6. 技术选型理由

- **为什么用这个方案**：P4 退出标准要求跳转准确；现有 Artifact trace 已证明 href + data 属性适合契约测试。
- **优势**：改动小、无需新增状态管理或请求层，和现有 SSR 测试一致。
- **劣势和风险**：checkpoint 当前没有真实 chapter_id，按 `chapter_index` 生成 `chapter:<index>` 是过渡约定，未来后端提供 chapter_id 后应替换。

### 7. 关键风险点

- **并发问题**：无新增写入。
- **边界条件**：checkpoint 缺少某个 ID 时不渲染对应链接。
- **性能瓶颈**：O(n) 渲染 checkpoint，与当前实现一致。
- **安全考虑**：不新增安全控制；写命令仍保持 CommandRegistry。