# StoryForge 架构重构总计划（Refactor Master Plan）

> 生成时间：2026-06-27
> 最近校准：2026-06-28（对齐当前工作树与 `.codex/verification-report.md`；只把有验证记录的刀标为完成）
> 定位：本文件是 StoryForge「全方位打磨更优雅」的**统领级总计划**，统一两条既有视角——god-file 结构解耦（原 `refactor-elegance-plan.md` 的 A–F backlog）与架构边界整治（原 `module-isolation-scorecard.md` 的痛点定位）——并按**可维护性优先**重新排序、补足执行细节。
> 上位约束见 `AGENTS.md`；本文件取代 `refactor-elegance-plan.md` 作为重构主入口，后者保留为 A 区历史记录。
> 证据来源：2026-06-27 一轮 16 张文件重构卡 + 6 项架构主题的只读侦察（逐函数簇、import 拓扑、护栏测试、monkeypatch 陷阱均已落到 `file:line`）。

---

## 当前状态快照（2026-06-28 校准）

完成状态只按**已接入代码 + 已跑本地门禁 + 已写入 `.codex/verification-report.md`** 计数；工作树里存在但未接入、未验证、未留痕的草稿，不能当作已完成。

| 条目 | 状态 | 当前事实 | 下一刀入口 |
|------|------|----------|------------|
| A 区 `agent_runs/runtime.py` 解耦 | ✅ 完成 | PR #19/#23 已把 runtime 从 1696 行收敛到约 920 行；当前工作树约 861 行 | 不再作为主计划待办 |
| E1 legacy orchestrator 边界审计 | ✅ 完成 | `docs/internal/e1-ide-orchestrator-boundary.md` 已落地 | 作为 E2 前提继续引用 |
| E2-1/E2-2 legacy orchestrator 收口前置 | ✅ 完成 | E2-1 已迁异常类；E2-2 已完成 live/legacy intent 与 chapter helper 对账，验证见报告 E2-2 | 继续 E2-3 行为变更迁移 |
| B1 `book_generation.py` 拆分 | ✅ 完成（当前合理边界） | metrics/LLM/errors/judge/preflight/progress/CLI/records/serial_metrics 九刀均已接入 facade 并验证；`book_generation.py` 当前约 662 行 | 不再继续机械拆；后续只在改动主循环时重评章节生成/蓝图/断点是否需要深模块 |
| `book_generation_judge.py` | ✅ 完成 | 已接入 `book_generation.py` facade；`_judge_and_repair_loop`/阈值常量旧路径 identity 已验证；B1 focused 测试 65 passed, 1 skipped | 不再作为草稿处理 |
| 前端 G1/G2/G3 护栏 | ✅ 完成 | `editor.test.tsx` / `chat-window.test.ts` / `app.test.tsx` 已补静态渲染与源文本结构护栏；桌面单元 59 passed，typecheck 通过；C1 已完成当前合理边界 | 可开始 C2/C3 拆分；每刀继续跑桌面 test/typecheck |

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
| **B2** | `book_runs/service.py`(+`book_context.py`) | 951 + 423 | 1110 + context | BookRun 生命周期 + 进度投影 + timeline 同步 + dispatch 装配 | 待拆 | 中 |
| **B3** | `judge/service.py` | 824 | 975 | 确定性规则 + 语义 LLM judge + style 指纹基线 | 待拆 | 中 |
| **C1** | `desktop/.../ChatWindow.tsx` | 1031 | 2270 | Agent 对话主壳层；types/utils/mapping/review/request payload/display panels/Composer 已外移到 `chat-window/` | ✅ 完成（当前合理边界） | 中 |
| **C2** | `desktop/.../App.tsx` | 1397 | 1489 | 根组件：全局状态机 + Tauri 桥 + 17 子组件 | 护栏就绪，待拆 | 中 |
| **C3** | `desktop/.../Editor.tsx` | 553 | 1119 | Monaco 生命周期 + 保存/导出/恢复壳层；issue decorations、VersionHistory、分支清单与建议写回 hook 已外移 | 🟡 进行中（接近当前合理边界） | **高** |
| **B4** | `story_memory/service.py` | 733 | 863 | 记忆 CRUD + 伏笔状态机 + 召回打分 + 仲裁 | 待拆 | 中 |
| **IS** | `ide/service.py`(+`router.py`) | 631 + 312 | 738 + router | command registry + Artifact 预览 + 快照 + run 事件 | 待拆 | 中 |
| **B5** | `studio/service.py` | 640 | 764 | 读取摘要 + 主动评审编排 + 批准写回 | 待拆 | 中 |
| **C4** | `desktop/.../api-client.ts`(+`project-context.ts`) | 670 + 372 | 740 | REST+WS+SSE 混装 + 类型守卫 + payload 映射 | 待拆 | 中 |
| **D1** | `workflow/orchestrators/book_loop.py`(+`novel_loop`+`book_run_adapter`) | 624 + 238 + 629 | 711 | LangGraph 整书编排三件套 | 待拆 | 中 |
| **D2** | `workflow/runtime/checkpoints.py`(+`runner.py`) | 620 + 502 | 711 | checkpoint 持久化 + ModelRun adapter + 执行循环 | 待拆 | 中 |
| **D3** | `workflow/runtime/provider_adapter.py`(+`provider_client.py`) | 558 + 259 | 664 | provider 边界 + 错误分类 + fallback + parity | 待拆 | 中 |
| **RT** | `retrieval/service.py`(+`model_runs/service.py`) | 576 + 488 | 657 | 检索装配/打分 + ModelRun 写入/诊断 | 待拆 | 中 |
| **D4** | `workflow/prompts/builder.py`(+`context.py`) | 509 + 243 | 573 | 分层 prompt 构建 + 上下文装配 | 待拆 | 低 |
| **E** | `ide/orchestrator.py`（legacy） | 1229 | 1389 | Agent 流水线冻结副本，仅 chapter.* 仍 live 可达；异常类已迁出 | E2-1 完成 | 中 |

