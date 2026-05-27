# StoryForge

StoryForge 是一个面向长篇小说生产的可验证创作流水线：每一次生成、检索、评审、修复、批准与回写，都必须留下可追溯证据，而不是只产出一段孤立文本。

## 当前状态

- 本地基础门禁已验证：`pnpm verify`、`pnpm test`、`pnpm e2e` 均通过，详细证据见 `.codex/verification-report.md`。
- Phase 9A 本地 deterministic/mock 闭环已实现：BookRun 可从 Blueprint 生成 3 章最小可审计小说，并导出 `book.md` 与 `audit_report.json`。
- Phase 9B 本地控制面已实现：BookRun 支持 checkpoint resume、token/时间/章节预算暂停，以及 provider 连续降级自动暂停。
- Phase 9C 本地增强已实现：Story Memory 注入/抽取、Character Bible、Timeline Guard、Style Guard、EPUB 导出和全书审计页已纳入本地测试。
- 真实 LLM 1 章/3 章 BookRun 冒烟尚未执行；当前环境未设置 `STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL`、`STORYFORGE_LLM_MODEL` 与 `STORYFORGE_LLM_PROVIDER`。

## 当前能做什么

- **BookRun 最小全书闭环**：从 Blueprint 章节计划顺序驱动 NovelLoop，完成 generate、Judge、Repair、approve、checkpoint 与导出登记。
- **BookRun 控制面**：支持暂停/恢复、预算硬上限、provider 降级暂停和成本摘要展示，避免真实模型运行失控。
- **全书制品与审计**：生成 Markdown、EPUB 与 `audit_report.json`，并通过 `/book-runs/[id]/audit` 回看 generate/judge/repair/approve/memory_extract 证据链。
- **Studio 创作链路**：读取作品、章节目标、Scene Packet、Judge 评审、Repair 修订、批准摘要与失败恢复摘要；批准写回通过 Server Action 提交到后端真实端点。
- **Retrieval 证据链路**：读取资料源、刷新任务、搜索命中和证据锚点，用于核对 Scene Packet 的检索来源。
- **Runs 运行链路**：读取指定 `job_run_id` 的 JobRun、Checkpoint 和 ModelRun 摘要，并说明 retry 只创建恢复任务。
- **Artifacts 治理入口**：读取制品列表、首个制品详情和 payload 下载摘要。
- **Evaluations 诊断入口**：读取评测运行、趋势摘要、失败样例和 Studio 反馈入口摘要。
- **Provider/LLM 诊断**：通过 Provider Gateway 与 workflow provider client 验证真实模型配置、降级边界和调用连通性。

## 当前不能做什么

- 不能宣称真实 LLM 下 3 章 BookRun 已 completed；真实 LLM 1 章/3 章冒烟仍缺少私有环境配置和运行证据。
- 不能宣称已具备稳定生产级长篇闭环；3-5 万字短篇、人工通读和真实长程质量验收仍未完成。
- 尚未在本轮取得远端 GitHub Actions `CI` 与 `E2E` 通过证据；当前结论仅基于本地验证。
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

设置私有 `STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL`、`STORYFORGE_LLM_MODEL` 与 `STORYFORGE_LLM_PROVIDER` 后，可在本地 API 环境执行：

```powershell
cd apps/api
uv run python -m app.domains.book_runs.phase9b_real_llm_smoke --chapter-count 1 --token-budget 8000
uv run python -m app.domains.book_runs.phase9b_real_llm_smoke --chapter-count 3 --token-budget 24000
```

命令只输出脱敏摘要；真实密钥不得写入仓库或验证报告。当前环境缺少上述变量，因此 9B-4a/9B-4b 仍未完成。

## 发布前门禁

- Web 业务请求必须统一经过 `apps/web/lib/api-client.ts` 注入 `X-StoryForge-API-Key` 和 `cache: "no-store"`。
- 页面级读取验证必须覆盖 `/studio`、`/retrieval`、`/runs?job_run_id=<有效ID>`、`/artifacts`、`/evaluations`、`/book-runs` 和 `/book-runs/[id]/audit`。
- `scripts/run-e2e.mjs` 必须执行真实 API HTTP pytest 目标，不允许重新降级为补偿验证来掩盖 API 链路失败。
- 宣称“能产出一本最小可审计小说”前，必须补齐真实 LLM 3 章 BookRun completed、远端 `CI`/`E2E` 通过、`book.md` 可读和 `audit_report.json` 完整证据。
- 宣称“稳定长篇生产闭环”前，必须补齐 3-5 万字短篇、Markdown/EPUB 导出、审计页回放、人工通读无明显一致性矛盾，以及 README/current-phase 能力边界同步。
- `.codex/verification-report.md` 必须记录自动化测试、页面读取、API Key 注入、Studio 批准写回、BookRun 冒烟、Artifacts/Evaluations 真实读取、远程 LLM 冒烟、未联通能力和 OpenAPI 变化情况。
- `pnpm openapi` 如产生 diff，必须解释来源并补充测试证据后才能进入发布判断。

## 架构事实源

- API：`apps/api` 是业务真相源。
- Web：`apps/web` 只展示已验证的页面级闭环和明确边界。
- Workflow：`apps/workflow` 负责长任务编排、checkpoint、运行态记录和真实模型调用边界。
- BookRun：`apps/api/app/domains/book_runs` 与 `apps/workflow/storyforge_workflow/orchestrators` 共同承载整书闭环。
- 共享契约：`packages/shared/src/contracts/storyforge.openapi.json`。
- 工作台契约：`docs/architecture/phase6-workbench-contract.md`。
- 本地验证报告：`.codex/verification-report.md`。
