## 项目上下文摘要（StoryForge VS Code IDE BookRun 命令状态）

生成时间：2026-05-29 01:20:00 +0800

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/service.py`
  - 模式：领域服务负责创建、暂停、恢复、停止与 checkpoint 重试 BookRun，路由或 IDE 命令层只做参数适配。
  - 可复用：`create_book_run`、`pause_book_run`、`resume_book_run`、`stop_book_run`、`retry_book_run_from_checkpoint`、`BookRunRead`。
  - 需注意：领域异常分为 `BookRunError`、`BookRunBlockedError`、`BookRunNotFoundError`，IDE 命令应统一转换为 `IdeCommandExecutionError`。
- **实现2**: `apps/api/app/domains/book_runs/router.py`
  - 模式：HTTP 端点捕获领域异常并转换为 400/404/422；返回 `BookRunRead` 契约。
  - 可复用：BookRun 创建、读取、恢复端点的响应结构与错误信息。
  - 需注意：IDE 命令响应必须包在 `IdeCommandResult.payload.book_run` 内，不能直接返回领域模型。
- **实现3**: `apps/api/app/domains/ide/service.py`
  - 模式：`judge.run`、`judge.repair`、`judge.approve` 先定位命令，再调用领域服务，最后用 `_accepted_command_result` 写入审计 ID 与 payload。
  - 可复用：`_accepted_command_result`、`IdeCommandExecutionError`、命令注册表 `_BUILTIN_COMMANDS`。
  - 需注意：当前 `bookrun.*` 分支调用缺失的 `_execute_bookrun_command`，导致 500，是本轮根因。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case；测试函数以 `test_...` 命名；Pydantic schema 使用 PascalCase。
- **文件组织**: BookRun 状态变更留在 `domains/book_runs/service.py`；IDE 命令适配留在 `domains/ide/service.py`；HTTP 路由只负责异常转换。
- **导入顺序**: 标准库、第三方库、本地 app 模块分组；ruff 负责校验。
- **代码风格**: 简洁领域函数、中文 docstring、命令响应统一 `IdeCommandResult`。

### 3. 可复用组件清单

- `apps/api/app/domains/book_runs/service.py`: BookRun 领域状态变更函数。
- `apps/api/app/domains/book_runs/schemas.py`: `BookRunCreate`、`BookRunRead`。
- `apps/api/app/domains/ide/service.py`: `_accepted_command_result` 与命令审计包装。
- `apps/api/tests/test_book_runs.py`: `seed_locked_blueprint` fixture 与 checkpoint 状态测试模式。

### 4. 测试策略

- **测试框架**: pytest + FastAPI `TestClient`。
- **测试模式**: 先跑 `apps/api/tests/test_ide_commands.py` 中 BookRun 命令切片复现红灯，再执行相关 API 回归。
- **参考文件**: `apps/api/tests/test_book_runs.py`、`apps/api/tests/test_ide_commands.py`。
- **覆盖要求**: start/pause/resume/stop/retry_from_checkpoint 正常流程；缺失 `book_run_id`、不存在 BookRun 等错误流程。

### 5. 依赖和集成点

- **外部依赖**: FastAPI、SQLAlchemy、Pydantic。
- **内部依赖**: IDE 命令端点 → IDE service → BookRun service → SQLAlchemy session。
- **集成方式**: `POST /api/ide/commands/{command_id}` 通过命令注册表分派；返回 `audit_event_id` 与 `payload.book_run`。
- **配置来源**: 测试使用 `apps/api/tests/conftest.py` 的 SQLite session fixture。

### 6. 技术选型理由

- **为什么用这个方案**: master plan 要求写操作统一经 CommandRegistry/IDE commands，同时 BookRun 领域服务已存在，适配层复用即可。
- **优势**: 不重复造轮子；保证 Web、Agent、快捷键可共用同一命令语义；审计 ID 格式一致。
- **劣势和风险**: 当前审计 ID 仍为命令层生成的追踪 ID，不是完整 audit_event 表记录；后续若需要强制持久 audit_event，应在统一审计层补齐。

### 7. 关键风险点

- **并发问题**: 多次 pause/resume 可能覆盖 progress 字段；本轮不引入额外并发控制，沿用领域服务当前行为。
- **边界条件**: 缺少 `book_run_id`、completed/stopped 状态、无 checkpoint 重试均需明确错误。
- **性能瓶颈**: 单条命令只做一次领域服务调用，风险低。
- **安全考虑**: 本轮只做命令路径一致性，不新增认证或鉴权设计。
