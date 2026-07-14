# StoryForge 域清单（live / backing / frozen）

> 新会话第一入口：判断某个域是否值得读。StoryForge = 单机桌面作者辅助写作 IDE，
> live 产品面很小；大量域是 web / 多租户 / 自动整书时代的遗产，已冻结。
> 依据：2026-07-04 W4 死域冻结隔离（蓝图 §7）+ 逐域调用面实证。

## 分档定义

- **live**：桌面产品直接 HTTP/SSE 命中的面（前端 `apps/desktop/frontend` 真调用）。
- **backing**：不是产品主面，但被 live agent 循环 / managed BookRun 在**进程内**依赖（import service/models）。改这些要谨慎，会影响真链路。
- **frozen**：web / 多租户 / 自动整书时代遗产。**router 已卸载或可卸载**；默认不必读，除非明确在做迁移/删除。域目录与 `models.py` 多数**保留**（被 backing 域 import，或在 `app/models.py` 聚合建表），物理删除按判据后评（不在 W4 范围）。

## live（桌面产品面）

| 域 | 面 | 说明 |
|---|---|---|
| `health` | `/health/live` `/health/ready` | 探活 + app_version 握手 |
| `assistant` | `/api/assistant/*` | 对话式 agent 会话 / 消息 / chat |
| `agent_runs` | SSE/REST `/api/ide/agent/sessions/*` + `/api/agent-runs/*` | live 工具循环主动脉 |
| `ide` | `/api/ide/*`（5 条 live：cross-chapter / runs events / commands / agent stream / agent control） | 命令面板 + 审阅。**6 条零前端调用的 ide 路由**（workspace-tree / diagnostics / scenes / context-snapshot / story-memory query / artifacts preview）待后续从 router 收窄，service 保留 |

## backing（进程内被 live 依赖，谨慎改）

`book_runs`（managed BookRun + agent-loop prompt 装配）、`judge`、`retrieval`、`character_bible`、`story_state`、`blueprints`、`artifacts`、`exports`、`model_runs`、`provider_gateway`、`events`、`quality`、`repair`、`runtime_tools`、`scene_packets`、`continuity`、`timeline`。

**router 可冻结但 service/models 是 live 依赖（不可删目录）**：
- `studio` —— `studio.service.approve_studio_writeback` / `schemas` 被 **live `ide`** 用（`ide/command_registry.py:22-23,220`，经 `judge.approve` REST 命令 + agent loop 工具可达）。
- `style_packs` —— `style_packs.service.list_style_packs` / `create_style_pack` / `schemas` 被 **backing `book_runs`** 生成链用（`book_generation.py:124-125`、`prompt_assembly.py:23`、`book_generation_judge.py:44`）。

## frozen（web / 多租户 / 自动整书遗产）

**2026-07-10 死码物理清理**：所有冻结域的 **HTTP 层（`router.py` / `service.py` / `schemas.py`）已物理删除**。`analytics` / `batch_refinery` / `worldbuilding`（无 models）**整目录删除**；`assets` / `collaboration` / `commercial` / `evaluations` / `prompt_packs` / `series` / `workspaces` **只剩 `models.py` + `__init__.py`**（`app/models.py` 聚合建表依赖，红线保留）。连带删 3 个 `*_service_acceptance` 死测、conftest `_reset_domain_caches` fixture（worldbuilding cache 已死）、`test_source_pruning` 的 worldbuilding/batch_refinery __init__ 卫生测；`test_redis_cache_strategy` 摘掉 3 个 worldbuilding/asset 缓存测、保留 artifacts + redis-util live 测。**OpenAPI 零变更**（router 早已卸载、schema 早已不在契约）。下方各 batch 记录为历史卸载过程。

**2026-07-14 frozen 残留对齐**：`jobs` 同样是 models-only residual（`JobRun` 仍被 backing ORM / quality 代码引用），与上述 7 域合计 8 个 models-only 域；`books/lineage_service.py` 是零 app 调用方的历史批准回写模块，按 frozen 行为模块保留。`test_live_domains_do_not_add_frozen_imports` 禁止 live 四域新增这些依赖，只白名单保留 `ide/command_registry.py -> workspaces.models.Workspace` 这条既有 ORM 审计边。

**router 已卸载（W4 batch-1，2026-07-04）**：`analytics`、`batch_refinery`、`collaboration`、`commercial`。
- 零前端调用、零 backing 域 import 其 service；`collaboration`/`commercial` 的 `models.py` 仍在 `app/models.py` 聚合建表，故保留目录。
- 护栏：`tests/test_api_surface.py::test_frozen_domain_routers_stay_unmounted`（重新 include_router 即红）。回滚 = `main.py` 加回一行 `include_router`。

**router 已卸载（W4 batch-2a，2026-07-10）**：`prompt_packs`、`series`、`worldbuilding`。
- 三域 service 亦零 live/backing import（`worldbuilding` service 此前仅被冻结的 `assets` 惰性 import，一并退役）；删其专属 HTTP 测试（`test_prompt_packs` / `test_series_memory` / `test_series_worldbuilding_api` / `test_worldbuilding_center`）不丢 live 覆盖。
- 前缀入 `FROZEN_UNMOUNTED_PREFIXES`；移除 `test_api_surface.py` 的 `worldbuilding` 正向断言；e2e 契约 phase2（series）/phase4（prompt-packs）同步摘除。`models.py` 全保留（`Series`/`SeriesMemory` 被 live `quality`/`retrieval`、`PromptPack` 被 `model_runs` import）。

