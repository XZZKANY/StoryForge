## 项目上下文摘要（终审压力测试）

生成时间：2026-05-21 18:35:00 +08:00

### 1. 已阅读资料

- `README.md`：项目定位、Phase 5/6/7 边界、本地命令和发布约束。
- `PROJECT_SUMMARY.md`：当前交付、风险与事实来源。
- `docs/architecture/phase6-workbench-contract.md`：工作台最小契约、已实现/未联通边界。
- `docs/operations/release-checklist.md`、`docs/operations/local-start.md`：发布门禁和本地启动流程。
- `apps/api/app/main.py`、`apps/web/lib/api-client.ts`、`apps/web/app/studio/api.ts`、`apps/web/app/artifacts/page.tsx`、`apps/web/app/evaluations/page.tsx`、`apps/web/app/retrieval/page.tsx`、`apps/web/app/runs/page.tsx`：API 鉴权、中台读取方式和页面实现。

### 2. 核心事实

- API 中间件除 `/health`、OpenAPI 和文档外，要求所有业务请求携带 `X-StoryForge-API-Key`。
- 通用 `readJson` 客户端会注入 API Key，但 Studio、Artifacts、Evaluations 存在直接 `fetch` 分支。
- Phase 6 契约反复声明多个页面只是最小摘要读取，仍有大量“已有契约但未联通”能力。
- Web 测试更偏静态契约检查，缺少页面级带鉴权渲染与失败路径端到端验证。

### 3. 审查关注点

- 上线高压风险：认证头遗漏、能力表述膨胀、验证覆盖无法证明真实页面可用。
- 剪枝重点：删除重复阶段叙事、收敛“中心/实验室/网关”式宣传词，减少未实现边界在首屏扩散。
- 抛光重点：把“可验证链路”作为唯一主叙事，用真实状态徽标和证据链路放大核心亮点。
