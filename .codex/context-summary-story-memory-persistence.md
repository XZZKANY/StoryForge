## 项目上下文摘要（story_memory 最小持久化）

生成时间：2026-05-19 00:00:00 +08:00

### 1. 任务目标

- 按总计划第 11.5 节执行 `story_memory` 最小持久化。
- 新增 `memory_atoms` 表、SQLAlchemy 模型、Alembic 迁移、基础 CRUD service、章节有效事实查询和验证。
- 不实现独立 TimelineEvent、Progression、MemoryConflict、AgentProposal / ArbitrationDecision 持久化；这些在第 11.5 中明确可延后。

### 2. 状态区分

- 已实现：`apps/api/app/domains/story_memory/schemas.py` 提供 MemoryAtom、TimelineEvent、Progression、MemoryConflict、AgentProposal、ArbitrationDecision 契约；`service.py` 提供纯函数查询、冲突检测和仲裁；`test_story_memory_contract.py` 覆盖契约行为。
- 已有契约但未持久化：MemoryAtom、Progression、冲突检测与仲裁。
- 完全不存在：`apps/api/app/domains/story_memory/models.py`、`memory_atoms` 表、Alembic 迁移、落库 CRUD、按章节从数据库查询有效事实。
- 竞品启发：Letta/MemGPT 记忆分层、Novelcrafter Progression、SillyTavern activation 仅作为边界参考，不在本轮扩展大型架构。

### 3. 相似实现分析

- `apps/api/app/db/base.py`：`IdMixin.id` 是 `Integer` 自增主键，确认不得假设 UUID。
- `apps/api/app/domains/books/models.py`：`Book.id`、`Chapter.id`、`Scene.id` 均通过 `IdMixin` 使用 int；新增 `book_id` 必须使用 int 外键。
- `apps/api/app/domains/retrieval/models.py` 与 `apps/api/app/domains/provider_gateway/models.py`：领域模型使用 SQLAlchemy 2.0 `Mapped` / `mapped_column`，JSON 字段保存结构化 payload。
- `apps/api/tests/test_phase4_service_acceptance.py`：使用 SQLite 内存库 `Base.metadata.create_all` 验证服务层闭环。

### 4. 项目约定

- Python 模块、函数、字段使用 snake_case；ORM 类使用 PascalCase。
- 用户可见错误、测试 docstring、文档和日志使用简体中文。
- Alembic 版本文件位于 `apps/api/alembic/versions/`，当前 head 为 `9f2b3c4d5e6f`。

### 5. 验证方式

- `cd apps/api; uv run pytest tests/test_story_memory_contract.py tests/test_story_memory_persistence.py -q`
- `cd apps/api; uv run alembic heads`
- `pnpm run test:api`
- `git status --short --branch`
