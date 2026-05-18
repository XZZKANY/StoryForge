# StoryForge TODO

更新时间：2026-05-18 17:11:48 +08:00

## 1. 项目目标

StoryForge 是面向长篇小说创作的 AI/RAG 创作工作台。核心目标是把作品资产、章节连续性、检索证据、结构化评审、定向修复、模型运行日志、制品和评测放在同一条可验证链路中，避免只生成孤立文本。

项目继续采用模块化单体：`apps/api` 作为业务真相源与控制面 API，`apps/workflow` 承载长任务、checkpoint 和 runtime，`apps/web` 提供连续操作工作台，`packages/shared` 保存 OpenAPI 契约，`tests/e2e` 负责阶段契约验证。

## 2. 当前状态

- 当前仓库路径：`D:/StoryForge/1-renovel-ai-ai-rag-tavern`。
- 当前分支与远程：`master...origin/master [ahead 1]`，本地 HEAD 为 `a9f73e3 整理：完成三轮健康基线与发布治理`，远程 `origin/master` 为 `95f3642 feat: complete phase4 engineering and verification`。
- 当前版本：`0.1.0`，根包管理器为 `pnpm@9.15.4`。
- 已完成主线：Phase 1 到 Phase 4 的工程闭环已完成，覆盖作品资产、章节生成、Scene Packet、Judge、Repair、系列记忆、团队协作、Provider Gateway、检索中心、Prompt Pack、模型运行日志、workflow runtime、制品中心和评测系统。
- 本地验证链：根级 `pnpm e2e`、Web 中文契约、API compileall、Workflow compileall、API 服务层补偿验收和 workflow pytest 已在既有验证报告中作为主要链路。
- 当前工作区已有未提交发布治理与 P1 Provider Gateway 变更：`.codex/operations-log.md`、`.codex/verification-report.md`、`.env.example`、`README.md`、`TODO.md`、`apps/api/app/domains/provider_gateway/schemas.py`、`apps/api/app/domains/provider_gateway/service.py`、`apps/api/tests/test_provider_gateway.py`、`docs/operations/local-start.md`、`packages/shared/src/contracts/storyforge.openapi.json`、`scripts/generate-openapi.ps1`、`scripts/run-e2e.mjs`、`scripts/verify-local.ps1` 已修改；`.codex/context-summary-OpenAPI验证治理三轮.md`、`.codex/context-summary-ProviderGateway配置真实化.md`、`.codex/context-summary-发布治理三轮.md`、`.codex/context-summary-编码与运维一致性三轮.md`、`.codex/context-summary-竞品架构横评.md`、`.codex/context-summary-竞品架构横评落地修改.md`、`apps/api/app/domains/provider_gateway/runtime_config.py`、`docs/operations/README.md`、`docs/operations/alembic-validation.md`、`docs/operations/release-checklist.md`、`docs/operations/troubleshooting.md` 仍为未跟踪文件。本轮用户明确要求不要自动提交。

## 3. 下一版本目标

下一版本不再重复实现 Phase 1 到 Phase 4，优先进入 Phase 0、Phase 5、Phase 6、Phase 7。

1. **Phase 0：同步与健康基线**
   - 收口当前未提交的计划、README 和 `.codex` 审计文件。
   - 复跑稳定验证链，确认本地与 GitHub 同步状态。
   - 明确当前环境限制，避免后续代理误判为功能缺陷。
2. **Phase 5：真实 AI/RAG 依赖接入**
   - 将确定性 provider、假 embedding、关键词检索和本地 shim 升级为可真实调用、可降级、可审计的 AI/RAG 内核。
   - 强化 Provider Gateway、Embedding、Reranker、ModelRun、Scene Packet 检索证据链。
3. **Phase 6：产品工作台可用化**
   - 把当前“能力入口和证据页”升级为可连续完成创作、检索、运行、制品和评测的工作台。
   - 优先串起 Studio、Retrieval、Runs、Artifacts、Evaluations 的连续操作体验。
4. **Phase 7：发布与运维治理**
   - 完善 `.env.example`、迁移、OpenAPI 刷新、统一验证脚本、启动手册、发布清单和故障手册。

## 4. 最大阻碍

- **变更收口阻碍**：当前本地 `master` 已领先远程 1 个提交，并叠加未提交发布治理变更；后续开发前必须先决定继续整理、提交、推送或回滚。
- **真实依赖阻碍**：Phase 4 的检索与 provider 仍以确定性占位或本地 shim 为主，真实 AI/RAG 尚未闭环。
- **验证环境阻碍**：既有报告记录 FastAPI `TestClient` / ASGI HTTP pytest 在当前环境可能阻塞，短期仍依赖契约测试、compileall 和服务层补偿验收。
- **产品体验阻碍**：前端页面已覆盖能力入口，但仍偏能力展示，尚未形成从创作到评测的连续操作闭环。
- **发布治理阻碍**：新机器启动、Docker、数据库迁移、MinIO、OpenAPI 刷新和统一验证脚本仍需治理补强。

## 5. 任务池

### P0：立即处理

- [ ] 确认当前本地 ahead 1 与未提交发布治理变更的处理策略，避免后续开发继续叠加在不清晰状态上。
- [x] 执行 GitHub 同步门禁：`git fetch origin --prune`、`git status --short --branch`、`git log --oneline --decorate -5`、`git ls-remote --heads origin`。本地与远程 `master` 均为 `95f3642`。
- [x] 复跑当前稳定验证链：`pnpm e2e`、`pnpm run test:web`、`pnpm run test:api`、`pnpm run test:workflow`。验证通过，但发现 `pnpm e2e` 中 OpenAPI 刷新失败被降级为警告，已转入下一轮处理。
- [ ] 若 Docker 可用，补跑 `pnpm verify` 并记录 PostgreSQL、Redis、MinIO 状态。本轮已执行但 Docker 服务不可查询，`pnpm verify` 退出码为 1，需启动 Docker Desktop 或 Docker 服务后补跑。

### P1：下一开发主线

- [x] Provider Gateway 配置真实化：已新增运行时环境配置解析，区分 LLM、embedding、reranker；未配置密钥时分别稳定回退到 deterministic、local、disabled，并保留数据库 provider 优先解析。
- [ ] Embedding 与检索刷新真实化：支持真实 embedding 客户端接口，并保持“索引只保存引用，不替代业务真相源”。
- [ ] Scene Packet 使用真实检索证据：记录来源、chunk、score、rerank 顺序和上下文预算占用。
- [ ] Workflow runtime 调用链联通：模型调用写入 `ModelRun`，失败后保留 checkpoint 和可恢复错误状态。

### P2：产品工作台可用化

- [ ] Studio 页面串起作品、章节、Scene Packet、Judge、Repair、批准回写和失败恢复入口。
- [ ] Retrieval 页面支持资料源列表、刷新任务、搜索请求、命中预览和证据跳转。
- [ ] Runs 页面展示任务状态、checkpoint、模型运行日志和失败重试。
- [ ] Artifacts 页面展示导出物、上传资料、工作流快照和评测报告。
- [ ] Evaluations 页面展示评测集、运行记录、指标趋势和失败样例。

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
- [x] 校准 TODO 当前工作区文件列表：已按最新 `git status --short --branch` 更新已修改与未跟踪发布治理文件。
- [ ] 补齐 Alembic 从干净数据库升级到最新模型的本地验证记录：已新增 `docs/operations/alembic-validation.md`，完成脚本语法、head 检查和离线 SQL 生成记录；在线 PostgreSQL 升级因 Docker 服务不可查询仍需补跑。

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
