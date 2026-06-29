# StoryForge 故事状态模型设计（Story State Model Design）

> 生成时间：2026-06-30
> 定位：本文件是**跨章故事状态层**的设计定稿，回应 `next-step-plan.md` 核心诊断「judge 单章作用域、跨章涌现查不到」与 Q1/Q4 keystone。
> 上位约束见 `AGENTS.md`；当前阶段事实以 `current-phase.md` 为准；架构方向见 memory `project_agent_orchestration_direction` / `project_live_judge_chain_truth`。
> 证据回填见 `.codex/verification-report.md`。**本文件是设计，未实现，不声称任何质量验收**（见 §8）。

---

## 一、为什么需要这层

`next-step-plan.md §一` 已逐行核验的根因：**真实 judge 是单章作用域**（`judge/semantic.py:97` 只判当前章），而退回阻塞（模板化、重复、称谓漂移、伏笔膨胀、收尾失败）全是**跨章涌现**——结构上看不到，所以「自动门禁全 pass、人工通读退回」。

要查跨章，先得有一份**跨章可累积、可回放、可接地的故事状态真值**。这层就是它。设计立场延续仓库三铁律：

- **API 是业务真相源** → 状态是业务真相，落 API domain，不是某条编排循环的内部状态。
- **先做诊断控制台再做生成器** → 状态先服务「查」（grounding + 不变量），不是先服务「生成」。
- **不创建假数据兜底** → grounding 失败明确返回，不伪造 clean 值。

---

## 二、五个设计决策（锁定）

| # | 决策点 | 锁定结论 |
|---|---|---|
| 1 | 状态由谁声明 | **B3**：Writer 在**预填骨架**上自报 + grounding 校核 |
| 2 | 时序模型 | **append-only 事件日志 + 物化当前态投影** |
| 3 | edge / node 切分 | **P2 语义切分**：关系型 → `edge_constraints`；单实体内在状态机 → 新建 `state_ledger` |
| 4 | CHANGES 落法 + 骨架来源 | 工具调用传输 + 花名册挑 id + 两层 grounding + **P-c 混合预填** |
| 5 | 接线点 | **W-c**：路径无关 `story_state` domain 模块，**先接** `_judge_and_repair_loop`，Desktop Agent runtime 后续调同一模块 |

### #1 状态由谁声明 = B3（预填骨架 + 自报 + grounding）

Writer 子 agent 收尾时**自报**本章状态变化，但不是凭空报：系统给它一份**预填骨架**（本章预期涉及的实体/冲突/伏笔槽位，见 #4 来源）。自报防遗漏靠骨架，自报防捏造靠 **grounding 两层校核**：

- **确定性硬闸（反捏造）**：每条 CHANGES 引用的实体，其表面形必须能在本章正文里定位到——Writer 不能声称 `char_001` 行动而正文里它根本没出场。
- **语义咨询（advisory）**：正文是否真支撑这条 delta 的「意思」（LLM、抽样、**扣分不硬断**）。

> 这两层刻意与 live 判定链同构（确定性 `deterministic_judge_fallback` + 语义 `semantic_judge_with_status`），不是另起一套判据。

### #2 时序模型 = append-only + 投影

- **真值源**：`state_event` 追加表，每条带**章戳**，记录类型化 delta。永不原地改。
- **快读**：物化 `state_ledger`（当前态投影），由事件 fold 而来，可随时 DROP 重建。
- **「第 N 章的状态」** = fold 到 N 的事件。
- **回滚**（resume/重跑某章）= 删 `chapter_index > target` 的事件后 reproject。**不裁剪历史**——这避开了一类常见的规模裂缝（截断历史导致远距召回失忆）。
- **多写安全**：DB 事务（串行提交，见 [[project_agent_orchestration_direction]] 锁定的串行状态提交）。
- **附带白捡**：`state_event` 即审计源，逐章 delta 天然可导出进 `audit_report.json`。

### #3 edge / node 切分 = P2 语义切分

判据：**关系型 / 带时间窗 → edge；单实体内在状态机 → node。** 两库不重叠。

