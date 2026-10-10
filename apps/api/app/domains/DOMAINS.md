# StoryForge 域清单（live / backing / frozen）

> 新会话第一入口：判断某个域是否值得读。StoryForge = 单机桌面作者辅助写作 IDE，
> live 产品面很小；大量域是 web / 多租户 / 自动整书时代的遗产，已冻结。
> 依据：2026-07-04 W4 死域冻结隔离（蓝图 §7）+ 逐域调用面实证。

## 分档定义

- **live**：桌面产品直接 HTTP/SSE 命中的面（前端 `apps/desktop/frontend` 真调用）。
- **backing**：不是产品主面，但被 live agent 循环在**进程内**依赖（import service/models）。改这些要谨慎，会影响真链路。
- **frozen**：web / 多租户 / 自动整书时代遗产。**router 已卸载或可卸载**；默认不必读，除非明确在做迁移/删除。域目录与 `models.py` 多数**保留**（被 backing 域 import，或在 `app/models.py` 聚合建表），物理删除按判据后评（不在 W4 范围）。

## live（桌面产品面）

| 域 | 面 | 说明 |
|---|---|---|
| `health` | `/health/live` `/health/ready` | 探活 + app_version 握手 |
| `assistant` | `/api/assistant/*` | 对话式 agent 会话 / 消息 / chat |
| `agent_runs` | SSE/REST `/api/ide/agent/sessions/*` + `/api/agent-runs/*` | live 工具循环主动脉 |
| `ide` | `/api/ide/*`（4 条 live：cross-chapter / commands / agent stream / agent control） | 命令面板 + 审阅。6 条无 Desktop 调用方的旧读路由已从 router/OpenAPI 收窄；2026-09-28 经明确退役决定，删除对应四个读投影模块、18 个独占 DTO 和旧 re-export。live command / cross-chapter 及其 service facade 保留，不删除底层质量能力。 |

## backing（进程内被 live 依赖，谨慎改）

**service 真被 live 进程内调用的只有 3 个**（2026-10 逐域实证，判据 = live 四域里非 `.models` 的 import）：

- `judge` —— `semantic_judge_with_status`、`create_judge_issues` 与两组 schema。
- `repair` —— `create_repair_patch` 与 schema。
- `studio` —— `approve_studio_writeback` 与 schema，经 live `ide` 的 `/api/ide/commands/judge.approve` 可达。

其余 `retrieval`、`character_bible`、`story_state`、`blueprints`、`artifacts`、`model_runs`、`provider_gateway`、
`events`、`quality`、`runtime_tools`、`scene_packets`、`continuity`、`timeline`、`style_packs` **只被 `app/models.py` 聚合建表引用**（`.models`），目录必留但 service 零 live 调用方。

## 2026-10 自动整书链退役

作者拍板删除 BookRun 自动整书链：`book_runs` **整域已删**（表与 5 个 `book_run_id` 外键随迁移 `20261009_0001` 一并删除，`story_state_ledgers` 唯一约束同时收敛为 `(book_id, entity_kind, entity_id)`）；
`writing_runs`、`exports` 与 `books/lineage_service.py` 整体删除；IDE `bookrun.*` 命令、`/api/ide/runs/{id}/events`、
`/api/book-runs/*`、`/api/books/{id}/exports/*` 与 Agent 托管适配器一并移除。live 模块的 LLM 调用统一走 `app/common/llm_client.py` / `llm_env.py`。

## 2026-10 卸载桌面端零调用的 router

桌面端是唯一客户端，实测只调 `/api/agent-runs`、`/api/assistant`、`/api/ide` 三个前缀（加 `/health`）。
其余 16 个前缀的 router 已卸载：`artifacts`、`blueprints`、`character_bible`、`continuity`、`events`、`judge`、
`model_runs`、`provider_gateway`、`quality`、`repair`、`retrieval`、`runtime_tools`、`scene_packets`、`studio`、
`style_packs`、`timeline`。**只卸 router，不删 service/models**——上面 3 个域的 service 仍在进程内执行。

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
