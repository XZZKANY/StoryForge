# StoryForge 域清单

> 新会话第一入口。StoryForge = 单机桌面作者辅助写作 IDE，**后端只剩 5 个域、7 张表**。
> 2026-10 收口后「live / backing / frozen」三档已不再需要：非 live 的域连同它们的 37 张表
> 已物理删除，本文件下半部分的分档叙述是**历史留档**，不是今天的现状。

## 今天的全部域（5 个）

| 域 | 面 | 说明 |
|---|---|---|
| `health` | `/health/live` `/health/ready` | 探活 + app_version 握手。`_CORE_TABLES` 必须与真实 live 表同步，否则 readiness 永远 degraded、桌面端起不来。 |
| `assistant` | `/api/assistant/*` | 对话式 agent 会话 / 消息 / chat |
| `agent_runs` | SSE/REST `/api/ide/agent/sessions/*` + `/api/agent-runs/*` | live 工具循环主动脉 |
| `ide` | `/api/ide/*`（cross-chapter / commands / agent stream / agent control） | 命令面板 + 审阅 |
| `judge` | 无 HTTP 面 | **只剩 `semantic.py` + `types.py` + `schemas.py`**：`semantic_judge_with_status` 被 agent 循环的 `project.deep_consistency` 工具调用（`agent_runs/deep_consistency.py`）。它没有模型、不碰 DB。 |

`/api` 下只有 `agent-runs` / `assistant` / `ide` 三个前缀，由 `tests/test_api_surface.py` 与
`tests/e2e/live-surface-contract.spec.ts` 两侧钉死。

## 今天的全部表（7 张）

`agent_runs`、`agent_run_events`、`agent_artifacts`、`subagent_runs`、
`assistant_sessions`、`assistant_messages`、`assistant_tool_calls`。

`app/models.py` 只聚合这两个域的模型；`create_all` 仍是 SQLite 建表器（见 CLAUDE.md §6）。

## 2026-10 收口：从 25 个域 / 44 张表到 5 个域 / 7 张表

按时间顺序，每刀都有独立证据：

1. **自动整书链退役**（PR #272）——作者拍板删除 BookRun：生成链、导出、`bookrun.*` 命令、
   `writing_runs` 全删。
2. **删 `book_runs` 表与 5 个外键**（#273，迁移 `20261009_0001`）——作者装机版库里该表 0 行、
   五处外键非空计数全 0。
3. **卸载 16 个桌面端零调用的 router**（#274）——桌面端只调 3 个 `/api` 前缀，OpenAPI 路径 77 → 35。
4. **清 BookRun checkpoint 恢复路径**（#275）——`bookrun_checkpoint` 与 `bookrun-agent` actor
   全仓零产出方。注意**别和 live 的 `runtime_checkpoint` 混淆**，后者有产出方、是活的。
5. **删已卸域的死服务层**（#277）——判据=模块在 `app/` 内零外部导入。
6. **删 `assistant_sessions` 的两个死外键**（#276，迁移 `20261010_0001`）。
7. **删 DB 实体审稿链**（#278）——`chapter.review` 需要 `scene_packet_id`，而 `ScenePacket` 的
   唯一创建方已随 #277 归零，整条链「有入口无数据」。
8. **删 21 个退役域与它们的 37 张表**（迁移 `20261010_0002`）——判据=从 `app.main` 静态算导入闭包
   （全仓零 `importlib` 动态导入），这些域在闭包里只剩 `models.py` 一条边；作者用了数月的装机版库里
   这 37 张表**全部 0 行**。

**护栏**：`tests/test_source_pruning.py::test_retired_domains_stay_deleted`（已变异验证）。
**回滚**：不能靠加回 `include_router`——代码已物理删除，只能从 git 历史取码并重新评审。

## 红线

- 删表迁移必须同时照顾两种库：存量库（真有表，要删）与 `create_all` 建的新库（表本就不存在，要静默跳过）。
- 删表前先查 `health/router.py` 的 `_CORE_TABLES`：它硬编码表名，漏改会让 readiness 永远 degraded。
- 判断「某模块是否可删」用**导入闭包 + 产出方 grep**，不要只看 router 是否挂载；反过来，
  判断「某表是否可删」要同时看 ORM 引用面和作者库里的真实行数。

