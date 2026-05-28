## 项目上下文摘要（P4 BookRun EventSource 客户端）

生成时间：2026-05-29 02:20:00 +0800

### 1. 相似实现分析

- **实现1**: `apps/web/components/job-status/JobStatusPoller.tsx`
  - 模式：客户端组件用 `useEffect` 管理异步读取、错误状态与重试触发。
  - 可复用：状态拆分为 snapshot/error/isPending；清理函数避免卸载后继续更新。
  - 需注意：该组件是轮询，不是 SSE；只能复用 React 客户端生命周期模式。
- **实现2**: `apps/web/components/ide/views/BookRunEventsPanel.tsx`
  - 模式：服务端可渲染组件展示 SSE 快照事件、`data-events-url` 与空状态。
  - 可复用：继续作为 SSR 快照和无 JS 兜底；新增客户端 EventSource 组件应嵌入其中。
  - 需注意：不破坏现有 `BookRunPanel` 与 `onExecuteCommand` 命令入口。
- **实现3**: `apps/web/app/ide/page.tsx`
  - 模式：页面级 SSR 读取 `/api/book-runs/{id}` 与 `/api/ide/runs/{id}/events` 快照，传给 Shell。
  - 可复用：SSR 快照作为 EventSource 连接前的初始事件列表。
  - 需注意：master plan 要求 SSE 实时通道，不应只停留在 SSR 快照。
- **实现4**: `apps/api/tests/test_ide_run_events.py`
  - 模式：后端已验证 `text/event-stream`、事件名与 JSON data 编码。
  - 可复用：前端客户端只需要按 EventSource `event.data` JSON 解析即可。
  - 需注意：重连是浏览器 EventSource 原生行为，前端应暴露连接状态和重连次数以便验证。

### 2. 项目约定

- **命名约定**：React 组件使用 PascalCase，测试中文描述行为。
- **文件组织**：IDE 视图组件放在 `apps/web/components/ide/views/`，测试集中在 `apps/web/tests/ide-components.test.tsx`。
- **导入顺序**：React/Node 内置在前，项目组件在后。
- **代码风格**：TypeScript 只读类型、明确 props 类型、两空格缩进。

### 3. 可复用组件清单

- `BookRunEventsPanel`: SSR 外壳和事件列表展示。
- `BookRunEventSnapshot`: 可复用事件数据类型。
- `phase1-contract-test.mjs`: 需加入新客户端组件的转译条目和 import rewrite。

### 4. 测试策略

- **测试框架**：`node:test` + `react-dom/server` 静态渲染 + 源码契约扫描。
- **红灯测试**：断言 BookRunEventsPanel 渲染包含 EventSource 客户端根节点，并且新客户端源码包含 `new EventSource`、`addEventListener('error'...)` 和 `retryCount`。
- **验证命令**：`pnpm --filter @storyforge/web test -- ide-components`、`pnpm --filter @storyforge/web lint`。
- **覆盖要求**：初始快照保留；客户端长连接路径存在；错误/重连状态可观察。

### 5. 依赖和集成点

- **外部依赖**：浏览器原生 `EventSource`，不新增包。
- **内部依赖**：`BookRunEventsPanel` 嵌入客户端组件；`phase1-contract-test.mjs` 转译新文件。
- **集成方式**：SSR 先渲染快照，客户端组件 mount 后连接 `eventsUrl` 并追加实时事件。
- **配置来源**：master plan P4、§6 实时通道、§13 测试矩阵。

### 6. 技术选型理由

- **为什么用原生 EventSource**：master plan 明确 SSE 用于 BookRun/ModelRun；浏览器原生支持断线重连，依赖最少。
- **优势**：实现小、可观察状态明确、保留 SSR 快照兜底。
- **劣势和风险**：当前 node 测试不能真实模拟浏览器长连接，只能做源码和渲染契约；后续可补 Playwright。

### 7. 关键风险点

- **边界条件**：`eventsUrl` 为空时不能创建 EventSource。
- **错误恢复**：`error` 事件不手动关闭连接，交给 EventSource 原生重连；组件记录 `retryCount`。
- **性能影响**：事件列表需要限制最大保留数量，避免长时间运行内存增长。