\* B1 风险「高」源于 import 拓扑（`book_generation_parallel.py` 用 `generation.<name>` 属性访问 20+ 私有符号 + 测试直接 import 私有符号），非缺护栏。

### 1.2 六大架构主题（按当前事实，非旧 scorecard）

| 主题 | 当前状态 | 优先级 |
|------|----------|--------|
| **T1** Context/ScenePacket/Retrieval/Continuity 边界 | 旧 P0「最恶心第一名」已**大幅过时**：scene_packets 仅 103 行+4 薄模块、四域单向无环。残留单点：`assemble_scene_context` 编排 + packet 裸 dict 缺 schema + 两套预算口径并存 | P1 |
| **T2** Workflow runtime adapter 桥接 | 旧 P1 隔离建议**已大部分落地**：图节点只认 `GenerationState` 引用态。残留：adapter 层自身 god-file（checkpoints/book_run_adapter/runner）+ 跨文件重复标量 helper | P2 |
| **T3** legacy `ide/orchestrator.py` 收口（E2） | E1 已画边界；E2-1 已迁 `AgentOrchestrationError`；E2-2 已对账 intent/helper 漂移。当前跨边界 live 符号剩 `orchestrate_agent_message`；`chapter.review`/`chapter.repair` 仍走 legacy fallback；`runtime.py` 仍有 `_judge_run_args_from_scene_packet` 等迁移半成品死代码 | 高 |
| **T4** 共享契约一致性 | **生成类型零消费**（generated 9955 行全仓 0 import）+ Desktop 全程手写解码 + 错误模型四处各自为政 | P1 |
| **T5** 横切一致性 | 错误处理**双轨制**（部分域绕开 DomainError）+ LLM 客户端**4 份重复**且行为不一致；「禁止假数据兜底」铁律抽样**通过** | P1 |
| **T6** 测试护栏地图 | 后端/workflow 充足；前端三大组件已补第一层 render/source 结构护栏，后续拆分仍需逐刀扩充行为特征测试 | P1 |

### 1.3 scorecard 过时项校正（重要）

