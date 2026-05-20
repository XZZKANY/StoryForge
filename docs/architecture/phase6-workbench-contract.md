# Phase 6 工作台最小契约

## 目标

本契约记录当前 Phase 6 页面入口、真实摘要读取、最小执行能力与后续边界。当前仍保持模块化单体，不新增大型前端架构、不拆微服务、不把治理文档写成新运行时能力。

Phase 6 的目标是把 StoryForge 从能力展示页推进为可连续操作的创作工作台：Studio、Retrieval、Runs、Artifacts、Evaluations 五个页面需要能承接 Phase 5 的记忆、检索、上下文、ModelRun 与制品证据链。

## 代码事实源

- 文档负责定义业务边界、状态区分和验收方式。
- `apps/web/lib/phase6-data-sources.ts` 中的 `phase6DataSources` 是页面数据源入口 registry，五个页面仍从它渲染数据源契约。
- 本轮治理事实以 API/Web 实际行为、用户事实基线、本契约矩阵和 `.codex/current-phase.md` 为准；registry 若未拆分到最新端点粒度，应由对应实现子代理后续校准，不作为完整交互完成证明。
- 后续真实 API 读取仍应优先使用 registry 中的 `page`、`contractSection`、`nextAction` 选择单页面单数据源 spike，避免文档、页面和实现再次分叉。

## 已实现的最小入口

- Workflow-to-API 已有最小真表 adapter/client：workflow runtime 可把 `ModelRunPayload` 通过 adapter 写入 API `ModelRun` 真表；这是模块化单体内的交接层，不是新微服务，也不是跨进程 HTTP client。
- Studio 作品列表、章节目标、Scene Packet、Judge 评审与 Repair 修订 API 已完成后端最小契约，并由 Web Studio 按页面级 `fetch` 单点读取。
- Studio 批准摘要与恢复摘要已完成读取：`GET /api/studio/approval-summary` 返回可批准对象、目标章节、回写状态和不可批准原因；`GET /api/studio/recovery-summary` 返回失败节点、checkpoint、可恢复步骤和不可恢复原因。
- Studio 批准写回已具备真实执行端点：`POST /api/studio/approve` 可把 ScenePacket 或 RepairPatch 写回章节、场景与 continuity 相关记录；Web 当前只展示执行入口契约和可执行状态，不是完整交互式按钮流。
- Retrieval 资料源列表、刷新任务与搜索请求已完成工作台 API 最小契约：`GET /api/retrieval/workbench/sources`、`GET /api/retrieval/workbench/refresh-runs`、`POST /api/retrieval/workbench/search`；Web Retrieval 已按资料源 → 刷新任务 → 搜索命中预览顺序单点读取，搜索结果包含 `evidence_href` 锚点。
- Runs JobRun 状态 API 已完成后端最小契约：`GET /api/model-runs/job-runs/{job_run_id}` 返回 JobRun 状态、progress、checkpoint 摘要和 ModelRun 摘要；`POST /api/model-runs/job-runs/{job_run_id}/retry` 的语义是基于失败 checkpoint 创建恢复任务，不会立即续跑 workflow。
- Artifacts 已完成列表、详情和下载摘要 API：`GET /api/artifacts`、`GET /api/artifacts/{artifact_id}`、`GET /api/artifacts/{artifact_id}/download`；当前 download 返回 `payload_preview` 下载摘要，不是对象存储签名 URL。
- Evaluations 已完成运行列表、运行详情和失败样例 API：`GET /api/evaluations/runs`、`GET /api/evaluations/runs/{run_id}`、`GET /api/evaluations/runs/{run_id}/failed-samples`；当前输出是趋势摘要、失败样例和 Studio 反馈入口摘要，不是复杂图表或自动反馈执行。

