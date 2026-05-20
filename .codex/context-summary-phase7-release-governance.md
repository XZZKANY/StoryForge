## 项目上下文摘要（Phase 7 发布与治理收口）

生成时间：2026-05-20 00:40:00 +08:00

### 1. 相似实现分析

- `docs/operations/local-start.md`：按“适用范围 → 前置工具 → 环境文件 → 服务启动 → 验证顺序 → 故障处理 → Git 检查”组织发布治理信息。
- `docs/operations/release-checklist.md`：按 Git、环境、OpenAPI、本地测试、文档、回滚门禁拆分发布前检查。
- `docs/operations/troubleshooting.md`：按故障现象、排查命令、处理步骤记录本地环境限制，强调不能把环境限制误判为功能缺陷。
- `docs/architecture/phase6-workbench-contract.md`：使用“已实现 / 已有契约但未联通 / 完全不存在”区分 Phase 6 状态，适合本轮只做状态校准。

### 2. 项目约定

- 所有文档、日志、验证报告使用简体中文。
- 发布治理只修改文档、样例配置、脚本或审计记录，不新增产品功能。
- OpenAPI 契约变更必须由 API 代码生成并有 diff 说明；无关 diff 不接受。
- Docker/PostgreSQL 不可用时只能记录环境限制和补偿验证，不能声称在线迁移通过。

### 3. 可复用组件清单

- `scripts/generate-openapi.ps1`：OpenAPI 刷新入口，按 `uv`、`python3`、`python` 顺序选择运行时。
- `scripts/run-e2e.mjs`：根级契约验证入口，先刷新 OpenAPI，再运行 Node 契约、API 补偿验收和 workflow 验证。
- `scripts/verify-local.ps1`：本地工具、路径与 Docker 容器状态检查入口。
- `apps/api/app/domains/provider_gateway/runtime_config.py`：当前实际读取 `STORYFORGE_LLM_*`、`STORYFORGE_EMBEDDING_*`、`STORYFORGE_RERANKER_*` 的运行时配置事实源。
- `apps/api/alembic/env.py` 与 `apps/api/alembic/versions/`：Alembic 迁移链事实源。

### 4. 测试策略

- 文档状态修复：使用 `Select-String` 检查关键字与状态边界。
- OpenAPI 治理：运行 `pnpm openapi`，再检查 `packages/shared/src/contracts/storyforge.openapi.json` 是否无无关 diff。
- 环境与迁移治理：优先静态比对 `.env.example` 与实际环境变量读取点；Docker 不可用时记录限制。
- 每轮都检查 `git status --short --branch`，但不自动提交。

### 5. 依赖和集成点

- API 配置：`DATABASE_URL`、Provider Gateway 运行时环境变量。
- Workflow 配置：`.env.example` 中的 `WORKFLOW_RUNTIME_MODE` 与 `WORKFLOW_CHECKPOINT_BACKEND` 当前为启动治理预留。
- 本地服务：PostgreSQL、Redis、MinIO 由 `docker-compose.yml` 提供。
- 契约：`packages/shared/src/contracts/storyforge.openapi.json` 由 `apps/api/app/main.py` 的 FastAPI app 生成。

### 6. 技术选型理由

- 本轮是发布治理，不引入新依赖；复用已有脚本与文档结构即可。
- 只做最小修复，避免继续扩 Studio/Retrieval/Runs/Artifacts/Evaluations 数据源。
- 使用离线验证和文本断言覆盖文档治理，避免 Docker 不可用时误报在线成功。

### 7. 关键风险点

- README 与 TODO 若继续建议 Phase 6 扩展，会违背当前“Phase 6 全局收口已完成”的用户裁决。
- 运维文档若继续写“代码尚未读取 AI/RAG 变量”，会与 `runtime_config.py` 当前事实冲突。
- OpenAPI 刷新可能产生无关契约 diff，必须先解释来源；本轮如无 API 代码变更应保持无 diff。
- Alembic 在线迁移依赖 Docker/PostgreSQL，不可用时只能记录补偿验证。