旧 `module-isolation-scorecard.md`（2026-05-24）多项结论已不成立，本计划据**当前**事实修订：

- ❌「scene_packets/service.py 一个函数干 7 件事」→ 已拆为 4 薄模块，service.py 仅 103 行。
- ❌「Context/ScenePacket/Retrieval 是最恶心第一名（P0）」→ 降为 P1 局部问题（单点：`assemble_scene_context` + packet 缺 schema）。
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
| **C3** | `Editor.tsx` → `editor/`（VersionHistory/3 hooks） | 553→装配壳 | L | 高 | decorations/VersionHistory/useBranchManifest/useSuggestionWriteback 已完成；G1 已完成 |
| **C2** | `App.tsx` → lib + 3 hooks + `components/shell/` | 1397→装配壳 | L | 中 | G3 已完成 |
| **B2** | `book_runs/service.py` → progression/timeline/dispatch/gate 薄模块 | 951→~240 | M | 中 | 护栏充足 |
| **B3** | `judge/service.py` → types/semantic/deterministic/consistency/style | 824→~90 | M | 中 | 先补 deterministic 纯函数特征测试 |

### Wave 3 · 后端域收口 + 前端 client + workflow

| # | 条目 | 文件→目标 | 工时 | 风险 |
|---|------|----------|------|------|
| **B4** | `story_memory/service.py` → foreshadow/recall/vector/extract/arbitration | 733→facade | M | 中 |
| **IS** | `ide/service.py` → command_registry/artifact_preview/workspace/snapshot/run_events | 631→facade | M | 中 |
| **B5** | `studio/service.py` → source/review/chapter_review/approval/recovery reads | 640→facade | M | 中 |
| **C4** | `api-client.ts`/`project-context.ts` → `lib/api/`+`lib/project/` barrel | 670+372→barrel | M | 中 |
| **RT** | `retrieval/`+`model_runs/` → scoring/loader/indexing/workbench + recording/diagnostics | 576+488→facade×2 | M | 中 |
| **D1** | `book_loop.py`+`book_run_adapter.py` → types/budget/scheduling/results + payload/volume | 624+629 | M | 中 |
| **D2** | `checkpoints.py` → records/sink/memory_store/sqlite_store/helpers | 620 | M | 中 |
| **D3** | `provider_adapter.py` → errors/usage/fallback/parity | 558 | M | 中 |
| **D4** | `prompts/builder.py`+`context.py` → _render/_sections + _continuity_budget | 509+243 | M | 低 |

---

## 第 3 层 · 架构边界整治（横切，多含行为变更，单独评审）

> 这些条目**不是纯文件移动**，杠杆高但风险高，必须与第 2 层拆分刀严格分离、独立小步 PR。

### E2 · legacy orchestrator 收口（高优先，4 刀串行）

E1 边界图（`docs/internal/e1-ide-orchestrator-boundary.md`）已证：跨边界 live 符号原本只有 `AgentOrchestrationError`（5 处 import）+ `orchestrate_agent_message`（仅 fallback）。2026-06-28 E2-1 已把 `AgentOrchestrationError` 迁到 `agent_runs/errors.py`，`ide/orchestrator.py` 仅回引 re-export。当前剩余跨边界 live 符号只有 `orchestrate_agent_message`；只有 `chapter.review`/`chapter.repair` 经 `legacy.orchestrator` 兜底可达。`runtime.py` 仍存在 `_judge_run_args_from_scene_packet` 等 helper 但无调用点（迁移半成品死代码）；迁移会使 `runtime_mode` 从 `legacy_adapter` 变 `agent_runtime`。

