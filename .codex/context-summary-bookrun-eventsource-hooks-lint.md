## 项目上下文摘要（BookRun EventSource hooks lint）

生成时间：2026-05-29 16:31:33 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/ide/views/BookRunEventsClient.tsx`
  - 模式：客户端组件用 `useEffect` 订阅浏览器 `EventSource`，在事件回调中更新本地状态。
  - 可复用：`reduceBookRunEventSourceState` 状态机。
  - 需注意：React hooks lint 禁止 effect 主体同步 `setState`。
- **实现2**: `apps/web/components/ide/editors/ChapterEditor.tsx`
  - 模式：effect 只负责外部系统 CodeMirror 的创建、订阅和销毁。
  - 可复用：外部系统同步逻辑放在 effect 内，React 派生数据留在渲染阶段。
  - 需注意：回调更新允许保留在外部系统订阅内。
- **实现3**: `apps/web/components/ide/shell/IdeShell.tsx`
  - 模式：URL 状态通过 `useMemo` 派生，浏览器 `popstate` 回调更新 React state。
  - 可复用：从 props/state 派生展示数据，而不是用 effect 二次同步。
  - 需注意：只在浏览器事件回调中同步状态。

### 2. 项目约定

- **命名约定**: React 组件使用 PascalCase，辅助变量和函数使用 camelCase。
- **文件组织**: Web IDE 组件位于 `apps/web/components/ide/`，测试位于 `apps/web/tests/`。
- **导入顺序**: React 导入在前，项目相对导入在后。
- **代码风格**: TypeScript、只读 props、Tailwind className、简体中文 UI 文案。

### 3. 可复用组件清单

- `reduceBookRunEventSourceState`: 连接状态转换真相源。
- `BookRunEventSnapshot`: SSE 快照事件类型。
- `phase1-contract-test.mjs`: Web 契约测试转译入口。

### 4. 测试策略

- **测试框架**: `node:test`，通过 `pnpm --filter @storyforge/web test` 运行。
- **测试模式**: 源码契约测试、静态渲染测试、状态机单元测试。
- **参考文件**: `apps/web/tests/ide-components.test.tsx`。
- **覆盖要求**: eslint、TypeScript、BookRun Events 组件契约。

### 5. 依赖和集成点

- **外部依赖**: React 19、Next 15、浏览器原生 `EventSource`。
- **内部依赖**: `BookRunEventsPanel` 将 `eventsUrl` 和 `initialEvents` 传给客户端组件。
- **集成方式**: 组件接收快照事件，浏览器端订阅 `/api/ide/runs/{id}/events`。
- **配置来源**: 根目录 `eslint.config.mjs` 启用 `eslint-plugin-react-hooks` 推荐规则。

### 6. 技术选型理由

- **为什么用这个方案**: React 官方建议从 props 派生的数据在渲染阶段计算，effect 只同步外部系统。
- **优势**: 消除级联渲染风险，保持 EventSource 回调状态更新。
- **劣势和风险**: 切换 `eventsUrl` 时需要重建内部组件，避免旧 live events 残留。

### 7. 关键风险点

- **边界条件**: `eventsUrl` 为空时必须显示 idle。
- **性能瓶颈**: live events 和快照事件都限制为 `MAX_LIVE_EVENTS`。
- **验证风险**: Windows 沙箱下 node:test 曾出现 `spawn EPERM`，需提升权限重跑同一测试。
