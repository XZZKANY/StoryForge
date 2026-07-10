# Workflow → IDE-agent 能力迁移 ledger

> **定位**：决定 `apps/workflow`（standalone LangGraph 批量整书编排器）哪些能力值得搬进 live IDE agent（`apps/api/app/domains/agent_runs`）成为 agent 工具、哪些随 managed-BookRun 一并退役。
> **背景**：pivot 方向 = 编辑器原生连载（作者即 oracle），批量自动整书已降级。「workflow 应该是 IDE 的一种能力」的精确落法 = 把 workflow 的**有用部分**做成 agent 工具，standalone app 随之退场——app 本身永不成为 IDE 能力，它的好部分成为。
> **状态**：分析留档，**非执行计划**；时机受质量轨红线约束（见 §4）。
> **生成**：2026-07-10，基于逐文件 discovery（`apps/workflow/storyforge_workflow/` 全域，`.venv` 除外）。

## 0. 两条 grounding 事实（先破误解）

- **`narrative/` 与 `quality/` 无一模块调 LLM**：生成式出口 `generate_text` 只被 `nodes/` 4 文件 + `runtime/provider_*` import（grep 确认）。即 workflow 的「叙事智能」核心**全是确定性规则引擎**，最可复用。
- **命名陷阱**：`collapse_judge.py` / `verdict.py` / `gate_harness.py` 听着像 LLM/语义，实为 100% 确定性规则引擎。
- **`provider_client.py` 已被取代**：`apps/api/app/common/llm_client.py` 是 W3 单一 chat/completions 出口；provider_client 是并行的旧 urllib OpenAI 兼容传输。

## 1. Live IDE agent 现有能力（迁移的「已在」基线）

`agent_runs` 工具循环（`loop_runtime.py`，工具 schema 从 WS spec 单点派生，**不用** workflow registry）：

- **读/观察**：`fs.list/read/search`；`project.consistency` = 机械扫描（词条分布含缺席、时间标记罗列、跨文件重复子句；**不下结论**，无 LLM，`consistency_scan.py`）
- **确定性不变量**：`project.canon` = 薄不变量闸纯函数（唯一持有章窗交叠、时间线声明成环 = 硬矛盾；退场后出场 = advisory），吃作者声明 `canon.json` + 正文重建 presence（`canon_gate.py`）
- **语义（LLM）**：`project.deep_consistency` = judge 对照本地 Character Bible（人物/设定 md），advisory，**无累积状态**（`deep_consistency.py`）
- **生成（LLM）**：`file.create` / `file.revise` / `file.review`

**可见缺口**：正文语义**事实抽取**（canon 只校验作者声明，不从章节抽取事实提议更新）；**丰富文笔气味检测**（consistency 只做机械计数）；**结构化规划**（beat sheet / scene 架构）。

## 2. 三档 ledger

### (a) 已 native 或已被取代 —— 作为重复项随 app 删，不迁移

| workflow 件 | 为何冗余 |
|---|---|
| `prompts/`（builder / context / _render / _sections） | 已复制进 `book_runs.prompts`（W5），API 副本是 live 唯一装机路径 |
| `provider_client.py` | 被 `app/common/llm_client.py`（W3 单一出口）取代 |
| `narrative/forbidden_terms.py` | `judge/deterministic.py` 已自包含等价实现（「避免 import workflow guard」） |
| `nodes/draft_writer.py` 的 critique+revise 环 | native `file.review` + `file.revise` 覆盖 draft→critique→定向重写 |

### (b) 值得搬 —— native agent 真缺的能力（除标注外全为纯函数）

