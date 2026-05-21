# StoryForge TODO

更新时间：2026-05-21 00:41:00 +08:00

## 1. 项目目标

StoryForge 是面向长篇小说创作的 AI/RAG 创作工作台。核心目标是把作品资产、章节连续性、检索证据、结构化评审、定向修复、模型运行日志、制品和评测放在同一条可验证链路中，避免只生成孤立文本。

项目继续采用模块化单体：`apps/api` 作为业务真相源与控制面 API，`apps/workflow` 承载长任务、checkpoint 和 runtime，`apps/web` 提供连续操作工作台，`packages/shared` 保存 OpenAPI 契约，`tests/e2e` 负责阶段契约验证。

## 2. 当前状态

- 当前仓库路径：`D:/StoryForge/1-renovel-ai-ai-rag-tavern`。
- 当前分支与远程：`master...origin/master`，本轮 `git status --short --branch` 未显示 ahead/behind；工作区已有并行子代理的 API/Web/workflow 与审计文件改动，本轮治理文档只写入指定四个文件，继续遵守不自动提交、不回滚他人改动约束。
- 当前版本：`0.1.0`，根包管理器为 `pnpm@9.15.4`。
- 已完成主线：Phase 1 到 Phase 4 的工程闭环已完成，覆盖作品资产、章节生成、Scene Packet、Judge、Repair、系列记忆、团队协作、Provider Gateway、检索中心、Prompt Pack、模型运行日志、workflow runtime、制品中心和评测系统。
- 本地验证链：根级 `pnpm e2e`、Web 中文契约、API compileall、Workflow compileall、API 服务层补偿验收和 workflow pytest 已在既有验证报告中作为主要链路。
- 当前收口事实：Phase 5/6 的代码、契约、文档和验证记录已归入当前边界；本轮闭环推进已把 workflow-to-api 最小真表 adapter/client、Studio 真实批准写回、Runs retry 恢复任务创建、Artifacts 详情与 `payload_preview` 下载摘要、Evaluations 详情与失败样例摘要纳入事实源。剩余项收口为交互按钮流、详情页、对象存储签名 URL、复杂图表、自动反馈执行和主线程最终验证。

## 3. 下一版本目标

下一版本不再重复实现 Phase 1 到 Phase 4。Phase 5/6 当前以既有收口事实为准：本轮只按四项风险计划补真实摘要读取和治理压缩，不新增微服务、不引入全量前端 client；剩余执行流保留为后续功能待办。

1. **Phase 7：发布与运维治理**
   - 完善 `.env.example`、迁移、OpenAPI 刷新、统一验证脚本、启动手册、发布清单和故障手册。
   - 校准 README、TODO、`.codex/current-phase.md`、运维文档和架构文档，确保它们准确反映 Phase 5/6 当前状态。
2. **Phase 5：真实 AI/RAG 依赖接入收口状态**
   - 当前批准边界已收口：Provider Gateway、Embedding、Reranker、Scene Packet 检索证据链、story_memory、compiled_contexts 与 Workflow State 引用化已有最小闭环。
   - workflow-to-api 已有最小真表 adapter/client，workflow runtime 可把 ModelRun payload 写入 API 真表；这不是新微服务。后续只保留 HTTP 传输、真实 provider 端到端和跨进程恢复压测等增强。
3. **Phase 6：产品工作台可用化收口状态**
   - 当前批准边界已收口：Studio/Retrieval/Runs/Artifacts/Evaluations 的入口、契约、registry、Studio/Retrieval 单点读取、Runs JobRun 读取与 retry 恢复任务创建、Artifacts 列表/详情/下载摘要读取、Evaluations 运行列表/详情/失败样例摘要读取已完成事实校准。
   - 后续若未另行批准，不继续扩数据源或新增工作台执行功能。
4. **Phase 0：同步与健康基线**
   - 继续作为发布前门禁复核项：Git 状态、本地稳定验证链和环境限制记录必须清楚。

## 4. 最大阻碍

- **变更收口阻碍**：当前 `master...origin/master` 未显示 ahead/behind，但工作区叠加大量未提交 Phase 5/审计变更；后续开发必须继续小步验证并避免误回滚。
- **真实依赖阻碍**：Phase 4 的检索与 provider 仍以确定性占位或本地 shim 为主，真实 AI/RAG 尚未闭环。
- **验证环境阻碍**：既有报告记录 FastAPI `TestClient` / ASGI HTTP pytest 在当前环境可能阻塞，短期仍依赖契约测试、compileall 和服务层补偿验收。
- **产品体验阻碍**：前端页面已覆盖能力入口，但仍偏能力展示，尚未形成从创作到评测的连续操作闭环。
- **发布治理阻碍**：新机器启动、Docker、数据库迁移、MinIO、OpenAPI 刷新和统一验证脚本仍需治理补强。
- **审计噪音阻碍**：`.codex/operations-log.md` 历史记录很长；后续代理应优先读取 `.codex/current-phase.md`、`TODO.md`、`.codex/verification-report.md` 和相关运维文档，只在追溯具体问题时按关键词检索 operations log。

## 5. 任务池

### P0：立即处理

- [x] 确认当前 Git 同步状态：`master...origin/master` 未显示 ahead/behind；仍有大量未提交 Phase 5/审计变更，本轮继续按用户约束不自动提交、不回滚。
- [x] 执行 GitHub 同步门禁：`git fetch origin --prune`、`git status --short --branch`、`git log --oneline --decorate -5`、`git ls-remote --heads origin`。本地与远程 `master` 均为 `95f3642`。
- [x] 复跑当前稳定验证链：`pnpm e2e`、`pnpm run test:web`、`pnpm run test:api`、`pnpm run test:workflow`。验证通过，但发现 `pnpm e2e` 中 OpenAPI 刷新失败被降级为警告，已转入下一轮处理。
- [x] 若 Docker 可用，补跑 `pnpm verify` 并记录 PostgreSQL、Redis、MinIO 状态。本轮 Docker Desktop 可用，已启动 `storyforge-minio` 并确认 PostgreSQL、Redis、MinIO 均运行，`pnpm verify` 通过。

### P1：Phase 5 当前边界收口 / 后续功能待办

当前说明：Phase 5 已按当前批准边界收口；下面未勾选项只代表后续功能待办，不再作为本轮当前开发主线。

- [x] Provider Gateway 配置真实化：已新增运行时环境配置解析，区分 LLM、embedding、reranker；未配置密钥时分别稳定回退到 deterministic、local、disabled，并保留数据库 provider 优先解析。
- [x] Story Memory 最小持久化：已完成 `memory_atoms` 表、基础 CRUD、章节有效事实查询和最小 `auto_merge` 写入闭环；独立 Timeline/Progression/Conflict 表仍延后。
- [x] Context Compiler 追溯持久化：已完成 `compiled_contexts` 表、预算/注入/裁剪摘要保存和 Scene Packet 反查；Context Inspector API/UI 仍延后。
- [x] Workflow State 引用化：已完成 `GenerationState` 引用字段、`checkpoint_reference_state()` 和运行时 checkpoint 保存边界；真实 PostgresSaver 与 replay UI 仍延后。
- [x] `.codex/current-phase.md` 当前 Phase 索引：已按总计划 11.9 建立当前事实入口，历史归档暂缓到 Phase 7。
- [x] Embedding 与检索刷新真实化：已支持可注入 embedding 客户端、稳定本地 fallback、refresh run chunk 引用与 provider 元数据；真实外部 SDK 与密钥环境端到端仍延后。
- [x] Scene Packet 使用真实检索证据：已透传来源、chunk、score、rerank 与预算 token 元数据；前端证据跳转仍归入 Phase 6。
- [x] Workflow runtime 调用链联通：已完成 workflow 内存级 ModelRun 记录、成功/失败 sink、显式 `api_job_run_id:int` 的 API-compatible payload 映射、最小真表 adapter/client、API 真表写入 helper、非法 API JobRun ID 边界测试和失败 checkpoint；剩余 HTTP 传输、真实 provider 端到端和跨进程恢复压测，不做新微服务。

### P2：Phase 6 当前边界收口 / 后续功能待办

当前说明：Phase 6 已按当前批准边界收口；静态入口、README 索引、契约文档、registry、中文契约测试、Studio/Retrieval 单点读取、Runs JobRun 读取与 retry 恢复任务创建、Artifacts 列表/详情/下载摘要读取、Evaluations 运行列表/详情/失败样例摘要读取已完成。下面未勾选项只代表后续交互或详情增强，另行批准前不继续扩执行流。

- [x] Studio 页面串起作品、章节、Scene Packet、Judge、Repair、批准写回和失败恢复入口；已补最小中文契约入口 `作品选择`、`章节目标`、`Judge 评审`、`Repair 修订`、`批准写回`、`失败恢复`，且作品列表、章节目标、Scene Packet、Judge 评审、Repair 修订、批准写回摘要、失败恢复摘要和 `POST /api/studio/approve` 真实批准写回已实现；Web 已通过 Server Action 提交批准写回并展示结果摘要；生成/Judge/Repair 的完整交互式按钮流和失败续跑执行流仍待做。
- [ ] Retrieval 页面支持资料源列表、刷新任务、搜索请求、命中预览和证据跳转；已补最小中文契约入口 `资料来源类型`、`搜索请求`、`命中预览`、`证据跳转`，且资料源列表、刷新任务、搜索请求和命中预览 API/Web 单点读取已实现；独立证据跳转路由和重排状态仍待做。
- [x] Runs 页面展示任务状态、checkpoint、模型运行日志和失败重试；已补最小中文契约入口 `Checkpoint 状态`、`失败重试`、`ModelRun adapter 契约`，且 `GET /api/model-runs/job-runs/{job_run_id}` 真实读取已实现，`POST /api/model-runs/job-runs/{job_run_id}/retry` 可创建 queued 恢复任务；Web 已展示 retry 执行契约并明确缺少 checkpoint 时不可重试，立即续跑 workflow 仍未实现。
- [x] Artifacts 页面展示导出物、上传资料、工作流快照和评测报告；已补最小中文契约入口 `导出下载`、`资料入库状态`、`快照追溯`、`报告追溯`，且 `GET /api/artifacts`、`GET /api/artifacts/{artifact_id}`、`GET /api/artifacts/{artifact_id}/download` 已实现摘要读取；当前 download 是 `payload_preview` 摘要，不是对象存储签名 URL，上传资料执行、快照详情和报告详情仍待做。
- [x] Evaluations 页面展示评测集、运行记录、指标趋势和失败样例；已补最小中文契约入口 `评测集`、`运行记录`、`指标趋势`、`失败样例`，且 `GET /api/evaluations/runs`、`GET /api/evaluations/runs/{run_id}`、`GET /api/evaluations/runs/{run_id}/failed-samples` 已实现趋势摘要、失败样例和 Studio 反馈入口摘要；评测集管理、复杂趋势图、报告下载和自动反馈执行仍待做。

