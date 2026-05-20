# StoryForge 当前 Phase 摘要

更新时间：2026-05-20 01:11:08 +08:00

## 1. 当前执行裁决

- 当前总计划事实源：`docs/superpowers/plans/2026-05-17-storyforge-master-replan.md` 第 11 节。
- 当前 TODO 事实源：`TODO.md` 第 9、10、11、20、21、22、23、24、25 节的推进记录。
- 当前阶段重点：Phase 5/6/7 后续交付闭环，禁止回到 Phase 1~4 重复实现。
- 第 11.9 处理方式：先建立当前摘要索引，不立刻归档历史 `.codex` 文件，避免把归档变成 Phase 5 P0 阻塞。

## 2. 第 11 节风险状态

| 条目 | 当前状态 | 证据 |
| --- | --- | --- |
| 11.5 `story_memory` 最小持久化 | 已实现最小闭环 | `TODO.md` 第 9 节；`apps/api/app/domains/story_memory/`；`tests/test_story_memory_persistence.py` |
| 11.6 `compiled_contexts` 持久化 | 已实现最小闭环 | `TODO.md` 第 10 节；`apps/api/app/domains/context_compiler/models.py`；`tests/test_context_compiler_persistence.py` |
| 11.7 Workflow State 引用化 | 已实现最小闭环 | `TODO.md` 第 11 节；`apps/workflow/storyforge_workflow/state.py`；`tests/test_generation_state_references.py` |
| 11.8 最小仲裁闭环 | 已实现最小闭环 | `TODO.md` 第 9 节；`apply_arbitration_decision()` 只处理 `auto_merge` 的 memory create |
| 11.9 `.codex` 审计噪音 | 本轮开始治理 | 本文件作为当前 Phase 索引；历史归档暂缓 |
| Phase 5 Workflow/ModelRun 调用链 | 已完成前置契约，真表 adapter 待做 | `ModelRunPayload.to_api_payload(api_job_run_id:int)`；`tests/test_runtime_runner.py`；API `tests/test_model_runs.py` |
| Phase 6 工作台最小入口 | 已完成静态入口与部分真实联动；Artifacts/Evaluations 仍只有契约入口 | Studio、Retrieval、Runs、Artifacts、Evaluations 页面与 `tests/phase1-navigation.test.tsx` |
| Phase 6 Studio 作品列表 API | API 与 Web 单点读取已实现 | `apps/api/app/domains/studio/`；`apps/api/tests/test_studio_book_list_api.py`；`apps/web/app/studio/page.tsx`；`GET /api/studio/books` |
| Phase 6 Studio 章节目标 API | API 与 Web 单点读取已实现 | `apps/api/app/domains/studio/`；`apps/api/tests/test_studio_book_list_api.py`；`apps/web/app/studio/page.tsx`；`GET /api/studio/chapter-goals` |
| Phase 6 Studio Scene Packet API | API 与 Web 单点读取已实现 | `apps/api/app/domains/studio/`；`apps/api/tests/test_studio_book_list_api.py`；`apps/web/app/studio/page.tsx`；`GET /api/studio/scene-packets` |
| Phase 6 Studio Judge 评审 API | API 与 Web 单点读取已实现 | `apps/api/app/domains/studio/`；`apps/api/app/domains/judge/`；`apps/api/tests/test_studio_book_list_api.py`；`apps/web/app/studio/page.tsx`；`GET /api/studio/judge-reviews` |
| Phase 6 Studio Repair 修订 API | API 与 Web 单点读取已实现，后续 Studio 数据源从批准回写继续 | `apps/api/app/domains/studio/`；`apps/api/app/domains/repair/`；`apps/api/tests/test_studio_book_list_api.py`；`apps/web/app/studio/page.tsx`；`GET /api/studio/repair-patches` |
| Phase 6 Retrieval 工作台 API | 资料源、刷新任务、搜索与命中预览 API/Web 单点读取已实现；独立证据跳转和重排状态仍未联通 | `apps/api/app/domains/retrieval/`；`apps/api/tests/test_retrieval_workbench_api.py`；`apps/web/app/retrieval/page.tsx` |
| Phase 6 Runs JobRun API | JobRun/checkpoint/ModelRun 摘要后端最小契约已实现；Runs 页面读取与失败重试仍未联通 | `apps/api/app/domains/model_runs/`；`apps/api/tests/test_model_runs.py`；`apps/web/app/runs/page.tsx` |