| 页面 | 已有入口 |
| --- | --- |
| Studio | 作品选择、章节目标、Scene Packet、Judge 评审、Repair 修订、批准摘要、真实批准写回端点、失败恢复摘要 |
| Retrieval | 资料库、资料来源类型、Embedding 刷新任务、搜索请求、命中预览、证据跳转锚点、检索命中与重排契约、Scene Packet 检索证据 |
| Runs | 模型运行日志、Provider 解析结果、Prompt Pack 来源、Checkpoint 状态、失败重试恢复任务、ModelRun adapter 契约、任务恢复入口 |
| Artifacts | 导出物列表、制品详情、payload 下载摘要、上传资料契约、资料入库状态契约、工作流快照契约、评测报告契约 |
| Evaluations | 评测运行列表、运行详情摘要、指标趋势摘要、失败样例、Studio 反馈入口、一致性错误率、修复成功率、用户接受率、未回收 open loop |

## 闭环事实矩阵

| 方向 | 已完成最小执行 / 摘要 | 剩余交互 / 详情增强 | 明确不代表 |
| --- | --- | --- | --- |
| Workflow-to-API | 最小真表 adapter/client 已存在，runtime `ModelRunPayload` 可写入 API 真表；调用方仍需传入已持久化 `JobRun.id:int`。 | HTTP 传输、真实 provider 端到端、跨进程恢复压测仍是后续能力。 | 不是新微服务；不是把 workflow runtime 字符串 ID 当数据库 ID。 |
| Studio | 七个读取摘要已串起；`POST /api/studio/approve` 已实现真实批准写回，可写回章节、场景和 continuity 记录。 | Web 仍是执行入口契约展示，交互式按钮流、Server Action 或 Client Component 提交流和失败续跑执行流仍待增强。 | 不是完整交互式 Studio 编排器；不是批准后自动全流程续跑。 |
| Retrieval | 资料源、刷新任务、搜索和命中预览 API/Web 单点读取已实现，搜索结果保留 `evidence_href`。 | 独立证据跳转路由、重排状态详情、不可用原因和跨页面证据路由仍未联通。 | 不是完整检索请求表单、命中详情弹层或检索工作台执行流。 |
| Runs | `GET /api/model-runs/job-runs/{job_run_id}` 真实读取；retry API 可创建 queued 恢复任务；Web 已展示执行契约。 | 交互式按钮流、Server Action 提交和 workflow 立即续跑仍待增强。 | retry 不是立即续跑 workflow；不是运行回放 UI 或完整 time-travel UI。 |
| Artifacts | 列表、详情和 download 摘要 API 已实现；download 当前为 `payload_preview`，页面可展示首个制品详情和 payload 预览。 | 上传资料执行、工作流快照详情、评测报告详情和对象存储签名 URL 仍待增强。 | 不是对象存储签名 URL 下载；不是完整制品管理工作台。 |
| Evaluations | 运行列表、运行详情和失败样例 API 已实现；当前是趋势摘要、失败样例和 Studio 反馈入口摘要。 | 评测集管理、复杂趋势图、报告下载、自动反馈执行和复盘工作台仍待增强。 | 不是复杂图表系统；不是自动把失败样例写回 Studio。 |
| 发布治理 | Alembic 干净临时库验证已纳入发布门禁。 | 本轮最终发布验证由主线程执行并留痕；治理文档子代理不替代主线程验收。 | 不是已经完成本轮最终发布验收。 |

## 剩余边界清单

- Studio：页面仍展示执行入口契约，不提供完整交互式批准按钮流；失败恢复仍是摘要，不是续跑执行。
- Runs：retry API 创建恢复任务，不直接调用 workflow runtime；Web 已展示执行契约，不伪装点击按钮。
- Artifacts：download 是 `payload_preview` 摘要，不是对象存储签名 URL；上传资料、快照详情和报告详情仍未闭环。
- Evaluations：趋势和失败样例是摘要读取，不是复杂图表，也不是自动反馈执行。
- 发布治理：Alembic 干净临时库验证已经列入门禁，但本轮最终验证由主线程执行。

## 真实数据联动优先级

1. Studio 优先保持作品、章节、Scene Packet、Judge、Repair、批准写回和失败恢复事实链准确，不把执行入口契约夸大为完整交互按钮流。
2. Retrieval 优先补独立证据跳转、重排状态和不可用原因，承接 Phase 5 检索证据链。
3. Runs 优先区分 JobRun 读取、retry 恢复任务创建和 workflow 立即续跑三类语义。
4. Artifacts 优先补对象存储签名 URL、上传资料执行、工作流快照详情和评测报告详情。
5. Evaluations 优先补评测集管理、复杂趋势图、报告下载和失败样例自动反馈执行。