### P3：发布与治理

- [x] 补全 `.env.example`，覆盖 API、workflow、PostgreSQL、Redis、MinIO、provider、embedding、reranker 配置；已新增 Phase 5 AI/RAG 预留变量，并在运维文档中说明当前代码尚未读取这些变量。
- [x] 编写运维文档：`docs/operations/local-start.md`、`docs/operations/release-checklist.md`、`docs/operations/troubleshooting.md` 已完成。
- [x] 加强 `scripts/verify-local.ps1`，输出清晰失败原因和下一步修复建议；已新增 MinIO 容器检查，并在 Docker 查询失败时标明具体服务和修复命令。
- [x] 强化 e2e 的 OpenAPI 刷新门禁：`scripts/run-e2e.mjs` 已在刷新失败时返回非零退出码，不再静默使用旧契约；`scripts/generate-openapi.ps1` 单独验证通过。
- [x] 校准 e2e 补偿验证提示：`scripts/run-e2e.mjs` 的 FastAPI HTTP pytest 回退提示已覆盖 Phase 1/2/3/4 服务层验收，与实际 fallback 列表一致。
- [x] 统一 OpenAPI 生成运行时回退：`scripts/generate-openapi.ps1` 已支持 `uv`、`python3`、`python` 顺序解析，并在未找到运行时时给出中文失败原因。
- [x] 同步 OpenAPI 运行时回退运维说明：`docs/operations/local-start.md`、`docs/operations/troubleshooting.md`、`docs/operations/README.md` 已记录 `uv`、`python3`、`python` 选择顺序和排查方式。
- [x] 修复文本文件 UTF-8 BOM：已移除 `TODO.md` 与 `scripts/run-e2e.mjs` 的 BOM，并用 Python 字节检查和 `node --check` 验证。
- [x] 同步本地启动手册 OpenAPI 失败处理：`docs/operations/local-start.md` 已记录 `uv`、`python3`、`python` 运行时回退和实际运行时输出。
- [x] 刷新 Phase 6 OpenAPI 契约：`pnpm openapi` 已生成 Studio、Retrieval、Runs 新增端点快照，并新增 `docs/api/phase6-openapi-review.md` 记录差异来源。
- [x] 校准 TODO 当前工作区文件列表：已按最新 `git status --short --branch` 更新已修改与未跟踪发布治理文件。
- [x] 补齐 Alembic 从干净数据库升级到最新模型的本地验证记录：`docs/operations/alembic-validation.md` 已同步当前 head `20260520_0001`、迁移文件列表、在线 `uv run alembic upgrade head`、`uv run alembic current` 与 `uv run alembic current --check-heads` 通过结果。

