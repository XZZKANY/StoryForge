# 真实 LLM 30 章长程退回结构化诊断（readthrough-findings）

> 生成时间：2026-06-29
> 性质：本文件把 30 章长程"退回重跑"的散文结论结构化为 7 阻塞 × 6 盲评维度的可审计制品，并登记**机器可验证锚点**与**代码级根因 file:line**。
> 铁律边界：本文件**不是人工通读完成记录**。逐章引文与主观质量判定中标注"待人工通读"的部分尚未完成，将在新一轮长程的人工盲评（见 `docs/internal/next-step-plan.md` Q9）中填充。请勿据本文件宣称任何质量验收通过。

## 1. 运行事实（脱敏）

- provider_protocol：openai-compatible，model：mimo-v2.5-pro
- chapter_count：30（实际 30），target_word_count：35000，actual_total_chars：92244
- tokens_used：261436，estimated_cost：≈1.05 CNY
- database_mode：ephemeral_sqlite（一次性 SQLite，不证明 Postgres/跨卷生产稳定性）
- 制品：`book.md` / `book.epub` / `audit_report.json` / `summary.json` / `run-metadata.json` 均已落盘
- 人工通读结论（记录于 `docs/internal/current-phase.md`）：**退回重跑**

## 2. 七阻塞 → 六盲评维度映射

| # | 退回阻塞 | 盲评维度 | 机器可验证锚点 | 代码级根因 | 状态 |
|---|---|---|---|---|---|
| 1 | 测试痕迹残留 / 系统词 | system_reliability | book.md 中"审计链"出现 **65 次** | premise 主动播种 `book_generation.py:408,486`；唯一能拦的 `ForbiddenDraftTermsFilter`（`forbidden_terms.py:9-21`）真实路径未接 | 锚点已确认；逐处引文待人工通读 |
| 2 | 章节结构模板化 | narrative_quality | 待人工通读（跨章主观判定） | judge 单章作用域 `semantic.py:18-51`，结构上看不到跨章模板 | 待人工通读 |
| 3 | 重复表达 | style_consistency | 待人工通读 / 待跨章 n-gram 量化 | `repetition_ledger.py:33-89` 跨章计数未接线；`prose_static_check.py` 仅单章 4-gram 且低 severity | 待量化 + 人工通读 |
| 4 | 人物称谓混乱 | character_consistency | 待人工通读（需 Character Bible canonical 对照） | `name_registry.py:36-59` 方向反了（抓"一名两人"，非"一人多称谓"）；真实路径未接 | 待补检测 + 人工通读 |
| 5 | 17/18 章时间线冲突 | timeline_consistency | 待人工通读核对 17/18 章具体冲突 | `consistency.py:93-121` 仅覆盖"已死亡角色出场"和"同时刻异地"两类，且依赖空的 MemoryAtom（`memory_extract_skipped`） | 根因已确认；冲突引文待人工通读 |
| 6 | 线索/伏笔膨胀 | narrative_quality | 待人工通读（伏笔回收清单） | `ArcConsistencyBarrier` 单 arc 全覆盖配置 `book_generation.py:501-512` → 末章永不报 arc_stalled；`entity_budget.py:29-53` 硬编码 20/25/30 | 根因已确认；伏笔清单待人工通读 |
| 7 | 结尾收束不足 | narrative_quality | 待人工通读 | `beat_sheet.py:78-87` 仅 `chapter==30` 触发收尾检查，且真实路径未接 | 待人工通读 |

## 3. 机器可验证锚点（grep / 代码事实）

- **系统词残留**：`grep -o 审计链 book.md | wc -l` = **65**。该词由 premise（`book_generation.py:408,486`）主动注入，属自伤型阻塞（blocker#1）。
- **章节数**：`grep -c '^## ' book.md` = **30**，与 target 对齐（缺章护栏阶段 0 落地后将作为 failure_count 校验依据）。
- **memory 抽取**：`audit_report.json` 每章 `memory_extract_skipped`；抽取写死 `book_generation_parallel.py:473-487`（林岚/灯塔），导致 blocker#4/#5/#6 检测断粮。
- **judge 快路径恒走**：`book_generation_judge.py:205` `local_coverage` 因 style pack 必种恒 True；`:328` `required_facts=[]`。

> "测试"一词在 book.md 出现 55 次，但需逐处区分"故事内合法用词"与"系统词残留"，不能直接计为污染——留待人工通读判定，不在此处下结论（避免假数据）。

## 4. 重跑 DoD 与盲评口径

完整 DoD 见 `docs/internal/next-step-plan.md` 第三节。要点：约 4 万字 / 16-18 章；换非 demo 题材；走 CLI 而非 `le=6` HTTP；`ManualReadReview(blind=true)` 6 维评分；通过判据=每维≥3 且 overall≥3.5 且零硬失败；制品附 sha256 并校验完整性；结论以人工通读为准。

## 5. 重跑前必须先落地的根因修复（阻断重跑直接复发）

1. 真实逐章 LLM 事实抽取替换写死抽取（next-step-plan Q1）——否则时间线/称谓/伏笔检测继续断粮。
2. 去 demo premise 系统词 + 多 arc（Q2）——否则 blocker#1/#6/#7 同链路必复发。
3. 收紧 fast-judge 空转（Q3）+ 用真相源填 required_facts（Q4）——否则自动门禁继续恒走快路径空转。
4. `_call_llm` 重试+缺章护栏（阶段 0-1）——否则一次 429 或一章失控即摧毁多小时运行或交付缺章污染人工通读。
