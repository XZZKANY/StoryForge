## 项目上下文摘要（BookRun 完章同步 TimelineEvent）

生成时间：2026-06-02 21:56:50 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/service.py`
  - 模式：服务层函数接收 `Session` 与 Pydantic payload，更新 ORM 后 `commit` 与 `refresh`。
  - 可复用：`apply_book_run_progress` 是 BookRun progress 合并入口；`_checkpoint_from_progress` 已扫描 `completed_chapters`。
  - 需注意：`provider_resolution`、`volume`、`current_volume`、`chapter_range`、`volume_checkpoint` 是受控 progress 字段。
- **实现2**: `apps/api/app/domains/timeline/service.py`
  - 模式：`create_timeline_event` 接收 `TimelineEventCreate`，校验作品和章节归属后创建 `TimelineEventRecord`。
  - 可复用：必须直接复用该服务和 schema 创建事件。
  - 需注意：该服务内部会 `commit` 与 `refresh`。
- **实现3**: `apps/api/tests/test_book_runs.py`
  - 模式：使用 `TestClient` 创建 BookRun，必要时用 `session_factory` 直接调用服务层。
  - 可复用：`seed_locked_blueprint` 可创建 locked Blueprint；测试断言直接检查返回对象和 API 响应。
- **实现4**: `apps/api/tests/test_timeline_events.py`
  - 模式：创建 Book 与 Chapter 后通过 `/api/timeline-events` 验证事件创建、列表过滤和归属校验。
  - 可复用：事件字段断言包含 `project_id`、`volume_id`、`time_order`、`evidence_refs`、`payload`。

### 2. 项目约定

- **命名约定**: Python 函数与私有 helper 使用 `snake_case`；ORM 类使用 `PascalCase`。
- **文件组织**: 领域服务在 `app/domains/<domain>/service.py`，schema 在 `schemas.py`，测试在 `tests/test_<domain>.py`。
- **导入顺序**: `__future__` 后标准库，再 SQLAlchemy/FastAPI，再 `app.*` 内部模块。
- **代码风格**: 中文 docstring，plain assert，服务层抛领域异常，测试使用内存 SQLite。

### 3. 可复用组件清单

- `apply_book_run_progress`: BookRun progress 合并入口。
- `TimelineEventCreate`: TimelineEvent 创建契约。
- `create_timeline_event`: TimelineEvent 创建服务，负责既有作用域校验。
- `list_timeline_events`: 测试中可读取事件列表。
- `Chapter`: 可按 `book_id + ordinal` 将 `chapter_index` 解析为真实章节。

### 4. 测试策略

- **测试框架**: pytest + FastAPI TestClient + SQLAlchemy 内存 SQLite。
- **测试模式**: 先新增失败测试，再实现服务层同步。
- **参考文件**: `apps/api/tests/test_book_runs.py`、`apps/api/tests/test_timeline_events.py`。
- **覆盖要求**: 正常同步、重复提交去重、缺失 `volume_id` 受控默认。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy ORM 2.0 风格 `select`、Pydantic v2 `model_dump`。
- **内部依赖**: BookRun service 依赖 timeline schema/service 与 books Chapter。
- **集成方式**: 在 `apply_book_run_progress` 中扫描 `progress["completed_chapters"]` 并调用 timeline 创建服务。
- **配置来源**: 不读取 `.env` 或凭据；测试通过夹具清理远程 LLM 环境变量。

### 6. 技术选型理由

- **为什么用这个方案**: 用户要求复用 timeline 现有 service/schema，且 BookRun progress 合并入口是唯一可靠同步点。
- **优势**: 不新增事件模型；重复 patch 可幂等；兼容 SQLite 测试和现有 JSON 字段。
- **劣势和风险**: TimelineEvent 缺少唯一索引，只能服务层去重；若未来事件量很大，需要新增 source key 或索引。

### 7. 关键风险点

- **并发问题**: 并发重复提交仍可能绕过服务层去重，当前任务不改数据库结构。
- **边界条件**: `completed_chapters` 项缺少 `chapter_id` 时需按 `chapter_index` 查章节；查不到则跳过，避免破坏既有 progress 更新。
- **性能瓶颈**: 每次扫描候选事件数量与完章数量相关，当前测试规模可接受。
- **安全考虑**: 不读取或写入 API Key；事件 evidence 仅使用已有 id 引用。
