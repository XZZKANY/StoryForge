# StoryForge 架构重构总计划（Refactor Master Plan）

> 生成时间：2026-06-27
> 最近校准：2026-06-29（对齐当前工作树与 `.codex/verification-report.md`；只把有验证记录的刀标为完成）
> 定位：本文件是 StoryForge「全方位打磨更优雅」的**统领级总计划**，统一两条既有视角——god-file 结构解耦（原 `refactor-elegance-plan.md` 的 A–F backlog）与架构边界整治（原 `module-isolation-scorecard.md` 的痛点定位）——并按**可维护性优先**重新排序、补足执行细节。
> 上位约束见 `AGENTS.md`；本文件取代 `refactor-elegance-plan.md` 作为重构主入口，后者保留为 A 区历史记录。
> 证据来源：2026-06-27 一轮 16 张文件重构卡 + 6 项架构主题的只读侦察（逐函数簇、import 拓扑、护栏测试、monkeypatch 陷阱均已落到 `file:line`）。

---

## 当前状态快照（2026-06-29 校准）

完成状态只按**已接入代码 + 已跑本地门禁 + 已写入 `.codex/verification-report.md`** 计数；工作树里存在但未接入、未验证、未留痕的草稿，不能当作已完成。

| 条目 | 状态 | 当前事实 | 下一刀入口 |
|------|------|----------|------------|
| A 区 `agent_runs/runtime.py` 解耦 | ✅ 完成 | PR #19/#23 已把 runtime 从 1696 行收敛到约 920 行；当前工作树约 861 行 | 不再作为主计划待办 |
| E1 legacy orchestrator 边界审计 | ✅ 完成 | `docs/internal/e1-ide-orchestrator-boundary.md` 已落地 | 作为 E2 前提继续引用 |
| E2 legacy orchestrator 收口 | ✅ 完成 | E2-1 迁异常类；E2-2 对账；E2-3 已迁 `chapter.review`/`chapter.repair` 入 live AgentRuntime；E2-4 已下线 `legacy.orchestrator` fallback；E2-5 已把 `ide/orchestrator.py` 收缩为旧路径兼容 facade，懒加载转发 live `run_agent_user_message` | 不再作为主计划待办 |
| B1 `book_generation.py` 拆分 | ✅ 完成（当前合理边界） | metrics/LLM/errors/judge/preflight/progress/CLI/records/serial_metrics 九刀均已接入 facade 并验证；`book_generation.py` 当前约 662 行 | 不再继续机械拆；后续只在改动主循环时重评章节生成/蓝图/断点是否需要深模块 |
| `book_generation_judge.py` | ✅ 完成 | 已接入 `book_generation.py` facade；`_judge_and_repair_loop`/阈值常量旧路径 identity 已验证；B1 focused 测试 65 passed, 1 skipped | 不再作为草稿处理 |
| B2 `book_runs/service.py` 拆分 | ✅ 完成 | `_coerce.py` / `timeline.py` / `gate.py` / `dispatch.py` / `progression.py` 已接入 facade 并验证；`service.py` 当前约 179 行 | 不再作为主计划待办 |
| B3 `judge/service.py` 拆分 | ✅ 完成 | `types.py` / `semantic.py` / `deterministic.py` / `consistency.py` / `style_fingerprint.py` 已接入 facade 并验证；`service.py` 当前约 130 行 | 不再作为主计划待办 |
| B4 `story_memory/service.py` 拆分 | ✅ 完成 | `errors.py` / `atoms.py` / `foreshadow_lifecycle.py` / `arbitration.py` / `extract.py` / `recall.py` 已接入 facade 并验证；`service.py` 当前约 75 行 | 不再作为主计划待办 |
| IS `ide/service.py` 拆分 | ✅ 完成 | `_coerce.py` / `command_registry.py` / `artifact_preview.py` / `workspace_reads.py` / `context_snapshot.py` / `story_memory_query.py` / `run_events.py` 已接入 facade 并验证；`service.py` 当前约 51 行 | 不再作为主计划待办 |
| D3 `provider_adapter.py` 拆分 | ✅ 完成 | `provider_errors.py` / `provider_usage.py` / `provider_fallback.py` 已接入旧 `provider_adapter.py` interface；`provider_adapter.py` 当前约 362 行，parity harness 依源码护栏留在具体模块 | 不再作为主计划待办 |
| C4 Desktop client 拆分 | ✅ 完成 | `src/lib/api-client.ts` / `src/lib/project-context.ts` 已退为 50 行 / 15 行 barrel；`lib/api/` 与 `lib/project/` 已承接传输、codec、语义索引和 context bundle cache；REST 解码护栏已补 | 不再作为主计划待办 |
| 前端 G1/G2/G3 护栏 | ✅ 完成 | `editor.test.tsx` / `chat-window.test.ts` / `app.test.tsx` 已补静态渲染与源文本结构护栏；桌面单元 62 passed，typecheck 与 smoke 通过；C1/C2/C3 已完成当前合理边界 | 后续前端只做行为变更或新护栏驱动拆分 |

---

## 第 0 层 · 执行宪法（每一刀都必须遵守）

1. **零行为变更优先**。结构拆分类条目必须是纯文件级移动：逻辑、分支顺序、错误文案、返回结构、对外签名、import 路径一律不变。任何会改变对外可观测行为的条目，单独标 `行为变更=true`，单独 PR、单独评审，**绝不混进纯移动刀**。
2. **小步推进**。一次只落一个明确条目，禁止顺手重构无关代码、禁止顺手「去重」语义相近但不等价的 helper（侦察已发现多处这种陷阱，见各条目 notes）。
3. **护栏先行**。无直接测试护栏的文件（前端 `Editor.tsx` 零测试、`ChatWindow`/`App` 主组件无渲染护栏），**拆分前必须先补特征/快照测试**，作为独立前置刀；后端/workflow 多数 god-file 护栏充足，可直接以现有测试为基线拆分。
4. **import 环防护**。拆出的纯函数/类型模块一律**单向被依赖**，绝不反向 import 原 god-file 或 facade。共享 helper 沉到无依赖叶子模块。每刀以 `python -c "import app.main"`（API）/ `uv run pytest`（workflow）/ `typecheck`（前端）验证无环。
5. **re-export 是兼容契约不是接口扩张**。god-file 拆分后，原文件退化为 facade，对所有被外部（router、跨域、测试、`importlib` file-module 桥接）引用的符号做顶层 re-export，保持 `from X import Y` 路径与 `module.attr` 可达性 100% 不变。这是保持行为不变所**必需**，不计作扩大公开接口。
6. **monkeypatch 目标即硬契约**。测试若 `monkeypatch.setattr(module, 'httpx'|'sqlite3'|'execute_provider_text'|'orchestrate_agent_message', ...)`，被打的名字必须仍在原模块命名空间可见。纯移动时若该名字随函数搬走，等于破坏护栏——这类点在各条目 notes 中已逐一标注，必须用 facade 保留 import 规避。
7. **行尾纪律**。仓库以 LF 为主，编辑保持目标文件原有行尾，避免 CRLF↔LF 噪声污染 diff。
8. **不碰 web**。`apps/web` 已退场，任何条目都不新增其代码、脚本或测试。
9. **证据链**。每条改动跑相关门禁（ruff / pytest / typecheck / 对应单测），结果回填 `.codex/verification-report.md`，PR 描述说明「零行为变更」或「行为变更点 + 评审依据」。