## 3. 状态区分

### 已实现

- `memory_atoms` 最小持久化、CRUD、章节有效事实查询、`auto_merge` 写入。
- `compiled_contexts` 最小持久化、预算/注入/裁剪摘要保存、Scene Packet 反查。
- Workflow State 最小引用化、`checkpoint_reference_state()`、运行时 checkpoint 保存边界。
- Workflow runtime ModelRun 内存记录、成功/失败 sink、失败 checkpoint、`to_api_payload(api_job_run_id:int)` 类型安全映射。
- Workflow-to-API ModelRun adapter 契约文档：`docs/architecture/workflow-modelrun-adapter-contract.md`。
- Phase 6 工作台最小入口：Studio 创作闭环、Retrieval 证据入口、Runs checkpoint/失败重试、Artifacts 制品追溯、Evaluations 失败样例。
- Studio 作品列表 API 最小契约与 Web 单点读取：`GET /api/studio/books` 返回 `id:int`、`title:str`、`recent_chapter_ordinal:int | None`，支持 `workspace_id:int` 过滤；Web Studio 页面显示成功态、空列表态和可重试错误摘要。
- Studio 章节目标 API 最小契约与 Web 单点读取：`GET /api/studio/chapter-goals` 使用 `book_id:int` 与 `target_ordinal:int` 读取目标章节、上章摘要和连续性约束；缺少目标章节时返回 404 供页面展示可重试错误摘要。
- Studio Scene Packet API 最小契约与 Web 单点读取：`GET /api/studio/scene-packets` 使用 `book_id:int` 与 `target_ordinal:int` 读取已组装 Scene Packet 的 ID、证据数量、`compiled_context_id` 和上下文预算摘要；缺少包时返回 404 供页面展示可重试错误摘要。
- Studio Judge 评审 API 最小契约与 Web 单点读取：`GET /api/studio/judge-reviews` 使用 `scene_packet_id:int` 读取已持久化 JudgeIssue 的状态、分数、问题数量和关键问题；缺少评审时返回 404 供页面展示可重试错误摘要。
- Studio Repair 修订 API 最小契约与 Web 单点读取：`GET /api/studio/repair-patches` 使用 `scene_packet_id:int` 只读已生成 RepairPatch 的修订文本、差异摘要、采纳建议和重评状态；缺少补丁时返回 404 供页面展示可重试错误摘要，且不触发新修复生成。
- Retrieval 工作台资料源、刷新任务、搜索请求和命中预览最小契约与 Web 单点读取：`GET /api/retrieval/workbench/sources`、`GET /api/retrieval/workbench/refresh-runs`、`POST /api/retrieval/workbench/search`；搜索结果提供 `evidence_href` 锚点，独立证据跳转路由仍未联通。
- Runs JobRun 状态 API 后端最小契约：`GET /api/model-runs/job-runs/{job_run_id}` 返回 JobRun 状态、checkpoint 摘要和 ModelRun 摘要；Runs 页面尚未读取该端点。

### 已有契约但未持久化

- `TimelineEvent`、`Progression`、`MemoryConflict`、`AgentProposal`、`ArbitrationDecision` 的独立持久化表。
- Context Inspector API 查询契约、ModelRun 与 `compiled_context_id` 的正式数据库关联。
- 具体 workflow-to-api ModelRun 真表 adapter/client；调用方必须传入已持久化 `JobRun.id` 正整数，不得把 workflow runtime 字符串 ID 当作数据库 ID。
- Phase 6 页面真实数据联动：Studio Web 已单点读取作品列表 API、章节目标 API、Scene Packet API、Judge 评审 API 与 Repair 修订 API；Retrieval Web 已单点读取资料源列表、刷新任务、搜索请求和命中预览；Runs 已有 JobRun/checkpoint/ModelRun 后端最小契约但页面未读取；批准回写、失败恢复、独立证据跳转、重排状态、失败重试、制品下载和评测趋势仍待接入 API 数据源。
- 真实 PostgresSaver、跨进程 workflow state 查询和数据库级 workflow checkpoint 关联。

### 完全不存在

- Context Inspector UI、跨版本上下文 diff API、完整 workflow replay/time-travel UI。
- 完整多 Agent 仲裁系统、世界观检测 Agent、剧情推进 Agent、复杂人工审核工作台。
- 真实 LLM 恢复压测与真实 PostgresSaver 端到端环境验证。
- 完整交互式 Studio、检索工作台、运行重试 UI、制品下载 UI、评测实验 UI。

