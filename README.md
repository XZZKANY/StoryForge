# StoryForge

StoryForge 是一个面向中文长篇小说生产的可验证创作流水线。它把 Blueprint、检索证据、章节生成、Judge 评审、Repair 修复、批准写回、Story Memory、导出制品与审计报告串成可复盘的 BookRun，而不是只产出一段孤立文本。

## 当前状态

- 远端 `master` 已合并 Phase 9B 真实 LLM 冒烟调用链修复和 Phase 9 Alembic 多 head 修复。最新 GitHub Actions `CI / Core verification` run `26857864662` 已通过；历史远端 `master` 定时 `E2E` run `26915457170`（2026-06-03T21:55:39Z）曾失败于 Alembic `Multiple head revisions`；修复分支 `codex/phase9-e2e-alembic` 的远端 `E2E` run `26941784868` 已成功；修复已非强制快进合入 `master`，最新远端 `master` E2E run `26944063055`（2026-06-04T09:45:05Z，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`）已成功，且 `执行 Alembic 迁移预检`、`执行数据库迁移`、`运行 E2E` 均为 success。
- Phase 9A 本地 deterministic/mock 闭环已实现：BookRun 可从锁定 Blueprint 生成 3 章最小可审计小说，并导出 `book.md` 与 `audit_report.json`。
- Phase 9B 控制面已实现：BookRun 支持 checkpoint resume、token/时间/章节预算暂停、provider 连续降级自动暂停，以及真实 LLM 冒烟入口。
- Phase 9C 本地增强已实现：Story Memory 注入/抽取、Character Bible、Timeline Guard、Style Guard、EPUB 导出和全书审计页已纳入本地测试。
- 当前已有真实 LLM 10 章 smoke 最终验收证据：`.codex/real-llm-10ch-20260604-110831`。该次运行实际 10 章、tokens_used=145668、`quality_summary.status=ok`、`gate: pass_for_real_10ch_final_acceptance`，并已补 10 章 smoke 人工通读完成记录；它不能外推为 3-5 万字长程完成。

## 当前能做什么

- **BookRun 最小全书闭环**：从 Blueprint 章节计划顺序驱动 NovelLoop，完成 generate、Judge、Repair、approve、checkpoint 与导出登记。
- **真实 LLM 冒烟门禁**：提供 Phase 9B 真实 LLM 1 章、3 章和 10 章 smoke 证据，支持 token 预算、章节预算、Judge/Repair 证据记录和脱敏摘要输出。
- **BookRun 控制面**：支持暂停/恢复、预算硬上限、provider 降级暂停和成本摘要展示，避免真实模型运行失控。
- **全书制品与审计**：生成 Markdown、EPUB 与 `audit_report.json`，并通过 `/book-runs/[id]/audit` 回看 generate/judge/repair/approve/memory_extract 证据链。
- **Studio 创作链路**：读取作品、章节目标、Scene Packet、Judge 评审、Repair 修订、批准摘要与失败恢复摘要；批准写回通过 Server Action 提交到后端真实端点。
- **Retrieval 证据链路**：读取资料源、刷新任务、搜索命中和证据锚点，用于核对 Scene Packet 的检索来源。
- **Runs 运行链路**：读取指定 `job_run_id` 的 JobRun、Checkpoint 和 ModelRun 摘要，并说明 retry 只创建恢复任务。
- **Artifacts 治理入口**：读取制品列表、首个制品详情和 payload 下载摘要。
- **Evaluations 诊断入口**：读取评测运行、趋势摘要、失败样例和 Studio 反馈入口摘要。
- **Provider/LLM 诊断**：通过 Provider Gateway 与 workflow provider client 验证真实模型配置、降级边界和调用连通性。

## 本分支新增内容

本分支会把当前本地主工作区的最新进度提交上来，合并前仍以 PR 验证结果为准：

- **模型设置页与 Provider 检测**：新增 `/settings` 入口、Provider 模型检测 API 与页面测试，用于检测端点连通性并查看可用模型。
- **首页体验改版**：首页导航、快捷动作、侧栏与最近记录向更接近 Claude-like 工作台的体验收敛。
- **Blueprint 章节计划增强**：3 章结构会生成更具体的调查推进目标和章节 beat，而不是每章复用同一句推进模板。
- **Novel Skill Framework 设计**：将现有 generate、judge、repair、approve、memory_extract、export 显式声明为 StoryForge 自己的小说技能契约层，第一阶段只映射现有能力，不新增动态插件。
- **小说质量总控计划**：规划静态坏味道检查、场景质量计划、分级修订、黄金样例回归和整书质量审计，目标是提升连贯性、人物一致性与文风稳定性。

## 当前不能做什么

- 不能宣称真实 LLM 下 3-5 万字长程已完成；当前真实证据只覆盖 1 章、3 章与 10 章 smoke。
- 不能宣称已具备稳定生产级长篇闭环；3-5 万字短篇、Markdown/EPUB 导出验收、审计页回放和长程人工通读仍是发布前门禁。
- 不提供全步骤 Studio 编排器，也不提供跨步骤草稿编辑器。
- 不提供完整检索请求表单、命中详情弹层或 Retrieval 独立证据跳转路由。
- 不把 Runs retry 描述为立即续跑 workflow。
- 不提供对象存储签名 URL 下载、上传资料执行流、快照 diff 或评测报告详情页。
- 不提供复杂趋势图、自动反馈执行或外部 LLM 生产端到端质量承诺。

## 如何本地跑通

```powershell
git clone https://github.com/XZZKANY/StoryForge.git
cd StoryForge
pnpm install
docker compose up -d postgres redis minio
pnpm verify
pnpm e2e
pnpm test
pnpm openapi
```

如 PowerShell 执行策略阻止 `pnpm.ps1`，使用：

```powershell
powershell.exe -NoProfile -Command "pnpm.cmd run verify"
powershell.exe -NoProfile -Command "pnpm.cmd run e2e"
powershell.exe -NoProfile -Command "pnpm.cmd run test"
powershell.exe -NoProfile -Command "pnpm.cmd openapi"
```

## 真实 LLM 冒烟入口

配置私有真实 LLM 环境变量后，可在本地 API 环境执行：

```powershell
cd apps/api
uv run python -m app.domains.book_runs.phase9b_real_llm_smoke --chapter-count 1 --token-budget 8000
uv run python -m app.domains.book_runs.phase9b_real_llm_smoke --chapter-count 3 --token-budget 24000
```

命令只输出脱敏摘要；真实凭据不得写入仓库、日志或验证报告。真实 LLM 冒烟结果必须连同 `book.md`、`audit_report.json`、ModelRun token 用量和 Judge/Repair 证据一起记录，才能升级能力声明。

## 最近验证证据

- PR #4：修复 Phase 9B 真实 LLM 冒烟调用链；最新远端 `CI / Core verification` run `26857864662` 已通过。
- 远端 `master` 历史 schedule run `26915457170`（2026-06-03T21:55:39Z）曾失败，失败点为 `uv run alembic upgrade head`，错误为 `Multiple head revisions are present for given argument 'head'`；修复分支远端 `E2E` run `26941784868` 已证明本轮最小 Alembic 修复可在远端跑通；修复已合入 `master`，最新远端 `master` E2E run `26944063055` 已成功。
- 本地迁移图修复：新增 Alembic merge revision `20260604_0001` 合并 `20260514_phase2` 与 `20260602_0003`，`uv run alembic heads --verbose` 只显示一个 mergepoint head；本地 `pnpm e2e` 的 `API verification` 已纳入 `tests/test_alembic_heads.py`，会先验证单 head 与离线 SQL smoke；在线 PostgreSQL 迁移已在本轮复验，临时库 `storyforge_phase9_online_verify` 执行 `uv run alembic upgrade head` 与 `uv run alembic current --check-heads` 均退出码为 0，验证后已删除。
- 隔离 worktree 验证：`apps/api` 全量 pytest 为 `313 passed, 6 warnings`；`apps/workflow` 全量 pytest 为 `110 passed`。
- 本地快速验证仍建议运行 `pnpm verify`、`pnpm test`、`pnpm e2e` 与 `pnpm openapi`，并把结果写入 `.codex/verification-report.md`。远程 GitHub workflow 只作为手动提示检查，不替代本地 AI 验证门禁。

## 发布前门禁

- Web 业务请求必须统一经过 `apps/web/lib/api-client.ts` 注入本地 API 访问头并使用 `cache: "no-store"`。
- 页面级读取验证必须覆盖 `/studio`、`/retrieval`、`/runs?job_run_id=<有效ID>`、`/artifacts`、`/evaluations`、`/book-runs` 和 `/book-runs/[id]/audit`。
- `scripts/run-e2e.mjs` 必须执行真实 API HTTP pytest 目标，不允许重新降级为补偿验证来掩盖 API 链路失败。
- 宣称“真实模型下能产出一本最小可审计小说”时，必须同时引用本地 `pnpm verify` / `pnpm e2e` 结果、历史远端手动提示检查证据、真实 10 章 smoke BookRun completed、`quality_summary.status=ok`、`book.md` 可读、`audit_report.json` 完整、人工通读完成和 `gate: pass_for_real_10ch_final_acceptance` 证据。
- 宣称“稳定长篇生产闭环”前，必须补齐 3-5 万字短篇、Markdown/EPUB 导出、审计页回放、人工通读无明显一致性矛盾，以及 README/current-phase 能力边界同步。
- `.codex/verification-report.md` 必须记录自动化测试、页面读取、本地 API 访问头注入、Studio 批准写回、BookRun 冒烟、Artifacts/Evaluations 真实读取、远程 LLM 冒烟、未联通能力和 OpenAPI 变化情况。
- `pnpm openapi` 如产生 diff，必须解释来源并补充测试证据后才能进入发布判断。

## 架构事实源

- 当前阶段主事实源：`current-phase.md`；README 只保留入口摘要，详细阶段判定和禁止宣称范围以 `current-phase.md` 为准。
- API：`apps/api` 是业务真相源。
- Web：`apps/web` 只展示已验证的页面级闭环和明确边界。
- Workflow：`apps/workflow` 负责长任务编排、checkpoint、运行态记录和真实模型调用边界。
- BookRun：`apps/api/app/domains/book_runs` 与 `apps/workflow/storyforge_workflow/orchestrators` 共同承载整书闭环。
- 共享契约：`packages/shared/src/contracts/storyforge.openapi.json`。
- 工作台契约：`docs/architecture/phase6-workbench-contract.md`。
- 当前阶段事实源：`current-phase.md`。
- 本地验证报告：`.codex/verification-report.md`。
