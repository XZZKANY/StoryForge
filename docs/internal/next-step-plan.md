# StoryForge 下一步计划与优化（Next-Step Plan）

> 生成时间：2026-06-29
> 定位：本文件是当前阶段的**下一步执行路线图**，由一轮多 agent 只读侦察（6 路领域调研 + 综合 + 3 视角对抗评审）产出并经 file:line 接地核验。
> 上位约束见 `AGENTS.md`；当前阶段事实以 `docs/internal/current-phase.md` 为准；架构重构总计划见 `docs/internal/refactor-master-plan.md`（已基本完成，本计划不再涉及 god-file 拆分）。
> 证据回填见 `.codex/verification-report.md`。

> **更新（2026-06-30）**：
> - **CI 已整体移除**（PR #31 squash 含 `5d22b27` 删 `ci.yml`/`e2e.yml`，`.github/workflows/` 不复存在）。lint + OpenAPI 漂移的自动拦截不再经 CI，改由**本地 `pre-push` git hook**（`.githooks/pre-push`，一次性 `pnpm hooks:install` 启用，跑 `pnpm run verify:fast` = lint + 漂移）。下方 §一.5、阶段 0-2、横切 DoD 中的 CI 字样以此为准。
> - **阶段 0 三项已完成**：#28（30 章退回结构化 + 重跑 DoD）、#29（`_call_llm` 有界重试）、#30（CI 触发，随后整体移除）。
> - **Q1/Q4 已具体化**：跨章状态层设计定稿见 `story-state-model-design.md`（state_event/state_ledger、CHANGES grounding、W-c 模块先接 `_judge_and_repair_loop`）；Q1 的“写死抽取”确指 live `deterministic_judge_fallback` 的 demo 模板，非 `extract/prompt.py`。

---

## 一、核心诊断：质量引擎没有跑在真实生成的书上

下列结论经 6 路调研 + 3 视角对抗评审一致确认，且逐行 file:line 核验属实，是本计划全部优先级的根基：

1. **`apps/workflow` 的整套叙事质量引擎在真实长程路径里是死代码。**
   `collapse_judge / repetition_ledger / name_registry / entity_budget / beat_sheet / forbidden_terms` 全在 `apps/workflow/storyforge_workflow/narrative/`；真实 30 章跑的是 `apps/api/.../book_generation_parallel.py`，后者对 `storyforge_workflow.narrative` **零 import**。7 大退回阻塞里至少 5 个的对应 guard，对真实生成的书一行都没跑（仅被 workflow 单测 + golden 回归引用）。golden 回归走的是 `apps/api` 侧另一套独立实现 `narrative_gate.py`，与 workflow guard **不可混接**。

2. **真实 judge 是单章作用域。** `judge/semantic.py:18-51` 只判 5 类、只看当前章，结构上看不到任何跨章问题——模板化、重复、称谓漂移、伏笔膨胀、收尾全是跨章涌现。这是"自动门禁全 pass、人工通读却退回"的根本原因。

3. **judge 自承造假。** `book_generation_judge.py:205` 的 `local_coverage` 因 style pack 必种而恒 True → 恒走快路径；`:328` `required_facts=[]`；`:204` 注释自承 `score=100` 为假象。

4. **那次"真实长程"建立在硬编码 demo 书上。** premise 自己写死"把证据写入**审计链**"（`book_generation.py:408,486`）——blocker#1 的系统词是真相源主动播种（book.md 实测"审计链"出现 65 次）；唯一接线的 `ArcConsistencyBarrier` 因单 arc 全覆盖（`:501-512`）第 1 章即"已推进"、末章永不触发；memory 抽取写死"林岚/灯塔"（`book_generation_parallel.py:473-487`）→ 每章 `memory_extract_skipped` → 时间线/称谓/伏笔检测断粮空转。

5. **工程脆弱点**：真实 `_call_llm`（`book_generation_llm.py:58-73`）单次 `urlopen` 无重试，一次瞬时 429 即摧毁多小时长程；CI（`ci.yml:4`/`e2e.yml:4`）仅 `workflow_dispatch`，PR/合并 master 不自动跑门禁。

6. **文档自相矛盾**：真实 Tauri 端到端写回状态在 `TODO.md:16/18`（称已完成）与 `current-phase.md:67`/`CLAUDE §8`（称未跑）之间冲突。