### 通用验证门禁

```bash
# Python 侧（A/B/E/F + 横切）
cd apps/api && uv run ruff check <改动路径>
cd apps/api && uv run pytest <相关测试> -q
cd apps/api && uv run python -c "import app.main"          # import 环 smoke
# 前端侧（C）
npm --prefix apps/desktop/frontend run typecheck
npm --prefix apps/desktop/frontend run test
# Workflow 侧（D）
cd apps/workflow && uv run pytest -q
```

---

## 第 1 层 · 现状全景

### 1.1 三端 god-file 地图（2026-06-28 校准）

| 区 | 文件 | 当前行数 | 原计划行数 | 当前职责 | 状态 | 风险 |
|----|------|---------:|-----------:|----------|------|------|
| **B1** | `book_runs/book_generation.py`(+`_parallel.py`) | 662 + 571 | 1871 + parallel | 整书生成主流程 facade；LLM/metrics/errors/judge/preflight/progress/CLI/records/serial_metrics 已外移，建书/蓝图/章节生成/断点重建保留在主流程旁 | ✅ 完成（当前合理边界） | 高*（import 拓扑） |
| **AS** | `agent_runs/service.py` | 618 | 1246 | Agent Run 生命周期 + 查询 + 持久化事实源 + BookRun 控制桥接；SSE/WS 事件编码、skill catalog、run payload helper 与 EventSink adapter 已外移 | ✅ 完成（当前合理边界） | 中 |
| **B2** | `book_runs/service.py`(+`book_context.py`) | 179 + 423 | 1110 + context | BookRun lifecycle facade；progression/timeline/gate/dispatch 已外移并经旧 `service.py` interface re-export | ✅ 完成 | 中 |
| **B3** | `judge/service.py` | 130 | 975 | Judge 写库编排 facade；types/semantic/deterministic/consistency/style_fingerprint 已外移并经旧 `service.py` interface re-export | ✅ 完成 | 中 |
| **C1** | `desktop/.../ChatWindow.tsx` | 1031 | 2270 | Agent 对话主壳层；types/utils/mapping/review/request payload/display panels/Composer 已外移到 `chat-window/` | ✅ 完成（当前合理边界） | 中 |
| **C2** | `desktop/.../App.tsx` | 333 | 1489 | 根组件装配壳；Window/Codex/Welcome/RightWorkspace 子组件与 layout/project/Tauri hooks 已外移 | ✅ 完成（当前合理边界） | 中 |
| **C3** | `desktop/.../Editor.tsx` | 458 | 1119 | Editor 装配壳；Monaco lifecycle、文件加载、issue decorations、VersionHistory、分支清单与建议写回 hook 已外移 | ✅ 完成（当前合理边界） | **高** |
| **B4** | `story_memory/service.py` | 75 | 863 | Story Memory facade；CRUD/有效期读取、伏笔状态机、召回/pgvector、抽取写入与仲裁已外移并经旧 `service.py` interface re-export | ✅ 完成 | 中 |
| **IS** | `ide/service.py`(+`router.py`) | 51 + 312 | 738 + router | IDE facade；command registry、Artifact 预览、Workspace/Scene/Diagnostics 读取、Context Snapshot、Story Memory 查询与 Run Events 已外移并经旧 `service.py` interface re-export | ✅ 完成 | 中 |
| **B5** | `studio/service.py` | 53 | 764 | Studio facade；source/review/recovery reads、approval、chapter_review 已外移并经旧 `service.py` interface re-export | ✅ 完成 | 中 |
| **C4** | `desktop/.../lib/api-client.ts`(+`project-context.ts`) | 50 + 15 | 740 | 旧路径 barrel；REST/WS/SSE/codecs 与 project semantic/context bundle 已外移 | ✅ 完成 | 中 |
| **D1** | `workflow/orchestrators/book_loop.py`(+`novel_loop`+`book_run_adapter`) | 348 + 281 + 390 | 711 | BookLoop 执行核心 + NovelLoop + BookRun adapter；types/budget/scheduling/results 与 coerce/payload/volume/types 已外移 | ✅ 完成 | 中 |
| **D2** | `workflow/runtime/checkpoints.py`(+`runner.py`) | 62 + 535 | 711 | checkpoint facade；records/ModelRun sink/memory store/SQLite store 已外移，runner 执行循环保留 | ✅ 完成（checkpoint 当前合理边界） | 中 |
| **D3** | `workflow/runtime/provider_adapter.py`(+`provider_client.py`) | 362 + 317 | 664 | Provider Gateway adapter facade；错误分类、usage、fallback 已外移，parity harness 留具体模块 | ✅ 完成 | 中 |
| **RT** | `retrieval/service.py`(+`model_runs/service.py`) | 137 + 88 | 657 | Retrieval 搜索装配 facade + ModelRun 查询/wrapper seam；打分/候选/索引/workbench、recording/runs_diagnostics 已外移 | ✅ 完成 | 中 |
| **D4** | `workflow/prompts/builder.py`(+`context.py`) | 368 + 195 | 573 | Prompt builder/context facades；render/sections/continuity budget 已外移并经旧模块 private surface 回引 | ✅ 完成 | 低 |
| **E** | `ide/orchestrator.py`（legacy facade） | 31 | 1389 | 旧路径兼容 facade：re-export `SUPPORTED_INTENTS` / `_detect_intent` / `AgentOrchestrationError`，`orchestrate_agent_message` 懒加载转发 live AgentRuntime facade | ✅ 完成 | 低 |

\* B1 风险「高」源于 import 拓扑（`book_generation_parallel.py` 用 `generation.<name>` 属性访问 20+ 私有符号 + 测试直接 import 私有符号），非缺护栏。

### 1.2 六大架构主题（按当前事实，非旧 scorecard）

| 主题 | 当前状态 | 优先级 |
|------|----------|--------|
| **T1** Context/ScenePacket/Retrieval/Continuity 边界 | ✅ 完成（当前合理边界）：Scene Packet body 已有显式 TypedDict contract + key order golden；retrieval_bridge 已拆为 retrieval query/context blocks facade；`assemble_scene_context` context 写入已命名 helper 化；两套预算口径已加对账 golden | 不再作为主计划待办 |
| **T2** Workflow runtime adapter 桥接 | ✅ 完成（当前合理边界）：图节点只认 `GenerationState` 引用态，BookRun adapter 已按 payload/volume/types 收口，checkpoint store 已按 records/sink/memory/sqlite 收口；逐字一致的正数 int/float helper 已收口到 `orchestrators/_coercion.py`。残留 runner 失败回写属于逻辑重构，单独评审 | 不再作为纯拆分待办 |
| **T3** legacy `ide/orchestrator.py` 收口（E2） | ✅ 完成：`chapter.review`/`chapter.repair` 已由 live AgentRuntime native handler 承接；`legacy.orchestrator` 工具 fallback 已下线；`ide/orchestrator.py` 已收缩为旧 import path facade，旧 `orchestrate_agent_message` 可调用但执行转发到 live `run_agent_user_message` | 不再作为主计划待办 |
| **T4** 共享契约一致性 | ✅ 完成（当前合理边界）：选择消费 generated OpenAPI types，不下线生成管线；shared types 已用本地 openapi-typescript 重新生成；Desktop assistant revise、provider health、Agent role DTO 已通过 `api/contracts.ts` 接入 generated schemas | 不再作为主计划待办 |
| **T5** 横切一致性 | ✅ 完成（当前合理边界）：LLM leaf utilities 已抽到 `app/common/llm_http.py`；assistant、IDE command、AgentRun、BookRun lifecycle、Artifact/Export 作用域与 BookGeneration 错误已接入 `DomainError` 全局 handler/status contract；剩余 legacy router 映射多为域外历史面，judge LLM 客户端因行为差异暂不合并；「禁止假数据兜底」铁律抽样**通过** | 不再作为主计划待办 |
| **T6** 测试护栏地图 | ✅ 完成（当前合理边界）：后端/workflow 护栏充足；前端三大组件已补第一层 render/source 结构护栏；后续新拆分继续按风险逐刀扩充行为特征测试 | 不再作为主计划待办 |