1. ✅ **E2-1（低风险，已完成）**：新建 `agent_runs/errors.py`，迁 `AgentOrchestrationError`，5 处 live import 切源，orchestrator 回引。解除「薄模块反向依赖胖模块」。零行为变更。验证见 `.codex/verification-report.md` 的 “E2-1 重构验证（2026-06-28）”。
2. ✅ **E2-2（对账，不改码，已完成）**：已逐字段比对 live/legacy `_detect_intent` 与 `_judge_run_args_from_scene_packet`，结论写入 `.codex/verification-report.md` 的 “E2-2 对账验证（2026-06-28）”。关键结论：intent 仅在 reviewer role hint/mention + file context + 中性话术上漂移；chapter helper 主体查询/返回键一致，但 `_string_list`/`_style_rules` 清洗语义漂移，E2-3 迁移时必须保留 legacy payload 语义或显式评审行为变更。
3. **E2-3（行为变更，单独 PR）**：迁 `chapter.review`/`chapter.repair` 两条编排入 live（新 `agent_runs/chapter_review.py` 或 runtime handler），复用 886-921 死代码使其转活，`else` 分支改走 live。`行为变更=true`，用 `test_ide_agent_orchestrator.py` 端到端锁死输出；迁移前先按 E2-2 结论处理 `style_rules`/字符串清洗漂移。
4. **E2-4（删除收尾）**：死集随迁随删，下线 `legacy.orchestrator` 工具与 `orchestrate_agent_message`，评估 orchestrator.py 整文件删除。

### T4 · 共享契约一致性（P1）

- **纯拆分先行**（零行为变更）：`api-client.ts` 按传输边界拆 rest-client/agent-socket/run-events（barrel 兼容）；手写 payload 映射下沉 `lib/api/codecs.ts`；错误模型统一到 `lib/api/errors.ts`。
- **决策项（行为/构建变更，单独立项）**：要么让 Desktop 真正消费 `generated/api-types.ts`（OpenAPI 漂移在 typecheck 暴露），要么判定 generated 管线为死代码并下线，停止 9955 行空转。**二选一，不暧昧。**
- 前置：先补 `requestRevision`/`probeProviderHealth`/`readErrorDetail` 的 REST 解码测试护栏（当前零覆盖）。

### T5 · 横切一致性（P1）

- **错误处理统一**（行为变更，独立 PR）：`assistant`/`ide`/`book_generation`/`agent_runs` 的领域异常基类从裸 `RuntimeError`/`Exception` 改派生 `DomainError` 子类，走全局 handler，删 router 内手工 try/except（28+9+8 处）。
- **LLM 客户端收敛**（零行为变更部分）：把 `book_runs`↔`assistant` 已共享的 OpenAI 兼容客户端抽到 `common/llm_http.py`；**judge 留待行为对齐**（其鉴权头/base_url 回退与 book_runs 不一致，差异是行为携带，不可在纯移动刀抹平）。
- **禁区标注**：`QualityDashboardInputError`/`ScenePacketInputError` 名为 Input 实继承 404，是行为携带分类，任何刀不得在纯移动中改其继承/命名。
- **铁律核验通过**：「不创建假数据兜底」抽样未发现违规，无需整改。

### T1 · Context/ScenePacket/Retrieval 边界固化（P1，降级自旧 P0）

- 为 ScenePacket 的 `packet` 裸 dict 引入显式 schema（`ScenePacketBody` TypedDict/Pydantic），收敛散落在 budget/context_pipeline/retrieval_bridge 三处的键写入。先只引入类型 + golden 快照，不改赋值顺序。
- `assemble_scene_context` 三处内联 dict 写入抽成命名纯函数，编排变线性「取数→组装→合并」。
- 拆 `retrieval_bridge.py` 为 `retrieval_query.py`（出站检索）+ `context_blocks.py`（出站上下文编译），命名对齐真实职责。
- 为「两套预算口径并存」写对账 golden 测试固化现状（本刀不统一）。

### T2 · Workflow runtime adapter（P2）

- `checkpoints.py` 按关注点拆 records/payload+sink/memory_store/sqlite_store/helpers（facade re-export，保 monkeypatch 路径）。
- `book_run_adapter.py` 拆 dispatch/volume_plan（注意 `book_generation_parallel.py` 的 `importlib` file-module 加载清单需联动）。
- 共享标量 helper 抽 `runtime/_coercion.py`（只合并三处逐字一致版本，不碰语义不同的 positive/bool 变体）。
- runner.py 失败回写收敛属逻辑重构，单列后续独立评估。

---

## 第 4 层 · 执行波次与推荐顺序