> 一句话：**不是"质量没达标"，是"根本没在查"。** 下一步第一性问题不是"再调模型"，而是先让检测真的运行、先立判据、再换题材重跑、最后人工盲评。

---

## 二、执行结构：先立护栏，再两轨并行

### 阶段 0 · 先立护栏与锚点（全 S 级、零依赖、可并行，先于一切代码大改）

| 优先 | 事项 | 轨道 | 工时 | 影响 |
|---|---|---|---|---|
| 1 | `_call_llm` 加有界重试+退避+缺章硬护栏 | 工程化 | S | 高 |
| 2 | CI 增 push/PR 触发 + OpenAPI 漂移自动拦截 | 工程化 | S | 高 |
| 3 | 回填 30 章退回结构化制品 + 固化重跑 DoD/盲评口径 | 长程质量验收 | S | 高 |

### 产品轨 · Cursor for Fiction 手感（与质量轨并行）

| 优先 | 事项 | 工时 | 影响 |
|---|---|---|---|
| P1 | 真机 Tauri + 真模型对真实正文章节跑通"按钮路径"端到端 + 回填证据（翻案 `CLAUDE §8`、解三处文档冲突的唯一前置） | M | 高 |
| P2 | CJK 句/子句级 diff + hunk 级冲突容忍（`patch-hunks.ts:15-18` 行级切→巨型 hunk；整文件门控作废整补丁，逐 hunk 复核这一唯一范围越界硬闸现形同虚设） | M | 高 |
| P3 | 消除 Provider 设置 split-brain + 降级强提示（密钥严禁经前端流转） | M | 中 |
| P4 | 真正实时流式：`agent_runs/runtime.py` 回合循环异步化、边执行边发事件（现 `ide/router.py:248` 同步跑完才一次性回放） | L | 中 |

### 质量轨 · 朝"4 万字重跑验收"里程碑

| 优先 | 事项 | 工时 | 影响 |
|---|---|---|---|
| Q1 | 用真实逐章 LLM 事实抽取替换写死抽取，对齐串行/并行双入口（keystone；设计定稿见 `story-state-model-design.md`，先做 app 边界决策） | L | 高 |
| Q2 | 去 demo premise 系统词 + 多 arc 化（最廉价根因，直接消 #1/#6/#7） | S | 高 |
| Q3 | 收紧 fast-judge 空转：强制语义评审为必经一遍（advisory 优先，不立即阻断） | S | 高 |
| Q4 | 用真相源填 `required_facts` 激活 deterministic + judge 注入跨章上下文/语义维度（依赖 Q1、Q3） | M | 高 |
| Q5 | 参数化章阈值（去硬编码 20/25/30）+ 接 `ForbiddenDraftTermsFilter`（先做 app 边界决策） | M | 中 |
| Q6 | 整书级叙事终检：完本后跑全书 guard 写入 `audit_report`（**只产咨询信号，不做硬门禁**） | M | 中 |
| Q7 | 补称谓一致性 judge 维度 + 17/18 章跨章时间线确定性回归基线 | M | 中 |
| Q8 | 长程可观测性：每章 emit `judge_calls_total`/`repair_patches_total`/`failure_count`/cost 并在 `/metrics` 暴露 | M | 中 |
| **Q9** | **重跑 preflight（含 resume/预算暂停实战演练）+ 真实 4 万字长程重跑 + 人工盲评 + 结构化落盘（验收里程碑本体）** | L | 高 |

### 收尾

| 优先 | 事项 | 工时 |
|---|---|---|
| F1 | 文档事实源收敛：修 `TODO.md` Tauri 矛盾、`test_phase9_fact_sources.py` 守卫从脆性字符串改语义断言、`current-phase.md` 补 refactor 边界（终稿措辞依 P1 真实结论定） | S |

---

## 三、重跑验收 DoD（阶段 0 锚点，Q9 据此判定）