- **`edge_constraints`（已 live，不动其表）**：保持现有 3 类 `EdgeKind`（`edge_constraints.py:18` = `relationship / timeline_order / status`）。其中 `status` 是 **subject→object 关系性时间窗**（`_check_status_window` `edge_constraints.py:144`，如「A 与 B 在 ch5-12 结盟」）。
- **`state_ledger`（净新增）**：所有**单实体内在状态机**——等级、位置、冲突阶段、地点/势力状态、伏笔三态、物品持有、秘密知情集、誓约、倒计时。
- **不重叠判据**：edge 的 `status` 是两实体间关系态；node 的 status（如冲突阶段 pending<active<climax<resolved）是单实体内在态。冲突若涉及双方阵营，**关系**进 edge，**阶段**进 node。

> 白捡升级：相较 flat 字符串比较，关系矛盾（同章既盟友又仇敌）与移动链在我们这边变成 `edge_constraints` 图查 / 位置序列检查，**对重名、链式传递更稳**。

### #4 CHANGES 落法 + 骨架来源

**传输 = 工具调用**：Writer 调 `commit_chapter(prose, changes[])`，`changes` 是带类型的结构化项，**schema 在工具层校验 + 重试**——绕开自由文本块解析的脆弱性。

**实体引用 = 花名册挑 id**：骨架带花名册（entity + 稳定 id + 别名）；Writer 报 CHANGES 直接引 `char_001`，不报自由文本名。新实体（花名册没有）→ Writer 标 `new` → 当场幂等铸造 id + 回写花名册。**消解前移到声明时**，事后名字归一那套脆弱基本自动消解。

**骨架来源 = P-c 混合**：

| | 来源 | 抓得到 |
|---|---|---|
| 清单（恒在） | `state_ledger` 当前态投影 | 跑偏 + 逾期（伏笔过期未收） |
| 期望槽（有则叠） | 计划/蓝图逐章期望 | 漏写（计划要收却没收） |

薄计划（现状单 arc）→ 以清单 + 全局逾期为主；Q2 多 arc / 更细 beat 落地 → 期望槽自动点亮，**不回头改协议**。

### #5 接线点 = W-c（路径无关模块，先接 book-gen loop）

按 CLAUDE.md「业务真相源在 API domain」：`story_state` 是**独立 domain 模块**，对两条编排路径零依赖，编排路径只是 caller。

- **先接** live book-gen loop（`_judge_and_repair_loop`，已在真实 30 章路径上跑）→ 直接惠及 Q9 4 万字重跑（DoD 要求走 CLI 长程）。
- **后续** Desktop Agent runtime（`agent_runs/runtime.py`）成熟后调**同一个** `story_state` 模块——零重写、只多一个 caller。这是 strangler-fig「先建后拆」的合规落法（[[project_agent_orchestration_direction]] / [[project_refactor_elegance_plan]]）。

---

## 三、数据模型

放置：新建 domain `apps/api/app/domains/story_state/`（或并入 `continuity/`，与 `edge_constraints` 同域）。新增列须带 `server_default`；新表走 alembic。

### state_event（append-only 真值源）

```
state_event
  id            PK
  book_run_id   FK
  chapter_index int          -- 章戳：哪一章产生
  seq           int          -- 章内顺序
  change_type   enum         -- 12 类之一（见 §四）
  entity_kind   enum         -- character/location/faction/item/foreshadow/conflict/secret/oath/countdown/relationship/timeline
  entity_id     str          -- 稳定 id（花名册铸造）；关系/边类放 subject
  object_id     str | null   -- 关系/边类的 object
  payload       jsonb        -- 类型化 delta，如 {"phase_from":"已埋","phase_to":"已收"} / {"level_from":3,"level_to":4}
  grounding     jsonb        -- {"hard":"pass|fail","surface_forms":[...],"semantic_score":int|null}
  created_at    ts
  -- 不可变；回滚 = DELETE WHERE chapter_index > target 后 reproject
```