```
Wave 0（前端护栏）   G1 Editor测试 ─┐  G2 ChatWindow测试 ─┐  G3 App测试 ─┐   并行可做
                                    │                     │             │
Wave 1（最大live）   B1 已完成 ───────┼──── C1 ←────────────┘             │
                     AS              │                                   │
                                     │                                   │
Wave 2（产品+次大）  C3 ←─────────────┘     C2 ←──────────────────────────┘
                     B2   B3
                                     │
Wave 3（收口）       B4 IS B5 C4 RT  D1 D2 D3 D4   （彼此独立，可穿插）
                                     │
横切（独立评审）     E2(1→2→3→4)   T4纯拆分→决策项   T5错误统一/LLM收敛   T1边界  T2adapter
```

**推荐节奏：**
1. **Wave 0 已完成**：G1/G2/G3 第一层前端护栏已落地；后续拆分继续以 `npm --prefix apps/desktop/frontend run test` + `typecheck` 为门禁。
2. **E2-3 可作为独立行为变更刀排队**：E2-2 已证明迁移前必须处理 chapter helper 清洗语义漂移，不能把 `runtime.py` 现有死代码原样转活。
3. **Wave 2 后续入口**：B1、AS、C1 均已到当前合理边界；C3 已完成 decorations、VersionHistory、useBranchManifest、useSuggestionWriteback 四刀，剩余 `useMonacoEditor` 最深，建议单独评估后再动；也可转入 C2/B2/B3。
4. **Wave 2/3 按域推进**：每域一刀或数刀，每刀 branch→PR→merge + 证据回填。
5. **横切项穿插但严格独立**：T4 决策项、T5 错误统一、E2-3 都是行为变更，必须单独 PR + 评审，不与拆分混做。

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

### B2 · book_runs/service.py（1110→~240，中/M）
- **下沉**：run_progress_projection（纯）、run_timeline_sync（持 Session 只读 Chapter）、workflow_dispatch_plan、longform_context_gate；共享小工具 `_value_coerce.py` 阻断子模块互引。`book_context.py` 本刀不动。
- **逐字保留**：`apply_book_run_progress` 步骤顺序与 commit 时点；evidence_refs 前缀（book_run:/chapter:/...）；STICKY/CONTROLLED_PROGRESS_KEYS 合并语义。

### B3 · judge/service.py（975→~90，中/M）
- **薄模块栈**：`judge_types.py`（叶子底座）← deterministic_rules/semantic_judge/consistency_checks/style_fingerprint；service 留 create_judge_issues + 共享 `_book_id_for_scene/_scene_scope_for_judge`（沉独立 `_scene_scope.py` 避环）。
- **陷阱**：`httpx` monkeypatch 目标（test_judge_semantic/failure_marker）→ semantic 搬走需保证两模块 httpx 同一被 patch 对象，或显式标「移动+测试 patch 目标跟随」；Counter `judge_llm_errors_total` 全局唯一不可重复定义；跨域消费者多（book_generation import 多个私有 helper）→ 全量 re-export。

### B4 · story_memory/service.py（863→facade，中/M）
- **五子模块**：foreshadow_lifecycle/scene_recall/vector_recall/memory_extract/arbitration；底座 `create_memory_atom/_record_to_atom` 留 service（或沉 atoms_core.py）。
- **陷阱**：`logger` name 必须保持 `app.domains.story_memory.service`（test_retrieval_pgvector caplog 断言）；`__init__.py` 不得转导出（test_source_pruning 强约束）→ 靠 service 自身 re-export；conflict_id sha1 截断/排序 key/状态机表逐字不变。

### B5 · studio/service.py（764→facade，中/M）
- **五薄模块**，严格单向：source_reads/review_reads/recovery_reads（叶子）→ approval（唯一 commit 点）→ chapter_review（顶层编排）。
- service 必须 re-export 全部 8 公开函数 + 7 异常类（router 15 项 + ide/service 2 项 import）；跨簇复用的 `_studio_repair_patch` 等不可复制（复制=行为漂移点）。建议拆序：recovery→source→review→approval→chapter_review。

