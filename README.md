# StoryForge

StoryForge 是一个面向长篇小说生产的可验证创作流水线：每一次生成、检索、评审、修复、批准与回写，都必须留下可追溯证据，而不是只产出一段孤立文本。

## 当前能做什么

- **Studio 创作链路**：读取作品、章节目标、Scene Packet、Judge 评审、Repair 修订、批准摘要与失败恢复摘要；批准写回通过 Server Action 提交到后端真实端点。
- **Retrieval 证据链路**：读取资料源、刷新任务、搜索命中和证据锚点，用于核对 Scene Packet 的检索来源。
- **Runs 运行链路**：读取指定 `job_run_id` 的 JobRun、Checkpoint 和 ModelRun 摘要，并说明 retry 只创建恢复任务。
- **Artifacts 治理入口**：读取制品列表、首个制品详情和 payload 下载摘要。
- **Evaluations 诊断入口**：读取评测运行、趋势摘要、失败样例和 Studio 反馈入口摘要。

## 当前不能做什么

- 不提供全步骤 Studio 编排器，也不提供跨步骤草稿编辑器。
- 不提供完整检索请求表单、命中详情弹层或独立证据跳转路由。
- 不把 Runs retry 描述为立即续跑 workflow。
- 不提供对象存储签名 URL 下载、上传资料执行流、快照 diff 或评测报告详情页。
- 不提供复杂趋势图、自动反馈执行或外部 LLM 生产端到端完成证明。

## 如何本地跑通

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm install
pnpm --filter @storyforge/web test
pnpm --filter @storyforge/web lint
pnpm run test
pnpm openapi
```

如 PowerShell 执行策略阻止 `pnpm.ps1`，使用：

```powershell
powershell.exe -NoProfile -Command "pnpm.cmd --filter @storyforge/web test"
powershell.exe -NoProfile -Command "pnpm.cmd --filter @storyforge/web lint"
powershell.exe -NoProfile -Command "pnpm.cmd run test"
powershell.exe -NoProfile -Command "pnpm.cmd openapi"
```

## 发布前门禁

- Web 业务请求必须统一经过 `apps/web/lib/api-client.ts` 注入 `X-StoryForge-API-Key` 和 `cache: "no-store"`。
- 页面级读取验证必须覆盖 `/studio`、`/retrieval`、`/runs?job_run_id=<有效ID>`、`/artifacts`、`/evaluations`。
- `.codex/verification-report.md` 必须记录自动化测试、页面读取、API Key 注入、Studio 批准写回、Artifacts/Evaluations 真实读取、未联通能力和 OpenAPI 变化情况。
- `pnpm openapi` 如产生 diff，必须解释来源并补充测试证据后才能进入发布判断。

## 架构事实源

- API：`apps/api` 是业务真相源。
- Web：`apps/web` 只展示已验证的页面级闭环和明确边界。
- Workflow：`apps/workflow` 负责长任务编排、checkpoint 和运行态记录。
- 共享契约：`packages/shared/src/contracts/storyforge.openapi.json`。
- 工作台契约：`docs/architecture/phase6-workbench-contract.md`。
- 本地验证报告：`.codex/verification-report.md`。
