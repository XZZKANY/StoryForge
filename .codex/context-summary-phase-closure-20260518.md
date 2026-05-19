## 项目上下文摘要（Phase 后续交付闭环三轮）

生成时间：2026-05-18 21:31:10 +08:00

### 1. 任务目标

- 按用户要求连续推进 3 轮，每轮选择一个最该解决的 Phase 后续交付闭环问题。
- 当前 TODO 指向 Phase 5/6/7；本轮优先处理 P1 的真实 AI/RAG 依赖接入，不做新的无关架构重构。
- 过程必须更新 TODO.md、运行本地验证、检查 Git 状态，且不得自动提交。

### 2. 相似实现分析

- `apps/api/app/domains/provider_gateway/runtime_config.py`：已有按能力解析 LLM、embedding、reranker 环境配置的模式，适合复用为检索 embedding 元数据来源。
- `apps/api/app/domains/provider_gateway/service.py` 与 `apps/api/tests/test_provider_gateway.py`：已有数据库 provider 优先、环境配置回退、缺密钥降级的测试模式。
- `apps/api/app/domains/retrieval/service.py` 与 `apps/api/tests/test_phase4_service_acceptance.py`：已有资料源切片、刷新任务、关键词检索和 Scene Packet 自动检索闭环。
- `apps/api/app/domains/scene_packets/service.py` 与 `apps/api/tests/test_scene_packet_context_compiler.py`：已有上下文编译、检索证据注入、预算裁剪和调试字段模式，需保留并最小扩展。
- `apps/api/app/domains/context_compiler/service.py`：当前工作区已有未跟踪上下文编译器实现，本轮不得覆盖，只能按其公开 schema 集成。

### 3. 项目约定

- Python 文件使用 `snake_case`，Pydantic schema 使用 `PascalCase`，服务异常使用领域内 `ValueError` 子类。
- 测试使用 pytest、SQLite 内存库、服务层直调或少量 FastAPI TestClient；当前环境对 HTTP pytest 有历史阻塞风险。
- 用户可见文本、注释、测试描述、文档和日志必须使用简体中文。
- 本地验证优先使用 `pnpm run test:api`、`pnpm e2e`、针对性 pytest 和 `git status --short --branch`。

### 4. 可复用组件清单

- `load_runtime_provider_config("embedding")`：解析 embedding provider、模型、密钥状态和降级状态。
- `RetrievalRefreshRun.payload`：可记录刷新使用的 provider、模型、chunk 引用和降级原因。
- `RetrievalChunk.embedding`：继续只保存向量加速字段，不复制业务真相源。
- `RetrievalHitRead`：可扩展检索命中的 score 来源、rerank 顺序和预算字段，并同步 OpenAPI。
- `ContextBlock.metadata`：可承载检索命中的 source/chunk/rank/score/budget 元数据。

### 5. 测试策略

- 第1轮新增或扩展 retrieval 服务测试，覆盖 embedding 客户端接口和刷新 payload。
- 第2轮覆盖查询向量参与排序，确保无关键词重叠时也能通过 embedding 相似度命中。
- 第3轮覆盖 Scene Packet 输出检索证据的 chunk、score、rerank 顺序和上下文预算占用。
- 每轮运行针对性 pytest，再运行 `pnpm run test:api`；必要时运行 `pnpm e2e` 或 `pnpm openapi`。

### 6. 依赖与集成点

- 外部依赖：不新增 Python 包；真实调用接口先以标准库和可注入 client 抽象承载，避免扩大依赖面。
- 内部依赖：provider_gateway 提供配置；retrieval 负责 chunk 与 search；scene_packets 负责证据注入；context_compiler 负责预算裁剪。
- 配置来源：`.env.example` 与 `STORYFORGE_EMBEDDING_*`，真实密钥缺失时继续稳定回退。

### 7. 风险点

- 当前工作区已有未提交和未跟踪文件，必须避免回滚或覆盖用户既有改动。
- `packages/shared/src/contracts/storyforge.openapi.json` 可能因 schema 扩展而变化，需用 `pnpm openapi` 验证。
- Docker 当前未必可用，本轮不把 `pnpm verify` 作为唯一通过依据。