## 6. 最近迭代记录

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-12 | 工程骨架与本地验证基线 | 初始化 monorepo、Docker、验证脚本、API/Web/Workflow/Shared 基线。 | 继续按 Phase 计划推进。 |
| 2026-05-16 | Phase 3 收尾与最终提交准备 | 团队工作区、协作审批、商业化控制、Provider Gateway、分析扩展完成补偿验收。 | 正常开发环境可补跑 HTTP route pytest。 |
| 2026-05-17 | Phase 4 工程补完与验收 | 检索中心、Prompt Pack、模型运行日志、runtime/JobRun 桥接、制品中心、评测系统完成。 | 后续接入真实 AI/RAG。 |
| 2026-05-17 | 总重规划完善 | 明确不再重复 Phase 1-4，后续路线调整为 Phase 0/5/6/7。 | 优先执行 Phase 0。 |
| 2026-05-18 | Phase 0 同步与健康基线记录 | README、总计划和验证报告已有本地记录。 | 当前仍需收口未提交/未跟踪文件。 |
| 2026-05-18 | TODO 整理 | 新增本文件，汇总目标、状态、下一版本、阻碍和任务池。 | 下一轮先处理 P0 收口与验证。 |
| 2026-05-18 | 第1轮：同步与健康基线收口 | GitHub 同步门禁通过；`pnpm e2e`、`test:web`、`test:api`、`test:workflow` 均通过。 | 第2轮修正 `run-e2e` 中 OpenAPI 刷新失败仍继续的问题。 |
| 2026-05-18 | 第2轮：验证脚本治理补强 | 修复 `scripts/run-e2e.mjs` 的 OpenAPI 刷新调用；刷新失败会停止 e2e，成功时输出已刷新契约。 | 第3轮继续补强发布治理文档或 `.env.example`。 |
| 2026-05-18 | 第3轮：发布文档治理 | 新增 `docs/operations/local-start.md`，覆盖本地工具、环境文件、Docker 服务、验证顺序和常见失败处理。 | 继续补充发布清单与故障手册；Phase 5 接入真实 provider 后再扩展 `.env.example`。 |
| 2026-05-18 | 再次第1轮：发布清单文档 | 新增 `docs/operations/release-checklist.md`，覆盖 Git、环境、OpenAPI、测试、文档和回滚门禁。 | 下一轮补齐故障手册。 |
| 2026-05-18 | 再次第2轮：故障手册文档 | 新增 `docs/operations/troubleshooting.md`，覆盖 Docker、FastAPI TestClient、OpenAPI、provider 未配置、验证失败和 Git 工作区排查。 | 下一轮加强 `pnpm verify` 基础服务检查。 |
| 2026-05-18 | 再次第3轮：verify-local 增强 | `scripts/verify-local.ps1` 新增 MinIO 检查，并让 Docker 查询失败提示包含具体服务和修复命令。 | Docker 服务当前不可查询，启动 Docker 后补跑 `pnpm verify`。 |
| 2026-05-18 | 第三次第1轮：校准 Git 与 TODO 状态 | 修正 TODO 当前状态：本地 `master` 已 `ahead 1`，并存在未提交发布治理变更；本轮继续遵守不提交约束。 | 下一轮补齐 Alembic 本地验证记录。 |
| 2026-05-18 | 第三次第2轮：Alembic 验证记录 | 新增 `docs/operations/alembic-validation.md`，记录迁移脚本语法、head 检查、离线 SQL 生成和在线升级限制。 | Docker 可用后补跑 `uv run alembic upgrade head` 与 `uv run alembic current`。 |
| 2026-05-18 | 第三次第3轮：运维文档索引 | 新增 `docs/operations/README.md`，并在根 `README.md` 重要文档中加入运维文档入口。 | 后续新增运维文档时同步更新索引。 |
| 2026-05-18 | 第四次第1轮：e2e 补偿提示校准 | 修正 `scripts/run-e2e.mjs` 的 FastAPI HTTP pytest 回退提示，使其与 Phase 1/2/3/4 服务层验收列表一致；`node --check` 通过。 | 下一轮统一 `pnpm openapi` 的 Python 运行时回退。 |
| 2026-05-18 | 第四次第2轮：OpenAPI 运行时回退 | `scripts/generate-openapi.ps1` 复用 e2e 的 Python 运行时回退策略，支持 `uv`、`python3`、`python`；PowerShell Parser、`pnpm openapi` 和 OpenAPI diff 检查通过。 | 下一轮同步运维文档，说明 OpenAPI 运行时回退与排查方式。 |
| 2026-05-18 | 第四次第3轮：OpenAPI 运维文档同步 | 同步本地启动手册、故障手册和运维索引，记录 `pnpm openapi` 的 `uv`、`python3`、`python` 运行时选择顺序；`pnpm e2e` 通过。 | 继续保留 Docker 可用后补跑 `pnpm verify` 与在线 Alembic 的遗留项。 |
| 2026-05-18 | 第五次第1轮：UTF-8 无 BOM 修复 | 移除 `TODO.md` 与 `scripts/run-e2e.mjs` 的 UTF-8 BOM，恢复 AGENTS 编码要求；字节检查与 `node --check` 通过。 | 下一轮同步本地启动手册中 OpenAPI 失败处理的运行时回退说明。 |
| 2026-05-18 | 第五次第2轮：本地启动手册同步 | 更新 `docs/operations/local-start.md` 的更新时间和 OpenAPI 失败处理步骤，记录 `uv`、`python3`、`python` 回退及实际运行时输出；`pnpm openapi` 通过。 | 下一轮校准 TODO 当前工作区未提交文件列表。 |
| 2026-05-18 | 第五次第3轮：TODO 工作区状态校准 | 按最新 `git status --short --branch` 更新 TODO 当前未提交文件列表，避免后续代理误判工作区范围。 | 继续保留不提交约束；Docker 可用后补跑 `pnpm verify` 与在线 Alembic。 |
| 2026-05-18 | 竞品架构横评落地修改 | 补齐 `.env.example` 的 Phase 5 AI/RAG 预留变量，并同步本地启动手册、故障手册、运维索引、README 和 TODO。 | Phase 5 仍需把变量绑定到真实 provider、embedding、reranker 与 ModelRun 验证。 |
| 2026-05-18 | Provider Gateway 配置真实化第1步 | 新增 provider 运行时配置解析，数据库 provider 优先；无数据库配置且真实密钥缺失时按能力回退到 deterministic、local、disabled。 | 后续继续接入真实 embedding 客户端、reranker 顺序和 Workflow ModelRun 调用链。 |
| 2026-05-19 | Phase 5 状态校准第1轮 | 校准 TODO 顶部 P0/P1：story_memory、compiled_contexts、Workflow State、embedding/reranker、Scene Packet 检索证据已完成最小闭环；Workflow-to-API 真表 adapter 仍未完成。 | 下一轮优先补 workflow-to-api ModelRun adapter 契约验证，不实现跨进程 client。 |
| 2026-05-19 | ModelRun adapter 契约第2轮 | `ModelRunPayload.to_api_payload()` 改为显式接收 `api_job_run_id:int`，避免把 workflow runtime 字符串 ID 当成 API/SQLAlchemy 的 `JobRun.id`。 | 下一轮补当前 Phase 索引/文档，明确 adapter 仍需由调用方传入已持久化 JobRun int ID。 |
| 2026-05-19 | 当前 Phase 索引第3轮 | 更新 `.codex/current-phase.md`，把 Workflow/ModelRun 调用链状态纳入当前事实入口，并明确真表 adapter/client 仍待做。 | 本次 3 轮结束后停止；后续可继续实现 adapter 或转入 Phase 6 工作台。 |
| 2026-05-19 | 续推第1轮：ModelRun ID 边界测试 | 新增 `test_model_run_payload_requires_persisted_api_job_run_id`，覆盖 `api_job_run_id` 为 0/负数时报错、正整数映射到 API payload。 | 下一轮补 workflow-to-api ModelRun adapter 契约文档，仍不实现 HTTP client。 |
| 2026-05-19 | 续推第2轮：ModelRun adapter 契约文档 | 新增 `docs/architecture/workflow-modelrun-adapter-contract.md`，明确 adapter 调用方必须先取得 `JobRun.id:int`，runtime 字符串 ID 只进 payload。 | 下一轮若 P1 无更小阻塞，转入 Phase 6 Runs 页面最小前置。 |
| 2026-05-19 | 续推第3轮：Runs 页面最小前置 | Runs 页面与前端中文契约补充 `Checkpoint 状态`、`失败重试`、`ModelRun adapter 契约`，从能力展示推进到 Phase 6 运行闭环入口。 | 本次 3 轮结束后停止；后续可继续真实数据联动或转 Studio/Retrieval 工作台。 |
| 2026-05-19 | Phase 6 再续第1轮：Studio 创作闭环入口 | Studio 页面与前端中文契约补充 `作品选择`、`章节目标`、`Judge 评审`、`Repair 修订`、`批准回写`、`失败恢复`。 | 下一轮补 Retrieval 资料来源、搜索请求、命中预览与证据跳转入口。 |
| 2026-05-19 | Phase 6 再续第2轮：Retrieval 证据入口 | Retrieval 页面与前端中文契约补充 `资料来源类型`、`搜索请求`、`命中预览`、`证据跳转`。 | 下一轮补 Artifacts 或 Evaluations 的后续闭环入口。 |
| 2026-05-19 | Phase 6 再续第3轮：Evaluations 评测闭环入口 | Evaluations 页面与前端中文契约补充 `评测集`、`运行记录`、`指标趋势`、`失败样例`。 | 本次 3 轮结束后停止；后续可继续真实数据联动或补 Artifacts 细化入口。 |
| 2026-05-19 | Phase 6 收口第1轮：Artifacts 制品闭环入口 | Artifacts 页面与前端中文契约补充 `导出下载`、`资料入库状态`、`快照追溯`、`报告追溯`。 | 下一轮更新 `.codex/current-phase.md` 汇总 Phase 6 页面入口状态。 |
| 2026-05-19 | Phase 6 收口第2轮：当前 Phase 索引 | `.codex/current-phase.md` 汇总 Studio、Retrieval、Runs、Artifacts、Evaluations 的最小入口状态，并标明真实数据联动待做。 | 下一轮补 Phase 6 工作台契约文档。 |
| 2026-05-19 | Phase 6 收口第3轮：工作台契约文档 | 新增 `docs/architecture/phase6-workbench-contract.md`，记录五个工作台页面入口、未联通数据源、完全不存在交互和验收命令。 | 本次 3 轮结束后停止；后续可继续真实数据联动。 |
| 2026-05-19 | Phase 6 索引续推第1轮：契约文档纳入 README | `README.md` 重要文档加入 `docs/architecture/phase6-workbench-contract.md`，避免 Phase 6 契约成为文档孤岛。 | 下一轮补前端契约测试覆盖该文档和四类状态边界。 |
| 2026-05-19 | Phase 6 索引续推第2轮：契约测试覆盖 | 前端中文契约测试新增 Phase 6 工作台契约文档索引与状态区分断言，契约文档补充 `真实数据联动优先级`。 | 下一轮在 TODO 与当前 Phase 索引中收口真实数据联动优先级，避免继续堆静态入口。 |
| 2026-05-19 | Phase 6 索引续推第3轮：真实数据联动优先级收口 | `TODO.md` 和 `.codex/current-phase.md` 明确下一步优先真实数据联动，不再继续堆静态入口，并重新区分四类状态。 | 本次 3 轮结束后停止；后续若继续，应从 Studio 或 Retrieval 的真实 API 数据联动开始。 |
| 2026-05-19 | Phase 6 数据契约第1轮：Studio API 数据源契约 | Phase 6 契约文档新增 Studio 最小 API 数据源表，覆盖作品列表、章节目标、Scene Packet、Judge、Repair、批准回写和失败恢复；前端中文契约测试保护这些关键字。 | 下一轮补 Retrieval 真实资料源、刷新任务、搜索请求、命中预览和证据跳转数据契约。 |
| 2026-05-19 | Phase 6 数据契约第2轮：Retrieval API 数据源契约 | Phase 6 契约文档新增 Retrieval 数据源契约，覆盖资料源列表、刷新任务、搜索请求、命中预览、证据跳转和重排状态；前端中文契约测试保护这些关键字。 | 下一轮补 Runs、Artifacts、Evaluations 的真实数据源契约并同步当前 Phase 索引。 |
| 2026-05-19 | Phase 6 数据契约第3轮：运行/制品/评测数据源契约 | Phase 6 契约文档新增 Runs、Artifacts、Evaluations 数据源契约，并在 `.codex/current-phase.md` 中要求后续按最小 API 数据源契约推进真实联动。 | 本次 3 轮结束后停止；后续若继续，应选择一个页面按契约接入真实 API 数据。 |
| 2026-05-19 | Phase 6 registry 第1轮：Studio 数据源契约接入 | 新增 `apps/web/lib/phase6-data-sources.ts`，Studio 页面从 `phase6DataSources.studio` 渲染数据源契约，避免继续分散手写静态入口。 | 下一轮让 Retrieval 页面接入同一 registry。 |
| 2026-05-19 | Phase 6 registry 第2轮：Retrieval 数据源契约接入 | Retrieval 页面从 `phase6DataSources.retrieval` 渲染资料源、刷新任务、搜索请求、命中预览、证据跳转和重排状态契约。 | 下一轮让 Runs、Artifacts、Evaluations 接入同一 registry 并同步当前 Phase 索引。 |
| 2026-05-19 | Phase 6 registry 第3轮：运行/制品/评测 registry 接入 | Runs、Artifacts、Evaluations 页面分别从 `phase6DataSources.runs`、`.artifacts`、`.evaluations` 渲染数据源契约；当前 Phase 索引同步 registry 已实现但真实 API 读取未联通。 | 本次 3 轮结束后停止；后续若继续，应从 registry 选择一个页面接入真实 API 读取。 |
| 2026-05-19 | Phase 6 并行收口：Studio/Retrieval/Runs | Studio 已实现作品、章节、Scene Packet、Judge、Repair API/Web 单点读取；Retrieval 已实现资料源、刷新任务、搜索和命中预览 API/Web 单点读取；Runs 已实现 JobRun/checkpoint/ModelRun 后端最小契约但 Web 未读取。 | 下一步优先 Studio 批准回写或 Runs 页面读取 JobRun，继续保持单页面单数据源。 |
| 2026-05-20 | Phase 7 发布治理第3轮：当前 Phase 与审计状态收口 | `.codex/current-phase.md` 已改写为 Phase 7 发布与治理收口事实入口；继续保持 `README.md`、`TODO.md`、运维文档和验证报告对 Phase 5/6 现状的准确描述，不再把 Phase 6 数据源扩展写成下一步目标。 | 后续若继续，只做发布治理校准、验证留痕和环境样例对齐，不新增产品功能。 |
| 2026-05-20 | Phase 5/6 统一收口 | `README.md`、`TODO.md`、`.codex/current-phase.md` 与 `PROJECT_SUMMARY.md` 已统一表达：Phase 5/6 当前批准边界已收口，未联通能力保留为后续功能待办。 | 当前继续进入 Phase 7 发布治理；除非另行批准，不继续扩 Phase 5/6 运行时或工作台数据源。 |
| 2026-05-20 | Phase 7 环境与 Alembic 在线验证收口 | Docker Desktop 可用后启动 MinIO，`pnpm verify` 通过；Alembic 在线升级、当前版本和 `--check-heads` 均通过，当前 head 为 `20260520_0001`。 | 保持不自动提交；后续 Phase 7 只继续处理新的发布治理校准问题。 |
| 2026-05-20 | Phase 7 发布门禁推进计划 | 新增 Phase 7 发布治理计划文档，使用临时数据库验证空库升级到 `20260520_0001`，并补充审计阅读顺序：优先 current-phase/TODO/verification-report，operations-log 仅按需检索。 | 下一步执行完整发布门禁：`pnpm verify`、`pnpm openapi`、`pnpm test`、`pnpm e2e`、Alembic head 检查和 `git diff --check`。 |
| 2026-05-20 | 四项剩余风险收口推进 | 新增 `docs/superpowers/plans/2026-05-20-four-risk-closure.md`；Runs 页面读取 `GET /api/model-runs/job-runs/1`，Studio 读取批准写回/失败恢复摘要，Artifacts 读取 `GET /api/artifacts`，Evaluations 读取 `GET /api/evaluations/runs`；registry 和前端契约测试同步为 `Web 单点读取已实现`。 | 后续只剩执行型能力：workflow-to-api 真表 adapter/client、生成/Judge/Repair 交互按钮流、失败续跑执行、制品下载、趋势图和详情页。 |

## 7. 本轮证据来源

- `README.md`：项目定位、当前状态、架构边界、本地环境、常用命令、后续路线。
- `docs/superpowers/plans/2026-05-17-storyforge-master-replan.md`：Phase 0/5/6/7 总路线、风险、任务拆分和执行优先级。
- `docs/superpowers/plans/2026-05-17-storyforge-phase4-engineering-plan.md`：Phase 4 覆盖范围、责任边界、实施顺序和验收方式。
- `docs/api/phase4-openapi-review.md`：Phase 4 端点、测试覆盖、风险与后续。
- `.codex/verification-report.md`：Phase 3、Phase 4、总重规划、Phase 0 的验证记录与环境限制。
- `.codex/operations-log.md`：历史研究、实施、编码前后声明和工具限制记录。
- `package.json`、`apps/web/package.json`、`apps/api/pyproject.toml`、`apps/workflow/pyproject.toml`、`packages/shared/package.json`：版本、脚本、技术栈和测试命令。
- `apps/web/tests/phase1-navigation.test.tsx`：前端中文契约和页面覆盖方式。
- Context7：查询了 `/vercel/next.js` 与 `/fastapi/fastapi`，用于确认 App Router 文件路由和 FastAPI OpenAPI 契约的官方背景。

## 8. 本地验证方式