### 1.3 scorecard 过时项校正（重要）

旧 `module-isolation-scorecard.md`（2026-05-24）多项结论已不成立，本计划据**当前**事实修订：

- ❌「scene_packets/service.py 一个函数干 7 件事」→ 已拆为 4 薄模块，service.py 仅 103 行。
- ❌「Context/ScenePacket/Retrieval 是最恶心第一名（P0）」→ 已降级并完成当前合理边界：packet schema、retrieval/context block 拆分、`assemble_scene_context` 写入整理与预算口径对账 golden 均已落地。
- ❌「worldbuilding router 未注册、入口不可达」→ 已注册（`main.py:245`）。
- ❌「Workflow 图与业务互相认识太多」→ 图节点已只认 `GenerationState` 引用态，痛点迁移为 adapter 层内部 god-file。
- ✅ 仍成立：「两套预算口径并存」「证据链分三处累积」「shared 契约偏薄」——但均为可独立小步处理的局部问题。

---

## 第 2 层 · 分级 backlog（可维护性优先排序）

> 排序口径：**可维护性/降心智** 为主（先拆最大、最常改、最让人难受的 live 路径文件与边界），叠加 价值/风险比 + 护栏强度。工时：S<2h / M 半天-1天 / L 多天。
> **A 区（`agent_runs/runtime.py` 解耦）已完成**（PR #19/#23），E1 已完成（PR #24），E2-1 与 B1 已完成并留痕；本表只列仍需推进的入口。

每个条目的完整细节（函数簇 `file:line`、目标模块、import 环、护栏、monkeypatch 陷阱）见**附录 A：重构卡全文**。下表是排序后的执行索引。

### Wave 0 · 前端护栏补齐（阻塞前置，必须先做）

| # | 条目 | 文件 | 工时 | 风险 |
|---|------|------|------|------|
| **G1** | ✅ 为 `Editor.tsx` 补 `renderToStaticMarkup` 空状态/工具栏快照 + e2e 依赖源文本护栏 | `tests/editor.test.tsx`（新建） | M | 高 |
| **G2** | ✅ 为 `ChatWindow()` 主组件补渲染快照 + SSE 投影特征测试 | `tests/chat-window.test.ts`（扩展） | M | 中 |
| **G3** | ✅ 为 `App()` 补 shell/WelcomeWorkspace/项目库入口渲染护栏 + 源文本结构护栏 | `tests/app.test.tsx`（新建） | M | 中 |

### Wave 1 · live 路径最大文件解耦（维护性收益最高）

| # | 条目 | 文件→目标 | 工时 | 风险 | 依赖 |
|---|------|----------|------|------|------|
| **C1** | ✅ `ChatWindow.tsx` → `chat-window/` 子目录（types/utils/mapping/review/Composer/panels） | 2145→1031 | M | 中 | 已完成并验证；主闭环保留壳层 |
| **AS** | ✅ `agent_runs/service.py` → event_encoders/skill_catalog/run_payloads/event_sink | 1246→618 | M | 中 | 已完成并验证；持久化事实源留 service |

### Wave 2 · 主产品体验与后端次大文件

| # | 条目 | 文件→目标 | 工时 | 风险 | 依赖 |
|---|------|----------|------|------|------|
| **C3** | ✅ `Editor.tsx` → `editor/`（VersionHistory + lifecycle/writeback hooks） | 553→458 | L | 高 | G1 已完成；smoke 通过 |
| **C2** | ✅ `App.tsx` → helpers + 3 hooks + `components/app/` | 1397→333 | L | 中 | G3 已完成；App 保留根壳层装配 |
| **B2** | ✅ `book_runs/service.py` → progression/timeline/dispatch/gate 薄模块 | 951→179 | M | 中 | 已完成并验证；BookRun lifecycle 留 service |
| **B3** | ✅ `judge/service.py` → types/semantic/deterministic/consistency/style | 824→~130 | M | 中 | 已完成并验证；写库编排留 service |

### Wave 3 · 后端域收口 + 前端 client + workflow

| # | 条目 | 文件→目标 | 工时 | 风险 |
|---|------|----------|------|------|
| **B4** | ✅ `story_memory/service.py` → errors/atoms/foreshadow_lifecycle/arbitration/extract/recall | 733→75 | M | 中 |
| **IS** | ✅ `ide/service.py` → _coerce/command_registry/artifact_preview/workspace_reads/context_snapshot/story_memory_query/run_events | 631→51 | M | 中 |
| **B5** | ✅ `studio/service.py` → source/review/chapter_review/approval/recovery reads | 640→53 | M | 中 |
| **C4** | ✅ `api-client.ts`/`project-context.ts` → `lib/api/`+`lib/project/` barrel | 670+372→50+15 | M | 中 |
| **RT** | ✅ `retrieval/`+`model_runs/` → scoring/loader/indexing/workbench + recording/diagnostics | 576+488→137+88 | M | 中 |
| **D1** | ✅ `book_loop.py`+`book_run_adapter.py` → types/budget/scheduling/results + coerce/payload/volume/types | 624+629→348+390 | M | 中 |
| **D2** | ✅ `checkpoints.py` → records/sink/memory_store/sqlite_store facade | 620→62 | M | 中 |
| **D3** | ✅ `provider_adapter.py` → errors/usage/fallback；parity 留具体模块 | 558→362 | M | 中 |
| **D4** | ✅ `prompts/builder.py`+`context.py` → _render/_sections + _continuity_budget | 509+243→368+195 | M | 低 |

---

## 第 3 层 · 架构边界整治（横切，多含行为变更，单独评审）

> 这些条目**不是纯文件移动**，杠杆高但风险高，必须与第 2 层拆分刀严格分离、独立小步 PR。

### E2 · legacy orchestrator 收口（完成）

E1 边界图（`docs/internal/e1-ide-orchestrator-boundary.md`）已证：跨边界 live 符号原本只有 `AgentOrchestrationError`（5 处 import）+ `orchestrate_agent_message`（仅 fallback）。2026-06-28 至 2026-06-29 已完成 E2-1 到 E2-5：异常类迁入 `agent_runs/errors.py`；live/legacy intent 与 chapter helper 已对账；`chapter.review`/`chapter.repair` 已迁入 live AgentRuntime native handler；`legacy.orchestrator` 工具 fallback 已下线；`ide/orchestrator.py` 的冻结实现已删除，退为兼容 facade。

