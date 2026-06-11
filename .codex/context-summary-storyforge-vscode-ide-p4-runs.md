## 项目上下文摘要（storyforge-vscode-ide-p4-runs）

生成时间：2026-05-28 04:51:31

### 1. 相似实现分析

- **实现1**: pps/api/app/domains/book_runs/service.py
  - 模式：BookRun 真相源已有 create_book_run、get_book_run、pply_book_run_progress、
esume_book_run。
  - 可复用：BookRun.progress、checkpoint、预算字段、阻塞章节字段。
  - 需注意：P4 消费 Phase 9 BookLoop 输出，不重写 BookLoop。
- **实现2**: pps/api/app/domains/book_runs/router.py
  - 模式：BookRun REST 端点使用 FastAPI router + SessionDependency，错误转换为 HTTPException。
  - 可复用：get_book_run 的 NotFound 处理。
  - 需注意：IDE 端点仍追加到 /api/ide，不改 /api/book-runs 既有契约。
- **实现3**: pps/web/app/book-runs/api.tsx
  - 模式：BookRun 状态面板展示进度、预算和最近事件，SSR 组件测试覆盖。
  - 可复用：字段命名、预算展示、checkpoint 展示语义。
  - 需注意：IDE 内应新增 BookRunPanel，不直接复刻旧页面路由。

### 2. 项目约定

- API 领域追加在 pps/api/app/domains/ide；schema/service/router 分层。
- Web IDE 组件位于 pps/web/components/ide，测试用
ode:test + SSR。
- 新 Web 组件需登记到 pps/web/scripts/phase1-contract-test.mjs。

### 3. 可复用组件清单

- BookRun: pps/api/app/domains/book_runs/models.py
- get_book_run: pps/api/app/domains/book_runs/service.py
- BookRunRead 视图字段：pps/web/app/book-runs/api.tsx
- BottomPanel: IDE runs 面板集成点。

### 4. 测试策略

- API：新增 pps/api/tests/test_ide_run_events.py，验证事件投影与 SSE 文本格式。
- Web：扩展 pps/web/tests/ide-components.test.tsx，验证 BookRunPanel 渲染状态、checkpoint、blocked chapter、预算、操作按钮。
- 契约：运行 pnpm openapi，确认新增 /api/ide/runs/{book_run_id}/events。

### 5. 依赖和集成点

- 外部依赖：无新增，SSE 使用 FastAPI StreamingResponse。
- 内部依赖：IDE service 调用 get_book_run 并从 progress/checkpoint/cost_summary 派生事件。
- 集成方式：当前实现是有限快照 SSE，后续可接真实 workflow event stream。

### 6. 技术选型理由

- P4 目标要求 SSE，但当前 BookLoop 事件已落在 BookRun 聚合状态中；先输出可回放的有限 SSE 快照，避免重写 runtime。
- 事件 schema 先覆盖 progress、checkpoint、locked、udget、completed，符合主计划兜底。

### 7. 关键风险点

- 真正端到端延迟 p95 需运行态测量，本轮只能提供可测试 SSE 契约。
- Start/Pause/Stop 等写操作应在 P5 CommandRegistry 正式化，P4 UI 先显示命令入口，不绕过审计链直接写。