### state_ledger（物化当前态投影，node 状态机）

```
state_ledger
  book_run_id    FK   ┐ 复合 PK
  entity_id      str  ┘
  entity_kind    enum
  canonical_name str          -- 主名（花名册）
  aliases        jsonb        -- 别名表（声明时归一用）
  state          jsonb        -- per-kind 当前态：level/abilities/location/holder/phase/knower_set/deadline...
  last_chapter   int          -- 最后更新章
  -- 由 state_event fold；可 DROP + 重建（reproject）
```

> **花名册（roster）= `state_ledger` 中 `canonical_name + aliases` 的投影**。预填时喂给 Writer，不是另存一份。

### 与 edge_constraints 的边界

`edge_constraints` 表与引擎**不动**。edge 类 CHANGES（relationship / timeline_order / 关系性 status）经 `submit_continuity` 注入它；node 类进 `state_ledger`。一条 commit 可能同时产生 edge 提交 + ledger 更新（如「秘密揭示」：知情集 node 增长 + 可选的 char→secret 关系 edge）。

---

## 四、12 类 CHANGES → edge / node / memory 映射

覆盖 12 类状态变更与对应不变量：

| CHANGES 类 | 去处 | 不变量 / 检查 |
|---|---|---|
| 关系 / 信任度Δ | **edge** relationship | 信任Δ越界；同章既盟友又仇敌（图查矛盾） |
| 时间推进 | **edge** timeline_order | 时序回退 / 成环（`WITH RECURSIVE`） |
| 角色等级 / 能力 / 心理 | **node** | 等级单调；能力获得须有事件 |
| 角色位置 / 移动 | **node**（位置）+ 序列 | 在场才能行动；移动链 from = 上次 to |
| 伏笔 setup / payoff | **node** | 未埋先收 / 已收回退 / 逾期 |
| 冲突进度 | **node** | 阶段序 pending<active<climax<resolved |
| 地点 / 势力状态 | **node** | 状态合法迁移 |
| 物品流转 | **node** | 单持有人；持有链 |
| 秘密揭示 | **node**（+ 可选 edge） | 知情集只增 |
| 誓约 | **node** | 单终止动作；不重复 create |
| 倒计时 | **node** | 单终止动作；不重复 create |
| 剧情节点 | **memory** | 不做约束，供召回 |

---

## 五、逐章运行时

每章在 `_judge_and_repair_loop`（`book_generation_judge.py:65`，有界 `for range(MAX_REPAIR_ROUNDS)`）内接入。新增 **state-grounding 作为一维 judge**，与现有三者并列：

1. `deterministic_judge_fallback`（`judge/deterministic.py:11`，薄、demo 调参）
2. local-gate 快路径（`book_generation_judge.py:204-211`，`required_facts`/`style_rules` 任一非空即给 score=100，**自承假象** `:204`）
3. `semantic_judge_with_status`（`judge/semantic.py:97`，LLM advisory）
4. **【新】state-grounding**：解析本章 `commit_chapter` 的 CHANGES → 跑硬闸 + 不变量 + 语义咨询

**链路**：

```
Writer 出正文
  → commit_chapter(prose, changes[])              # #4 工具调用，引花名册 id
  → ground(changes, prose)                         # #1 两层：硬闸（表面形可定位）+ 语义咨询
      ├─ 硬闸 fail / 不变量 fail → 三级升级（见下）
      └─ pass →
          append state_event（章戳）                 # #2 真值源
          reproject state_ledger                    # #2 投影
          submit edge 类 → edge_constraints         # #3 + 翻 _skip_submit_continuity
  → 下一章预填骨架 = P-c(state_ledger 清单 + 计划期望槽)  # #4 闭环
```

**三级升级**（嵌入有界 repair 轮，对应锁定的渐进式策略）：

| 级 | 动作 | 落点 |
|---|---|---|
| 1 | 定点改（1-2x） | 现有 `_maybe_repair`（loop 内 patch） |
| 2 | 带约束整章重生（1x） | **新增**：定点改在 state 硬闸上耗尽 → 把失败的 CHANGES 作为硬约束注入，整章重生成 |
| 3 | Tripwire（人工） | 现有 max-rounds 兜底（`MAX_REPAIR_ROUNDS` / novel_loop `awaiting_review`） |

