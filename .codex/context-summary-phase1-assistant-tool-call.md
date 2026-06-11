## 项目上下文摘要（Phase 1 AssistantToolCall 事实源）

生成时间：2026-06-09 21:24:48 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/assistant/models.py`
  - 模式：SQLAlchemy 2.0 `Mapped` ORM，`AssistantSession` 一对多 `AssistantMessage`，级联删除。
  - 可复用：`AssistantSession`、`AssistantMessage`、`AssistantSession.messages` 关系模式。
  - 需注意：Assistant 域不保存 Provider 凭据，只保存追溯摘要和业务引用。
- **实现2**: `apps/api/app/domains/assistant/service.py`
  - 模式：薄 service，显式 `session.commit()` 后读取或刷新。
  - 可复用：`AssistantSessionNotFoundError`、`get_assistant_session`。
  - 需注意：缺失会话统一转 404，不在 router 内直接查 ORM。
- **实现3**: `apps/api/app/domains/events/models.py`
  - 模式：JSON 摘要字段 `payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)`。
  - 可复用：JSON 摘要字段设计。
  - 需注意：事件流依赖 workspace，不适合作 Assistant 会话内 tool call。- **实现4**: `apps/web/components/home/assistant-session-store.ts`
  - 模式：前端 API helper 使用 `readJson`、`postAssistantJson`、type guard 和 `ApiResult`。
  - 可复用：`createAssistantSession`、`appendAssistantSessionMessage`、`readAssistantSession` 的校验与错误格式。
  - 需注意：响应格式不正确必须返回 `status: 'error'`。
- **实现5**: `apps/web/components/home/assistant-tool-node-mapper.ts`
  - 模式：将后端事实对象映射为 `AssistantToolNode[]`，UI 只消费节点。
  - 可复用：`AssistantToolStatus`、`readString/readNumber/isRecord` 辅助模式。
  - 需注意：不能伪造完成状态，Provider 不可用时不能展示 running/completed。
- **实现6**: `apps/web/components/home/*-actions.ts`
  - 模式：Server Action 通过依赖注入测试 API 调用、session 写入、redirect。
  - 可复用：`writeAssistantBookRunSession`、`writeAssistantChapterReviewSession`、`writeAssistantArtifactExportSession` 的写会话路径。
  - 需注意：invalid 参数路径不写 session，也不应写 tool call。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case，ORM 类 PascalCase；TypeScript helper 使用 camelCase，React 组件 PascalCase。
- **文件组织**: 后端按 domain 拆 `models.py`、`schemas.py`、`service.py`、`router.py`；前端 home assistant 能力集中在 `apps/web/components/home/`。
- **导入顺序**: `from __future__ import annotations` 位于 Python 文件顶部；TypeScript 先框架依赖，再项目依赖，再类型导入。
- **代码风格**: 简体中文注释和测试说明；Pydantic v2 使用 `ConfigDict`；前端测试使用 `node:test` 与 `assert`。### 3. 可复用组件清单

- `apps/api/app/domains/assistant/service.py:get_assistant_session`: 创建 tool call 前校验会话存在。
- `apps/api/app/domains/assistant/service.py:AssistantSessionNotFoundError`: 会话缺失错误。
- `apps/api/app/domains/events/models.py:EventLog.payload`: JSON 摘要字段参考。
- `apps/web/components/home/assistant-session-store.ts:readJson/postAssistantJson`: 前端 API helper 模式。
- `apps/web/components/home/assistant-tool-node-mapper.ts:AssistantToolNode` 映射模式。
- `apps/web/components/home/*-actions.ts`: Server Action 依赖注入和 redirect 测试模式。

### 4. 测试策略

- **测试框架**: 后端 `pytest` + FastAPI `TestClient`；前端 `node:test` + `assert`。
- **参考文件**: `apps/api/tests/test_assistant_sessions.py`、`apps/api/tests/test_assistant_sessions_migration.py`、`apps/web/tests/assistant-book-run-actions.test.ts`。
- **覆盖要求**: 创建 tool call、更新 tool call、列表排序、缺失 session 404、缺失 tool call 404、额外字段 422、迁移静态片段、前端 mapper 与 action 写入。
- **TDD 顺序**: 先写失败测试并运行确认 RED，再实现生产代码，再运行 GREEN。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy 2.0、Pydantic v2、FastAPI、Next.js Server Action。
- **内部依赖**: `AssistantSession` 是 tool call 父记录；`AssistantConversation` 负责将事实源转为消息工具树；三个 action 负责在真实 API 成功后写事实源。
- **配置来源**: API 路由已在 `apps/api/app/main.py` 注册 `assistant_router`；ORM metadata 通过 `apps/api/app/models.py` 汇总导入。
- **迁移链路**: 现有 assistant 迁移为 `20260602_0001`，当前最新文件包含 `20260609_0001_add_continuity_edges.py`，新增迁移使用 `20260609_0002`。### 6. 技术选型理由

- **为什么用 AssistantToolCall 表**: `AssistantMessage` 适合自然语言消息，不能稳定重放工具状态；`EventLog` 是工作区事件流，依赖 workspace，不适合作 AssistantSession 内事实源。
- **优势**: tool call 可按 session 重放，状态与业务对象关联清晰，前端工具树可以从事实源优先渲染。
- **劣势和风险**: JSON 摘要若不控制大小会膨胀；action 写入失败可能影响原有业务路径；前端读取失败不能让 BookRun 推导消失。

### 7. 关键风险点

- **并发问题**: 同一 session 下多个 action 可能并发写 tool call，使用独立记录并按 id 升序展示，不依赖覆盖式状态。
- **边界条件**: 缺失 session、缺失 tool call、invalid 表单参数、API 失败、tool call 列表为空。
- **性能瓶颈**: 列表按 `session_id` 查询，需要 `session_id` 索引；摘要字段只存短对象，不存正文或大 payload。
- **安全考虑**: schema 使用 `extra=forbid`，不接收 API Key；input/output 只存摘要和关联 ID。

### 8. 充分性检查

- 能定义接口契约：是，POST/PATCH/GET tool call API 已确定。
- 理解技术选型理由：是，新增表弥补 session/message 与工作区事件流之间的事实源空缺。
- 识别主要风险点：是，并发写入、摘要膨胀、读取失败兜底、敏感字段拒绝。
- 知道如何验证实现：是，后端 pytest、前端 node:test、最终 `.codex/verification-report.md`。