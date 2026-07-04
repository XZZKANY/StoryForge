# StoryForge 域清单（live / backing / frozen）

> 新会话第一入口：判断某个域是否值得读。StoryForge = Cursor for Fiction 单机桌面 IDE，
> live 产品面很小；大量域是 web / 多租户 / 自动整书时代的遗产，已冻结。
> 依据：2026-07-04 W4 死域冻结隔离（蓝图 §7）+ 逐域调用面实证。

## 分档定义

- **live**：桌面产品直接 HTTP/WS 命中的面（前端 `apps/desktop/frontend` 真调用）。
- **backing**：不是产品主面，但被 live agent 循环 / managed BookRun 在**进程内**依赖（import service/models）。改这些要谨慎，会影响真链路。
- **frozen**：web / 多租户 / 自动整书时代遗产。**router 已卸载或可卸载**；默认不必读，除非明确在做迁移/删除。域目录与 `models.py` 多数**保留**（被 backing 域 import，或在 `app/models.py` 聚合建表），物理删除按判据后评（不在 W4 范围）。

## live（桌面产品面）

| 域 | 面 | 说明 |
|---|---|---|
| `health` | `/health/live` `/health/ready` | 探活 + app_version 握手 |
| `assistant` | `/api/assistant/*` | 对话式 agent 会话 / 消息 / chat |
| `agent_runs` | WS `/api/ide/agent/sessions/*` + `/api/agent-runs/*` | live 工具循环主动脉 |
| `ide` | `/api/ide/*`（4 条 live：cross-chapter / runs events / commands / agent WS） | 命令面板 + 审阅。**6 条零前端调用的 ide 路由**（workspace-tree / diagnostics / scenes / context-snapshot / story-memory query / artifacts preview）待后续从 router 收窄，service 保留 |

## backing（进程内被 live 依赖，谨慎改）

`book_runs`（managed BookRun + agent-loop prompt 装配）、`judge`、`retrieval`、`character_bible`、`story_state`、`blueprints`、`artifacts`、`exports`、`model_runs`、`provider_gateway`、`events`、`quality`、`repair`、`runtime_tools`、`scene_packets`、`continuity`、`timeline`。

**router 可冻结但 service/models 是 live 依赖（不可删目录）**：
- `studio` —— `studio.service.approve_studio_writeback` / `schemas` 被 **live `ide`** 用（`ide/command_registry.py:22-23,220`，经 `judge.approve` 命令 + agent WS 可达）。
- `style_packs` —— `style_packs.service.list_style_packs` / `create_style_pack` / `schemas` 被 **backing `book_runs`** 生成链用（`book_generation.py:124-125`、`prompt_assembly.py:23`、`book_generation_judge.py:44`）。

## frozen（web / 多租户 / 自动整书遗产）

**router 已卸载（W4 batch-1，2026-07-04）**：`analytics`、`batch_refinery`、`collaboration`、`commercial`。
- 零前端调用、零 backing 域 import 其 service；`collaboration`/`commercial` 的 `models.py` 仍在 `app/models.py` 聚合建表，故保留目录。
- 护栏：`tests/test_api_surface.py::test_frozen_domain_routers_stay_unmounted`（重新 include_router 即红）。回滚 = `main.py` 加回一行 `include_router`。

**router 可卸载但本波未动（batch-2 / 待观察期）**，`models.py` 是 live 依赖必须保留：
- `workspaces` —— `Workspace` 被 **live ide 审计**（`command_registry.py:24` 的「假 Workspace 行」）+ `artifacts`/`events`/`provider_gateway`/`model_runs`/`common/scope.py` import。最重，**永不删**。
- `assets` —— `Asset`/`EvidenceLink` 被 live `scene_packets`/`character_bible`/`story_memory`/`books` import。
- `prompt_packs` —— `PromptPack` 被 live `model_runs` import。
- `series` —— `Series`/`SeriesMemory` 被 live `quality`/`retrieval` import。
- `evaluations` —— 仅 `app/models.py` 聚合 import。
- `worldbuilding` —— router 可卸载；`service` 仅被冻结的 `assets` 惰性 import，随 assets 一同退役。

## 冻结/删除红线

- 冻结 = 卸 router，**不删** models（打碎 `app/models.py` 建表会连累 live）。物理删目录前须逐域 grep 全 import 面 + 打 `attic/*` tag，不在 W4 范围。
- 质量轨资产（book_runs / judge / story_memory / 长程生成链）一行不删，直到真实长程重跑验收完成（见 `docs/internal/arch-review-blueprint-2026-07-03.md` §9）。