## 最小 API 数据源契约

### Studio 数据源契约

Studio 已从首个作品列表 spike 扩展到单章创作闭环的最小读取与批准写回执行。当前仍不引入全量 Web API client，也不把页面入口升级为完整交互式编排器。

| 数据源 | 最小输入 | 最小输出 | 当前状态 |
| --- | --- | --- | --- |
| 作品列表 API | 当前工作区或默认项目上下文，可选 `workspace_id:int` | 作品 ID、标题、最近章节编号 | API 与 Web 单点读取已实现 |
| 章节目标 API | 作品 ID、目标章节编号 | 章节目标、上章摘要、连续性约束 | API 与 Web 单点读取已实现 |
| Scene Packet API | 作品 ID、章节 ID、场景目标 | `scene_packet_id`、证据链接、上下文预算摘要 | API 与 Web 单点读取已实现 |
| Judge 评审 API | 草稿或 `draft_artifact_id`、`scene_packet_id` | 问题列表、严重级别、位置和建议 | API 与 Web 单点读取已实现 |
| Repair 修订 API | Judge 问题、草稿引用、修订策略 | 修订文本、差异摘要、采纳建议 | API 与 Web 单点读取已实现 |
| 批准回写 API | `scene_packet_id` 或 `repair_patch_id` | 可批准对象、目标章节、回写状态、不可批准原因 | 摘要读取已实现，真实写回由 `POST /api/studio/approve` 承接 |
| 批准执行 API | ScenePacket 或 RepairPatch 批准请求 | 章节、场景、continuity 回写结果 | `POST /api/studio/approve` 真实写回已实现；Web 仅展示执行入口契约 |
| 失败恢复 API | `job_run_id`、checkpoint 引用、失败节点 | 可恢复步骤、错误摘要、重试入口状态 | API 与 Web 摘要读取已实现；续跑执行未实现 |

### Retrieval 数据源契约

| 数据源 | 最小输入 | 最小输出 | 当前状态 |
| --- | --- | --- | --- |
| 资料源列表 API | 作品 ID、来源类型过滤 | 用户上传、章节快照、系列记忆、Prompt Pack 来源列表 | API 与 Web 单点读取已实现 |
| 刷新任务 API | 资料源 ID、刷新范围、embedding provider | refresh run ID、chunk 引用、provider 元数据、刷新状态 | API 与 Web 单点读取已实现 |
| 搜索请求 API | 查询文本、作品 ID、topK、reranker 开关 | search request ID、命中列表、score、rerank 顺序 | API 与 Web 单点读取已实现 |
| 命中预览 API | hit ID 或 chunk 引用 | 片段摘要、来源标题、预算 token、关联章节 | API 与 Web 单点读取已实现 |
| 证据跳转 API | evidence link、source_ref、chunk_ref | 可跳转目标、锚点摘要、不可用原因 | 已有契约但未联通 |
| 重排状态 API | search request ID、reranker provider | rerank provider、model、score 和降级状态 | 已有契约但未联通 |

### Runs 数据源契约

| 数据源 | 最小输入 | 最小输出 | 当前状态 |
| --- | --- | --- | --- |
| JobRun 状态 API | `job_run_id` 或作品/章节过滤 | 当前节点、运行状态、错误摘要、恢复提示 | API 与 Web 单点读取已实现 |
| Checkpoint 引用 API | `job_run_id`、checkpoint ID | `scene_packet_id`、`compiled_context_id`、`model_run_id`、恢复节点 | API 与 Web 单点读取已实现 |
| ModelRun 日志 API | `job_run_id`、provider 或状态过滤 | provider、model、token、latency、错误消息和 payload 摘要 | API 与 Web 单点读取已实现 |
| 失败重试 API | `job_run_id`、失败节点、checkpoint 引用 | 重试资格、恢复任务引用、不可重试原因 | API 创建恢复任务已实现；Web 展示执行契约已实现；不立即续跑 workflow |

### Artifacts 数据源契约