---

> 以下为 2026-07 ~ 2026-10 的分档与卸载过程留档，仅用于追溯决策来源，**不作为今天的现状**。

## 2026-10 自动整书链退役

作者拍板删除 BookRun 自动整书链：`book_runs` **整域已删**（表与 5 个 `book_run_id` 外键随迁移 `20261009_0001` 一并删除，`story_state_ledgers` 唯一约束同时收敛为 `(book_id, entity_kind, entity_id)`）；
`writing_runs`、`exports` 与 `books/lineage_service.py` 整体删除；IDE `bookrun.*` 命令、`/api/ide/runs/{id}/events`、
`/api/book-runs/*`、`/api/books/{id}/exports/*` 与 Agent 托管适配器一并移除。live 模块的 LLM 调用统一走 `app/common/llm_client.py` / `llm_env.py`。

## 2026-10 卸载桌面端零调用的 router

桌面端是唯一客户端，实测只调 `/api/agent-runs`、`/api/assistant`、`/api/ide` 三个前缀（加 `/health`）。
其余 16 个前缀的 router 已卸载：`artifacts`、`blueprints`、`character_bible`、`continuity`、`events`、`judge`、
`model_runs`、`provider_gateway`、`quality`、`repair`、`retrieval`、`runtime_tools`、`scene_packets`、`studio`、
`style_packs`、`timeline`。当时**只卸 router 不删 service/models**。

## 2026-10 DB 实体审稿链退役

那条链已经**有入口无数据**：`chapter.review` intent 需要 `scene_packet_id`，而 `ScenePacket` 行的唯一
创建方随 `scene_packets` 服务删除后归零；`chapter.repair` 需要的 `issue_id` 只能由 `chapter.review` 产生，
`judge.approve` 需要的 `repair_patch_id` 只能由 `chapter.repair` 产生。桌面端实际只发 `chapter.write` /
`chapter.polish` / `file.revise` / `chat.explain` 四个 intent，从不进入这条链。

删除：IDE 命令 `judge.run` / `judge.repair` / `judge.approve`；intent `chapter.review` / `chapter.repair`；
`repair` 与 `studio` 整域；`judge` 的 `service` / `router` / `consistency` / `deterministic` / `style_fingerprint`；
`agent_runs/adapters/chapter_review_pipeline.py` 与它的 runtime mixin；agent 循环工具 `judge.repair`。

**保留**：`judge/semantic.py`（live 的 `project.deep_consistency` 用）；agent 循环工具 `judge.run` —— 它被
`file.revise` 管线用作产字后的确定性轻量自检（`mode="proposed_patch_smoke"` 那条纯函数分支），
只砍掉了它转交 IDE 命令的尾巴。`chapter.repair` 作为**工具**（`chapter_writing_pipeline` 里 `chapter.write`
流程的修复步）与被删的同名 intent 无关，保留。

**2026-10 续刀：死服务层物理删除。** `quality` / `runtime_tools` / `scene_packets` / `style_packs` 零表零消费方，
整域删除；`model_runs` 的 `recording` / `router` / `runs_diagnostics` / `schemas` / `service` 与 `context_compiler` 的
`schemas` / `service` 一并删除（只留 `models.py` 供聚合建表）。判据=这些模块在 `app/` 内零外部导入；
`context_compiler` 的唯一消费方是 `scene_packets`，随之孤儿化故同刀带走。约 3300 行。

OpenAPI 路径 77 → 35。随之退役的还有 `tests/e2e/phase1-5` 五个阶段契约 spec（其断言对象即这些已卸端点），
改由 `tests/e2e/live-surface-contract.spec.ts` 守「契约快照只含三个 live 前缀」+「运行时 app 与快照逐路径一致」。
后端侧护栏见 `tests/test_api_surface.py`（`test_api_surface_is_limited_to_desktop_consumed_prefixes` /
`test_desktop_unused_domain_routers_stay_unmounted`，均已变异验证）。**回滚 = 把对应 `include_router` 加回 `main.py`**。

