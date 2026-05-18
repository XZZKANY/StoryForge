## 项目上下文摘要（竞品架构横评落地修改）

生成时间：2026-05-18 17:10:00 +08:00

### 1. 相似实现分析

- **实现1**: `README.md:1-152`
  - 模式：根文档说明项目定位、架构边界、本地环境、常用命令和后续 Phase 0/5/6/7 路线。
  - 可复用：重要文档入口、后续路线表、验证策略说明。
  - 需注意：不能承诺真实 AI/RAG 已可用，只能说明 Phase 5 预留。
- **实现2**: `docs/operations/local-start.md:1-124`
  - 模式：运维手册按适用范围、前置工具、环境文件、启动服务、验证顺序和失败处理组织。
  - 可复用：环境文件章节、OpenAPI 运行时回退说明、Docker 失败处理格式。
  - 需注意：新增配置必须明确不是当前启动前置条件。
- **实现3**: `docs/operations/troubleshooting.md:1-137`
  - 模式：每类问题按现象、判断、处理分节。
  - 可复用：Provider、embedding、reranker 未配置章节。
  - 需注意：排查建议必须以当前代码证据为准。

### 2. 项目约定

- **命名约定**: 环境变量使用大写下划线；Python 标识符使用 snake_case；包名使用 `@storyforge/*`。
- **文件组织**: 配置样例在 `.env.example`，运维说明在 `docs/operations/`，审计留痕在项目本地 `.codex/`。
- **代码风格**: 文档、注释和日志使用简体中文；文本文件保持 UTF-8 无 BOM。
- **验证风格**: 优先本地命令，失败必须记录原因和补偿步骤。

### 3. 可复用组件清单

- `apps/api/app/domains/provider_gateway/models.py`: `ProviderConfig` 保存 provider 名称、能力、模型别名和 `credential_ref`，不直接保存密钥。
- `apps/api/app/domains/retrieval/models.py`: `RetrievalChunk.embedding` 当前保存轻量 embedding 数组。
- `apps/api/app/domains/retrieval/service.py`: `_fake_embedding` 与关键词评分是当前 Phase 4 的确定性检索实现。
- `apps/workflow/storyforge_workflow/runtime/provider_execution.py`: `simulate_provider_execution` 是 workflow 当前本地确定性 provider。

### 4. 测试策略

- **测试框架**: 根级 `pnpm test`、`pnpm openapi`、PowerShell 文本检查、Python 字节检查。
- **参考文件**: `package.json`、`scripts/verify-local.ps1`、`scripts/run-e2e.mjs`。
- **覆盖要求**: 本轮不改业务代码；重点验证文本关键字、BOM、OpenAPI 生成和 compileall/Web 测试链。

### 5. 依赖和集成点

- **外部依赖**: 本轮不新增 SDK，不引入真实外网调用。
- **内部依赖**: `.env.example` 仅作为 Phase 5 预留配置入口；运行时仍由当前 deterministic provider、fake embedding、关键词检索和本地 shim 支撑。
- **配置来源**: 当前代码只显式读取 `DATABASE_URL`；AI/RAG 环境变量需要后续 Phase 5 接入时绑定到 provider gateway、embedding client 和 reranker。

### 6. 技术选型理由

- **为什么用这个方案**: 审计明确真实 AI/RAG 尚未闭环，但 `.env.example` 和运维说明缺少 Phase 5 配置边界；先补齐样例和文档能降低后续接入歧义。
- **优势**: 小范围、可验证、可回滚，不影响现有 Phase 1-4 验证链。
- **劣势和风险**: 仅是配置与文档预留，不能替代真实 provider/embedding/reranker 代码接入。

### 7. 关键风险点

- **边界风险**: 若文档措辞不清，后续代理可能误以为真实 AI/RAG 已可用。
- **验证风险**: `pnpm verify` 仍可能因 Docker 服务不可查询失败，需要记录为环境限制。
- **收口风险**: 当前工作区已有 ahead 1 和多项未提交治理变更，本轮不自动提交。
