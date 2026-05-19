## 项目上下文摘要（compiled_contexts 最小持久化）

生成时间：2026-05-19 00:55:00 +08:00

### 1. 相似实现分析

- `apps/api/app/domains/story_memory/models.py`：新增领域模型使用 `IdMixin`、`TimestampMixin`，`book_id` 按 `ForeignKey("books.id")` 使用 int，迁移和测试已形成最小持久化样板。
- `apps/api/app/domains/continuity/models.py`：`ScenePacket.packet` 使用 SQLAlchemy `JSON` 保存结构化包体，说明审计摘要字段可沿用 JSON 列。
- `apps/api/app/domains/model_runs/models.py`：`ModelRun` 以 `book_id`、`scene_id`、`payload` 记录运行审计信息，是 compiled context 与后续 ModelRun 绑定的相邻模式。
- `apps/api/tests/test_scene_packet_context_compiler.py`：使用 SQLite 内存库、`Base.metadata.create_all()` 和服务层调用验证 Scene Packet 输出 `compiled_context_id`、注入、裁剪、预算字段。

### 2. 项目约定

- SQLAlchemy 采用 2.0 annotated declarative：`Mapped[...] = mapped_column(...)`。
- 主键统一来自 `app.db.base.IdMixin`，当前 `id` 类型为 `Integer`，不得假设 UUID。
- JSON 审计字段沿用 `Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)` 或列表型 JSON 字段。
- 测试使用 pytest，服务层测试优先使用 SQLite 内存库和真实 SQLAlchemy Session。

### 3. 可复用组件清单

- `compile_context(payload)`：现有纯函数编译上下文，返回 `CompiledContext` 契约对象。
- `ContextCompileRequest` / `CompiledContext`：已有契约，含 `novel_id`、`chapter_id`、`scene_id`、预算报告、注入块、裁剪块和调试摘要。
- `Base`、`IdMixin`、`TimestampMixin`：所有领域表共享元数据、int 主键和审计时间字段。
- `ScenePacket`：当前已经持久化场景包，可作为 `compiled_context_id` 写回 packet 的集成点。

### 4. 测试策略

- 先新增 `apps/api/tests/test_context_compiler_persistence.py`，验证表结构、服务层持久化摘要、Scene Packet 组装后可查询历史编译结果。
- 按 TDD 先运行定向 pytest 观察红灯；实现后再运行 `test_context_compiler.py`、`test_context_compiler_persistence.py`、`test_scene_packet_context_compiler.py`。

### 5. 依赖和集成点

- 外键依赖：`books.id`、`chapters.id`、`scenes.id` 均已确认是 `Integer`。
- 服务集成：`scene_packets.service._attach_compiled_context()` 当前只把 compiled context 写入 packet 字典，尚未持久化。
- 迁移集成：上一新增 head 是 `c0ffee20260519_add_memory_atoms.py`，后续迁移应接在该 revision 后。

### 6. 技术选型理由

- 使用 SQLAlchemy 模型和 Alembic 小迁移符合总计划 11.6 的“最小持久化表”要求。
- 使用 JSON 保存 `block_refs`、`budget_report`、`debug_summary`，避免存整段 prompt 全文，满足“只保存摘要、预算、block 引用、裁剪原因”的边界。
- 不新增 API/UI/微服务，先保证后续 Context Inspector、diff、归因有事实源。

### 7. 关键风险点

- 当前 `CompiledContext.compiled_context_id` 是 `ctx_...` 字符串，而数据库 `id` 仍应为 int；应新增单独字符串列 `compiled_context_id`，不能把主键改成 UUID 或字符串。
- `novel_id` 契约命名与数据库 `book_id` 命名不同；持久化层需明确映射，避免混淆。
- Scene Packet 集成要保持现有返回契约不变，只额外持久化并继续写回相同 `compiled_context_id`。

### 8. 外部资料

- Context7 `/websites/sqlalchemy_en_20_orm`：确认 SQLAlchemy 2.0 推荐 `Mapped` + `mapped_column()` annotated declarative 映射，JSON 类型可通过显式类型或类型映射保存结构化值。
- GitHub 开源搜索：本环境未提供可调用的 `github.search_code` 工具；已记录限制，并以项目内 3 个相似实现和 SQLAlchemy 官方文档补偿。