## frozen（web / 多租户 / 自动整书遗产）

**2026-07-10 死码物理清理**：所有冻结域的 **HTTP 层（`router.py` / `service.py` / `schemas.py`）已物理删除**。`analytics` / `batch_refinery` / `worldbuilding`（无 models）**整目录删除**；`assets` / `collaboration` / `commercial` / `evaluations` / `prompt_packs` / `series` / `workspaces` **只剩 `models.py` + `__init__.py`**（`app/models.py` 聚合建表依赖，红线保留）。连带删 3 个 `*_service_acceptance` 死测、conftest `_reset_domain_caches` fixture（worldbuilding cache 已死）、`test_source_pruning` 的 worldbuilding/batch_refinery __init__ 卫生测；`test_redis_cache_strategy` 摘掉 3 个 worldbuilding/asset 缓存测、保留 artifacts + redis-util live 测。**OpenAPI 零变更**（router 早已卸载、schema 早已不在契约）。下方各 batch 记录为历史卸载过程。

**2026-07-14 frozen 残留对齐**：`jobs` 同样是 models-only residual（`JobRun` 仍被 backing ORM / quality 代码引用），与上述 7 域合计 8 个 models-only 域。`test_live_domains_do_not_add_frozen_imports` 禁止 live 四域新增这些依赖，只白名单保留 `ide/command_registry.py -> workspaces.models.Workspace` 这条既有 ORM 审计边。

### 历史卸载经过（2026-07，留档；不作为今天的操作指令）

> 以下逐批记录仅为 2026-07 卸载过程的留档。当时的回滚方式（`main.py` 加回一行 `include_router`）只适用于 router 刚卸载、模块仍在的时点；2026-07-10 起相关域 HTTP 层已物理删除，**今天不能靠加回 include 恢复**，恢复只能从 git 历史取码并重新评审。

**router 已卸载（W4 batch-1，2026-07-04）**：`analytics`、`batch_refinery`、`collaboration`、`commercial`。
- 零前端调用、零 backing 域 import 其 service；`collaboration`/`commercial` 的 `models.py` 仍在 `app/models.py` 聚合建表，故保留目录。
- 护栏：`tests/test_api_surface.py::test_frozen_domain_routers_stay_unmounted`（重新 include_router 即红）。回滚（仅当时）= `main.py` 加回一行 `include_router`。

**router 已卸载（W4 batch-2a，2026-07-10）**：`prompt_packs`、`series`、`worldbuilding`。
- 三域 service 亦零 live/backing import（`worldbuilding` service 此前仅被冻结的 `assets` 惰性 import，一并退役）；删其专属 HTTP 测试（`test_prompt_packs` / `test_series_memory` / `test_series_worldbuilding_api` / `test_worldbuilding_center`）不丢 live 覆盖。
- 前缀入 `FROZEN_UNMOUNTED_PREFIXES`；移除 `test_api_surface.py` 的 `worldbuilding` 正向断言；e2e 契约 phase2（series）/phase4（prompt-packs）同步摘除。`models.py` 全保留（`Series`/`SeriesMemory` 被 live `quality`/`retrieval`、`PromptPack` 被 `model_runs` import）。

