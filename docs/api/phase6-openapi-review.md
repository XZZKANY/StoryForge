# Phase 6 OpenAPI 契约审查

生成时间：2026-05-20 00:55:00 +08:00

## 1. 审查范围

本记录只审查本轮 `pnpm openapi` 刷新的契约差异，来源限定为当前工作区已经存在的 Phase 6 API 代码变更，不接受无来源的 OpenAPI diff。

契约文件：`packages/shared/src/contracts/storyforge.openapi.json`

## 2. 本轮新增或刷新端点来源

| 端点 | 来源代码 | 状态说明 |
| --- | --- | --- |
| `GET /api/studio/books` | `apps/api/app/domains/studio/router.py` | Studio 作品列表 API 最小契约，Web 已单点读取。 |
| `GET /api/studio/chapter-goals` | `apps/api/app/domains/studio/router.py` | Studio 章节目标 API 最小契约，Web 已单点读取。 |
| `GET /api/studio/scene-packets` | `apps/api/app/domains/studio/router.py` | Studio Scene Packet 摘要 API 最小契约，Web 已单点读取。 |
| `GET /api/studio/judge-reviews` | `apps/api/app/domains/studio/router.py` | Studio Judge 评审摘要 API 最小契约，Web 已单点读取。 |
| `GET /api/studio/repair-patches` | `apps/api/app/domains/studio/router.py` | Studio Repair 修订摘要 API 最小契约，Web 已单点读取。 |
| `GET /api/retrieval/workbench/sources` | `apps/api/app/domains/retrieval/router.py` | Retrieval 资料源列表工作台 API，Web 已单点读取。 |
| `GET /api/retrieval/workbench/refresh-runs` | `apps/api/app/domains/retrieval/router.py` | Retrieval 刷新任务工作台 API，Web 已单点读取。 |
| `POST /api/retrieval/workbench/search` | `apps/api/app/domains/retrieval/router.py` | Retrieval 搜索请求与命中预览工作台 API，Web 已单点读取。 |
| `GET /api/model-runs/job-runs/{job_run_id}` | `apps/api/app/domains/model_runs/router.py` | Runs JobRun/checkpoint/ModelRun 摘要后端最小契约，Runs 页面尚未读取。 |

## 3. 接受的契约差异

- 新增 Phase 6 Studio、Retrieval 和 Runs 后端最小契约对应的 path 与 schema。
- 新增 schema 名称包括 `StudioBookListItem`、`StudioChapterGoalRead`、`StudioScenePacketRead`、`StudioJudgeReviewRead`、`StudioRepairPatchRead`、`RetrievalWorkbenchSourceRead`、`RetrievalWorkbenchRefreshRunRead`、`RetrievalWorkbenchSearchRead`、`RetrievalWorkbenchHitRead`、`RunsJobRunRead`。
- 未发现需要解释为独立功能扩展的 OpenAPI 变更；本轮不新增 API 代码，只刷新契约快照。

## 4. 本地验证

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm openapi
git diff -- packages/shared/src/contracts/storyforge.openapi.json
Select-String packages/shared/src/contracts/storyforge.openapi.json -Pattern "/api/studio/books","/api/retrieval/workbench/search","/api/model-runs/job-runs/{job_run_id}" -SimpleMatch
```

通过条件：`pnpm openapi` 退出码为 0，契约差异能追溯到上表 API 代码，关键 Phase 6 端点在契约中存在。