- **规模**：约 4 万字 / 16-18 章 / 每章 2000-2500 字 band。
- **题材**：换一个非 demo 题材（不得沿用林岚/灯塔/审计链），暴露泛化问题。
- **入口**：必须走 CLI 长程路径，**不得**走 `le=6` 的 HTTP `/start` 路径（`schemas.py:38`）。
- **盲评口径**：复用 `ManualReadReview(blind=true)`，评审人不看自动分；按 6 维评分（`narrative_quality / character_consistency / world_consistency / timeline_consistency / style_consistency / system_reliability`，各 1-5）。
- **通过判据**：每维 ≥3 且 overall ≥3.5 且**零硬失败**（时间线矛盾 / 测试痕迹残留 / 缺章 / 结尾未收束 / 未回收伏笔任一即退回）。
- **制品登记**：`book.md` / `book.epub` / `audit_report.json` / `summary.json` / `run-metadata.json` 全部附 sha256，并通过结构完整性校验（EPUB 良构、Markdown 章数与 target 对齐）。
- **证据落盘**：逐章 `readthrough-findings.md` + 人工盲评结论写入 `.codex/verification-report.md`；结论严格以人工通读为准，**不以 golden/judge pass 替代**。

---

## 四、Quick Wins

- `_call_llm` 重试+缺章护栏（阶段 0-1）
- 去 demo premise 系统词 + 多 arc（Q2 根因半）
- 修 `TODO.md` Tauri 自相矛盾 + doc 守卫语义化（F1）
- 为"修选中 issue"加 issue id 存在性校验（`ChatWindow.tsx:1001-1034`），防按漂移旧 id 改错目标
- 用应用内模态替换原生 `prompt/alert/confirm`，统一写回确认入口
- 把 `verify-agent-conversation.mjs`/`verify-tauri-smoke.mjs` 接入 `test:desktop` 聚合或 CI，让 Agent 链路 wiring 回归被默认门禁拦

---

## 五、Do-Not-Do（铁律护栏）

- ❌ 不再做任何 god-file 机械拆分/"优雅化"重构——三端 facade + T1-T6 已到边界，纯拆分零增量。
- ❌ 不把 narrative guard / golden green / judge pass 当作"能过人工通读"的论证——自动信号对人工质量零预测力。
- ❌ 不把 `apps/workflow` 富 guard 当作 `apps/api` 可直接 import 的免费资产——真实路径零 import，须先做 app 边界决策（抽共享库 / api 侧自包含重写 / 跨进程调用）；也不要把 workflow guard 与 golden 用的 `narrative_gate.py` 混为一套去接。
- ❌ memory 抽取仍写死/被 skip 时不要接线 `required_facts`/时间线/称谓/伏笔检测——会得到假阳性安全感（必须先做 Q1）。
- ❌ 不要沿用同 provider+同 demo 书+同单 arc 直接重跑——必复发；换题材且不得新增题材专有硬编码。
- ❌ 不把前端 localStorage 的 provider 设置（尤其 API key）注入后端调用链——密钥唯一来源本机后端 env。
- ❌ 不把死代码 guard 直接当硬门禁接入真实路径（`narrative_gate` 有 30 章 CH3/4 误报史）——LLM 语义新判定先 advisory/扣分-only，验证误报率后再议阻断；语义 judge 失败一律不得机械改写正文。
- ❌ audit_report 终检对"未运行/异常"的 guard 不得 emit 伪 clean 值——须区分"已运行=0 信号"与 unavailable/error。
- ❌ 不碰 `apps/web`；不把 BookRun 提升为主控制台/主入口（本轮长程质量工作仅服务后台 managed full-book run 的能力验收）。
- ❌ 不承诺多人协作/多租户认证/生产级签名下载/完整 Studio/持久化任务队列等范围外能力——可登记为已知缺口，不纳入本轮交付。

### 横切 DoD（所有 code-change 项必须满足）

- 所有变更在 `.codex/verification-report.md` 留痕（命令 + 输出摘要 + 未联通能力）。
- 任何改动经路由暴露 schema 的项，必 `pnpm openapi` 刷新 `packages/shared/src/contracts/storyforge.openapi.json` 并解释 diff（CI 移除后由本地 `pre-push` hook 自动拦截漂移，见顶部更新）。

---

## 六、已知缺口（本轮不交付，登记备查）

多人实时协作、多租户认证、生产级对象存储签名下载、完整 Studio 编排器、持久化异步任务队列。以上为有意不纳入本轮的范围，登记于此避免被误读为遗漏。

---

## 附：执行进度

阶段 0 三项已完成（#28/#29/#30，见顶部更新）；CI 于 2026-06-30 整体移除，门禁拦截改由本地 `pre-push` hook（`.githooks/pre-push`）承担。后续按 branch→PR→merge 推进，证据回填 `.codex/verification-report.md`。