**router 已卸载（W4 batch-2b，2026-07-10）**：`assets`、`evaluations`、`workspaces`。至此 batch-2 六域 router 全部卸载。
- `workspaces` —— `Workspace` models 被 **live ide 审计** + `artifacts`/`events`/`provider_gateway`/`model_runs`/`common/scope.py` import，**永不删**；只卸 HTTP router。手术：`test_api_middleware.py` 8 处拿 `/api/workspaces` 当「通用受保护端点」→ 改指 `/api/agent-runs`（auth 401 + CORS preflight 在 routing 之前，端点存在与否无关，行为等价）；删 `test_api_surface.py` 正向断言 + `test_workspaces_api.py`。
- `assets` —— `Asset`/`EvidenceLink` models 被 live `scene_packets`/`character_bible`/`story_memory`/`books` import。手术：`test_phase1_closed_loop_api.py` 的 `_create_asset` 从 `/api/assets` POST 改 session 直建（`create_asset` 唯一非平凡逻辑是 `lineage_key=uuid4`，下游按 id+payload 引用，session 直建保覆盖）；删 `test_assets_api.py`。
- `evaluations` —— 仅 `app/models.py` 聚合 import。手术：删 `test_phase1_closed_loop_api.py` 尾段评测块 + `test_evaluations.py`。
- 三前缀入 `FROZEN_UNMOUNTED_PREFIXES`；e2e 契约 phase1（assets path+AssetCreate）/phase3（workspaces test+WorkspaceCreate）/phase4（evaluations path+EvaluationRunRead）同步摘除。`models.py` 全保留。

**batch-2 卸载前置评估（2026-07-04 discovery；2026-07-10 batch-2a+2b 全落地，六域 router 已全部卸载；下方为历史 discovery 留档，线号已过时）**：
- 6 个 router **全部零 live HTTP 消费方**（`apps/desktop/frontend` 零 fetch + 无 live/backing 域走 HTTP 调用；唯一近似命中 `frontend/src/lib/project/semantics.ts:27` 的 `worldbuilding:'setting'` 是标签映射非 URL；`runtime_tools/creative_registry.py` 的 `/api/evaluations/*` 是静态文档字段非调用（2026-07-26 前该文件在 `apps/workflow`））。
- `assets`/`prompt_packs`/`evaluations`/`series` 四域 **service 亦已死**（零 live/backing import 其 `service`，只 import `models`）→ 卸 router + 删其 HTTP 测试不丢 live 覆盖，与 batch-1 同型。
- **但 batch-2 不是 batch-1 式的干净隔离，落地前须处理测试纠缠**：`test_phase1_closed_loop_api.py` 把 assets+evaluations 织进一条闭环集成流（需手术摘除对应步骤而非整删）；`test_series_worldbuilding_api.py` 同文件混 series+worldbuilding（worldbuilding 保留 → 只摘 series 段）；`workspaces`/`worldbuilding` 另有**正向 surface 护栏** `test_api_surface.py:25,27` 断言其必须挂载（卸载须同删这两行）。此外 e2e 契约断言待更新：assets `phase1-closed-loop.spec.ts:18-19`、series `phase2-contract.spec.ts:18-19`、prompt_packs+evaluations `phase4-contract.spec.ts:54-55/59-60`；main.py include 行 assets:278 / evaluations:282 / prompt_packs:289 / series:297 / workspaces:299 / worldbuilding:300。
- **本刀不做的理由**：A3 渐进绞杀把 batch-2 排在「batch-1 冻结 → 两个发版周期观察 → 再推进」之后，batch-1 于 2026-07-04 当日合并，同日做 batch-2 违背分级降解的安全意图。观察期后按上表逐域落地（每域 = 删 include 行 + 加 `FROZEN_UNMOUNTED_PREFIXES` + 处理其测试纠缠 + `pnpm openapi`）。

## 冻结/删除红线

- 冻结 = 卸 router；**`models.py` 永不删**（打碎 `app/models.py` 聚合建表会连累 live）。冻结域的 router/service/schemas 已于 2026-07-10 物理删除（见本节顶部）；models-only 域只剩 `models.py` + `__init__.py`，三个无 models 域（analytics/batch_refinery/worldbuilding）整目录已删。

## 源码公共面与双轨入口

- `agent_runs` 主链只经 `loop` / `tools` / `fs` / `events` / `permission` / `patches` 六公共面；读序与 service 子边界见 [`agent_runs/STRUCTURE.md`](agent_runs/STRUCTURE.md)。
- 自由文本走 live loop；显式旧 intent 只经 `adapters/intent_fixed_pipeline_adapter.py`。
- `tests/test_source_code_standards.py` 同时硬门禁跨模块私有依赖、双轨 import、体积上限与 live→frozen 依赖。