| Tier | workflow 件 | 变成 | 价值 |
|---|---|---|---|
| **1** | `quality/prose_static_check.py`（347L） | advisory「文笔质量」工具 | native `consistency` 只机械计数；此件加陈词/说而非现/信息倾倒/对话密度/OOC 检测 |
| **1** | `narrative/collapse_judge.py` + `gate_harness.py` | 「本场是否承重」工具 | 旗舰规则判定，标 process-only / 无不可逆后果 / 调查模板场景，native 无对应 |
| **1** | `extract/{prompt,parser,facts}` + 一个 LLM 调用 | **canon 抽取 slice** | 补 canon 缺口：读章节 → 提议 `canon.json` 更新（canon 现只校验声明）。注：LLM 调用本身不在此包，须自供 |
| **2** | `entity_budget` / `beat_sheet` / `name_registry` / `repetition_ledger` / `timeline_ledger` | advisory 结构/重复闸 | 连载结构检查（新实体预算、beat 校验、别名冲突、母题重复、可用性矛盾），agent 现无 |
| **2** | `quality/arc_consistency.py` | 弧线兑现追踪 | 连载（钩子/弧线兑现）真需，但**须先从 BookLoop `ConsistencyBarrier` 签名解耦** |
| **3** | `nodes/director` / `scene_architect` | 结构化规划工具 | LLM 耦合 `GenerationState` + provider；与「作者主驾」重叠，优先级最低 |

**随 (b) 一起搬的地基**：`narrative/verdict.py`（共享 `GateVerdict` 类型）+ `narrative/plan.py`（`NarrativePlan`/`ChapterBeat`/`EntityBudget` 数据模型）+ `extract/facts.py`（`NarrativeSceneFact`）。

**关键（决定搬得干不干净）**：tier-1/2 闸都吃**自有 dataclass**（来自 `plan.py`/`facts.py`），**非**批量 `NovelLoopRequest`/`NovelLoopResult` DTO → 可干净搬、不拖批量码。`arc_consistency` 是唯一例外（绑 `NovelLoopResult`），须解耦状态机与 barrier 接线。

### (c) 批量专属 —— 整体可删，随 managed-BookRun 退役

- `orchestrators/*`：`novel_loop` / `book_loop` / `book_run_adapter` / `chapter_scheduler` + 全部 `book_loop_*` / `book_run_adapter_*` 兄弟件
- `graph.py`（LangGraph StateGraph 接线）+ `state.py`（`GenerationState` checkpoint schema）
- `skills/`：`runner`（port-call 审计记录器）/ `audit`（progress→projection）/ `definitions`（7 skill 元数据目录）
- `tools/registry.py`（7 CreativeToolSpec 目录，前端零消费、仅 `/api/runtime-tools` + e2e 比对用，S12 去桥对象）
- `storyforge_api_client.py`（回调 API continuity gate 的 HTTP 传输）

无独立价值——这些**就是**批量管线本身。

## 3. 退役路径（守红线 + pivot「等 n=1」）

1. **dogfood 需要时增量搬**：把一个 tier-1 闸做成 advisory agent 工具（同 canon 建法：`agent_runs` 内新写纯函数，无 LLM，先带 `verdict.py`+`plan.py` 地基）。`prose_static_check` + `collapse_judge` 杠杆最高、碰不到红线。
2. **做 canon LLM slice 时**：`extract/` + 一个模型调用 → 正文事实抽取缺口闭合，喂 `canon.json`。
3. **native 覆盖需求 + n=1 触发生成重评后**：`apps/workflow` + managed-BookRun（`book_generation_parallel`）+ `provider_client` 一刀整删——(c) 档无独立价值。

结论：**salvage ~9 个纯闸 + 抽取搬进 agent，弃批量壳**。一次一个 advisory 工具地搬，非一次性大整合。

## 4. 红线约束（为何不是现在）

`apps/workflow` **删不动**：`book_runs/book_generation_parallel.py` 仍用 importlib 从相邻目录动态加载 `orchestrators/{novel_loop,book_loop}` + `quality/arc_consistency` 跑 managed 整书真·LLM 并发生成，这条**长程生成链受质量轨红线保护**（`apps/api/app/domains/DOMAINS.md` 冻结红线 / `docs/internal/arch-review-blueprint-2026-07-03.md` §9，「n=1 稳定后重评」前一行不删）。`runtime_tools/service.py` 另桥到 `tools/registry.py` 供 `/api/runtime-tools`（前端零消费，S12 去桥非删能力）；`judge/deterministic.py` 已自包含不 import workflow。

→ **workflow 降级/删除 = D1 级质量轨翻案，或 n=1 后**。本 ledger 是那一刀的施工图。

---

相关：`docs/internal/arch-review-blueprint-2026-07-03.md`（蓝图 W5/W7 + F04/F05）、`apps/api/app/domains/DOMAINS.md`（冻结域清单 + 红线）、`docs/内部` 无 workflow 专档（本文件补此空白）。
