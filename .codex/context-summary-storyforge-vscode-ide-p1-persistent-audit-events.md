## 项目上下文摘要（P1/P5 持久审计事件）

生成时间：2026-05-29 02:42:00 +0800

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/events/models.py`
  - 模式：`EventLog` 是平台事件流，包含 `workspace_id`、`book_id`、`scene_id`、`event_type`、`source`、`payload`。
  - 可复用：直接作为 IDE 命令审计事件的持久化表，避免新增重复审计表。
  - 需注意：`workspace_id` 非空；无工作区归属的测试数据需要可回退的系统工作区。
- **实现2**: `apps/api/app/domains/events/service.py`
  - 模式：`record_event(session, EventRecordCreate)` 校验工作区存在后写入并提交。
  - 可复用：IDE 命令执行完成后写入 `EventLog`。
  - 需注意：领域命令本身可能已经提交事务；审计事件应在命令结果组装后单独记录。
- **实现3**: `apps/api/app/domains/ide/service.py`
  - 模式：`execute_ide_command_by_id` 统一生成 `audit_event_id`，各命令通过 `_accepted_command_result` 返回统一 payload。
  - 可复用：将随机追踪 ID 升级为 `EventLog.id` 派生的 `ide-command-event:<id>`，并把原命令 ID/参数/结果写进 payload。
  - 需注意：只读命令 `audit.open` 不写事件；未知/执行失败命令不应产生成功审计事件。
- **实现4**: `apps/api/tests/test_ide_command_registry.py` / `apps/api/tests/test_ide_commands.py`
  - 模式：TestClient + session_factory 断言命令 HTTP 返回和数据库状态。
  - 可复用：新增断言查询 `EventLog`，证明 `audit_event_id` 可解析并有持久事件。
  - 需注意：优先使用 `memory.resolve_conflict`，避免把命令注册审计测试绑定到 BookRun/Judge 夹具。

### 2. 项目约定

- **命名约定**：Python 测试函数 `test_*`，中文 docstring；服务函数 snake_case。
- **文件组织**：平台事件域在 `domains/events`；IDE 命令聚合在 `domains/ide/service.py`。
- **导入顺序**：标准库、SQLAlchemy、领域模块分组。
- **代码风格**：Pydantic schema 做输入，SQLAlchemy session 由服务层传递。

### 3. 可复用组件清单

- `EventLog`: 持久审计事件模型。
- `EventRecordCreate` / `record_event`: 事件写入服务。
- `_accepted_command_result`: 可扩展为先组装 payload，再记录审计事件。

### 4. 测试策略

- **测试框架**：pytest + TestClient + SQLite 内存库。
- **红灯测试**：执行 `memory.resolve_conflict` 后，从返回的 `audit_event_id` 解析事件 ID，查询 `EventLog`，断言 `event_type=ide_command_executed`、`source=ide.command_registry`、payload 包含 command_id/status/args。
- **验证命令**：`cd apps/api; uv run pytest tests/test_ide_command_registry.py tests/test_ide_commands.py -q`，再跑 ruff。
- **覆盖要求**：写命令产生持久事件；只读命令仍可不产生 audit_event_id；未知命令 404 不产生成功事件。

### 5. 依赖和集成点

- **外部依赖**：无新增依赖。
- **内部依赖**：IDE 服务依赖 events 服务和工作区模型。
- **集成方式**：命令成功后写入事件；返回 `audit_event_id` 指向事件 ID。
- **配置来源**：master plan P1 “写回有 audit_event”、P5 “Agent 任意写操作可在 audit 中追溯”。

### 6. 技术选型理由

- **为什么复用 EventLog**：已有平台事件流就是可审计、可聚合事件存储，避免新增自研审计表。
- **优势**：最小改动、可查询、与协作事件同一事实源。
- **劣势和风险**：缺少明确用户/member 归属；先记录为 `member_id=None`，后续可从会话补齐。

### 7. 关键风险点

- **边界条件**：命令参数可能含复杂对象，payload 必须保持 JSON 可序列化。
- **事务风险**：审计事件写入失败会导致命令整体失败；测试数据无 workspace 时需要系统工作区兜底。
- **语义风险**：`audit_event_id` 前缀变化会影响旧测试，需要同步更新断言。