1. ✅ **E2-1（低风险，已完成）**：新建 `agent_runs/errors.py`，迁 `AgentOrchestrationError`，5 处 live import 切源，orchestrator 回引。解除「薄模块反向依赖胖模块」。零行为变更。验证见 `.codex/verification-report.md` 的 “E2-1 重构验证（2026-06-28）”。
2. ✅ **E2-2（对账，不改码，已完成）**：已逐字段比对 live/legacy `_detect_intent` 与 `_judge_run_args_from_scene_packet`，结论写入 `.codex/verification-report.md` 的 “E2-2 对账验证（2026-06-28）”。关键结论：intent 仅在 reviewer role hint/mention + file context + 中性话术上漂移；chapter helper 主体查询/返回键一致，但 `_string_list`/`_style_rules` 清洗语义漂移，E2-3 迁移时必须保留 legacy payload 语义或显式评审行为变更。
3. ✅ **E2-3（行为变更，已完成）**：已迁 `chapter.review`/`chapter.repair` 两条编排入 live AgentRuntime，按 E2-2 结论处理 `_string_list`/`_style_rules` 漂移，`runtime_mode` 转为 `agent_runtime`。验证见 `.codex/verification-report.md` 的 “E2-3 重构验证（2026-06-28）”。
4. ✅ **E2-4（删除收尾，已完成）**：已下线 `legacy.orchestrator` 工具 fallback，unsupported intent 改显式抛 `AgentOrchestrationError`。验证见 `.codex/verification-report.md` 的 “E2-4 重构验证（2026-06-28）”。
5. ✅ **E2-5（兼容 facade，已完成）**：`ide/orchestrator.py` 删除 legacy 编排冻结副本，只保留 `SUPPORTED_INTENTS`、`_detect_intent`、`AgentOrchestrationError` 与 `orchestrate_agent_message` 旧路径；旧函数懒加载 `run_agent_user_message()` 转发到 live AgentRuntime，避免导入环并保留外部直调的返回 dict 形状。

**结论**：T3/E2 已完成。旧路径仍是兼容 interface，不再承载业务编排知识；runtime、测试与潜在外部调用方统一落到 live AgentRuntime seam。

### T4 · 共享契约一致性（P1）

- ✅ **纯拆分先行已完成（零行为变更）**：`api-client.ts` 已按传输边界拆为 config/assistant/agent-socket/run-events/codecs/errors/types（barrel 兼容）；手写 payload 映射已下沉 `lib/api/codecs.ts`；错误详情读取已下沉 `lib/api/errors.ts`。
- ✅ **决策项已落地**：选择让 Desktop 消费 `generated/api-types.ts`。`lib/api/contracts.ts` 已把 assistant revise request/response、provider health response、Agent role read DTO 接到 generated schemas；camelCase UI-facing types 不变。
- ✅ **shared types 已再生成**：绕过 pnpm filter 的非 TTY purge guard，直接使用 `packages/shared/node_modules/.bin/openapi-typescript.cmd` 从 checked-in OpenAPI JSON 生成 `packages/shared/src/generated/api-types.ts`；`ProviderHealthResponse` 与 context bundle `budget` 已进入 generated TS。
- **后续**：`pnpm --filter @storyforge/shared ...` 在本地仍触发 module purge guard，属于工具链非交互执行问题；不阻塞当前 generated contract consumption，但后续可单独修 pnpm runner。
- ✅ 前置测试已补：`requestRevision` payload/响应映射、JSON error detail、`probeProviderHealth` camelCase 映射与非 JSON 错误 fallback 已由 `tests/api-client.test.ts` 覆盖。

### T5 · 横切一致性（P1）

- ✅ **assistant 错误模型第一刀已完成**：`AssistantSessionNotFoundError` / `AssistantToolCallNotFoundError` 派生 `NotFoundError`，`AssistantLlmNotConfiguredError` / `AssistantReviseError` 派生 `DomainError` 并显式保留 422/502；`assistant/router.py` 删除重复 try/except，继续由全局 handler 返回 `{"detail": str(exc)}`。`provider-health` 仍按产品契约始终 200 返回结构化诊断，不纳入异常映射。
- ✅ **IDE command 错误模型第一刀已完成**：`IdeCommandNotFoundError` 派生 `NotFoundError`，`IdeCommandExecutionError` 派生 `InputError`；`ide/router.py` 的 HTTP command endpoint 删除重复 404/400 try/except，WebSocket command 分支继续捕获并转为消息体错误。
- ✅ **AgentRun not-found 去重已完成**：`AgentRunNotFoundError` 已是 `NotFoundError`，`agent_runs/router.py` 删除 5 处重复 404 try/except，包括 SSE 快照端点的预读取阶段。
- ✅ **BookRun lifecycle 错误去重已完成**：`BookRunError` / `BookRunNotFoundError` / `BookRunBlockedError(status_code=422)` 已由全局 handler 接管；`book_runs/router.py` 主生命周期端点删除重复 404/422/400 try/except。导出端点暂不纳入本刀，因为 `ArtifactForbiddenError` 与 `BookExportError` 的 403/404 分类仍需单独收口。
- ✅ **Artifact/Export 作用域错误收口已完成**：新增 `ForbiddenError(status_code=403)`；`ArtifactForbiddenError`、`ExportForbiddenError`、BookRun export workspace mismatch 改由领域异常携带 403；`BookExportNotFoundError` 替代 router 字符串判 404；artifacts/exports/book_runs/ide 相关 router 删除导出与制品预览重复映射。
- ✅ **BookGeneration 错误 status contract 已完成**：`BookGenerationPreflightError` 多继承 `DomainError`/`RuntimeError` 并保留 422；`BookGenerationError` 多继承 `DomainError`/`RuntimeError` 并保留 502。assistant、CLI 和测试的 `RuntimeError` 捕获面不变。
- **剩余边界**：更多 legacy router 映射仍可逐域清理，但不再属于本主计划 P1 横切项；judge LLM 客户端因鉴权头/base_url fallback 行为差异暂不合并。
- ✅ **LLM 客户端收敛（零行为变更部分）**：`book_runs`↔`assistant` 已共享的 OpenAI 兼容 leaf utilities 抽到 `app/common/llm_http.py`；`book_generation_llm.py` 继续保留 `_call_llm`、异常映射、token/cost 统计和旧私有 helper surface。**judge 留待行为对齐**（其鉴权头/base_url 回退与 book_runs 不一致，差异是行为携带，不可在纯移动刀抹平）。
- **禁区标注**：`QualityDashboardInputError`/`ScenePacketInputError` 名为 Input 实继承 404，是行为携带分类，任何刀不得在纯移动中改其继承/命名。
- **铁律核验通过**：「不创建假数据兜底」抽样未发现违规，无需整改。

### T1 · Context/ScenePacket/Retrieval 边界固化（P1，降级自旧 P0）

