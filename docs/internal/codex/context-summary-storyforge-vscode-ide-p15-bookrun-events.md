## 项目上下文摘要（StoryForge VSCode IDE P1.5 BookRun 事件快照）

生成时间：2026-05-28 14:08:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/ide/views/BookRunPanel.tsx`
  - 模式：纯展示组件，接收 `run` 和 `onExecuteCommand`，渲染运行指标、checkpoint、阻塞章节和命令按钮。
  - 可复用：BookRun 状态展示、命令按钮、`data-command-id` 契约。
  - 需注意：当前没有事件快照 URL 或 EventSource/轮询入口。
- **实现2**: `apps/web/components/ide/shell/BottomPanel.tsx`
  - 模式：根据 activePanel 渲染 Problems、Runs、Artifacts，并用 `CommandRegistry` 执行写命令。
  - 可复用：runs 分支已有命令注册和执行入口。
  - 需注意：runs 分支当前只渲染空 BookRunPanel，缺少事件快照容器。
- **实现3**: `apps/api/tests/test_ide_run_events.py`
  - 模式：后端已验证 `build_run_events`、SSE 编码和 `/api/ide/runs/{id}/events` 快照端点。
  - 可复用：事件名 `progress/checkpoint/blocked/budget/provider_fallback/completed` 和 SSE URL。
  - 需注意：前端缺少对应消费契约。
### 2. 项目约定

- **命名约定**: React 组件使用 PascalCase，props 类型使用 `XxxProps`，事件字段沿用后端 snake_case payload。
- **文件组织**: IDE 视图组件位于 `apps/web/components/ide/views/`；底部面板入口在 `apps/web/components/ide/shell/BottomPanel.tsx`。
- **导入顺序**: React/类型导入在前，相对模块导入在后。
- **代码风格**: props 使用 readonly；展示契约通过 `data-*` 属性支持 SSR 测试。

### 3. 可复用组件清单

- `BookRunPanel`: 运行状态、checkpoint 和命令按钮展示。
- `CommandRegistry`: BookRun 写命令统一执行入口。
- `build_run_events` / `/api/ide/runs/{id}/events`: 后端 BookRun 事件快照真相源。
- `phase1-contract-test.mjs`: 本地组件契约测试转译脚本。

### 4. 测试策略

- **测试框架**: Web 使用 `node:test` + `renderToStaticMarkup`。
- **参考文件**: `apps/web/tests/ide-components.test.tsx` 和 `apps/api/tests/test_ide_run_events.py`。
- **覆盖要求**: 先红灯确认 `BookRunEventsPanel` 缺失，再断言 SSE URL、事件类型、事件摘要和命令按钮契约。

### 5. 依赖和集成点

- **外部依赖**: React。
- **内部依赖**: `BottomPanel` → `BookRunEventsPanel` → `BookRunPanel`；只读事件源为 `/api/ide/runs/{book_run_id}/events`。
- **集成方式**: 写命令仍经 `commands.execute`；事件快照只读，不产生审计写入。

### 6. 技术选型理由

- **为什么用这个方案**: 新增容器组件可以补齐事件快照入口，同时保持 BookRunPanel 的纯展示职责。
- **优势**: 改动集中、易测试、后续可在同一容器内接入真实 EventSource。
- **劣势和风险**: 本切片只提供快照消费契约和事件摘要，不实现长连接状态机。

### 7. 关键风险点

- **并发问题**: 后续真实 EventSource 需要处理断线重连和乱序事件；本切片暂不处理。
- **边界条件**: 无 run 时不能生成无效 events URL；无事件时应显示空状态。
- **性能瓶颈**: 事件列表当前很小；长日志后续再引入虚拟列表。
- **安全考虑**: 不新增安全设计；写操作仍保留审计链。
