## 项目上下文摘要（Agent Runtime 控制平面）

生成时间：2026-06-23 02:20:00

### 1. 相似实现分析

- **Assistant 会话与工具调用**: `apps/api/app/domains/assistant/models.py`
  - 模式：SQLAlchemy 2.0 typed ORM，`AssistantSession` 聚合 `AssistantMessage` 与 `AssistantToolCall`。
  - 可复用：会话、工具调用、JSON 摘要字段、级联删除关系的写法。
  - 需注意：AssistantToolCall 是旧工具树事实，不等同于新的 AgentRunEvent。
- **平台事件流**: `apps/api/app/domains/events/models.py`
  - 模式：独立 `EventLog` 表记录事件类型、来源和 JSON payload。
  - 可复用：事件表字段组织、REST 读取服务和按时间排序模式。
  - 需注意：EventLog 以 workspace 为作用域；AgentRunEvent 应以 run 为作用域。
- **IDE Agent WebSocket**: `apps/api/app/domains/ide/router.py`
  - 模式：`/api/ide/agent/sessions/{session_id}` 收 user_message，调用 `orchestrate_agent_message`，可选推送 stream 事件。
  - 可复用：认证、错误返回、WebSocket 兼容响应结构。
  - 需注意：WebSocket 当前会自行生成 run_id，需要改成调用 Agent Runtime。
- **IDE Orchestrator**: `apps/api/app/domains/ide/orchestrator.py`
  - 模式：返回 `agent_result`、`plan`、`tool_trace`、`proposed_patch`。
  - 可复用：多子代理审稿、文件修订、章节审阅、BookRun 预检和命令目录。
  - 需注意：第一版 Runtime 应包装它，而不是重写已有审稿和修订能力。

### 2. 项目约定

- **命名约定**: Python 模块和函数使用 snake_case，SQLAlchemy ORM 类使用 PascalCase，表名使用复数 snake_case。
- **文件组织**: 每个 API 领域在 `apps/api/app/domains/{domain}` 下包含 `models.py`、`schemas.py`、`service.py`、`router.py`。
- **导入顺序**: `from __future__ import annotations` 后按标准库、第三方、项目内导入，ruff 负责检查。
- **代码风格**: Pydantic v2 使用 `ConfigDict` 和 `Field`；服务层抛领域异常，路由层转 HTTPException。

### 3. 可复用组件清单

- `app.db.base.Base`、`IdMixin`、`TimestampMixin`: 新 ORM 表统一基类和审计字段。
- `app.domains.ide.orchestrator.orchestrate_agent_message`: Root Runtime 第一版的下游执行器。
- `app.domains.ide.service.encode_sse_event`: SSE 文本编码模式可复用或保持一致。
- `app.domains.assistant.service`: 现有 Assistant 会话和 tool call 写入仍由 orchestrator 使用。

### 4. 测试策略

- **测试框架**: pytest + FastAPI TestClient。
- **测试模式**: sqlite 内存库通过 `Base.metadata.create_all` 建表；WebSocket 使用 `client.websocket_connect`。
- **参考文件**: `apps/api/tests/test_assistant_tool_calls.py`、`apps/api/tests/test_ide_agent_orchestrator.py`、`apps/api/tests/test_ide_run_events.py`。
- **覆盖要求**: 模型元数据、REST 读取、SSE 快照、WebSocket 事件回放、权限事件和 artifact 映射。

### 5. 依赖和集成点

- **外部依赖**: FastAPI、SQLAlchemy 2.0、Pydantic v2、Alembic。
- **内部依赖**: `agent_runs` 依赖 `db.base` 和现有 `ide.orchestrator`；`ide.router` 调用 Agent Runtime service。
- **集成方式**: 新增 router 注册到 `app.main`；新模型导入 `app.models`；WebSocket 用户消息进入 AgentRun service。
- **配置来源**: 默认权限档位为 `risk_confirm`，第一版无需新增环境变量。

### 6. 技术选型理由

- **为什么用新领域模块**: AgentRun 是控制平面事实源，职责不同于 Assistant 会话和 EventLog。
- **优势**: 不破坏现有桌面端契约，先获得可恢复、可审计的运行事件。
- **劣势和风险**: 第一版仍包装旧 orchestrator，尚未把 BookRun 后台进度完全改为 AgentRun 派生。

### 7. 关键风险点

- **并发问题**: 同一 public run_id 续接时要避免重复创建；第一版通过唯一索引和服务查询控制。
- **边界条件**: Orchestrator 抛错时必须写 `agent_run_failed`，不能只有 WebSocket error。
- **性能瓶颈**: 事件 payload 只存摘要；按 run_id 建索引支撑回放。
- **安全考虑**: proposed_patch 仅作为需确认 artifact，不能绕过 Desktop PatchReviewPanel 写回文件。
