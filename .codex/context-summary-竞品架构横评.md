## 项目上下文摘要（竞品架构横评）

生成时间：2026-05-18 16:30:00 +08:00

### 1. 相似实现分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/README.md:1-152`
  - 模式：模块化单体，`apps/api` 为业务真相源，`apps/workflow` 承载 checkpoint 与长任务，`apps/web` 负责工作台。
  - 可复用：现有 Phase 1-4 能力地图、验证命令、OpenAPI 契约与 `.codex` 审计文件。
  - 需注意：当前主线明确是 Phase 0/5/6/7，不应重复 Phase 1-4。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/superpowers/plans/2026-05-17-storyforge-master-replan.md:1-220`
  - 模式：继续模块化单体，不拆微服务；真实 AI/RAG 接入、产品工作台可用化、发布治理分阶段推进。
  - 可复用：Phase 5 的 Provider Gateway、Embedding、Reranker、ModelRun、Scene Packet 真实证据链任务。
  - 需注意：文档已指出 provider 和检索仍偏确定性占位或 shim。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/TODO.md:1-126`
  - 模式：任务池按 P0/P1/P2/P3 划分，记录 Git、验证、Docker、OpenAPI 和 Alembic 风险。
  - 可复用：当前阻碍清单和下一步任务池可直接映射 Phase 0/5/6/7 架构路线。
  - 需注意：本地工作区存在未提交治理变更，架构建议必须避免直接改业务代码。

### 2. 项目约定

- **命名约定**: 包名使用 `@storyforge/*`，Python 包使用 `storyforge_*`，文档与日志强制简体中文。
- **文件组织**: `apps/api`、`apps/workflow`、`apps/web`、`packages/shared`、`tests/e2e`、`docs`、`.codex` 分层明确。
- **导入顺序**: 当前未做代码变更，保持既有 TypeScript/Python 项目默认顺序。
- **代码风格**: 本轮为架构分析，不改业务代码；输出和审计文档使用中文。
### 3. 可复用组件清单

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api`: FastAPI、领域模型、OpenAPI、业务真相源。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow`: LangGraph 或兼容 runtime、checkpoint、JobRun 桥接。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/packages/shared`: OpenAPI 契约快照。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/run-e2e.mjs`: 阶段契约与补偿验证编排。

### 4. 测试策略

- **测试框架**: Node `node:test`、TypeScript 静态检查、Python `compileall`、pytest、根级 `pnpm e2e`。
- **测试模式**: 阶段级契约测试 + 服务层补偿验收 + workflow runtime pytest。
- **参考文件**: `tests/e2e/phase2-contract.spec.ts`、`tests/e2e/phase3-contract.spec.ts`、`apps/api/tests/*phase*_service_acceptance.py`。
- **覆盖要求**: 后续 Phase 5 必须覆盖真实配置解析、降级、失败记录、检索证据链、checkpoint 恢复。

### 5. 依赖和集成点

- **外部依赖**: Next.js 15.3.2、React 19.1.0、FastAPI >=0.115、LangGraph >=0.2、PostgreSQL + pgvector、Redis、MinIO。
- **内部依赖**: API 是真相源；workflow 通过 Job、checkpoint、事件、ModelRun 暴露状态；web 不持有长任务真相状态。
- **配置来源**: `.env.example`、`docker-compose.yml`、各子项目 `pyproject.toml` 与 `package.json`。

### 6. 技术选型理由

- **为什么用这个方案**: 模块化单体降低 Phase 5/6/7 复杂度，PostgreSQL 保存结构化真相源，pgvector 负责语义检索，Redis 适合短期状态与队列。
- **优势**: 工程边界清楚，契约验证明确，已有 OpenAPI 和 `.codex` 审计留痕。
- **劣势和风险**: 真实 AI/RAG 尚未闭环；workspace 没有 Turbo/Nx 任务图；LangGraph state 若直接累积全文会膨胀；TTFT 与流式事件恢复需要专门设计。

### 7. 关键风险点

- **并发问题**: 多 Agent 同时修改世界观、剧情、角色卡时会出现冲突写入和不可解释回滚。
- **边界条件**: 超长作品、跨卷时间线、重写历史章节、长期暂停后恢复。
- **性能瓶颈**: 11,600+ 文件实际扫描为 21,730 文件；未排除 `node_modules` 时本地检索与构建成本会被放大。
- **安全考虑**: 按当前任务只用于架构风险描述，不作为验收目标。