### IS · ide/service.py（738→facade，中/M）
- **六薄模块** + 叶子 `_coerce.py`（_int_or_none/_string_or_none，避多模块各自 import service 成环）：command_registry（最大簇）/artifact_preview/workspace_reads/context_snapshot/story_memory_query/run_events。
- command registry 三符号（execute_ide_command_by_id/两异常）被 router+runtime(live)+orchestrator(legacy)共用 → re-export 兜住；保留既有乱码/占位文案（'StoryForge IDE ??'）不顺手修。router 本身不动。

### RT · retrieval/+model_runs/（657→facade×2，中/M，建议两刀）
- retrieval：scoring（纯）←candidate_loader/indexing/workbench；search_retrieval 留 service 作装配核心。
- model_runs：recording（写入+ModelRunError）/runs_diagnostics（诊断+重试）；查询簇留 service。
- **陷阱**：story_memory import `retrieval.service._cosine_similarity`（私有跨域）→ re-export 保留；test_retrieval_embedding 用 `inspect.getsource`+monkeypatch → 函数体一字不改且 service 命名空间回引；ModelRunError 单一定义。

### C1 · ChatWindow.tsx（2270→1031，风险中/M，当前合理边界完成）
- **已完成并验证**：`chat-window/types.ts`、`path-utils.ts`、`agent-step-mapping.ts`、`writing-run.ts`、`review.ts`、`request-payload.ts`、`conversation-utils.ts`、`display-utils.ts`、`Composer.tsx`、`panels.tsx` 已提取；`ChatWindow.tsx` 保持旧 named export、`StableAgentRequestPayload` type re-export 与 `WritingRunProgressPanel` 兼容 re-export。验证见 `.codex/verification-report.md` 的 “C1 ChatWindow pure helpers” 与 “C1 ChatWindow panels/Composer”。
- **保留在壳层的职责**：`runAuthorAgent` 主闭环、WebSocket/事件监听、当前文件 flush/read、context append、AgentRun 状态组合、写回/导出桥接。继续抽 hook 会把最复杂异步闭环拆成浅模块，后续只有在重写 Agent orchestration 时再评估深模块。
- **唯一硬约束**：测试 + App.tsx 从 `'../ChatWindow'` import named exports → ChatWindow.tsx barrel re-export 全部维持。共享类型集中 `chat-window/types.ts`，子模块不反向 import ChatWindow。

### C2 · App.tsx（1489→装配壳，中/L，依赖 G3）
- **下沉**：path-utils/app-shell-storage（叶子）+ 3 hooks（useShellLayout/useProjectWorkspace/useTauriMenuBridge，由 App 持顶层 state 注入，hook 间不互 import）+ `components/shell/` 子组件家族 + 9 SVG 并入 StoryIcons.tsx。
- **陷阱**：useEffect 顺序/依赖数组承载语义（menu bridge 依赖前两 hook 回调）；eslint-disable set-state-in-effect 注释原样带走；window.prompt/confirm/alert 文案逐字。分多刀：helper→图标→shell 组件→3 hooks。

### C3 · Editor.tsx（1119→553，进行中/高/L，依赖 G1）
- **已完成并验证**：`editor/decorations.ts` 承载 `locateEvidence` / `issueDecorationOptions` / severity color 归一；`editor/VersionHistory.tsx` 承载历史列表/分支图侧栏、版本读取、列表筛选、`BranchCanvas` 接线与 `formatTimestamp`；`editor/useBranchManifest.ts` 承载分支清单加载、选择、开分支、推进 head 与落盘；`editor/useSuggestionWriteback.ts` 承载建议补丁接收、接受/分块接受、旁注保存、修订结果事件监听、Agent 写回快照与闭环记录。`Editor.tsx` 源文本护栏继续通过，并保留 `recordRevisionLoop` / `emitAuthorLoopResult` / `editor-save-btn` / `editor-export-btn` 可见引用。验证见 `.codex/verification-report.md` 的 “C3 Editor decorations”、“C3 Editor VersionHistory”、“C3 Editor useBranchManifest” 与 “C3 Editor useSuggestionWriteback”。
- **剩余入口**：useMonacoEditor（最深，单独 PR/单独手动冒烟）。当前 `Editor.tsx` 已接近合理装配壳边界；继续拆 Monaco 生命周期前，建议先补更贴近运行期的编辑器/写回集成护栏。
- **e2e 静态断言陷阱**：`ide-judge-repair.spec.ts`/`ide-shell.spec.ts` 用 `readFileSync(Editor.tsx)` 断言源文本含 `recordRevisionLoop/emitAuthorLoopResult/editor-save-btn/editor-export-btn` → 这些符号可见引用必须留在 Editor.tsx（工具栏 JSX 留壳层、写回 hook 留薄包装）。共享 ref 由壳层创建注入，hooks 间零互 import。**每刀配桌面手动冒烟**（无组件级运行期单测）。