- ✅ 为 ScenePacket 的 `packet` 裸 dict 引入显式 `ScenePacketBody` TypedDict contract，新增 key order golden 护栏；`budget.py` / `context_pipeline.py` / `context_blocks.py` 只接类型，不改赋值顺序。
- ✅ `assemble_scene_context` 内联 context 写入已抽成 `attach_memory_context` / `attach_pacing_directive` / `attach_retrieval_hits`，编排保持线性「取数→组装→合并」。
- ✅ 拆 `retrieval_bridge.py` 为 `retrieval_query.py`（出站检索）+ `context_blocks.py`（出站上下文编译），旧 `retrieval_bridge.py` 保持 facade re-export。
- ✅ 为「两套预算口径并存」写对账 golden 测试固化现状（本刀不统一）。

**结论**：T1 已到当前合理边界。后续若统一预算模型、证据链或共享契约，应进入 T4/T5 独立评审，不再作为 T1 纯结构拆分继续推进。

### T2 · Workflow runtime adapter（P2）

- ✅ `checkpoints.py` 已按关注点拆为 checkpoint records、ModelRun sink、memory store、SQLite store；旧 facade re-export 并保留 `sqlite3` monkeypatch 路径。
- ✅ `book_run_adapter.py` 已拆 dispatch payload、volume plan、types/coerce；`book_generation_parallel.py` 的 file-module 加载清单未受影响。
- ✅ 共享标量 helper 已抽到 `orchestrators/_coercion.py`，只合并逐字一致的正数 int/float 归零语义；`_optional_positive_int`、`_bool_value`、`novel_loop._optional_int` 等语义不同 helper 继续原位保留。
- runner.py 失败回写收敛属逻辑重构，单列后续独立评估。

---

## 第 4 层 · 执行波次与推荐顺序

```
Wave 0（前端护栏）   G1 Editor测试 ─┐  G2 ChatWindow测试 ─┐  G3 App测试 ─┐   并行可做
                                    │                     │             │
Wave 1（最大live）   B1 已完成 ───────┼──── C1 ←────────────┘             │
                     AS              │                                   │
                                     │                                   │
Wave 2（产品+次大）  C3 已完成 ───────┘     C2 已完成 ─────────────────────┘
                     B2   B3
                                     │
Wave 3（收口）       B4、IS已完成   B5 C4 RT D1 D2 D3 D4已完成   （彼此独立，可穿插）
                                     │
横切（独立评审）     E2完成   T4 generated consumption 续接   T5错误统一/LLM收敛   T1完成  T2完成
```

**推荐节奏：**
1. **Wave 0 已完成**：G1/G2/G3 第一层前端护栏已落地；后续拆分继续以 `npm --prefix apps/desktop/frontend run test` + `typecheck` 为门禁。
2. **E2 已完成**：`chapter.review`/`chapter.repair` 已 native 化，`legacy.orchestrator` fallback 已下线；`ide/orchestrator.py` 已退为旧路径兼容 facade。
3. **Wave 2/3 后续入口**：B1、B2、B3、B4、B5、IS、RT、D1、D2、D3、D4、AS、C1、C2、C3、C4 均已到当前合理边界；继续前端拆分前先补更贴近运行期的行为护栏。
4. **Wave 2/3 按域推进**：每域一刀或数刀，每刀 branch→PR→merge + 证据回填。
5. **横切项穿插但严格独立**：T4 generated DTO 续接、T5 错误统一等行为敏感项必须单独 PR + 评审，不与拆分混做。

**每刀闭环**（遵循 `feedback_delivery_flow` 记忆）：建分支 → 拆分/补测 → 跑门禁 → 回填 `verification-report.md` → branch→PR→merge 一路到合并。

**状态判定纪律**：只有当新模块已被原 facade import/re-export、原重复定义已删除、相关门禁通过并写入 `.codex/verification-report.md` 时，才可把条目标为“完成”。仅新增文件、仅复制代码、仅本地草稿均标为“草稿态/进行中”。

---

## 附录 A · 重构卡全文

> 16 张文件重构卡 + 6 项架构主题的完整侦察结论（函数簇、目标模块、import 环、护栏、陷阱）见配套数据：本轮 workflow 侦察输出。下列为各卡的**关键约束速查**，完整 `members` 清单与 `note` 在落地每条目时回看侦察结果。

### B1 · book_generation.py（1871→662，风险高/L，当前合理边界完成）
- **已完成并验证**：`book_generation_metrics.py`（证据摘要/指标/Artifact 摘要）+ `book_generation_llm.py`（_call_llm/headers/token/cost/环境读取）+ `book_generation_judge.py`（Judge & Repair 循环/质量评分/字数门禁/summary judge）+ `book_generation_preflight.py`（resolved_llm_env/missing env/_assert_preflight/LLM env key 常量）+ `book_generation_progress.py`（pause/failure/budget BookRun 状态转移）+ `book_generation_cli.py`（CLI 参数/摘要输出壳）+ `book_generation_records.py`（draft scene/ModelRun/ScenePacket/最终批准落库）+ `book_generation_serial_metrics.py`（串行直跑集成指标）+ `book_runs/errors.py`（`BookGenerationError`/`BookGenerationPreflightError`）。`book_generation.py` 已 facade re-export，验证见 `.codex/verification-report.md` 的 B1 metrics、B1 LLM、B1 Judge、B1 Preflight、B1 Progress/CLI、B1 Records/Serial Metrics 六段。
- **保留在 facade 的职责**：`run_book_generation`/`resume_book_generation` 主循环、`_create_generation_book`/`_seed_consistency_data`/`_blueprint_payload`/`_default_planning_arcs`、`_chapter`/`_reconstruct_completed_chapters`、`_generate_chapter`、`_prior_chapters_recap`。这些函数要么承载主流程顺序，要么被 `book_generation_parallel.py` 和测试通过旧 facade 路径 patch/调用；继续机械外移会制造浅模块或破坏 `_default_planning_arcs` 等 monkeypatch 契约。
- **命名校正**：原计划的 `book_generation_evidence.py` 实际先落为 `book_generation_metrics.py`，它承载 `_result_summary`、`_evidence_summary`、Artifact hash/text、per-chapter/latency/cost 汇总等证据摘要能力；不要再新建一个重复 evidence 模块，除非先重新拆清 CLI 与 evidence 的职责。
- **硬约束**：`book_generation_parallel.py` 用 `generation.<name>` 属性访问 20+ 私有符号 → 所有外移符号必须在 `book_generation.py` re-export；测试直接 import `REPAIR_THRESHOLD/_judge_and_repair_loop/_generate_chapter/_default_planning_arcs`；新模块**绝不**反向 import book_generation；异常类已下沉到 `errors.py`，继续复用。
- **完成验收**：`uv run ruff check app/domains/book_runs/book_generation*.py app/domains/book_runs/errors.py tests/conftest.py`；`uv run python -c "import app.main"`；显式文件列表宽回归 `tests/test_book_generation.py tests/test_book_generation_long_wrapper.py tests/test_book_generation_parallel.py tests/test_book_generation_parallel_wrapper.py tests/test_multi_round_repair.py tests/test_phase1_context_optimization_verify.py tests/test_book_run_start.py tests/test_assistant_revise.py tests/test_assistant_provider_health.py tests/test_ide_agent_orchestrator.py -q`；records/serial facade identity；`BookBlueprint` 兼容 re-export 覆盖并发 runner。