| 数据源 | 最小输入 | 最小输出 | 当前状态 |
| --- | --- | --- | --- |
| 导出物 API | 作品 ID、章节 ID、导出类型 | artifact ID、文件名、版本、下载状态 | `GET /api/artifacts` API 与 Web 单点读取已实现 |
| 制品详情 API | `artifact_id:int` | 制品类型、标题、版本、payload、关联 book/job | `GET /api/artifacts/{artifact_id}` API 与 Web 首个制品详情读取已实现 |
| 制品下载摘要 API | `artifact_id:int` | `download_mode: payload_preview`、内容预览、payload 摘要 | `GET /api/artifacts/{artifact_id}/download` 已实现；不是对象存储签名 URL |
| 上传资料 API | 作品 ID、资料来源类型 | 上传对象、入库状态、检索刷新引用 | 已有契约但未联通 |
| 工作流快照 API | `job_run_id`、checkpoint 引用 | 快照摘要、关联节点、上下文引用和恢复状态 | 已有契约但未联通 |
| 评测报告 API | evaluation run ID、artifact ID | 报告摘要、指标、失败样例引用 | 已有契约但未联通 |

### Evaluations 数据源契约

| 数据源 | 最小输入 | 最小输出 | 当前状态 |
| --- | --- | --- | --- |
| 评测集 API | 作品 ID、评测类型 | eval set ID、样例数量、覆盖范围 | 已有契约但未联通 |
| 评测运行 API | eval set ID、模型或版本过滤 | run ID、状态、开始/结束时间、关联制品 | `GET /api/evaluations/runs` API 与 Web 单点读取已实现 |
| 指标趋势 API | `run_id:int` | 趋势摘要点、失败样例数量、Studio 反馈入口 | `GET /api/evaluations/runs/{run_id}` API 与 Web 首个运行详情读取已实现；不是复杂图表 |
| 失败样例 API | eval run ID、失败类别 | 样例 ID、失败原因、关联章节和修复建议 | `GET /api/evaluations/runs/{run_id}/failed-samples` API 与 Web 摘要读取已实现；不是自动反馈执行 |

## 完全不存在

- 完整交互式 Studio 编排器和跨步骤草稿编辑器。
- 完整检索请求表单、命中详情弹层和独立证据跳转路由。
- 立即续跑 workflow 的失败重试执行流、运行回放 UI、完整 workflow replay/time-travel UI。
- 对象存储签名 URL 下载、上传资料执行流、快照 diff、评测报告详情页。
- 评测实验创建工作台、复杂趋势图和失败样例自动反馈执行。

## 竞品启发边界

- 可参考 Novelcrafter/Sudowrite 的连续创作工作台和证据面板，但当前仅采纳“连续步骤入口”和“证据可追溯”两类产品边界。
- 不引入新的 Agent 框架、前端状态管理平台或微服务拆分。

## 发布治理门禁

- Alembic 干净临时库验证已经纳入发布门禁；本轮最终验证由主线程执行并记录。
- 本治理文档子代理只验证文档 diff 格式和写入范围，不替代 API/Web/workflow 的最终发布验收。

## 验收命令

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run pytest tests/test_studio_book_list_api.py -q
uv run pytest tests/test_retrieval_workbench_api.py tests/test_model_runs.py -q
uv run pytest tests/test_artifacts.py tests/test_evaluations.py -q
uv run python -m compileall app tests/test_studio_book_list_api.py

cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm --filter @storyforge/web test
pnpm --filter @storyforge/web exec tsc --noEmit
pnpm run test:api
pnpm run test:workflow
git diff --check
```

通过条件：Studio 作品列表 API、章节目标 API、Scene Packet API、Judge 评审 API、Repair 修订 API、批准回写 API、批准执行 API 与失败恢复 API 最小契约测试通过；Retrieval 资料源、刷新任务、搜索命中预览测试通过；Runs JobRun/checkpoint/ModelRun 摘要与 retry 恢复任务测试通过；Artifacts 导出物 API、详情/download 摘要和 Evaluations 运行列表/详情/失败样例测试通过；API 与 Workflow compileall 通过；Web 中文契约与 TypeScript 编译无错误；文档 diff 不含空白错误。