### C4 · api-client.ts/project-context.ts（740→barrel，中/M）
- api→`lib/api/`：config/agent-messages（叶子）/assistant/agent-socket/run-events；project→`lib/project/`：semantic-index（叶子）/context-bundle。原文件退 barrel re-export。
- **陷阱**：`contextBundleCache` 模块级单例 Map 整块迁移不可拆两份；`toAssistantContextBundlePayload` 被 project-context.test 跨用 → barrel re-export 关键；子模块直接 import 叶子，绝不经 barrel（避环）。

### D1 · book_loop.py+book_run_adapter.py（711，中/M）
- 先抽叶子 `book_loop_types.py`（数据类+Callable 别名，断 arc_consistency 反向引用环）；book_loop 留执行核心，旁挂 budget/scheduling/results；adapter 抽 payload/volume_plan，闭包 `run_book_run_with_skill_runner` 留主文件。
- **陷阱**：`arc_consistency` 已 `from book_loop import ChapterConsistencyReport` → 下沉数据类后 book_loop re-export；两套 `_int_value`/`_positive_int_or_zero` 语义同但禁合并。

### D2 · checkpoints.py（711，中/M）
- 拆 records/model_run_sink/memory_store/sqlite_store/helpers；checkpoints.py 退 facade 保留 `import sqlite3`。
- **陷阱**：`test_workflow_lifecycle` monkeypatch `checkpoints.sqlite3.connect`、`test_runtime_runner` patch `runner.execute_provider_text` → facade 保留这些 import；`_default_sqlite_path` 用 `Path(__file__).parents[2]` → 新模块必须同处 `runtime/` 同层否则默认落库路径漂移。runner.py 本轮不拆或仅抽无状态 helper。

### D3 · provider_adapter.py（664，中/M）
- 拆 provider_errors（纯）/provider_usage（纯）/provider_fallback/provider_parity；adapter 留门面 re-export。provider_client.py 本轮不动（被 4 node+runner 直接引用）。
- **陷阱**：`test_source_pruning` 源码文本断言（A 区 provider_execution 留下的结构护栏）→ 改名复核；except 链顺序/__post_init__ 文案逐字；重复 usage 解析禁合并。

### D4 · prompts/builder.py+context.py（573，低/M）
- 严格单向分层：`_render.py`（无依赖底座）←`_sections.py`←builder.py；context 侧抽 `_continuity_budget.py`。`__init__.py` 始终唯一聚合层。
- **逐字保留**：build_draft_prompt length_line 分支、critique score_dimensions 唯一性（test 断言）、continuity 排序 key 元组 + 预算累加分支。

---

## 附录 B · 与既有文档关系

- 本计划**取代** `refactor-elegance-plan.md` 作为重构主入口；后者的 A 区记录与 E1 条目仍有效，E2 细化见本文件第 3 层。
- `module-isolation-scorecard.md`（2026-05-24）多项已过时，校正见 §1.3；其「评分口径」表仍可作模块健康度参考。
- E1 边界图 `e1-ide-orchestrator-boundary.md` 是 E2 的直接前提。
- 执行流程遵循 `AGENTS.md` 与 `AI_ITERATION_GUIDE.md`；证据回填 `.codex/verification-report.md`。
