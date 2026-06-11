## 项目上下文摘要（Novelskill 剩余工程尾项）

生成时间：2026-06-08 09:20:00 +08:00

### 1. 相似实现分析

- **BookContext 缓存**: `apps/api/app/domains/book_runs/book_context.py`
  - 模式：`get_book_context()` 使用 book_id 模块级缓存，`clear_book_context_cache(book_id)` 可精确失效。
  - 可复用：已有缓存清理函数，不需要新缓存框架。
  - 需注意：Lineage/Studio 已接成功写回清缓存，但直接改 `Scene`/`Chapter` 后 commit 仍可能绕过。
- **Story Memory**: `apps/api/app/domains/story_memory/service.py`
  - 模式：`MemoryAtomRecord` 是真相源，`create_memory_atom()` 统一写入，`recall_scene_memory_atoms()` 负责场景召回。
  - 可复用：`EmbeddingClient`、`_cosine_similarity()`、active atom 过滤。
  - 需注意：P2.5 是按需 embedding，尚未持久化 memory atom embedding。
- **Retrieval pgvector**: `apps/api/app/domains/retrieval/service.py`
  - 模式：PostgreSQL 且维度匹配时用 `embedding_vector <=> CAST(:query_embedding AS vector)` 排序并限制候选。
  - 可复用：pgvector literal、候选上限环境变量模式、sqlite fallback。

### 2. 项目约定

- Python `snake_case`；SQLAlchemy 2.0 `select()`；pytest plain assert 和中文 docstring。
- 不新增外部依赖；优先复用 retrieval 域 embedding 能力。
- 事件兜底只做缓存失效，不在事件里写业务数据。

### 3. 可复用组件清单

- `clear_book_context_cache(book_id)`
- `MemoryAtomRecord`
- `EmbeddingClient`
- `EmbeddingResult`
- `retrieval.service._cosine_similarity`
- `retrieval.service._pgvector_literal`

### 4. 测试策略

- 红灯1：直接修改 approved `Scene.content` 并 commit 后，`get_book_context()` 必须返回新实例和新正文。
- 红灯2：`create_memory_atom(..., embedding_client=...)` 必须把 embedding 持久化到 `MemoryAtomRecord.embedding`。
- 红灯3：PostgreSQL 候选裁剪应生成 `memory_atoms.embedding_vector <=> CAST(:query_embedding AS vector)` 排序并限制候选。

### 5. 依赖和集成点

- SQLAlchemy Session 事件：`after_flush` 收集受影响 book_id，`after_commit` 清缓存，`after_rollback` 丢弃待清集合。
- Story Memory：写入时可选持久化 embedding；召回时优先复用已持久化 embedding，PostgreSQL 可先裁剪候选。

### 6. 技术选型理由

- 缓存兜底用 ORM 事件覆盖绕过服务层的直接写入，避免重复在每个入口手工接线。
- embedding 持久化仍用 JSON 字段兼容 SQLite；PostgreSQL 迁移额外增加 `embedding_vector` 生成列和 HNSW 索引契约。

### 7. 关键风险点

- 真实 PostgreSQL/pgvector 在线迁移仍依赖环境；本轮以模型、迁移静态契约和 SQL 生成测试做本地补偿。
- 真实 provider 长跑需要安全凭据和成本预算，不能在缺少运行时变量时宣称完成。