### AS · agent_runs/service.py（1246→618，风险中/M，当前合理边界完成）
- **已完成并验证**：`event_encoders.py` 承载 `encode_agent_run_sse_event` / `websocket_started_event` / `websocket_control_event`；`skill_catalog.py` 承载 Agent skill 定义、`list_agent_skills`、`_skill_by_name`、`_agent_plan_payload`；`run_payloads.py` 承载 message/scope/budget/BookRun snapshot payload helper；`event_sink.py` 承载 `_AgentRunEventSink` 与 `_record_*` adapter；`service.py` 顶层 re-export 保持旧路径。验证见 `.codex/verification-report.md` 的 AS event_encoders/skill_catalog/run_payloads/event_sink 四段。
- **保留在 service 的职责**：`create_or_resume_agent_run` / user message facade / BookRun control bridge、`record_agent_event` / `record_agent_artifact` / `record_subagent_run` / `complete_agent_run` / `fail_agent_run` 持久化事实源、list/get 查询 API、role catalog wrapper。继续把这些写入函数下沉会制造 service ↔ sink 环，或把同一事实源拆散到浅模块。
- **环处理**：`event_sink.py` 在方法执行时局部 import service 写入函数，导入期不反向 import service；`import app.main` smoke 通过。
- **护栏**：`test_record_agent_event_sequences_increment_from_existing_max` 锁定 run 内 sequence 递增；`test_encode_agent_run_sse_event_is_stable_json_snapshot` 锁定 SSE `event:`/`data:` JSON 投影；`test_agent_runs.py` 33 passed。`AgentRuntime` 顶层 import 仍留 service，测试 monkeypatch 契约不变。

### B2 · book_runs/service.py（1110→179，当前合理边界完成）
- **已完成并验证**：`_coerce.py`（叶子转换工具）、`timeline.py`（完章进度到 TimelineEvent 同步）、`gate.py`（长篇上下文门禁与卷计划 helper）、`dispatch.py`（Workflow dispatch payload 与 narrative plan 装配）、`progression.py`（进度回填、暂停、恢复、停止、重试）。`service.py` 已退为 BookRun lifecycle facade + 旧路径 re-export，验证见 `.codex/verification-report.md` 的 “B2 重构验证（2026-06-29，完成）”。
- **保留在 facade 的职责**：`create_book_run` / `get_book_run` / startable 校验 / generation dispatched 标记 / background generation runner。继续拆这些会把 BookRun lifecycle 事实源拆散成浅模块。
- **硬约束**：旧 `service.py` interface 继续 re-export progression/timeline/gate/dispatch 入口、常量与私有 helper；`apply_book_run_progress` 步骤顺序、commit/refresh 时点、evidence_refs 前缀、STICKY/CONTROLLED_PROGRESS_KEYS 合并语义均保持不变。

### B3 · judge/service.py（975→~130，当前合理边界完成）
- **已完成并验证**：`types.py`（`DetectedIssue`/异常/常量/`StyleFingerprint`）、`semantic.py`（LLM 语义评审、HTTP 请求、响应解析、错误计数）、`deterministic.py`（本地 setting/style 规则）、`consistency.py`（Character Bible/Timeline/Style Fingerprint Drift）、`style_fingerprint.py`（文风指纹基线与相似度）。`service.py` 已退为 `create_judge_issues` 写库编排 + `_validate_scene_packet` + 旧路径 re-export，验证见 `.codex/verification-report.md` 的 “B3 重构验证（2026-06-29，完成）”。
- **保留在 facade 的职责**：评审目标校验、语义/确定性/跨域问题合并、降级标记注入、`JudgeIssue` 写库提交。继续拆这些会把 Judge 的写库事实源拆散。
- **硬约束**：`httpx` 保留在 `service.py` facade，现有 `monkeypatch.setattr(judge_service.httpx, "Client", ...)` 仍影响 `semantic.py`；`_judge_llm_errors_total` 单一定义在 `semantic.py` 并经 facade 回引；BookRun 生成路径需要的私有 helper 全量 re-export。

### B4 · story_memory/service.py（733→75，当前合理边界完成）
- **已完成并验证**：`errors.py`（Story Memory 输入/伏笔异常）、`atoms.py`（MemoryAtom CRUD/有效期读取/embedding 文本/record 转换）、`foreshadow_lifecycle.py`（伏笔状态机与生命周期快照）、`arbitration.py`（冲突检测与提案仲裁）、`extract.py`（memory_extract 白名单写入）、`recall.py`（场景召回、pgvector 候选排序、语义/关键词打分）。`service.py` 已退为旧路径 facade + re-export，验证见 `.codex/verification-report.md` 的 “B4 重构验证（2026-06-29，完成）”。
- **保留在 facade 的职责**：无业务写库事实源留在 facade；它只作为旧 `app.domains.story_memory.service` interface 的兼容 seam，供 router、BookRun、ScenePacket、IDE、guard 和测试继续从旧路径访问。
- **硬约束**：52 个旧类/函数名全部仍可从 `service.py` 访问；`recall.py` 显式使用 `logging.getLogger("app.domains.story_memory.service")` 保持 pgvector caplog 契约；`story_memory/__init__.py` 不做转导出；conflict_id sha1 截断、排序 key、伏笔状态机表与抽取 payload 规则保持不变。

### B5 · studio/service.py（764→53，完成）
- **已完成并验证**：`source_reads.py`（作品列表、章节目标、Scene Packet 摘要）、`review_reads.py`（Judge 评审、Repair Patch 摘要、共享 `_studio_repair_patch` adapter）、`recovery_reads.py`（失败恢复摘要）、`approval.py`（批准摘要与唯一 commit 点）、`chapter_review.py`（主动章节审阅顶层编排）。`service.py` 已退为旧路径 facade + re-export，验证见 `.codex/verification-report.md` 的 “B5 重构验证（2026-06-29，完成）”。
- **保留在 facade 的职责**：无业务读写事实源留在 facade；它只作为旧 `app.domains.studio.service` interface 的兼容 seam，供 router、IDE command registry 和测试继续从旧路径访问。
- **硬约束**：旧 `service.py` 的 41 个类/函数名全部仍可访问；router 需要的 8 个公开函数 + 7 个异常类保持旧路径；IDE `judge.approve` 仍可从旧路径导入 `StudioApprovalSummaryNotFoundError` / `approve_studio_writeback`；新模块不反向 import `studio.service`；`approval.py` 是唯一执行 `session.commit()` 和清理 book context cache 的 commit 点；`_studio_repair_patch` 只有 `review_reads.py` 一个实现。

### IS · ide/service.py（738→51，当前合理边界完成）
- **已完成并验证**：`_coerce.py`（`_int_or_none`/`_string_or_none`/`_context_href` 叶子工具）、`command_registry.py`（IDE command catalog、Judge/Repair/Approve/BookRun WritingRun adapter、审计事件写入）、`artifact_preview.py`（Artifact Viewer 预览/版本/追溯链）、`workspace_reads.py`（Explorer tree、场景正文、诊断投影）、`context_snapshot.py`（Context Inspector 快照）、`story_memory_query.py`（Story Memory Explorer 过滤与冲突队列）、`run_events.py`（BookRun → IDE Run Panel SSE 投影）。`service.py` 已退为旧路径 facade + re-export，验证见 `.codex/verification-report.md` 的 “IS 重构验证（2026-06-29，完成）”。
- **保留在 facade 的职责**：无业务编排留在 facade；它只作为旧 `app.domains.ide.service` interface 的兼容 seam，供 router、live AgentRuntime、`ide/orchestrator.py` 兼容 facade 和测试继续从旧路径访问。
- **硬约束**：35 个旧类/函数名全部仍可从 `service.py` 访问；`execute_ide_command_by_id` / `IdeCommandNotFoundError` / `IdeCommandExecutionError` 旧路径继续被 router、runtime、orchestrator 共用；`StoryForge IDE ??` 审计 workspace fallback 文案保持不变；`router.py` 不动。

