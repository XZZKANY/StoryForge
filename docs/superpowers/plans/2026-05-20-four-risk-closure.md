# StoryForge 四项剩余风险收口实施计划

> **代理执行要求：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务推进；复核时以本文件的勾选状态、验证报告和 Git diff 为准。

**Goal:** 将四项剩余问题从后续待办推进为可验证的最小交付。

**Architecture:** 继续采用模块化单体，API 保持 FastAPI router/service/schema 分层，Web 保持 Next SSR 页面级读取。每次只联通单页面单数据源，不新增微服务、不引入全量前端 client。

**Tech Stack:** FastAPI、SQLAlchemy、Next.js App Router、Node test、pnpm、Alembic。

---

### Task 1: Runs 页面真实读取

**Files:**
- Modify: `apps/web/app/runs/page.tsx`
- Modify: `apps/web/lib/phase6-data-sources.ts`
- Modify: `apps/web/tests/phase1-navigation.test.tsx`

- [x] Runs 页面默认读取 `GET /api/model-runs/job-runs/1`。
- [x] 展示 JobRun、checkpoint 和 ModelRun 摘要。
- [x] API 不可用或 404 时展示可重试错误摘要。
- [x] registry 中 Runs 三项状态改为 `Web 单点读取已实现`。

### Task 2: Studio 批准回写与失败恢复摘要

**Files:**
- Modify: `apps/api/app/domains/studio/schemas.py`
- Modify: `apps/api/app/domains/studio/service.py`
- Modify: `apps/api/app/domains/studio/router.py`
- Modify: `apps/api/tests/test_studio_book_list_api.py`
- Modify: `apps/web/app/studio/page.tsx`

- [x] 新增 `GET /api/studio/approval-summary` 只读摘要。
- [x] 新增 `GET /api/studio/recovery-summary` 只读摘要。
- [x] Studio 页面在 Repair 后读取批准回写与失败恢复摘要。
- [x] 不执行真实写回或重试。
### Task 3: Artifacts 与 Evaluations 真实读取

**Files:**
- Modify: `apps/web/app/artifacts/page.tsx`
- Modify: `apps/web/app/evaluations/page.tsx`
- Modify: `apps/web/lib/phase6-data-sources.ts`
- Modify: `apps/web/tests/phase1-navigation.test.tsx`

- [x] Artifacts 页面读取 `GET /api/artifacts` 并展示摘要。
- [x] Evaluations 页面读取 `GET /api/evaluations/runs` 并展示摘要。
- [x] registry 中相关首个数据源状态改为 `Web 单点读取已实现`。
- [x] 明确下载、报告详情、趋势图仍未实现。

### Task 4: 文档治理与发布门禁

**Files:**
- Create: `.codex/context-summary-four-risk-closure.md`
- Modify: `docs/architecture/phase6-workbench-contract.md`
- Modify: `TODO.md`
- Modify: `.codex/current-phase.md`
- Modify: `.codex/operations-log.md`
- Modify: `.codex/verification-report.md`

- [x] 同步契约矩阵和当前 Phase 摘要。
- [x] 只追加索引化摘要，不复制长流水。
- [x] 运行 API、Web、发布门禁和 Alembic 验证。
- [x] 提交并推送 `origin master`。

## 验证命令

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run pytest tests/test_model_runs.py -q
uv run pytest tests/test_studio_book_list_api.py -q
uv run pytest tests/test_artifacts.py tests/test_evaluations.py -q
uv run alembic current --check-heads

cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm --filter @storyforge/web test
pnpm --filter @storyforge/web exec tsc --noEmit
pnpm verify
pnpm openapi
pnpm test
pnpm e2e
git diff --check
```