**翻默认**：`novel_loop._skip_submit_continuity`（`novel_loop.py:47`，默认 port `:70` 不提交）翻成真正 `submit_continuity`，让已 live 的 `edge_constraints` 吃到 edge 类 CHANGES。

---

## 六、与 live 现状的关系

| 已 live、可直接用 | 净新增 | 要翻的默认 |
|---|---|---|
| `edge_constraints` 图引擎（`WITH RECURSIVE` 查环 + status 时间窗，`edge_constraints.py`） | `state_event` 表 + `state_ledger` 表 + `story_state` domain | `novel_loop._skip_submit_continuity` → 真提交（`novel_loop.py:47/70`） |
| `_judge_and_repair_loop` 有界轮 + `_maybe_repair`（`book_generation_judge.py:65`，`test_multi_round_repair` 实证多轮/封顶/阈值） | 稳定 ID 库 + 幂等铸造 + 花名册归一 | local-gate 空转收紧（`book_generation_judge.py:205`，与 Q3 合流） |
| `semantic_judge_with_status` advisory（`judge/semantic.py:97`） | `commit_chapter` 工具 + CHANGES schema | — |
| | state-grounding 判定维度 + 整章重生分支（升级第 2 级） | |

> **不复用**：`apps/workflow` `narrative/` 全套（TEST-ONLY，[[project_live_judge_chain_truth]]）；`narrative_gate.py`（golden 专用独立实现，30 章 CH3/4 有误报史，不可混接）。

---

## 七、与 next-step-plan 的映射

本设计是 **Q1 keystone** 的状态层底座，并直接支撑 Q4/Q7：

- **Q1**（真逐章抽取替写死抽取）：state-grounding 的硬闸 + CHANGES 自报，就是「真抽取接进 `_judge_and_repair_loop`」的具体形态——Writer 自报 + grounding 校核，替 `deterministic_judge_fallback` 的 demo 模板。
- **Q3**（收紧 fast-judge 空转）：翻 local-gate（§六）。
- **Q4**（真相源填 `required_facts` + 跨章注入）：`state_ledger` 投影即真相源；预填骨架即跨章上下文注入。
- **Q7**（称谓一致性 + 跨章时间线回归）：称谓→花名册归一；时间线→`edge_constraints` timeline_order。

---

## 八、明确不声称（诚实边界）

- 本文件是**设计，未实现**。不声称任何质量验收、不等同 Q9 通过。
- state-grounding 的**语义层先 advisory / 扣分-only**，验证误报率后再议是否硬断（next-step ❌ 铁律：语义新判定先 advisory；语义 judge 失败一律不机械改写正文）。
- **确定性硬闸**（表面形可定位、单调/序列/去重不变量）可硬断——它们是无歧义的事实约束，非语义判断。
- 不把本设计接进 `narrative_gate.py`，不复用 `apps/workflow` `narrative/`（须先做 app 边界决策，见 next-step ❌）。
- 不碰 `apps/web`；不把 BookRun 提升为主入口（本轮仅服务后台 managed run 的能力验收）。
- Desktop Agent runtime 调用同模块是**后续**，本轮先接 book-gen loop。

---

## 九、未决 / 下一步

- **未决**：`payload` jsonb 的 per-kind schema 细化（每类 delta 的字段表）；不变量引擎是逐条 Python 校验还是声明式规则表；reproject 是全量重建还是增量。
- **下一步（建议）**：起 **Q1 P0** —— 先建 `story_state` domain 骨架（`state_event` + `state_ledger` 表 + alembic 迁移 + commit/ground/append/reproject 纯函数 + 单测），**先不接 loop**（纯模块、零行为变更），再单独一步接 `_judge_and_repair_loop`（纯拆分与行为变更严格分离，[[project_refactor_elegance_plan]] 铁律）。
