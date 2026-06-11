## 项目上下文摘要（Novelskill P2.5 语义记忆召回）

生成时间：2026-06-08 06:45:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/story_memory/service.py`
  - 模式：`recall_scene_memory_atoms()` 读取 active memory atoms，再用 `chapter`、`assets`、`continuity_records` 提取候选词并按 `_term_rank()` 排序。
  - 可复用：`get_active_memory_atoms()`、`_scene_memory_terms()`、`_is_active()`、`MemoryAtom` 契约。
  - 需注意：当前 `_memory_atom_matches_scene()` 只做子串判断，语义相关但无关键词重叠的记忆无法进入召回。
- **实现2**: `apps/api/app/domains/retrieval/service.py`
  - 模式：`search_retrieval()` 支持可注入 `EmbeddingClient`，无关键词重叠时用 query embedding + `_cosine_similarity()` 命中语义相近 chunk。
  - 可复用：`EmbeddingClient` 协议、`LocalEmbeddingClient`、`_cosine_similarity()`、pgvector 候选排序约定。
  - 需注意：retrieval chunk 表与 memory atom 表不同，本轮只复用 embedding 接口和打分函数，不复制 retrieval schema。
- **实现3**: `apps/api/tests/test_retrieval_embedding.py`
  - 模式：测试内定义 `SemanticEmbeddingClient`，制造“查询词与内容无关键词重叠但向量相近”的红绿场景。
  - 可复用：可注入 embedding client 测试模式、`EmbeddingResult` 构造。
  - 需注意：测试应验证真实 service 行为，不测试 mock 本身。
- **实现4**: `apps/api/app/domains/book_runs/phase9b_parallel_ports.py`
  - 模式：P2 已在 `_memory_recall_chars_for_chapter()` 中读取 active atoms 并把 `memory_recall_chars` 写入 completed progress。
  - 可复用：Phase9B precommit revision、`memory_recall_budget_scope`。
  - 需注意：当前只统计 active atoms 字符数，不区分相关性；P2.5 应改为调用召回路径。

### 2. 项目约定

- API 服务层使用 SQLAlchemy 2.0 `select()`、`order_by()`、`session.scalars()`；Context7 已查询 SQLAlchemy 文档确认该模式。
- 测试使用 pytest plain assert 和中文 docstring。
- embedding 能力已有本地稳定降级，不新增依赖、不要求真实 provider 凭据。
- GitHub 搜索显示通用 agent memory 项目常见做法是 relevance + recency 排序；本仓库已有 retrieval 域实现，优先复用本地代码。

### 3. 可复用组件清单

- `app.domains.retrieval.embedding_client.EmbeddingClient`: 可注入 embedding 协议。
- `app.domains.retrieval.embedding_client.LocalEmbeddingClient`: 缺凭据时本地稳定向量实现。
- `app.domains.retrieval.service._cosine_similarity`: 既有余弦相似度实现。
- `story_memory.get_active_memory_atoms()`: 章节有效区间过滤。
- `scene_packets.context_pipeline.assemble_scene_context()`: Scene Packet 主链路已调用 `recall_scene_memory_atoms()`。

### 4. 测试策略

- 红灯1：`recall_scene_memory_atoms()` 在关键词无重叠时，应能通过注入 embedding client 召回语义相关 memory atom。
- 红灯2：排序应体现 relevance + immutable + recency，避免远期低相关事实挤掉当前关键事实。
- 回归：`test_story_memory_contract.py`、`test_context_compiler_memory_injection.py`、`test_phase9b_parallel_ports.py`。

### 5. 依赖和集成点

- 外部依赖：无新增；本地 embedding 使用已有 `LocalEmbeddingClient`。
- 内部依赖：Story Memory、Retrieval embedding、Phase9B parallel runner、Scene Packet context pipeline。
- 集成方式：给 `recall_scene_memory_atoms()` 增加可选 `embedding_client` 和 `limit` 参数；默认无 embedding 时保持关键词兼容；Phase9B 召回预算调用该函数统计相关记忆字符数。

### 6. 技术选型理由

- 复用 retrieval 域 embedding 协议，避免新增自研向量客户端。
- SQLite 本地测试无法证明 pgvector 索引执行，但可证明 query embedding + cosine 的语义排序；PostgreSQL pgvector 候选排序继续留在 retrieval 域。
- Story Memory 表不新增 embedding 列，本轮按需临时嵌入 active atoms，优先交付可验证主链路；后续可把 memory atom embedding 持久化为 P3 增量。

### 7. 关键风险点

- 临时嵌入 active atoms 对超大记忆库有性能成本，需 limit 和候选加载边界控制。
- 本地稳定 embedding 不等价于真实 embedding 质量，但测试可注入语义客户端验证接口行为。
- pgvector 真实长跑仍需 PostgreSQL 与凭据安全确认，不作为 P2.5 通过条件。
