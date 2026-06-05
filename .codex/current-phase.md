# StoryForge 当前 Phase 摘要

更新时间：2026-05-24 21:10:00 +08:00

## 1. 当前执行裁决

- 当前总计划事实源：`docs/superpowers/plans/2026-05-17-storyforge-master-replan.md` 第 11 节。
- 当前 TODO 事实源：`TODO.md` 的 P1/P2/P3 任务池与最近迭代记录。
- 当前上下文摘要：`.codex/context-summary-end-to-end-closure.md`。
- 当前阶段重点：Phase 7 发布治理已由主线程完成本地收口；`pnpm verify && pnpm e2e` 已通过，ModelRun adapter 与 API 真表写入已通过定向测试。
- 第 11.9 处理方式：继续保留本文件作为主事实入口，不复制 `.codex/operations-log.md` 长流水；历史审计记录只在追溯具体问题时按关键词读取。

## 2. 第 11 节风险状态

| 条目 | 当前状态 | 证据 |
| --- | --- | --- |
| 11.5 `story_memory` 最小持久化 | 已实现最小闭环 | `TODO.md`；`apps/api/app/domains/story_memory/`；`tests/test_story_memory_persistence.py` |
| 11.6 `compiled_contexts` 持久化 | 已实现最小闭环 | `TODO.md`；`apps/api/app/domains/context_compiler/models.py`；`tests/test_context_compiler_persistence.py` |
| 11.7 Workflow State 引用化 | 已实现最小闭环 | `TODO.md`；`apps/workflow/storyforge_workflow/state.py`；`tests/test_generation_state_references.py` |
| 11.8 最小仲裁闭环 | 已实现最小闭环 | `TODO.md`；`apply_arbitration_decision()` 只处理 `auto_merge` 的 memory create |
| 11.9 `.codex` 审计噪音 | 本文件继续作为主事实入口 | `.codex/current-phase.md`；`.codex/context-summary-end-to-end-closure.md` |
| Workflow-to-API ModelRun 调用链 | 已完成最小真表 adapter/client，workflow runtime 可把 `ModelRunPayload` 写入 API 真表；不是新微服务 | `docs/architecture/workflow-modelrun-adapter-contract.md`；`apps/workflow/tests/test_runtime_runner.py`；`apps/api/tests/test_model_runs.py` |
| Studio 创作闭环 | 读取链路已覆盖作品、章节目标、Scene Packet、Judge、Repair、批准摘要和恢复摘要；Web 已通过 Server Action 调用 `POST /api/studio/approve` 提交批准写回并展示结果摘要 | `apps/api/app/domains/studio/`；`apps/web/app/studio/page.tsx`；`apps/api/tests/test_studio_book_list_api.py` |
| Retrieval 工作台 | 资料源、刷新任务、搜索和命中预览 API/Web 单点读取已实现 | `apps/api/app/domains/retrieval/`；`apps/web/app/retrieval/page.tsx`；`apps/api/tests/test_retrieval_workbench_api.py` |
| Runs 工作台 | `GET /api/model-runs/job-runs/{job_run_id}` 仍是 API runtime diagnostics 读侧；旧 `/runs` URL 通过 308 进入 IDE runs 面板，IDE 面板读取 BookRun 与 `/api/ide/runs/{book_run_id}/events` SSE | `apps/api/app/domains/model_runs/`；`apps/api/tests/test_model_runs.py`；`apps/web/app/ide/page.tsx`；`apps/web/components/ide/views/BookRunPanel.tsx`；`apps/web/components/ide/views/BookRunEventsPanel.tsx` |
| Artifacts 工作台 | `GET /api/artifacts`、`GET /api/artifacts/{artifact_id}`、`GET /api/artifacts/{artifact_id}/download` 已实现；download 为 `payload_preview` 摘要 | `apps/api/app/domains/artifacts/`；`apps/api/tests/test_artifacts.py`；`apps/web/app/artifacts/page-content.tsx` |
| Evaluations 工作台 | `GET /api/evaluations/runs`、`GET /api/evaluations/runs/{run_id}`、`GET /api/evaluations/runs/{run_id}/failed-samples` 已实现摘要读取 | `apps/api/app/domains/evaluations/`；`apps/api/tests/test_evaluations.py`；`apps/web/app/evaluations/page.tsx` |
| 发布治理 | 已完成本地收口：`.env.example` 默认项、Alembic 干净临时库、OpenAPI diff 解释、运维手册与最终报告均已验证 | `.env.example`；`docs/operations/alembic-validation.md`；`.codex/verification-report.md`；`pnpm verify && pnpm e2e` |

## 3. 状态区分

### 已完成最小执行 / 摘要

