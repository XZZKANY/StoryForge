## 项目上下文摘要（StoryForge VS Code IDE P1.5 入口闭环）

生成时间：2026-05-28 14:42:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/ide/views/ContextInspector.tsx`
  - 模式：纯 React 展示组件，接收 `snapshot` 后用 `renderToStaticMarkup` 可断言的文本和 `data-*` 输出状态。
  - 可复用：`ContextSnapshot.compiled_context_id`、注入块/裁剪块列表渲染结构。
  - 需注意：当前只有快照内容，没有 ModelRun、Repair、Approve 反向入口。
- **实现2**: `apps/web/components/ide/views/StoryMemoryExplorer.tsx`
  - 模式：过滤标签、记忆条目、冲突队列三段式展示。
  - 可复用：`StoryMemoryConflict.conflict_id/entity_id/fact_type` 足以组成 `memory.resolve_conflict` 参数。
  - 需注意：冲突仲裁必须暴露命令入口，不能直接写入或绕过命令审计链。
- **实现3**: `apps/web/components/ide/views/ArtifactViewer.tsx`
  - 模式：后端 preview 数据驱动预览、下载摘要、版本列表和 trace 链接。
  - 可复用：`ArtifactViewerTraceLink.id/href/label` 以及已有 BookRun、ModelRun、JudgeReport、Approve trace 分支。
  - 需注意：已有 href 缺少机器可读 `data-trace-*` 属性。
- **实现4**: `apps/web/tests/ide-components.test.tsx`
  - 模式：使用 `node:test`、`node:assert/strict` 和 `renderToStaticMarkup` 断言静态 HTML 契约。
  - 可复用：现有 `data-command-id`、`data-command-args`、`data-range-*` 断言方式。
  - 需注意：测试文案和断言说明使用简体中文。

### 2. 项目约定

- **命名约定**: React 组件使用 PascalCase，props/type 使用 PascalCase，字段沿用后端 snake_case。
- **文件组织**: IDE 展示组件位于 `apps/web/components/ide/views/`，组件契约测试集中在 `apps/web/tests/ide-components.test.tsx`。
- **导入顺序**: Node 内置模块、React、项目组件依次导入。
- **代码风格**: TypeScript 使用 `readonly` props，组件保持纯展示，SSR 契约通过 `data-*` 暴露。
### 3. 可复用组件清单

- `apps/web/components/ide/commands/registry.ts`: 命令注册与执行模型，写操作必须经该路径或后端 `/api/ide/commands/{id}`。
- `apps/web/components/ide/views/BookRunPanel.tsx`: `data-command-id` 和 `data-command-args` 按钮契约参考。
- `apps/web/components/ide/panels/ProblemsPanel.tsx`: 诊断 ID、range 和 quick fix 命令元数据参考。
- `apps/web/components/ide/views/DiffViewer.tsx`: `judge.approve` 批准写回命令入口参考。

### 4. 测试策略

- **测试框架**: `node:test` + `node:assert/strict`，React 静态渲染使用 `react-dom/server` 的 `renderToStaticMarkup`。
- **测试模式**: 组件契约测试优先断言 HTML 中的可见文本和机器可读 `data-*` 属性。
- **参考文件**: `apps/web/tests/ide-components.test.tsx`。
- **覆盖要求**: 正常入口渲染、冲突命令参数、trace 反向链接元数据。

### 5. 依赖和集成点

- **外部依赖**: React 与 React DOM server。Context7 查询确认小写自定义属性和 `data-*` 属性可在静态 HTML 中输出，非字符串值会字符串化或在 null/undefined 时省略。
- **内部依赖**: ContextInspector、StoryMemoryExplorer、ArtifactViewer 均为纯展示组件，不应引入网络客户端。
- **集成方式**: 通过 props 输入数据；写入口只渲染命令 ID 和 JSON 参数，后续由 CommandRegistry 或 API 命令端点执行。
- **配置来源**: 无新增环境配置。

### 6. 技术选型理由

- **为什么用这个方案**: 当前 IDE 组件已有 SSR 契约测试和 `data-command-id` 约定，补充属性比新增状态管理或请求层更贴合现有架构。
- **优势**: 改动小、可测试、不会新增绕过审计链的写路径。
- **劣势和风险**: HTML 字符串断言对属性转义敏感，命令参数需保持稳定 JSON 序列化。

### 7. 关键风险点

- **并发问题**: 无新增异步或共享状态。
- **边界条件**: trace 缺少 href/id 时仍需渲染稳定的缺省项；Context entries 为空时不应破坏原快照渲染。
- **性能瓶颈**: 小列表 O(n) 渲染，无额外 I/O。
- **安全考虑**: 本任务不处理安全控制；不新增直接写入或鉴权相关逻辑。

### 8. 检索记录

- 使用 desktop-commander 阅读了 3 个目标组件和 1 个组件测试文件。
- 使用 desktop-commander 搜索了 `data-command-id`、`compiled_context_id`、`ArtifactViewer` 和测试模式。
- 使用 Context7 查询了 React 自定义属性和 `renderToStaticMarkup` 行为。
- 当前会话未暴露 `github.search_code` 工具，已降级为项目内相似实现检索并记录该限制。