**router 已卸载（W4 batch-2b，2026-07-10）**：`assets`、`evaluations`、`workspaces`。至此 batch-2 六域 router 全部卸载。
- `workspaces` —— `Workspace` models 被 **live ide 审计** + `artifacts`/`events`/`provider_gateway`/`model_runs`/`common/scope.py` import，**永不删**；只卸 HTTP router。手术：`test_api_middleware.py` 8 处拿 `/api/workspaces` 当「通用受保护端点」→ 改指 `/api/agent-runs`（auth 401 + CORS preflight 在 routing 之前，端点存在与否无关，行为等价）；删 `test_api_surface.py` 正向断言 + `test_workspaces_api.py`。
- `assets` —— `Asset`/`EvidenceLink` models 被 live `scene_packets`/`character_bible`/`story_memory`/`books` import。手术：`test_phase1_closed_loop_api.py` 的 `_create_asset` 从 `/api/assets` POST 改 session 直建（`create_asset` 唯一非平凡逻辑是 `lineage_key=uuid4`，下游按 id+payload 引用，session 直建保覆盖）；删 `test_assets_api.py`。
- `evaluations` —— 仅 `app/models.py` 聚合 import。手术：删 `test_phase1_closed_loop_api.py` 尾段评测块 + `test_evaluations.py`。
- 三前缀入 `FROZEN_UNMOUNTED_PREFIXES`；e2e 契约 phase1（assets path+AssetCreate）/phase3（workspaces test+WorkspaceCreate）/phase4（evaluations path+EvaluationRunRead）同步摘除。`models.py` 全保留。

**batch-2 卸载前置评估（2026-07-04 discovery；2026-07-10 batch-2a+2b 全落地，六域 router 已全部卸载；下方为历史 discovery 留档，线号已过时）**：
- 6 个 router **全部零 live HTTP 消费方**（`apps/desktop/frontend` 零 fetch + 无 live/backing 域走 HTTP 调用；唯一近似命中 `frontend/src/lib/project/semantics.ts:27` 的 `worldbuilding:'setting'` 是标签映射非 URL；`apps/workflow/.../tools/registry.py:333` 的 `/api/evaluations/*` 是静态文档字段非调用）。
- `assets`/`prompt_packs`/`evaluations`/`series` 四域 **service 亦已死**（零 live/backing import 其 `service`，只 import `models`）→ 卸 router + 删其 HTTP 测试不丢 live 覆盖，与 batch-1 同型。
- **但 batch-2 不是 batch-1 式的干净隔离，落地前须处理测试纠缠**：`test_phase1_closed_loop_api.py` 把 assets+evaluations 织进一条闭环集成流（需手术摘除对应步骤而非整删）；`test_series_worldbuilding_api.py` 同文件混 series+worldbuilding（worldbuilding 保留 → 只摘 series 段）；`workspaces`/`worldbuilding` 另有**正向 surface 护栏** `test_api_surface.py:25,27` 断言其必须挂载（卸载须同删这两行）。此外 e2e 契约断言待更新：assets `phase1-closed-loop.spec.ts:18-19`、series `phase2-contract.spec.ts:18-19`、prompt_packs+evaluations `phase4-contract.spec.ts:54-55/59-60`；main.py include 行 assets:278 / evaluations:282 / prompt_packs:289 / series:297 / workspaces:299 / worldbuilding:300。
- **本刀不做的理由**：A3 渐进绞杀把 batch-2 排在「batch-1 冻结 → 两个发版周期观察 → 再推进」之后，batch-1 于 2026-07-04 当日合并，同日做 batch-2 违背分级降解的安全意图。观察期后按上表逐域落地（每域 = 删 include 行 + 加 `FROZEN_UNMOUNTED_PREFIXES` + 处理其测试纠缠 + `pnpm openapi`）。

## 冻结/删除红线

- 冻结 = 卸 router；**`models.py` 永不删**（打碎 `app/models.py` 聚合建表会连累 live）。冻结域的 router/service/schemas 已于 2026-07-10 物理删除（见本节顶部）；models-only 域只剩 `models.py` + `__init__.py`，三个无 models 域（analytics/batch_refinery/worldbuilding）整目录已删。
- 质量轨资产（book_runs / judge / story_memory / 长程生成链）一行不删，直到真实长程重跑验收完成（见 `docs/internal/arch-review-blueprint-2026-07-03.md` §9）。

## 源码公共面与双轨入口

- `agent_runs` 主链只经 `loop` / `tools` / `fs` / `events` / `permission` / `patches` 六公共面；读序与 service 子边界见 [`agent_runs/STRUCTURE.md`](agent_runs/STRUCTURE.md)。
- 自由文本走 live loop；显式旧 intent 只经 `adapters/intent_fixed_pipeline_adapter.py`；managed BookRun 命令只经 `adapters/bookrun_managed_run_adapter.py`。
- live `assistant` / `agent_runs` / `ide` 只经 BookRun 的 `book_generation` / `service` / `models` 公共模块；不得 import 生成内部 helper。
- `tests/test_source_code_standards.py` 同时硬门禁跨模块私有依赖、双轨 import、BookRun 公共入口、体积上限与 live→frozen 依赖。
