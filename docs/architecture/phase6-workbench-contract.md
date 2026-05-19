# Phase 6 工作台最小契约

## 目标

本契约记录当前 Phase 6 页面入口与后续真实数据联动边界。当前只做模块化单体内的工作台入口收口，不新增大型前端架构、不拆微服务、不实现新的跨服务 client。

Phase 6 的目标是把 StoryForge 从能力展示页推进为可连续操作的创作工作台：Studio、Retrieval、Runs、Artifacts、Evaluations 五个页面需要能承接 Phase 5 的记忆、检索、上下文、ModelRun 与制品证据链。

## 代码事实源

- 文档负责定义业务边界、状态区分和验收方式。
- `apps/web/lib/phase6-data-sources.ts` 中的 `phase6DataSources` 是页面真实联动前置的代码事实源，五个页面必须从它读取数据源契约。
- 后续真实 API 读取应优先使用 registry 中的 `page`、`contractSection`、`nextAction` 选择单页面单数据源 spike，避免文档、页面和实现再次分叉。

## 已实现的最小入口

- Studio 作品列表 API 已完成后端最小契约：`GET /api/studio/books` 返回作品 ID、标题和最近章节编号，并支持 `workspace_id:int` 过滤；Web Studio 已通过页面级 `fetch` 单点读取该端点。
- Studio 章节目标 API 已完成后端最小契约：`GET /api/studio/chapter-goals` 使用 `book_id:int` 与 `target_ordinal:int` 读取目标章节、上一章摘要和连续性约束；Web Studio 已在作品列表之后单点读取该端点。
- Studio Scene Packet API 已完成后端最小契约：`GET /api/studio/scene-packets` 使用 `book_id:int` 与 `target_ordinal:int` 读取已组装 Scene Packet 的 ID、证据数量、`compiled_context_id` 和上下文预算摘要；Web Studio 已在章节目标之后单点读取该端点。
- Studio Judge 评审 API 已完成后端最小契约：`GET /api/studio/judge-reviews` 使用 `scene_packet_id:int` 读取已持久化 JudgeIssue 的状态、分数和关键问题；Web Studio 已在 Scene Packet 之后单点读取该端点。

| 页面 | 已有入口 |
| --- | --- |
| Studio | 作品选择、章节目标、Scene Packet、Judge 评审、Repair 修订、批准回写、失败恢复 |
| Retrieval | 资料库、资料来源类型、Embedding 刷新任务、搜索请求、命中预览、证据跳转、检索命中与重排、Scene Packet 检索证据 |
| Runs | 模型运行日志、Provider 解析结果、Prompt Pack 来源、Checkpoint 状态、失败重试、ModelRun adapter 契约、任务恢复入口 |
| Artifacts | 导出物、导出下载、上传资料、资料入库状态、工作流快照、快照追溯、评测报告、报告追溯 |
| Evaluations | 评测集、运行记录、指标趋势、失败样例、一致性错误率、修复成功率、用户接受率、未回收 open loop |

## 已有契约但未联通

- Studio 作品列表 API、章节目标 API、Scene Packet API 与 Judge 评审 API 的后端最小契约和 Web 单点读取已实现；Repair、批准回写和失败恢复 API 数据仍未联通。
- Retrieval 还未接真实资料源、refresh run、search request、hit preview 和 evidence link 跳转。
- Runs 还未接真实 JobRun、checkpoint、ModelRun、失败重试和 adapter 执行状态。
- Artifacts 还未接真实导出文件、上传资料、工作流快照和评测报告对象。
- Evaluations 还未接真实评测集、运行记录、指标趋势和失败样例。

## 真实数据联动优先级

1. Studio 优先接入作品、章节、Scene Packet、Judge、Repair 和批准回写数据，形成单章创作闭环。
2. Retrieval 优先接入资料源、刷新任务、搜索请求、命中预览和证据跳转，承接 Phase 5 检索证据链。
3. Runs 优先接入 JobRun、checkpoint、ModelRun 和失败重试状态，承接 workflow-to-api adapter 契约。
4. Artifacts 优先接入导出物、上传资料、工作流快照和评测报告对象，支撑证据追溯。
5. Evaluations 优先接入评测集、运行记录、指标趋势和失败样例，支撑质量闭环。

## 最小 API 数据源契约

### Studio 数据源契约

首个真实读取 spike 固定为 `phase6FirstDataSourceSpike` 指向的 `作品列表 API`。本 spike 只允许验证当前工作区或默认项目上下文到作品 ID、标题、最近章节编号的读取闭环；作品列表 API 读取失败时必须保留契约占位并展示可重试错误摘要，不得扩展成全量 client 或一次性联通五页。