本轮仅整理项目与 `TODO.md`，不修改功能代码。直接验证建议：

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
Get-Content TODO.md -Raw
git status --short --branch
git diff -- TODO.md
```

通过条件：`TODO.md` 可读且包含项目目标、当前状态、下一版本目标、最大阻碍、任务池和最近迭代记录；除 `TODO.md` 与本轮允许的文档/审计文件外，不出现功能代码变更。

## 9. 2026-05-19 story_memory 三轮推进记录

更新时间：2026-05-19 00:32:00 +08:00

### 本轮优先级判断

- TODO.md 中没有比总计划第 11.5 节更明确、可本地闭环的更高优先级代码阻塞项；因此按第 11.3 的 P0 裁决，从 `story_memory` 最小持久化开始。
- 符合第 11.5：新增 `memory_atoms` 表、Alembic 迁移、基础 CRUD service 和章节有效事实查询。
- 符合第 11.8：仅补最小 `AgentProposal -> ArbitrationDecision -> MemoryAtom` 写入闭环，不做完整多 Agent 系统。

### 状态区分

- 已实现：`MemoryAtom` 契约、`memory_atoms` 持久化、`MemoryAtomRecord`、基础 CRUD、章节有效事实查询、最小 auto_merge 写入。
- 已有契约但未持久化：`TimelineEvent`、`Progression`、`MemoryConflict`、`AgentProposal`、`ArbitrationDecision` 的独立表。
- 完全不存在：完整多 Agent 仲裁系统、复杂人工审核 UI、递归激活、pgvector 检索优化。
- 竞品启发：Letta/MemGPT、Novelcrafter、SillyTavern 机制仅作为边界参考，未扩展为大型架构。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | story_memory 第1轮：持久化模型与迁移 | 按总计划 11.5 新增 `MemoryAtomRecord`、`memory_atoms` Alembic 迁移和模型注册；确认 `book_id` 使用现有 int 外键。`test_story_memory_persistence.py` 2 项、`pnpm run test:api`、`uv run alembic heads` 通过。 | 下一轮补齐 CRUD 与章节有效事实查询。 |
| 2026-05-19 | story_memory 第2轮：CRUD 与有效事实查询 | `story_memory.service` 新增 `create_memory_atom`、`list_memory_atoms`、`get_active_memory_atoms`，复用契约 `MemoryAtom` 并按章节区间过滤。契约测试 + 持久化测试共 7 项通过。 | 第3轮补齐最小仲裁写入闭环。 |
| 2026-05-19 | story_memory 第3轮：最小仲裁写入闭环 | 新增 `apply_arbitration_decision`，仅 `auto_merge` 的 memory create 提案写入 `memory_atoms`，`needs_human` 不写入；契约 + 持久化测试 9 项通过，`pnpm run test:api` 与 `pnpm e2e` 通过。 | 后续可按总计划 11.6 处理 `compiled_contexts` 持久化。 |

## 10. 2026-05-19 compiled_contexts 三轮推进记录

更新时间：2026-05-19 00:55:00 +08:00

### 本轮优先级判断

- `story_memory` 最小持久化已在第 9 节完成；TODO 中没有比总计划第 11.6 更高且可本地闭环的新阻塞项。
- 因此继续执行第 11.3 P0 裁决：`compiled_contexts` 持久化现在做。
- 边界：仅做最小持久化表、服务写入和 Scene Packet 追溯闭环；不做大型架构重构、不拆微服务、不做完整 Context Inspector UI。

### 状态区分

- 已实现：`ContextBlock`、`ContextCompileRequest`、`CompiledContext` 契约；`compile_context()` 纯函数；Scene Packet 输出 `compiled_context_id`、注入、裁剪、预算和调试字段。
- 已有契约但未持久化：`CompiledContext` 历史快照、预算报告、block 引用、裁剪原因。
- 完全不存在：可查询历史 compiled context 的数据库表、Context Inspector API/UI、ModelRun 与 compiled context 的正式关联。
- 竞品启发：SillyTavern/Novelcrafter 的上下文预算与注入位置、LangGraph 引用型 state 仅作为边界参考。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | compiled_contexts 第1轮：红灯测试 | 新增 `.codex/context-summary-compiled-contexts-persistence.md` 和 `test_context_compiler_persistence.py`；定向 pytest 因缺少 `app.domains.context_compiler.models` 红灯，证明持久化尚未实现。 | 第2轮新增模型、迁移、服务持久化并转绿。 |
| 2026-05-19 | compiled_contexts 第2轮：最小持久化实现 | 新增 `CompiledContextRecord`、`compiled_contexts` Alembic 迁移、模型注册、持久化读取服务，并在 Scene Packet 组装时保存上下文快照；定向测试 3 项通过，`alembic heads` 为 `c0ffee20260520`。 | 第3轮运行更宽 Context Compiler / Scene Packet 集成验证，并补齐最终审计记录。 |
| 2026-05-19 | compiled_contexts 第3轮：集成验证与审计闭环 | `test_context_compiler.py`、`test_context_compiler_persistence.py`、`test_scene_packet_context_compiler.py` 共 7 项通过；`pnpm run test:api` 通过；离线 Alembic SQL 生成包含 `compiled_contexts`，在线 `alembic upgrade head` 因默认 PostgreSQL `127.0.0.1:55432` 不可用超时，沿用既有 Docker/PostgreSQL 环境限制记录。 | 不继续开新任务；后续可按总计划 11.7 处理 Workflow State 引用化。 |

### 本次 compiled_contexts 交付边界

- 已实现：`CompiledContext` 契约、`compile_context()`、`compiled_contexts` 表模型与迁移、预算/注入/裁剪摘要持久化、Scene Packet 组装时写入并可按 `compiled_context_id` 反查。
- 已有契约但未持久化：Context Inspector API 查询契约、ModelRun 与 `compiled_context_id` 的正式外键或引用字段、Workflow State 的完整引用化改造。
- 完全不存在：Context Inspector UI、跨版本上下文 diff API、真实 tokenizer 预算、递归激活。
- 竞品启发：SillyTavern/Novelcrafter 的上下文注入位置和预算理念仅用于字段边界，未扩展成大型上下文编排系统。


## 11. 2026-05-19 Workflow State 引用化三轮推进记录

更新时间：2026-05-19 01:30:00 +08:00

### 本轮优先级判断

- `story_memory` 与 `compiled_contexts` 已分别完成最小持久化闭环；TODO 中没有比总计划第 11.7 更高且可本地闭环的新阻塞项。
- 因此继续执行第 11.3 的 P1“现在做”裁决：Workflow State 引用化，避免 LangGraph checkpoint 被大上下文撑爆。
- 边界：只做 workflow state/checkpoint 最小引用化契约，不改 API 数据库，不拆微服务，不做完整 runtime 重构。

### 状态区分

- 已实现：workflow 生成图、人工审批 interrupt、内存 checkpointer、审计摘要记录、运行时 checkpoint 仓库。
- 已有契约但未持久化：API 侧 `WorkflowStateReference` 契约、`compiled_context_id`、`ModelRun`、`Artifact`、`MemoryAtomRecord` 等可引用事实源。
- 完全不存在：PostgresSaver 真实落库、跨服务 workflow state 查询 API、完整 Context Inspector 与 workflow replay UI。
- 竞品启发：LangGraph checkpoint/store/business table 分层只作为引用化边界参考。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | workflow state 第1轮：红灯测试 | 新增 `.codex/context-summary-workflow-state-references.md` 和 `test_generation_state_references.py`；`python -m pytest` 因当前 Python 缺少 pytest 不可用，改用 `uv run pytest` 后因缺少 `checkpoint_reference_state` 红灯，证明引用化边界尚未实现。 | 第2轮最小实现引用型 state 契约和 checkpoint sanitizer。 |
| 2026-05-19 | workflow state 第2轮：最小引用化契约 | `GenerationState` 改为暴露 `scene_packet_id`、`compiled_context_id`、`model_run_id`、`draft_artifact_id`、`memory_atom_ids`、`timeline_event_ids` 等引用字段；新增 `checkpoint_reference_state()` 并让 `RuntimeCheckpointStore.save_state()` 强制裁掉完整 `scene_packet`、`draft_excerpt`、`book_strategy`、`chapter_plan`；相关 workflow 测试 6 项通过。 | 第3轮运行 workflow compileall、补偿验证并收口审计记录。 |
| 2026-05-19 | workflow state 第3轮：集成验证与审计闭环 | Workflow compileall 通过；`test_generation_graph.py`、`test_runtime_runner.py`、`test_generation_state_references.py` 共 6 项通过；根级 `pnpm run test:workflow` 通过；API `test_phase4_service_acceptance.py`、`test_context_compiler.py`、`test_context_compiler_persistence.py` 共 8 项通过。 | 不继续开新任务；后续可在新一轮按总计划 11.7 深化真实 PostgresSaver/引用恢复，或转向 11.9 审计归档治理。 |

### 本次 Workflow State 交付边界

- 已实现：`GenerationState` 引用字段契约、`checkpoint_reference_state()`、运行时 checkpoint 保存边界、生成节点的轻量引用摘要、草稿制品引用与审批预览。
- 已有契约但未持久化：真实 PostgresSaver、跨进程 workflow state 查询、ModelRun/Artifact 与 workflow checkpoint 的数据库级关联。
- 完全不存在：完整 workflow replay UI、Context Inspector 与 workflow time-travel 联动、真实 LLM 运行后的恢复压测。
- 竞品启发：LangGraph checkpoint/store/business table 分层作为边界约束；未引入新的 Agent 框架或微服务。


## 12. 2026-05-19 Phase 审计治理三轮推进记录

更新时间：2026-05-19 02:05:00 +08:00

### 本轮优先级判断

- 第 11.5、11.6、11.7 和 11.8 的最小闭环已在 TODO 第 9、10、11 节记录；当前继续无限追加 `.codex/operations-log.md` 与 `.codex/verification-report.md` 会触发总计划第 11.9 的审计噪音风险。
- 因此本轮优先按第 11.9 建立当前 Phase 摘要索引；不归档历史、不迁移目录结构，避免把审计治理扩大成新架构任务。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | 审计治理第1轮：current-phase 当前事实索引 | 新增 `.codex/current-phase.md`，集中记录 11.5/11.6/11.7/11.8/11.9 状态、已实现/已有契约但未持久化/完全不存在/竞品启发分类、验证入口和环境限制；`Select-String` 验证关键条目存在。 | 第2轮同步 Alembic 验证记录到最新 head。 |
| 2026-05-19 | 审计治理第2轮：Alembic 验证记录同步 | 更新 `docs/operations/alembic-validation.md` 到当前 head `c0ffee20260520`；本地 `uv run alembic heads` 通过，离线 SQL 包含 `memory_atoms` 与 `compiled_contexts`；在线升级仍记录为 PostgreSQL/Docker 环境限制，未伪装为通过。 | 第3轮校准 TODO 任务池并运行轻量验证链。 |
| 2026-05-19 | 审计治理第3轮：TODO 任务池校准与轻量验证 | 在 P1/P3 任务池补入 `story_memory`、`compiled_contexts`、Workflow State 引用化和 `.codex/current-phase.md` 当前索引的已完成状态；`pnpm run test:api` 与 `pnpm run test:workflow` 通过；`Select-String` 验证任务池关键条目存在。 | 本轮 3 轮结束后停止，不继续开新任务。 |

### 本次审计治理交付边界

- 已实现：`.codex/current-phase.md` 当前 Phase 索引、Alembic 验证记录同步到 `c0ffee20260520`、TODO P1/P3 任务池状态校准。
- 已有契约但未持久化：真实在线 PostgreSQL 迁移验证、`.codex/archive/` 历史归档、`verification-history/` 分日验证归档。
- 完全不存在：自动化日志轮转、审计报告生成器、可视化 Phase 状态页。
- 竞品启发：仅采纳“当前状态索引优先于长流水”的轻量治理方式，未引入新文档系统。


## 13. 2026-05-19 Retrieval 真实化三轮推进记录

更新时间：2026-05-19 02:35:00 +08:00

### 本轮优先级判断

- 11.5、11.6、11.7、11.8 和 11.9 的最小闭环已完成；TODO P1 仍未完成的最高主线是“Embedding 与检索刷新真实化”。
- 本轮符合总计划第 11 节的 Phase 5 第一开发主线，聚焦真实 embedding/reranker 可注入、可降级、可审计；不新增大型架构、不拆微服务、不做数据库迁移。

### 状态区分

- 已实现：`EmbeddingClient` Protocol、本地稳定 embedding、refresh run 记录 embedding provider/model/credential_status/chunk_refs、query embedding 混合搜索、可注入 `RerankerClient`、搜索 rerank 元数据、Scene Packet 检索证据基础字段与 rerank 证据透传。
- 已有契约但未持久化：Provider Gateway 已有真实 provider/embedding/reranker 环境配置契约，但外部 SDK 调用记录与异步刷新任务状态尚未持久化为独立运行日志。
- 完全不存在：真实外部 embedding SDK 调用、真实 reranker SDK 调用、pgvector 索引优化、异步刷新队列。
- 竞品启发：rerank 顺序和证据链字段参考 RAG 常见做法，仅用于排序与审计边界，不扩展新架构。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | retrieval 第1轮：reranker 红灯测试 | 新增 `.codex/context-summary-retrieval-refresh-realization.md`；在 `test_retrieval_embedding.py` 增加可选 reranker 测试。`uv run pytest tests/test_retrieval_embedding.py -q` 红灯，失败为缺少 `app.domains.retrieval.reranker_client`，证明 retrieval 尚未接入 reranker 客户端。 | 第2轮新增最小 reranker 客户端契约并接入搜索排序。 |
| 2026-05-19 | retrieval 第2轮：最小 reranker 搜索接入 | 新增 `reranker_client.py` 的 `RerankerClient`、`RerankResult`、`DisabledRerankerClient`；`RetrievalHitRead` 增加 rerank 元数据；`search_retrieval()` 支持可选 reranker 并保持默认稳定排序。`uv run pytest tests/test_retrieval_embedding.py -q` 通过，`3 passed`。 | 第3轮补齐 Scene Packet rerank 证据透传与集成验证。 |
| 2026-05-19 | retrieval 第3轮：Scene Packet rerank 证据透传与集成验证 | `EvidenceLinkRead` 与检索 ContextBlock metadata 透传 `rerank_score`、`rerank_provider`、`rerank_model`，并避免未启用 reranker 时写入空 metadata；检索与 Scene Packet 相关 pytest 共 5 项通过，根级 `pnpm run test:api` 通过。 | 本轮 3 轮结束后停止；后续可继续处理真实外部 embedding SDK 调用或 Workflow ModelRun 调用链。 |

### 本次 Retrieval 真实化交付边界

- 已实现：embedding 可注入客户端、本地稳定回退、刷新任务 chunk 引用与 provider 元数据、query embedding 混合搜索、可选 reranker 重排、rerank 元数据、Scene Packet 证据透传。
- 已有契约但未持久化：Provider Gateway 的真实 provider/embedding/reranker 环境配置；外部 SDK 调用记录和异步刷新任务状态尚未进入独立 `ModelRun` 或任务日志。
- 完全不存在：真实外部 embedding/reranker SDK 调用、pgvector 索引优化、异步队列刷新、前端 Retrieval 工作台刷新任务页面。
- 竞品启发：采用 RAG 常见 rerank 证据链字段与稳定排序思路；未引入新检索平台、微服务或大规模迁移。


## 14. 2026-05-19 Workflow ModelRun 调用链三轮推进记录

更新时间：2026-05-19 03:25:00 +08:00

### 本轮优先级判断

- 11.5、11.6、11.7、11.8、11.9 与 retrieval/reranker 最小闭环已完成；TODO P1 中剩余最高主线为 `Workflow runtime 调用链联通`。
- 本轮符合 Phase 5 后续真实 provider / ModelRun / workflow 调用链方向；仅做最小运行时引用与失败状态，不新增大型架构、不拆微服务、不做数据库迁移。

### 状态区分

- 已实现：API 侧 `ModelRun` SQLAlchemy 模型、schema、service 和 router；workflow state 已有 `model_run_id` 引用字段；runtime 已有 provider 执行模拟与 checkpoint record。
- 已有契约但未持久化：workflow runtime 与 API `ModelRun` 表之间尚未真实落库联通，当前只能先做内存运行引用与可替换边界。
- 完全不存在：真实 provider SDK 调用、跨进程写入 API 数据库的 workflow client、失败重试 UI、PostgresSaver replay UI。
- 竞品启发：LangGraph/运行日志分层仅作为 checkpoint 与业务表分离边界，未引入新框架。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | workflow model_run 第1轮：红灯测试 | 新增 `.codex/context-summary-workflow-model-run-link.md`；扩展 `test_runtime_runner.py`，要求 runtime start 写入可查询 model run 记录并让 checkpoint `model_run_id` 指向该记录。`uv run pytest tests/test_runtime_runner.py -q` 红灯，失败为 `RuntimeCheckpointStore` 缺少 `list_model_runs`。 | 第2轮新增最小运行时 ModelRun 记录与引用写入。 |
| 2026-05-19 | workflow model_run 第2轮：最小运行时 ModelRun 引用 | 新增 `RuntimeModelRunRecord` 与 `record_model_run()`/`list_model_runs()`；`WorkflowRuntime.start()` 将 provider 执行摘要写入运行时模型记录，并把 `model_run_id` 写入 checkpoint state，不再用 token_usage 伪装引用。`uv run pytest tests/test_runtime_runner.py -q` 通过，`1 passed`。 | 第3轮补齐失败状态保留与更宽 workflow 验证。 |
| 2026-05-19 | workflow model_run 第3轮：失败恢复状态与集成验证 | 新增 provider 失败路径测试；`WorkflowRuntime.start()` 在 provider 调用异常时写入失败 `RuntimeModelRunRecord`、保存 `error_code=provider_execution_failed` 的 checkpoint，并记录 `approval_status=failed`。`uv run pytest tests/test_runtime_runner.py tests/test_generation_state_references.py -q` 通过，`5 passed`；`pnpm run test:workflow` 通过。 | 本轮 3 轮结束后停止；后续可在新一轮处理 workflow 到 API `ModelRun` 真表持久化或真实 provider SDK。 |

### 本次 Workflow ModelRun 交付边界

- 已实现：workflow runtime 内存级 `RuntimeModelRunRecord`、`model_run_id` 引用写入 checkpoint、provider 成功/失败模型运行记录、失败 checkpoint `error_code` 与可恢复节点状态。
- 已有契约但未持久化：API 侧 `ModelRun` SQLAlchemy 模型与 service 已存在，但 workflow runtime 尚未跨进程写入 API 数据库真表。
- 完全不存在：真实 provider SDK 调用、workflow 到 API 的持久化 client、失败重试 UI、PostgresSaver replay UI。
- 竞品启发：采用运行日志与 checkpoint 分层边界；未引入新 Agent 框架、微服务或大规模迁移。


## 15. 2026-05-19 API ModelRun 失败记录三轮推进记录

更新时间：2026-05-19 04:10:00 +08:00

### 本轮优先级判断

- 当前 Phase 5 仍剩 `Workflow runtime 调用链联通` 的 API 真表写入边界；上一轮已完成 workflow 内存级 model run 引用和失败 checkpoint，但 API `ModelRun` helper 只能记录 completed。
- 本轮符合 TODO P1 与总计划第 11 节后续交付闭环；只增强既有 `model_runs` service，不新增数据库表、不做迁移、不拆微服务。

### 状态区分

- 已实现：API `ModelRun` 模型/schema/router、成功运行日志创建、workflow 内存级 RuntimeModelRunRecord、失败 checkpoint。
- 已有契约但未持久化：workflow 到 API `ModelRun` 真表的跨进程写入 client 尚未实现；API 失败记录 helper 本轮补齐。
- 完全不存在：真实 provider SDK、跨服务重试 UI、PostgresSaver replay UI。
- 竞品启发：仅采用运行日志与 checkpoint 分层边界，未引入新架构。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | api model_run 第1轮：失败记录红灯测试 | 新增 `.codex/context-summary-api-model-run-failure.md`；扩展 `test_model_runs.py`，要求 `record_failed_runtime_model_run()` 写入 `status=failed`、`error_message` 和恢复 payload。`uv run pytest tests/test_model_runs.py -q` 红灯，失败为无法导入 `record_failed_runtime_model_run`。 | 第2轮复用 `create_model_run()` 实现失败记录 helper。 |
| 2026-05-19 | api model_run 第2轮：失败记录 helper 实现 | `model_runs.service` 新增 `record_failed_runtime_model_run()`，复用 `ModelRunCreate` 与 `create_model_run()` 写入 `status=failed`、`error_message`、`token_usage=0` 和恢复 payload；不新增模型或迁移。`uv run pytest tests/test_model_runs.py -q` 通过，`2 passed`。 | 第3轮补齐 workflow/API 边界说明并运行更宽验证链。 |
| 2026-05-19 | api model_run 第3轮：边界收口与集成验证 | 运行 API `test_model_runs.py` + Phase 4 补偿测试共 4 项通过；workflow runtime/state 相关测试共 5 项通过；根级 `pnpm run test:api` 与 `pnpm run test:workflow` 通过。同步 P1 任务池：Embedding 与 Scene Packet 证据链标记为已完成最小闭环，Workflow ModelRun 标记为“内存与 API helper 已完成，跨进程真表写入 client 待做”。 | 本轮 3 轮结束后停止；后续可单独做 workflow 到 API ModelRun 真表 client 或产品工作台 Runs 页面。 |

### 本次 API ModelRun 失败记录交付边界

- 已实现：API `record_failed_runtime_model_run()`、失败 `ModelRun` 真表记录能力、错误摘要与恢复 payload、workflow 内存级成功/失败 model run 与 checkpoint 错误状态。
- 已有契约但未持久化：workflow runtime 到 API `ModelRun` 真表的跨进程写入 client/adapter；当前两侧字段已对齐但未直接调用。
- 完全不存在：真实 provider SDK 调用、失败重试 UI、PostgresSaver replay UI、跨进程 workflow-to-api 认证与传输层。
- 竞品启发：采用运行日志与 checkpoint 分层边界；未引入新 Agent 框架、微服务或大规模迁移。


## 16. 2026-05-19 Workflow ModelRun sink 三轮推进记录

更新时间：2026-05-19 04:50:00 +08:00

### 本轮优先级判断

- API 已能记录成功/失败 `ModelRun`，workflow 已有内存级 model run 与失败 checkpoint；当前剩余缺口是 workflow runtime 没有可替换 sink 边界，后续无法在不改核心 runtime 的情况下接 API 真表 adapter。
- 本轮符合 Phase 5 `Workflow runtime 调用链联通` 的必要前置；仅增加可注入 sink 边界，不实现 HTTP client、不新增服务、不做迁移。

### 状态区分

- 已实现：API 成功/失败 `ModelRun` helper、workflow 内存 `RuntimeModelRunRecord`、失败 checkpoint。
- 已有契约但未持久化：workflow-to-api 真表写入 adapter 尚未实现；本轮先补 sink 前置边界。
- 完全不存在：真实 provider SDK、跨进程认证/传输 client、失败重试 UI。
- 竞品启发：运行日志与 checkpoint 分层边界；未引入新架构。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | workflow sink 第1轮：红灯测试 | 新增 `.codex/context-summary-workflow-model-run-sink.md`；扩展 `test_runtime_runner.py`，要求 `WorkflowRuntime(model_run_sink=...)` 在成功路径投递 completed payload。`uv run pytest tests/test_runtime_runner.py -q` 红灯，失败为 `WorkflowRuntime.__init__()` 不接受 `model_run_sink`。 | 第2轮新增最小 sink Protocol/payload 并接入成功路径。 |
| 2026-05-19 | workflow sink 第2轮：最小 ModelRun sink 实现 | 新增 `ModelRunPayload` 与 `ModelRunSink` Protocol；`WorkflowRuntime` 支持 `model_run_sink` 注入，成功路径在写入内存 `RuntimeModelRunRecord` 后投递 completed payload；不实现 HTTP/client。`uv run pytest tests/test_runtime_runner.py -q` 通过，`2 passed`。 | 第3轮补齐失败路径 sink 投递与集成验证。 |
| 2026-05-19 | workflow sink 第3轮：失败路径 sink 与集成验证 | 失败路径也向 `model_run_sink` 投递 `status=failed` 与 `error_message`；workflow runtime/state 相关 pytest 共 5 项通过，根级 `pnpm run test:workflow` 通过，API `test_model_runs.py` 2 项通过。P1 任务池同步为：workflow 内存记录、sink 边界、API helper 已完成，具体 workflow-to-api 真表 adapter/client 待后续。 | 本轮 3 轮结束后停止；后续可单独实现 adapter/client 或转入 Phase 6 Runs 工作台。 |

### 本次 Workflow ModelRun sink 交付边界

- 已实现：`ModelRunPayload`、`ModelRunSink` Protocol、runtime 成功/失败路径 sink 投递、checkpoint `model_run_id` 保留、API 成功/失败 helper 字段对齐。
- 已有契约但未持久化：具体 workflow-to-api 真表 adapter/client；当前 sink 可被 adapter 接管，但默认不跨进程写 API 数据库。
- 完全不存在：真实 provider SDK、跨进程认证/传输实现、失败重试 UI、PostgresSaver replay UI。
- 竞品启发：采用运行日志与 checkpoint 分层边界；未引入新 Agent 框架、微服务或大规模迁移。


## 17. 2026-05-19 ModelRunPayload API 映射三轮推进记录

更新时间：2026-05-19 05:20:00 +08:00

### 本轮优先级判断

- workflow runtime 已有 `ModelRunSink`，API 也有成功/失败 helper；当前缺口是 sink payload 不能直接转换为 API `ModelRunCreate` 兼容字段，后续 adapter 容易字段漂移。
- 本轮符合 Phase 5 Workflow/ModelRun 调用链联通的必要前置；不实现 HTTP client、不新增迁移、不拆微服务。

### 状态区分

- 已实现：workflow sink、API 成功/失败 helper、内存 model run、失败 checkpoint。
- 已有契约但未持久化：API-compatible payload 映射本轮补齐；具体 workflow-to-api 传输 adapter 仍待后续。
- 完全不存在：真实 provider SDK、跨进程认证/传输实现、失败重试 UI。
- 竞品启发：日志/checkpoint 分层边界；未引入新架构。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | payload 映射第1轮：completed 红灯 | 扩展 `test_runtime_runner.py`，要求 completed `ModelRunPayload.to_api_payload()` 输出 API `ModelRunCreate` 兼容字段与 thread payload。`uv run pytest tests/test_runtime_runner.py -q` 红灯，失败为 `ModelRunPayload` 缺少 `to_api_payload`。 | 第2轮实现 completed payload 映射。 |
| 2026-05-19 | payload 映射第2轮：completed 映射实现 | `ModelRunPayload.to_api_payload()` 输出 API `ModelRunCreate` 兼容字段，包含 `job_run_id`、provider/model/capability、status、latency/token、input/output、error 和 `payload.thread_id`；不引入 API 依赖或 HTTP client。`uv run pytest tests/test_runtime_runner.py -q` 通过，`2 passed`。 | 第3轮补齐 failed 映射断言并运行集成验证。 |
| 2026-05-19 | payload 映射第3轮：failed 映射与集成验证 | failed `ModelRunPayload.to_api_payload()` 覆盖 `status=failed`、`error_message`、`token_usage=0` 和 `payload.thread_id`；workflow runtime/state pytest 共 5 项通过，API `test_model_runs.py` 2 项通过，根级 `pnpm run test:workflow` 通过。P1 任务池同步为：payload 映射已完成，具体 workflow-to-api 真表 adapter/client 待后续。 | 本轮 3 轮结束后停止；后续可单独实现 adapter/client 或转入 Phase 6 Runs 工作台。 |

### 本次 ModelRunPayload 映射交付边界

- 已实现：`ModelRunPayload.to_api_payload()`、completed/failed API-compatible 字段映射、sink 成功/失败投递验证、API 成功/失败 helper 对齐验证。
- 已有契约但未持久化：具体 workflow-to-api 真表 adapter/client；当前 payload 已可被 adapter 复用，但默认仍不跨进程写 API 数据库。
- 完全不存在：真实 provider SDK、跨进程认证/传输实现、失败重试 UI、PostgresSaver replay UI。
- 竞品启发：采用运行日志与 checkpoint 分层边界；未引入新 Agent 框架、微服务或大规模迁移。


## 18. 2026-05-19 Phase 6 registry 真实联动前置三轮推进记录

更新时间：2026-05-19 06:55:00 +08:00

### 本轮优先级判断

- TODO P2 已明确下一步不要继续堆静态入口，应优先做真实数据联动闭环；当前 registry 已被五个页面复用，但缺少可追踪到页面、契约章节和下一步动作的字段。
- 本轮符合总计划第 11 节的执行优先级：服务 Phase 6 工作台可用化，同时不越过 Phase 5/Workflow-to-API 真表 adapter 边界，不实现 HTTP client、不新增大型架构。

### 状态区分

- 已实现：Phase 6 五个页面最小入口、统一 `phase6DataSources` registry、页面从 registry 渲染数据源契约。
- 已有契约但未联通：各 API 数据源的真实读取、workflow-to-api 真表 adapter/client、跨页面连续操作状态。
- 完全不存在：全量前端 API client、大型状态管理平台、一次性联通五页的真实数据流。
- 竞品启发：工作台分区与证据链展示仅作为产品体验参考，未引入新架构。
### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | Phase 6 registry 前置第1轮：追踪字段 | `phase6DataSources` 补充 `page`、`contractSection`、`nextAction`，用于后续按页面和契约章节选择单数据源真实 API spike；前端中文契约测试先红后绿，Web test 8 项与 TypeScript 检查通过。 | 下一轮在契约文档中声明 `phase6DataSources` 为页面真实联动前置的代码事实源。 |
| 2026-05-19 | Phase 6 registry 前置第2轮：文档事实源 | `docs/architecture/phase6-workbench-contract.md` 新增“代码事实源”章节，明确文档管业务边界、`phase6DataSources` 管页面真实联动前置；文本断言、Web test 8 项与 TypeScript 检查通过。 | 下一轮收口真实 API spike 边界，禁止全量 client 或一次性联通五页。 |
| 2026-05-19 | Phase 6 registry 前置第3轮：真实 API spike 边界 | TODO 与 `.codex/current-phase.md` 明确下一步只能从 `phase6DataSources` 选择单页面单数据源做真实 API 读取 spike，禁止全量 client、不一次性联通五页、不引入大型状态管理；文本断言、Web test 8 项与 TypeScript 检查通过。 | 本次 3 轮结束后停止；后续若继续，应先选定一个页面和一个数据源再开工。 |

### 下一步真实 API spike 边界

- 只能从 `apps/web/lib/phase6-data-sources.ts` 的 `phase6DataSources` 选择一个 `page` 和一个数据源。
- 只做单页面单数据源真实 API 读取 spike，先证明输入、输出、失败态和页面渲染闭环。
- 禁止全量 client，不一次性联通五页，不新增大型状态管理平台，不把静态契约扩展成新架构。
- 若需要 workflow-to-api 真表数据，必须先沿用既有 `ModelRunPayload.to_api_payload(api_job_run_id:int)` 契约，不能把 workflow runtime 字符串 ID 当数据库 ID。


## 19. 2026-05-19 Phase 6 单数据源 spike 三轮推进记录

更新时间：2026-05-19 07:45:00 +08:00

### 本轮优先级判断

- TODO 与当前 Phase 索引已明确下一步只能从 `phase6DataSources` 选择单页面单数据源；当前最该解决的问题是把首个 spike 起点固化为可测试的代码事实，避免后续在五个页面之间发散。
- 本轮符合总计划第 11 节：服务 Phase 6 工作台真实联动闭环，同时不新增大型架构、不拆微服务、不做数据库迁移、不实现全量 client。

### 状态区分

- 已实现：`phase6DataSources` typed registry、`page/contractSection/nextAction` 追踪字段、首个 spike 起点 `phase6FirstDataSourceSpike`。
- 已有契约但未联通：Studio 作品列表 API 的真实读取、失败态展示、后端数据到页面的联通。
- 完全不存在：全量 Web API client、五页一次性真实数据联通、大型前端状态管理平台。
- 竞品启发：只保留“先选一个入口打穿”的产品迭代方式，不引入新架构。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | Phase 6 单数据源第1轮：首个 spike 选择保护 | `apps/web/lib/phase6-data-sources.ts` 导出 `phase6FirstDataSourceSpike = phase6DataSources.studio[0]`，明确首个真实读取起点是 Studio 的作品列表 API；前端契约测试先红后绿，Web test 8 项与 TypeScript 检查通过。 | 下一轮补 Studio 页面和契约文档中的作品列表读取前置说明。 |
| 2026-05-19 | Phase 6 单数据源第2轮：Studio 读取前置 | Studio 页面新增“首个真实读取 spike”区块，展示 `phase6FirstDataSourceSpike` 的读取输入、读取输出和失败态；契约文档同步作品列表 API 读取失败边界。文本断言、Web test 8 项与 TypeScript 检查通过。 | 下一轮收口下一次真实读取验证清单。 |
| 2026-05-19 | Phase 6 单数据源第3轮：读取验证清单 | TODO 与 `.codex/current-phase.md` 新增 Studio 作品列表 API 可复现读取验证清单，明确下一轮必须先定位现有作品/资产 API、确认 int 主键、补失败态测试，再做单点读取；文本断言、Web test 8 项与 TypeScript 检查通过。 | 本次 3 轮结束后停止；后续若继续，只能围绕该清单执行。 |

### Studio 作品列表 API 可复现读取验证清单

- 先定位现有作品或资产相关 API/router/service，不得新增全量 API client，也不得凭空新增并行读取层。
- 确认 SQLAlchemy 模型中的作品主键类型，以现有 int 字段为准，不得假设 UUID。
- 只读取 `phase6FirstDataSourceSpike` 对应的作品列表 API，输入限定为当前工作区或默认项目上下文。
- 必须覆盖成功态、空列表态、作品列表 API 读取失败态，并在 Studio 页面保留可重试错误摘要。
- 不一次性联通章节目标、Scene Packet、Judge、Repair、批准回写或其他四个 Phase 6 页面。


## 20. 2026-05-19 Studio 作品列表 API 三轮推进记录

更新时间：2026-05-19 09:15:00 +08:00

### 本轮优先级判断

- TODO 第 19 节已把下一步限定为 Studio 作品列表 API 可复现读取验证清单；当前最该解决的问题是先定位现有模型、router/service 和测试模式，确认主键类型，避免凭空假设 UUID 或新增全量 client。
- 本轮符合总计划第 11 节：服务 Phase 6 工作台真实数据联动，同时延续第 11.2 的类型事实源硬约束；不新增大型架构、不拆微服务、不做数据库迁移。

### 状态区分

- 已实现：`Book`/`Workspace` SQLAlchemy 模型、int 主键事实、既有 FastAPI router/service/schema 分层模式、TestClient 本地测试模式、`GET /api/studio/books` API 最小契约。
- 已有契约但未联通：Web Studio 对 `/api/studio/books` 的真实读取、读取失败态展示；章节目标、Scene Packet、Judge、Repair、批准回写和失败恢复仍只有契约。
- 完全不存在：全量 Web API client、五页联动读取、作品列表缓存平台。
- 竞品启发：仅采用“先打通首个作品列表入口”的工作台迭代方式，不引入新架构。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | Studio 作品列表第1轮：事实定位 | 新增 `.codex/context-summary-studio-book-list-api.md`，确认 `Book.id` 来自 `IdMixin(Integer)`，`Book.workspace_id` 为 `int | None`，可复用 workspaces/assets 的 router-service-schema 和 TestClient 测试模式；文本事实检查通过。 | 下一轮以 TDD 补 API 侧最小作品列表契约。 |
| 2026-05-19 | Studio 作品列表第2轮：API 最小契约 | 新增 `apps/api/app/domains/studio/` 的 schema/service/router，并在 `app.main` 注册 `/api/studio/books`；测试先红后绿，覆盖成功态、workspace_id int 过滤和空列表态。`uv run pytest tests/test_studio_book_list_api.py -q` 3 项通过，API compileall 通过。 | 下一轮同步 Phase 6 契约文档和 current-phase，明确 API 已实现但 Web 仍未读取。 |
| 2026-05-19 | Studio 作品列表第3轮：文档与 Phase 索引同步 | `docs/architecture/phase6-workbench-contract.md`、`.codex/current-phase.md` 和 `TODO.md` 同步状态边界：`GET /api/studio/books` API 最小契约已实现，Web Studio 仍未读取；本轮未新增 Web client、未做数据库迁移。API 单测、compileall、Web test、TypeScript 与文本断言通过。 | 本次 3 轮结束后停止；后续若继续，只能让 Web Studio 单点读取 `/api/studio/books`，不得扩展为全量 client。 |


## 21. 2026-05-19 Web Studio 作品列表读取三轮推进记录

更新时间：2026-05-19 10:40:00 +08:00

### 本轮优先级判断

- TODO 第 20 节已明确后续只能让 Web Studio 单点读取 `/api/studio/books`，不得扩展为全量 client；当前没有比该单点真实联动更高、且可本地闭环的阻塞项。
- 本轮符合总计划第 11 节：服务 Phase 6 产品工作台可用化，同时遵守第 11.2 类型事实源约束；不新增大型架构、不拆微服务、不做数据库迁移。

### 状态区分

- 已实现：后端 `GET /api/studio/books` API 最小契约、Web Studio 页面静态数据源契约、首个 spike 起点、Web Studio 对 `/api/studio/books` 的单点读取、空列表态和读取失败态。
- 已有契约但未联通：章节目标、Scene Packet、Judge、Repair、批准回写、失败恢复以及其他四个 Phase 6 页面真实 API 数据读取。
- 完全不存在：全量 Web API client、跨页面缓存平台、一次性联通五页。
- 竞品启发：只采用“先打穿一个作品列表入口”的迭代方式，不引入新架构。
### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | Web Studio 作品列表第1轮：上下文与红灯契约 | 新增 `.codex/context-summary-web-studio-book-list-read.md`；前端契约测试新增 `/api/studio/books`、`读取作品列表`、`空列表`、`可重试错误摘要` 断言。红灯验证显示 Studio 页面缺少 `/api/studio/books`，证明 Web 尚未单点读取。 | 下一轮只实现 Web Studio 对 `/api/studio/books` 的最小读取边界并转绿。 |
| 2026-05-19 | Web Studio 作品列表第2轮：最小实现转绿 | `apps/web/app/studio/page.tsx` 改为 async Server Component，使用页面级 `fetch(new URL("/api/studio/books", STORYFORGE_API_BASE_URL), { cache: "no-store" })` 读取作品列表，并展示成功、空列表和可重试错误摘要；未新增全量 client。Web test 8 项、TypeScript、API 单测和 API compileall 均通过。 | 下一轮同步 Phase 6 契约文档和 current-phase，明确 Web Studio 已具备单点读取边界，但其他数据源仍未联通。 |
| 2026-05-19 | Web Studio 作品列表第3轮：Phase 文档收口 | `phase6DataSources` 将作品列表 API 状态更新为 `Web 单点读取已实现`；`docs/architecture/phase6-workbench-contract.md`、`.codex/current-phase.md` 和 TODO 同步边界：Web Studio 已能单点读取 `/api/studio/books`，但章节目标、Scene Packet、Judge、Repair、批准回写和其他页面仍未联通。文本断言、Web test、TypeScript、API 单测和 API compileall 均通过。 | 本次 3 轮结束后停止；后续若继续，只能选择下一个单一数据源，例如 Studio 章节目标或 Scene Packet，不得新增全量 client。 |


## 22. 2026-05-19 Phase 6 Studio 章节目标真实联动三轮推进记录

更新时间：2026-05-19 17:45:00 +08:00

### 本轮优先级判断

- TODO P2 和 `.codex/current-phase.md` 均要求不要继续堆静态入口，优先从 Studio 页面选择一个数据源做真实 API 联动。
- 本轮选择 `phase6DataSources.studio` 中的“章节目标 API”，符合总计划第 11 节 Phase 6 工作台连续化方向。
- 边界：只做 Studio 单页面单数据源，不新增全量 Web API client、不联通其他页面、不做数据库迁移。

### 状态区分

- 已实现：Studio 作品列表 API 与章节目标 API 的后端契约和 Web 单点读取。
- 已有契约但未联通：Scene Packet、Judge、Repair、批准回写和失败恢复。
- 完全不存在：完整交互式 Studio 编排器、跨页面状态管理平台、一次性联通五页的真实数据流。
- 竞品启发：仅保留“章节目标先于生成”的连续创作步骤，不引入新架构。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | Phase 6 Studio 章节目标第1轮：API 红绿实现 | 新增章节目标 API 红灯测试，先观察 `/api/studio/chapter-goals` 404；随后补 `StudioChapterGoalRead`、`read_studio_chapter_goal()` 和 GET 端点，读取目标章节、上一章摘要与连续性约束。`uv run pytest tests/test_studio_book_list_api.py -q` 4 项通过，`uv run python -m compileall app tests/test_studio_book_list_api.py` 通过。 | 第2轮在 Web Studio 对章节目标 API 做单点读取，不扩展其他数据源。 |
| 2026-05-19 | Phase 6 Studio 章节目标第2轮：Web 单点读取 | 先在前端中文契约测试中加入 `/api/studio/chapter-goals`、读取章节目标、上章摘要和连续性约束红灯断言；随后 Studio 页面新增 `readStudioChapterGoal()`，在作品列表之后只读取章节目标 API 并展示成功、空前置和可重试错误。`pnpm --filter @storyforge/web test` 8 项通过，`tsc --noEmit` 通过，API 定向测试 4 项通过。 | 第3轮补章节目标 API 错误路径与状态文档收口。 |
| 2026-05-19 | Phase 6 Studio 章节目标第3轮：错误路径与状态收口 | 新增章节目标 404 测试，确认目标章节不存在时返回可展示的错误摘要；`phase6DataSources.studio` 将章节目标 API 标记为 `Web 单点读取已实现`，Phase 6 契约文档和 `.codex/current-phase.md` 同步状态。后端 5 项、Web 8 项、TypeScript 和 compileall 均通过。 | 本次 3 轮结束后停止；后续若继续，应选择 Studio 的 Scene Packet 单一数据源。 |


## 23. 2026-05-19 Phase 6 Studio Scene Packet 真实联动三轮推进记录

更新时间：2026-05-19 19:00:00 +08:00

### 本轮优先级判断

- TODO P2 和 `.codex/current-phase.md` 均要求 Studio 下一步从 Scene Packet 单一数据源推进。
- 本轮固定选择 `phase6DataSources.studio` 中的“Scene Packet API”，符合总计划第 11 节 Phase 6 工作台连续化方向。
- 边界：只做 Studio 单页面单数据源，不新增全量 Web API client、不联通 Judge、Repair、批准回写和失败恢复。

### 状态区分

- 本轮开始前已实现：Studio 作品列表 API 与章节目标 API 的后端契约和 Web 单点读取。
- 本轮开始前已有契约但未联通：Scene Packet API、Judge、Repair、批准回写和失败恢复。
- 完全不存在：完整交互式 Studio 编排器、一次性联通五页、跨页面状态管理平台。
- 竞品启发：仅保留 Scene Packet 作为生成前证据包和预算摘要的产品步骤，不引入新架构。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | Phase 6 Studio Scene Packet 第1轮：上下文与红灯契约 | 新增 `.codex/context-summary-phase6-studio-scene-packet.md`；定位现有 `POST /api/scene-packets`、`ScenePacket` 模型、Scene Packet 测试和 Studio 单点读取模式；新增 Studio Scene Packet 摘要 API 测试，红灯为 `/api/studio/scene-packets` 返回 404。 | 第2轮实现最小读取 API 与 Web Studio 单点读取。 |
| 2026-05-19 | Phase 6 Studio Scene Packet 第2轮：最小读取联动 | 新增 `StudioScenePacketRead`、`read_studio_scene_packet()` 与 `GET /api/studio/scene-packets`，只读取已持久化 Scene Packet 摘要；Web Studio 新增 `readStudioScenePacket()` 并在章节目标之后单点读取该端点。API 定向测试 6 项、API compileall、Web 契约测试 8 项和 TypeScript 均通过。 | 第3轮补无 Scene Packet 错误路径、registry 状态和 Phase 文档收口。 |
| 2026-05-19 | Phase 6 Studio Scene Packet 第3轮：错误路径与状态收口 | 新增 Scene Packet 缺失 404 测试，确认无已组装包时返回可展示的错误摘要；`phase6DataSources.studio` 将 Scene Packet API 标记为 `Web 单点读取已实现`，Phase 6 契约文档和 `.codex/current-phase.md` 同步状态，并把后续单数据源建议收口到 Judge。 | 本次 3 轮结束后停止；后续若继续，应选择 Studio 的 Judge 单一数据源。 |

### 三轮收口状态

- 已实现：Studio 作品列表 API、章节目标 API 与 Scene Packet API 的后端契约和 Web 单点读取。
- 已有契约但未联通：Judge、Repair、批准回写和失败恢复。
- 本次连续 3 轮到此停止，不开启第 4 轮。


## 24. 2026-05-19 Phase 6 Studio Judge 评审真实联动三轮推进记录

更新时间：2026-05-19 20:00:00 +08:00

### 本轮优先级判断

- TODO 和 `.codex/current-phase.md` 均明确 Studio 作品列表、章节目标与 Scene Packet 已完成，后续应从 Judge 单一数据源继续。
- 本轮固定选择 `phase6DataSources.studio` 中的“Judge 评审 API”，符合总计划第 11 节 Phase 6 工作台连续化方向。
- 边界：只做 Studio 单页面单数据源，不新增全量 Web API client、不联通 Repair、批准回写或失败恢复。

### 状态区分

- 本轮开始前已实现：Studio 作品列表 API、章节目标 API 与 Scene Packet API 的后端契约和 Web 单点读取。
- 本轮开始前已有契约但未联通：Judge 评审 API、Repair、批准回写和失败恢复。
- 完全不存在：完整交互式 Studio 编排器、一次性联通五页、跨页面状态管理平台。
- 竞品启发：仅保留 Judge 作为生成后质量闸门和问题摘要步骤，不引入新架构。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | Phase 6 Studio Judge 第1轮：上下文与红灯契约 | 新增 `.codex/context-summary-phase6-studio-judge.md`；定位现有 `POST /api/judge/issues`、`JudgeIssue` 模型、Judge/Repair 测试和 Studio 单点读取模式；新增 Studio Judge 摘要 API 测试，红灯为 `/api/studio/judge-reviews` 返回 404。 | 第2轮实现最小 Judge 读取 API 与 Web Studio 单点读取。 |
| 2026-05-19 | Phase 6 Studio Judge 第2轮：最小读取联动 | 新增 `StudioJudgeReviewRead`、`read_studio_judge_review()` 与 `GET /api/studio/judge-reviews`，只读取已持久化 JudgeIssue 摘要；Web Studio 新增 `readStudioJudgeReview()` 并在 Scene Packet 之后单点读取该端点。API 定向测试 8 项、API compileall、Web 契约测试 8 项和 TypeScript 均通过。 | 第3轮补 Judge 缺失错误路径、registry 状态和 Phase 文档收口。 |
| 2026-05-19 | Phase 6 Studio Judge 第3轮：错误路径与状态收口 | 新增 Judge 评审缺失 404 测试，确认无已持久化评审时返回可展示的错误摘要；`phase6DataSources.studio` 将 Judge 评审 API 标记为 `Web 单点读取已实现`，Phase 6 契约文档和 `.codex/current-phase.md` 同步状态，并把后续单数据源建议收口到 Repair。 | 本次 3 轮结束后停止；后续若继续，应选择 Studio 的 Repair 单一数据源。 |

### 三轮收口状态

- 已实现：Studio 作品列表 API、章节目标 API、Scene Packet API 与 Judge 评审 API 的后端契约和 Web 单点读取。
- 已有契约但未联通：Repair、批准回写和失败恢复。
- 本次连续 3 轮到此停止，不开启第 4 轮。


## 25. 2026-05-19 Phase 6 Studio Repair 修订真实联动推进记录

更新时间：2026-05-19 19:39:49 +08:00

### 本轮优先级判断

- 用户明确要求只推进 Phase 6 Studio 创作闭环收口，不碰 Retrieval/Runs/Artifacts/Evaluations。
- `.codex/current-phase.md` 与 TODO 第 24 节均把 Studio 后续单一数据源收口到 Repair。
- 本轮固定选择 `phase6DataSources.studio` 中的“Repair 修订 API”，不新增全量 Web API client、不做批准回写、不实现失败恢复。

### 状态区分

- 本轮开始前已实现：Studio 作品列表 API、章节目标 API、Scene Packet API 与 Judge 评审 API 的后端契约和 Web 单点读取。
- 本轮完成：Studio Repair 修订 API 的后端只读契约和 Web 单点读取。
- 已有契约但未联通：批准回写和失败恢复。
- 完全不存在：完整交互式 Studio 编排器、跨页面状态管理平台、五页一次性联动。
### 本轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-19 | Phase 6 Studio Repair 收口 | 新增 `StudioRepairPatchRead`、`read_studio_repair_patches()` 与 `GET /api/studio/repair-patches`，只读已生成 RepairPatch 摘要；Web Studio 在 Judge 评审后单点读取 Repair 修订并展示修订文本、差异摘要、采纳建议和重评状态；`phase6DataSources.studio` 将 Repair 修订 API 标记为 `Web 单点读取已实现`；Phase 6 契约文档和 `.codex/current-phase.md` 同步状态。API 定向测试 11 项、API compileall、Web 契约测试 8 项和 TypeScript 均通过。 | 后续若继续，只能选择 Studio 的批准回写单一数据源；仍不得触碰 Retrieval/Runs/Artifacts/Evaluations。 |

### 收口状态

- 已实现：Studio 作品列表 API、章节目标 API、Scene Packet API、Judge 评审 API 与 Repair 修订 API 的后端契约和 Web 单点读取。
- 已有契约但未联通：批准回写和失败恢复。
- 本轮未修改 Retrieval/Runs/Artifacts/Evaluations 实现文件。


## 26. 2026-05-20 Phase 7 发布治理收口推进记录

更新时间：2026-05-20 00:55:00 +08:00

### 本轮边界

- 当前进入 Phase 7 发布与治理收口；Phase 6 全局收口和验证已完成。
- 本轮不新增产品功能，不继续扩 Studio/Retrieval/Runs/Artifacts/Evaluations 数据源，不自动提交。

### 三轮结果

| 日期 | 迭代 | 结果 | 后续动作 |
| --- | --- | --- | --- |
| 2026-05-20 | Phase 7 第1轮：文档状态不一致收口 | `README.md` 与 TODO 下一版本目标已校准为 Phase 7 发布治理收口，并明确 Phase 6 不继续扩数据源；文本检查通过。 | 第2轮检查 OpenAPI 契约是否需要刷新。 |
| 2026-05-20 | Phase 7 第2轮：OpenAPI 契约刷新与审查 | `pnpm openapi` 已刷新 `packages/shared/src/contracts/storyforge.openapi.json`；新增 `docs/api/phase6-openapi-review.md` 记录 Studio、Retrieval、Runs 新端点的代码来源，拒绝无来源 diff。 | 第3轮检查环境变量、Alembic、Docker 或本地启动问题。 |
| 2026-05-20 | Phase 7 第3轮：当前 Phase 与审计状态收口 | `.codex/current-phase.md` 已改写为当前 Phase 事实入口，`TODO.md`、`.codex/operations-log.md` 和 `.codex/verification-report.md` 的 Phase 7 收口状态保持一致；`Select-String` 与 `git status --short --branch` 验证通过。 | 本次 3 轮结束后停止；后续只做必要的发布治理校准，不再开第 4 轮。 |
| 2026-05-21 | 闭环事实源治理收口 | `phase6-workbench-contract.md`、`TODO.md`、`.codex/current-phase.md` 与 `context-summary-end-to-end-closure.md` 按最小执行/摘要事实校准；不复制 `.codex/operations-log.md` 长流水，不修改运行时代码。 | 主线程继续执行最终验证；后续交互按钮流、详情页、签名 URL、复杂图表和自动反馈执行另行批准。 |

| 2026-05-21 | Studio Server Action 批准写回闭环 | `apps/web/app/studio/page.tsx` 新增 `approveStudioWritebackAction` 与真实表单，提交 `scene_packet_id` 或 `repair_patch_id` 到 `POST /api/studio/approve`，成功后 `revalidatePath("/studio")` 并展示结果摘要；API 批准写回测试 20 项通过。 | 这只是 Studio 批准写回最小交互闭环，不等于完整 Studio 编排器；失败续跑和生成/Judge/Repair 按钮流仍需另行批准。 |

| 2026-05-21 | Studio 文档状态收口 | `docs/architecture/phase6-workbench-contract.md`、`TODO.md` 与 `.codex/current-phase.md` 已同步为“Studio 已通过 Server Action 提交批准写回并展示结果摘要”；不改运行时代码，只消除旧表述。 | 后续文档继续保持 Studio 最小交互闭环与完整编排器的边界区分。 |
