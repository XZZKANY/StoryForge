# 项目上下文摘要（Phase 7 发布收口到全流程闭环）

生成时间：2026-05-24 20:40:35 +08:00

## 1. 任务目标

- 先完成 Phase 7 发布治理五项收口：`.env.example` 默认值、Alembic 从零升级、OpenAPI 无未解释 diff、`docs/operations/` 手册可用、`.codex/verification-report.md` 记录完整证据。
- Phase 7 通过后再验证功能闭环：workflow-to-api ModelRun 真表 adapter 与端到端冒烟链路。
- 最终验收为本地 `pnpm verify && pnpm e2e` 全绿，并输出 Git 状态和提交建议，不自动提交。

## 2. 事实源与当前阶段

- 外层规则文件：`D:/StoryForge/AGENTS.md`。
- 实际 Git 仓库根：`D:/StoryForge/1-renovel-ai-ai-rag-tavern`。
- 日常规则：`AI_ITERATION_GUIDE.md`。
- 当前阶段入口：`.codex/current-phase.md`，其中声明发布治理最终验证由主线程执行。
- 根脚本：`package.json` 提供 `verify`、`test`、`e2e`、`openapi`。

## 3. 相似实现分析

- `scripts/verify-local.ps1`：本地发布前环境门禁，检查 Node、pnpm、Python、Docker、必需文件和 PostgreSQL/Redis/MinIO 容器状态。
- `scripts/generate-openapi.ps1`：复用 FastAPI `app.openapi()` 刷新共享契约，失败时中止并输出中文错误。
- `scripts/run-e2e.mjs`：先刷新 OpenAPI，再运行 Node 契约、API `compileall`、真实 API HTTP pytest、workflow `compileall` 与 pytest。- `apps/workflow/storyforge_workflow/runtime/checkpoints.py`：包含 `ModelRunPayload`、`ModelRunSink`、`ApiModelRunAdapter`、SQLite checkpoint store 与内存测试替身。
- `apps/workflow/storyforge_workflow/runtime/runner.py`：`WorkflowRuntime` 通过 `model_run_sink` 投递成功/失败 provider 摘要，并把持久化 `ModelRun.id` 回写 runtime state。
- `apps/workflow/tests/test_runtime_runner.py`：覆盖 start/resume、provider 失败 checkpoint、payload 到 API 字段映射、adapter 正整数 `api_job_run_id` 边界。
- `apps/api/tests/test_model_runs.py`：覆盖 API 真表 ModelRun 创建、Runs JobRun 读取、retry 创建恢复任务、adapter 成功/失败 payload 真表写入与字符串 job_run_id 拒绝。

## 4. 可复用组件清单

- `package.json`：统一入口，禁止新增平行脚本。
- `docs/operations/alembic-validation.md`：Alembic 发布门禁记录模板。
- `docs/operations/local-start.md`、`release-checklist.md`、`troubleshooting.md`：Phase 7 运维手册事实源。
- `apps/api/alembic.ini` 与 `apps/api/alembic/env.py`：迁移配置入口。
- `packages/shared/src/contracts/storyforge.openapi.json`：OpenAPI 生成产物。

## 5. 项目约定

- 文档、注释、日志、测试描述使用简体中文。
- TypeScript/Node 使用 camelCase 函数和 PascalCase 类型；Python 使用 snake_case 函数与 PascalCase 类。
- API 侧沿用 FastAPI router/service/schema/test 分层；workflow 侧沿用 runtime/checkpoints/provider_execution 分层。
- 本轮不新增依赖、不新增脚本、不扩展 Studio/Retrieval/Runs/Artifacts/Evaluations 数据源。

## 6. 官方文档与开源检索

- Context7 已查询 Alembic 官方文档：`alembic upgrade head` 用于执行全部迁移到最新 head；`alembic current --check-heads` 用于检查数据库是否处于全部 head，未处于 head 时会非零失败。
- 当前工具集中没有可调用的 `github.search_code`，已记录为检索限制；本轮以项目内既有脚本和 Context7 官方文档作为复用依据。## 7. 测试策略

- Phase 7 环境门禁：`pnpm verify`。
- Alembic 门禁：`uv run alembic heads`、干净临时库 `uv run alembic upgrade head`、`uv run alembic current --check-heads`。
- OpenAPI 门禁：`pnpm openapi` 后检查 `packages/shared/src/contracts/storyforge.openapi.json` 是否产生未解释 diff。
- ModelRun adapter 门禁：`apps/workflow` 下 `uv run pytest tests/test_runtime_runner.py tests/test_generation_state_references.py -q`；`apps/api` 下 `uv run pytest tests/test_model_runs.py -q`。
- 全流程门禁：仓库根 `pnpm verify` 与 `pnpm e2e`。

## 8. 依赖和集成点

- Docker Compose 提供 `storyforge-postgres`、`storyforge-redis`、`storyforge-minio`。
- `.env.example` 必须与本地启动、Web API client、API key、workflow SQLite、Provider Gateway 配置一致。
- `WorkflowRuntime` 仅投递 payload；API 真表写入由 `ApiModelRunAdapter` 的 `record_api_model_run` 回调完成。
- Runs retry 仍只创建 queued 恢复任务，不声明立即续跑 workflow。

## 9. 已识别风险点

- `.env.example` 当前存在空值和缺失项，不能百分之百证明“所有变量有默认值”。
- 部分 `docs/operations/` 文档仍提到 e2e 补偿验收，与当前 `scripts/run-e2e.mjs` 固定真实 API HTTP pytest 不一致。
- Alembic 从零升级依赖本机 Docker/PostgreSQL 可用；失败时必须记录阻塞，不允许用离线 SQL 冒充在线升级通过。
- `pnpm openapi` 可能刷新生成物；若有 diff，必须给出来源和测试证据。

## 10. 充分性检查

- 能定义接口契约：是，Phase 7 验收命令、ModelRun adapter 输入输出和全流程门禁已明确。
- 理解技术选型：是，复用现有 pnpm/uv/Alembic/pytest/Node 脚本，不新增工具。
- 识别主要风险：是，环境、OpenAPI diff、旧文档表述和真实 HTTP e2e 均已列出。
- 知道如何验证：是，按第 7 节命令逐项执行并回填 `.codex/verification-report.md`。