| 数据源 | 最小输入 | 最小输出 | 当前状态 |
| --- | --- | --- | --- |
| 作品列表 API | 当前工作区或默认项目上下文，可选 `workspace_id:int` | 作品 ID、标题、最近章节编号 | API 与 Web 单点读取已实现 |
| 章节目标 API | 作品 ID、目标章节编号 | 章节目标、上章摘要、连续性约束 | API 与 Web 单点读取已实现 |
| Scene Packet API | 作品 ID、章节 ID、场景目标 | `scene_packet_id`、证据链接、上下文预算摘要 | API 与 Web 单点读取已实现 |
| Judge 评审 API | 草稿或 `draft_artifact_id`、`scene_packet_id` | 问题列表、严重级别、位置和建议 | API 与 Web 单点读取已实现 |
| Repair 修订 API | Judge 问题、草稿引用、修订策略 | 修订文本、差异摘要、采纳建议 | 已有契约但未联通 |
| 批准回写 API | 修订结果、审批决策、章节 ID | 已批准章节版本、回写状态、后续任务引用 | 已有契约但未联通 |
| 失败恢复 API | `job_run_id`、checkpoint 引用、失败节点 | 可恢复步骤、错误摘要、重试入口状态 | 已有契约但未联通 |

### Retrieval 数据源契约

| 数据源 | 最小输入 | 最小输出 | 当前状态 |
| --- | --- | --- | --- |
| 资料源列表 API | 作品 ID、来源类型过滤 | 用户上传、章节快照、系列记忆、Prompt Pack 来源列表 | 已有契约但未联通 |
| 刷新任务 API | 资料源 ID、刷新范围、embedding provider | refresh run ID、chunk 引用、provider 元数据、刷新状态 | 已有契约但未联通 |
| 搜索请求 API | 查询文本、作品 ID、topK、reranker 开关 | search request ID、命中列表、score、rerank 顺序 | 已有契约但未联通 |
| 命中预览 API | hit ID 或 chunk 引用 | 片段摘要、来源标题、预算 token、关联章节 | 已有契约但未联通 |
| 证据跳转 API | evidence link、source_ref、chunk_ref | 可跳转目标、锚点摘要、不可用原因 | 已有契约但未联通 |
| 重排状态 API | search request ID、reranker provider | rerank provider、model、score 和降级状态 | 已有契约但未联通 |

### Runs 数据源契约

| 数据源 | 最小输入 | 最小输出 | 当前状态 |
| --- | --- | --- | --- |
| JobRun 状态 API | `job_run_id` 或作品/章节过滤 | 当前节点、运行状态、错误摘要、恢复提示 | 已有契约但未联通 |
| Checkpoint 引用 API | `job_run_id`、checkpoint ID | `scene_packet_id`、`compiled_context_id`、`model_run_id`、恢复节点 | 已有契约但未联通 |
| ModelRun 日志 API | `job_run_id`、provider 或状态过滤 | provider、model、token、latency、错误消息和 payload 摘要 | 已有契约但未联通 |
| 失败重试 API | `job_run_id`、失败节点、checkpoint 引用 | 重试资格、重试任务引用、不可重试原因 | 已有契约但未联通 |

### Artifacts 数据源契约

| 数据源 | 最小输入 | 最小输出 | 当前状态 |
| --- | --- | --- | --- |
| 导出物 API | 作品 ID、章节 ID、导出类型 | artifact ID、文件名、版本、下载状态 | 已有契约但未联通 |
| 上传资料 API | 作品 ID、资料来源类型 | 上传对象、入库状态、检索刷新引用 | 已有契约但未联通 |
| 工作流快照 API | `job_run_id`、checkpoint 引用 | 快照摘要、关联节点、上下文引用和恢复状态 | 已有契约但未联通 |
| 评测报告 API | evaluation run ID、artifact ID | 报告摘要、指标、失败样例引用 | 已有契约但未联通 |

### Evaluations 数据源契约

| 数据源 | 最小输入 | 最小输出 | 当前状态 |
| --- | --- | --- | --- |
| 评测集 API | 作品 ID、评测类型 | eval set ID、样例数量、覆盖范围 | 已有契约但未联通 |
| 评测运行 API | eval set ID、模型或版本过滤 | run ID、状态、开始/结束时间、关联制品 | 已有契约但未联通 |
| 指标趋势 API | 指标名称、时间范围、作品 ID | 趋势点、均值、异常点摘要 | 已有契约但未联通 |
| 失败样例 API | eval run ID、失败类别 | 样例 ID、失败原因、关联章节和修复建议 | 已有契约但未联通 |

## 完全不存在

- 完整交互式 Studio 编排器。
- 完整检索请求表单、命中详情弹层和证据跳转路由。
- 真实失败重试按钮、重试执行流和运行回放 UI。
- 制品下载签名 URL、快照 diff、评测报告详情页。
- 评测实验创建、趋势图和失败样例复盘工作台。

## 竞品启发边界

- 可参考 Novelcrafter/Sudowrite 的连续创作工作台和证据面板，但当前仅采纳“连续步骤入口”和“证据可追溯”两类产品边界。
- 不引入新的 Agent 框架、前端状态管理平台或微服务拆分。

## 验收命令

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run pytest tests/test_studio_book_list_api.py -q
uv run python -m compileall app tests/test_studio_book_list_api.py

cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm --filter @storyforge/web test
pnpm --filter @storyforge/web exec tsc --noEmit
```

通过条件：Studio 作品列表 API、章节目标 API、Scene Packet API 与 Judge 评审 API 最小契约测试通过，API 代码可编译；Web Studio 单点读取边界、空列表态、缺失包或缺失评审错误态和可重试错误摘要受中文契约保护；TypeScript 编译无错误。
