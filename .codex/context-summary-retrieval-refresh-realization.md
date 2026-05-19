## 项目上下文摘要（retrieval-refresh-realization）

生成时间：2026-05-19 02:30:00 +08:00

### 1. 相似实现分析

- `apps/api/app/domains/retrieval/embedding_client.py`：已有 `EmbeddingClient` Protocol、`EmbeddingResult` 和 `LocalEmbeddingClient`，说明 Phase 5 embedding 已有可注入客户端契约与本地稳定回退。
- `apps/api/app/domains/retrieval/service.py`：`create_retrieval_source()` 与 `create_retrieval_refresh_run()` 通过 `_sync_source_chunks()` 保存 chunk 引用、keywords、embedding；`search_retrieval()` 已支持 query embedding 与 keyword 混合打分。
- `apps/api/tests/test_retrieval_embedding.py`：已有 SQLite 内存库 fixture、测试用 embedding client、刷新元数据断言和 query embedding 语义命中测试。
- `apps/api/tests/test_provider_gateway.py`：已有 provider runtime 配置测试，覆盖 embedding 与 reranker 缺密钥时分别回退到 `local` 与 `disabled`。
- `apps/api/app/domains/scene_packets/service.py`：Scene Packet 自动检索会把 `score_source`、`keyword_score`、`embedding_score`、`context_tokens` 写入证据链和 ContextBlock metadata。

### 2. 项目约定

- Python 使用 SQLAlchemy 2.0 `Mapped/mapped_column`、Pydantic v2 `BaseModel`、pytest + SQLite `StaticPool` 夹具。
- 领域模块按 `models.py`、`schemas.py`、`service.py`、`router.py` 分层。
- 测试函数名称使用英文标识符，测试 docstring 和断言语义使用简体中文。
- 日志和审查记录追加到项目内 `.codex/operations-log.md` 与 `.codex/verification-report.md`。

### 3. 可复用组件清单

- `EmbeddingClient` / `EmbeddingResult`：检索刷新和搜索注入真实或测试 embedding 的既有接口。
- `load_runtime_provider_config("reranker")`：已有 reranker 运行时配置解析，可用于 disabled/local 回退元数据。
- `RetrievalHitRead`：当前检索结果读模型，已包含分数来源和 embedding/keyword 子分。
- `search_retrieval()`：真实检索入口，Scene Packet 已复用该函数生成证据。

### 4. 测试策略

- 参考 `test_retrieval_embedding.py`，优先服务层 pytest，避免 FastAPI TestClient 环境阻塞。
- 红灯测试先覆盖 reranker 可选启用：在 keyword/embedding 初排后，reranker mock 能稳定调整 rank，并在 hit 中保留 rerank 元数据。
- 绿灯后运行 `uv run pytest tests/test_retrieval_embedding.py -q`，必要时补跑 Scene Packet 检索测试。

### 5. 依赖和集成点

- API 真相源仍是 `RetrievalSource` 与 `RetrievalChunk`，向量索引只保存 chunk 引用和得分，不替代业务数据。
- Scene Packet 通过 `search_retrieval()` 获取 hits；若 hit schema 增加 rerank 字段，需要同步 evidence/context metadata。
- Provider Gateway 已能解析 reranker 配置，但 retrieval 搜索尚未接入 reranker 客户端。

### 6. 技术选型理由

- 采用 Protocol + dataclass 延续 embedding_client 的轻量接口，便于测试注入真实客户端 mock，不新增大型架构。
- reranker 默认为 disabled，未配置时保持现有排序，避免破坏既有测试和无密钥本地验证。
- 只在 search 阶段重排，不改数据库结构，不做 pgvector 优化。

### 7. 关键风险点

- reranker 只应记录 score/order 元数据，不复制 source 全文到 refresh run。
- 若 reranker 结果缺失 chunk_id，应保留原始稳定排序。
- 本轮不新增数据库迁移，避免偏离总计划第 11 节当前优先级。