- Workflow-to-API：最小真表 adapter/client 已有，runtime `ModelRunPayload` 可写 API `ModelRun` 真表；调用方仍必须传入已持久化 `JobRun.id:int`。
- Studio：作品列表、章节目标、Scene Packet、Judge、Repair、批准摘要和恢复摘要读取已实现；Web Server Action 已可提交 `POST /api/studio/approve`，把 ScenePacket 或 RepairPatch 写回章节、场景与 continuity，并通过查询参数展示结果摘要。
- Retrieval：资料源列表、刷新任务、搜索请求和命中预览已完成 API/Web 单点读取，保留 `evidence_href` 锚点。
- Runs：API 仍提供 JobRun/checkpoint/ModelRun runtime diagnostics 读取；Web 旧 `/runs` 深链进入 IDE runs 面板，面板展示 BookRun/checkpoint/SSE 事件与 ModelRun 追溯链接。
- Artifacts：列表、详情和 `payload_preview` 下载摘要已实现。
- Evaluations：运行列表、详情趋势摘要、失败样例和 Studio 反馈入口摘要已实现。
- 发布治理：`.env.example` 默认项、Alembic 干净临时库、OpenAPI diff 解释、`docs/operations/` 手册和 `.codex/verification-report.md` 已完成本地收口。

### 剩余交互 / 详情增强

- Studio 生成、Judge、Repair 的完整交互按钮流和失败续跑执行流；批准写回 Server Action 已完成最小交互闭环。
- Runs Web 已展示 retry 执行契约；当前仅说明可创建恢复任务和不可重试原因，不提供点击按钮或立即续跑 workflow。
- Retrieval 独立证据跳转路由、重排状态详情和跨页面证据路由。
- Artifacts 上传资料执行、工作流快照详情、评测报告详情、对象存储签名 URL。
- Evaluations 评测集管理、复杂趋势图、报告下载、失败样例自动反馈执行。
- 发布治理最终验证已由主线程执行：`pnpm verify && pnpm e2e` 退出码 0；详细证据见 `.codex/verification-report.md`。

### 完全不存在

- 新微服务形态的 workflow-to-api 桥接。
- 完整交互式 Studio 编排器、完整检索工作台、运行回放/time-travel UI、完整制品管理工作台和评测复盘工作台。
- 对象存储签名 URL 下载、复杂图表系统、自动把失败样例写回 Studio 的反馈执行。

### 竞品启发

- Letta/MemGPT、Novelcrafter、SillyTavern 只作为记忆分层、连续创作步骤和证据追溯参考。
- LangGraph checkpoint/store/business table 分层只作为 Workflow State 引用化边界参考。
- 当前未引入新 Agent 框架、微服务或大型架构模块。

## 4. 当前验证入口

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run pytest tests/test_model_runs.py -q
uv run pytest tests/test_studio_book_list_api.py -q
uv run pytest tests/test_retrieval_workbench_api.py -q
uv run pytest tests/test_artifacts.py tests/test_evaluations.py -q
uv run python -m compileall app tests/test_studio_book_list_api.py

cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow
uv run pytest tests/test_runtime_runner.py tests/test_generation_state_references.py -q
uv run python -m compileall storyforge_workflow tests

cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm --filter @storyforge/web test
pnpm --filter @storyforge/web exec tsc --noEmit
git diff --check
```

## 5. 环境限制

- 在线 `uv run alembic upgrade head` 依赖本地 PostgreSQL `127.0.0.1:55432`；Alembic 干净临时库验证已纳入发布门禁，但最终执行由主线程负责。
- Docker/PostgreSQL 不可用时，只能声明 head 检查与离线 SQL 生成通过，不能声明在线升级通过。
- 系统 `python -m pytest` 可能缺少 pytest；workflow 验证优先使用 `uv run pytest`。
- 本轮治理文档子代理不修改 `.codex/operations-log.md` 和 `.codex/verification-report.md`，因此不会把长流水复制到当前入口。

## 6. 后续建议

- 审计阅读顺序：优先读取 `.codex/current-phase.md`，再读取 `TODO.md`、`.codex/context-summary-end-to-end-closure.md`、`.codex/verification-report.md` 和相关 `docs/operations/*`。
- Phase 6 后续只能推进明确批准的交互或详情增强；不要再把最小摘要读取误判为完整工作台。
- Runs retry 需要区分“创建恢复任务”和“立即续跑 workflow”；文档、页面和测试中均不得混用。
- Artifacts download 需要继续标明 `payload_preview`，直到对象存储签名 URL 真正接入。
- Evaluations 当前仅提供趋势摘要、失败样例和反馈入口摘要；复杂图表和自动反馈执行另行规划。
- 发布治理最终验证由主线程执行，治理文档只保持事实入口一致。