### RT · retrieval/+model_runs（657→137+88，完成）
- **已完成并验证**：retrieval 拆为 `scoring.py`（关键词/相似度/评分/rerank）、`candidate_loader.py`（keyword/pgvector 候选裁剪和日志）、`indexing.py`（资料源创建/刷新/chunk 构建）、`workbench.py`（工作台列表与投影），`service.py` 保留 `search_retrieval` / `search_retrieval_workbench` 装配核心 + 旧路径 re-export；model_runs 拆为 `recording.py`（ModelRun 写入、引用校验、workflow payload adapter）和 `runs_diagnostics.py`（Runs JobRun 诊断、runtime tools 投影、retry），`service.py` 保留 list/query seam 与 source-pruning wrapper。验证见 `.codex/verification-report.md` 的 “RT 重构验证（2026-06-29，完成）”。
- **保留在 facade 的职责**：retrieval `service.py` 仍是搜索装配 seam，确保 `monkeypatch.setattr(retrieval_service, "_score_chunk", ...)` 会影响 `search_retrieval`；model_runs `service.py` 仍持有 `list_model_runs` / `build_model_run_list_query` 和字面 `def get_runs_job_run(` / `def record_workflow_model_run_payload(` wrapper，满足分页与 source-pruning interface。
- **硬约束**：retrieval 旧 `service.py` 的 36 个类/函数名、model_runs 旧 `service.py` 的 30 个类/函数名全部仍可访问；`story_memory.recall` 私有导入 `retrieval.service._cosine_similarity` 保持；`_log_search_candidate_load` logger 名称保持 `app.domains.retrieval.service`；`ModelRunError` 单一定义在 `recording.py` 并经旧路径回引；`test_source_pruning.py` 要求的 source markers 留在 model_runs `service.py`。

### C1 · ChatWindow.tsx（2270→1031，风险中/M，当前合理边界完成）
- **已完成并验证**：`chat-window/types.ts`、`path-utils.ts`、`agent-step-mapping.ts`、`writing-run.ts`、`review.ts`、`request-payload.ts`、`conversation-utils.ts`、`display-utils.ts`、`Composer.tsx`、`panels.tsx` 已提取；`ChatWindow.tsx` 保持旧 named export、`StableAgentRequestPayload` type re-export 与 `WritingRunProgressPanel` 兼容 re-export。验证见 `.codex/verification-report.md` 的 “C1 ChatWindow pure helpers” 与 “C1 ChatWindow panels/Composer”。
- **保留在壳层的职责**：`runAuthorAgent` 主闭环、WebSocket/事件监听、当前文件 flush/read、context append、AgentRun 状态组合、写回/导出桥接。继续抽 hook 会把最复杂异步闭环拆成浅模块，后续只有在重写 Agent orchestration 时再评估深模块。
- **唯一硬约束**：测试 + App.tsx 从 `'../ChatWindow'` import named exports → ChatWindow.tsx barrel re-export 全部维持。共享类型集中 `chat-window/types.ts`，子模块不反向 import ChatWindow。

### C2 · App.tsx（完成，当前合理边界）
- **已完成并验证**：`components/app/helpers.ts` 承载路径/最近项目 key/Assistant session 存取；`WindowMenu.tsx`、`CodexSidebar.tsx`、`WelcomeWorkspace.tsx`、`RightWorkspace.tsx` 与 `icons.tsx` 承载窗口栏、项目库、欢迎/Agent 工作台、右侧编辑工作台和 app 壳层图标；`useShellLayout.ts` 承载布局状态机；`useProjectWorkspace.ts` 承载项目/文件 recent state 与 Assistant session mapping；`useTauriMenuBridge.ts` 承载 Tauri menu listener、smoke API ready 标记和 unlisten 清理。
- **保留在 App 的职责**：根壳层装配、Settings/CommandPalette 开关、新建文件与初始化项目命令、各子模块事件 wiring、`desktop-shell` / `assistant-panel` 源文本护栏。继续把 JSX 装配再拆会制造浅模块，当前 `App.tsx` 约 333 行是合理壳层。
- **硬约束**：`app.test.tsx` 依赖的 `WindowMenu`、`CodexSidebar`、`AgentWorkspace`、`RightWorkspace`、`DynamicIDELayout`、`desktop-shell`、`assistant-panel` 字面 marker 继续在 `App.tsx` 可见；`window.prompt` / `confirm` / `alert` 文案仍留在新建文件命令处；Tauri menu bridge 仍注册 save/close/toggle/sidebar/smoke reset 事件。
- **验证**：见 `.codex/verification-report.md` 的 “C2 重构验证（2026-06-29，完成）”。行为变更=false，纯文件级移动 + hooks 下沉。

### C3 · Editor.tsx（完成，当前合理边界）
- **已完成并验证**：`editor/decorations.ts` 承载 `locateEvidence` / `issueDecorationOptions` / severity color 归一；`editor/VersionHistory.tsx` 承载历史列表/分支图侧栏、版本读取、列表筛选、`BranchCanvas` 接线与 `formatTimestamp`；`editor/useBranchManifest.ts` 承载分支清单加载、选择、开分支、推进 head 与落盘；`editor/useSuggestionWriteback.ts` 承载建议补丁接收、接受/分块接受、旁注保存、修订结果事件监听、Agent 写回快照与闭环记录；`editor/useEditorFileLoader.ts` 承载文件加载、加载态与切换文件清理；`editor/useMonacoEditor.ts` 承载 Monaco 实例生命周期、dirty/auto-save、快捷保存、gutter issue click、smoke controller 与 loadedContent 同步。
- **保留在 Editor 的职责**：保存/快照/分支推进、导出、历史恢复/checkout/branch from node、工具栏与关键 data-testid/source marker。继续拆保存/导出会跨 author-loop、版本快照和分支血缘，建议等运行期编辑器写回护栏更强后再评估。
- **硬约束**：`recordRevisionLoop` / `emitAuthorLoopResult` / `editor-save-btn` / `editor-export-btn` 继续在 `Editor.tsx` 源文本可见；文件切换仍清 issue decorations；Monaco change listener 继续更新 dirty 状态；auto-save 与 Ctrl/Cmd+S 通过 ref 读取最新 `handleSave`，避免重建编辑器。
- **验证**：见 `.codex/verification-report.md` 的 “C3 重构验证（2026-06-29，完成）”。行为变更=false，纯文件级移动 + lifecycle hooks 下沉。