### 竞品启发

- Letta/MemGPT、Novelcrafter、SillyTavern 只作为记忆分层、Progression、上下文注入与预算边界参考。
- LangGraph checkpoint/store/business table 分层只作为 Workflow State 引用化边界参考。
- 当前未引入新 Agent 框架、微服务或大型架构模块。

## 4. 当前验证入口

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run pytest tests/test_story_memory_contract.py tests/test_story_memory_persistence.py -q
uv run pytest tests/test_context_compiler.py tests/test_context_compiler_persistence.py tests/test_scene_packet_context_compiler.py -q
uv run alembic heads
uv run alembic upgrade head --sql

cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow
uv run pytest tests/test_generation_graph.py tests/test_runtime_runner.py tests/test_generation_state_references.py -q
uv run python -m compileall storyforge_workflow tests

cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run pytest tests/test_model_runs.py -q
uv run pytest tests/test_studio_book_list_api.py -q
uv run pytest tests/test_retrieval_workbench_api.py -q
uv run python -m compileall app tests/test_studio_book_list_api.py

cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm --filter @storyforge/web test
pnpm --filter @storyforge/web exec tsc --noEmit
```

## 5. 环境限制

- 在线 `uv run alembic upgrade head` 仍依赖本地 PostgreSQL `127.0.0.1:55432`。
- Docker/PostgreSQL 不可用时，只能声明 head 检查与离线 SQL 生成通过，不能声明在线升级通过。
- 系统 `python -m pytest` 可能缺少 pytest；workflow 验证优先使用 `uv run pytest`。

## 6. 后续建议

- 短期：继续保持本文件为当前 Phase 入口，减少后续代理从长流水日志中恢复状态的成本。
- Phase 6 下一步优先级：不要继续堆静态入口；Studio 作品列表 API、章节目标 API、Scene Packet API、Judge 评审 API 与 Repair 修订 API 后端最小契约和 Web 单点读取已实现，后续优先在同一 Studio 页面继续按 `docs/architecture/phase6-workbench-contract.md` 的最小 API 数据源契约推进批准回写单一数据源；再推进失败恢复，Retrieval 资料源/刷新/搜索/命中/证据跳转，Runs JobRun/checkpoint/ModelRun/失败重试，Artifacts 导出物/上传资料/快照/评测报告，Evaluations 评测集/运行记录/趋势/失败样例。
- Phase 6 真实 API spike 边界：只能从 `apps/web/lib/phase6-data-sources.ts` 的 `phase6DataSources` 选择单页面单数据源；禁止全量 client，不一次性联通五页，不新增大型状态管理平台，不把静态契约扩展成新架构。
- Studio 作品列表 API 可复现读取验证结果：已定位现有模型、API router/service 和 int 主键；已实现后端 `/api/studio/books` 与 Web 单点读取；已覆盖成功态、空列表态和作品列表 API 读取失败态边界。
- 状态边界：已实现的是静态入口、README 索引、Phase 6 契约文档、最小 API 数据源契约、`phase6DataSources` typed registry、`page/contractSection/nextAction` 追踪字段、`phase6FirstDataSourceSpike` 首个起点、中文契约测试、Studio 作品列表 API、章节目标 API、Scene Packet API、Judge 评审 API 与 Repair 修订 API 后端最小契约和 Web 单点读取、Retrieval 资料源/刷新任务/搜索请求/命中预览 API 与 Web 单点读取、Runs JobRun/checkpoint/ModelRun 后端最小契约；已有契约但未联通的是 Studio 批准回写/失败恢复、Retrieval 独立证据跳转/重排状态、Runs 页面读取/失败重试、Artifacts 与 Evaluations 真实数据读取；完全不存在的是全量 HTTP client、缓存、完整交互式工作台与执行流；竞品启发只保留连续步骤和证据追溯，不作为新增架构理由。
- 当前已进入 Phase 7 发布与治理收口：先收口 `.env.example`、OpenAPI、Alembic、启动手册、发布清单、故障手册和审计状态，再做任何新的治理扩展。
- Phase 7 期间只允许做发布治理校准，不新增产品功能，不继续扩 Studio/Retrieval/Runs/Artifacts/Evaluations 数据源。