### C4 · api-client.ts/project-context.ts（670+372→50+15，完成）
- **已完成并验证**：`lib/api/` 拆为 `types.ts`、`config.ts`、`errors.ts`、`codecs.ts`、`assistant.ts`、`agent-socket.ts`、`run-events.ts`；`lib/project/` 拆为 `types.ts`、`path.ts`、`semantics.ts`、`index.ts`、`initialize.ts`、`context-bundle.ts`。
- **保留在 barrel 的职责**：`src/lib/api-client.ts` 与 `src/lib/project-context.ts` 只做旧路径 re-export，所有调用方仍从原路径 import；REST/SSE/WS、payload codec、project semantic index、初始化和 context bundle cache 的实现知识下沉到各自深模块。
- **硬约束**：`contextBundleCache` 单例整体留在 `project/context-bundle.ts`，没有拆成两份；`toAssistantContextBundlePayload` 仍经 `api-client.ts` barrel 可用，满足 `project-context.test.ts` 跨用；子模块直接 import 叶子模块，不经 barrel 互引。
- **验证**：见 `.codex/verification-report.md` 的 “C4 重构验证（2026-06-29，完成）”。行为变更=false，纯文件级移动 + REST 解码护栏补齐。

### D1 · book_loop.py+book_run_adapter.py（完成）
- **已完成并验证**：`book_loop_types.py` 承载 BookLoop 数据类、错误和 Callable 别名；`book_loop_budget.py` 承载预算/降级暂停；`book_loop_scheduling.py` 承载并行窗口、预取和 integration metrics；`book_loop_results.py` 承载 progress/checkpoint/result 投影；`book_run_adapter_types.py` 承载 adapter request/ports/sink；`book_run_adapter_coerce.py`、`book_run_adapter_payload.py`、`book_run_adapter_volume.py` 分别承载标量清洗、dispatch payload/narrative plan adapter 和卷计划投影。
- **保留在主文件的职责**：`book_loop.py` 保留顺序/并行章节执行闭环、precommit/commit side effects 调用点和旧路径 re-export；`book_run_adapter.py` 保留 `run_book_run_dispatch_payload` 与 `run_book_run_with_skill_runner` 主编排闭包，避免把 NovelSkillRunner 生命周期拆成浅模块。
- **硬约束**：`ChapterConsistencyReport` 等旧 `book_loop.py` import path 继续可用；adapter 的 `_bool_value` / `_int_or_default` / `_positive_int_or_zero` 等旧 helper 经旧路径可达；两套相似标量 helper 没有合并，保留各自语义。
- **验证**：见 `.codex/verification-report.md` 的 “D1 重构验证（2026-06-29，完成）”。行为变更=false，纯文件级移动 + 兼容回引。

### D2 · checkpoints.py（完成）
- **已完成并验证**：`checkpoint_records.py` 承载 RuntimeRecord/RuntimeStateSnapshot/RuntimeModelRunRecord 与行投影 helper；`model_run_sink.py` 承载 ModelRunPayload、ModelRunSink、ApiModelRunAdapter 和 observability 字段提升；`memory_checkpoint_store.py` 承载显式测试替身；`sqlite_checkpoint_store.py` 承载 SQLite store、连接复用、WAL 配置、write-behind 和默认路径；`checkpoints.py` 退为约 62 行旧 interface facade。
- **保留在 facade 的职责**：旧 `storyforge_workflow.runtime.checkpoints` import path 继续可用，`sqlite3` 继续作为 monkeypatch 入口；`RuntimeCheckpointStore` 的 `_connect`、`_connection` 等测试 surface 仍在实例类上。
- **硬约束**：旧 24 个顶层类/函数名全部仍可从 `checkpoints.py` 访问；`test_workflow_lifecycle` 的 `checkpoints.sqlite3.connect` monkeypatch 仍影响真实连接；`_default_sqlite_path` 仍位于 runtime 同层模块，`Path(__file__).parents[2]` 默认落库路径不漂移。runner.py 本轮不拆，失败回写收敛留后续逻辑重构独立评估。
- **验证**：见 `.codex/verification-report.md` 的 “D2 重构验证（2026-06-29，完成）”。行为变更=false，纯文件级移动 + 兼容回引。

### D3 · provider_adapter.py（664→362，完成）
- **已完成并验证**：`provider_errors.py`（ProviderErrorKind/ProviderError/HTTP 分类/Retry-After/错误 body 读取）、`provider_usage.py`（token 估算、成本估算、真实 Chat Completion usage 解析）、`provider_fallback.py`（FallbackProviderAdapter、fallback metadata、Sentry breadcrumb、OpenAI-compatible fallback 调用与畸形响应校验）已外移并经 `provider_adapter.py` 旧路径回引。
- **保留在 adapter 的职责**：`ProviderRequest` / `ProviderResponse` / `ProviderAdapter` interface、`ProviderClientAdapter`、`MockProviderAdapter`、默认 provider 装配 factory、parity harness。`test_source_pruning.py` 明确要求 `ProviderParityCase` / `ProviderParityResult` / `ProviderParityHarness` 字面类定义留在 `provider_adapter.py`，因此不再新建 `provider_parity.py`。
- **硬约束**：`provider_adapter_module.generate_chat_completion` 与 `provider_adapter_module.provider_config` monkeypatch 目标仍在旧模块命名空间；`def _estimate_token_count(` / `def _estimate_cost(` 字面 wrapper 保留，`_estimate_token_usage` 不回归；runtime 包级入口仍不转导出 parity harness；`provider_client.py` 本轮不动。
- **验证**：见 `.codex/verification-report.md` 的 “D3 重构验证（2026-06-29，完成）”。行为变更=false，纯文件级移动 + 兼容回引。

### D4 · prompts/builder.py+context.py（573→facades+helpers，完成）
- **已完成并验证**：`_render.py`（无依赖底座：返回任务边界、section render、join）、`_sections.py`（作品策略、角色、创作准则、文风、叙事位置、ChapterBeat、连续性、节奏等 prompt sections）、`_continuity_budget.py`（连续性排序、POV/章节匹配、预算累加和环境变量读取）。`builder.py` 仍保留公开 prompt builder 字面定义和关键字符串契约；`context.py` 仍保留 `narrative_context_from_state` 与旧 private helper 回引。验证见 `.codex/verification-report.md` 的 “D4 重构验证（2026-06-29，完成）”。
- **保留在 facade 的职责**：`builder.py` 是 prompt 构建器旧 interface，保留 `build_draft_prompt` length_line 分支、critique/revision 字符串契约和 `score_dimensions` 唯一性；`context.py` 是 GenerationState adapter 旧 interface，保留 narrative context 装配。
- **硬约束**：builder 旧 22 个函数名、context 旧 20 个函数名全部仍可访问；`prompts/__init__.py` 仍是唯一公开聚合层且不转导出 prompt models；continuity sort key 元组与预算累加分支保持旧语义。

---

## 附录 B · 与既有文档关系

- 本计划**取代** `refactor-elegance-plan.md` 作为重构主入口；后者的 A 区记录与 E1 条目仍有效，E2 细化见本文件第 3 层。
- `module-isolation-scorecard.md`（2026-05-24）多项已过时，校正见 §1.3；其「评分口径」表仍可作模块健康度参考。
- E1 边界图 `e1-ide-orchestrator-boundary.md` 是 E2 的直接前提。
- 执行流程遵循 `AGENTS.md` 与 `AI_ITERATION_GUIDE.md`；证据回填 `.codex/verification-report.md`。
