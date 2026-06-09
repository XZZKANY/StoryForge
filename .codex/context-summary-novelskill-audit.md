## 项目上下文摘要（Novelskill 架构深度审计 — 长程一致性崩塌与串行阻塞根因）

生成时间：2026-06-07 21:55:00 +08:00

> 本文为纯源码审计留痕，未改动任何业务代码。三条主线（上下文编译 / 记忆链 / 剧情规划+并发）经精确读源定位，每条结论带 `file:line` 证据。

### 0. 执行摘要（一句话定性）

长程一致性崩塌与"并发"是同一笔交易的两面：phase9b 并发 runner 为拿到 `concurrent_chapter_utilization=1.0`，把章节间数据依赖（第 N 章须看第 N-1 章正文）**切断**——窗口内 N 章一次性 submit 并行生成，谁也看不到谁。与此同时，真正承载长程一致性的三套机制（带预算的上下文编译器、记忆召回链、arc 一致性屏障）**全部建好但未接线**。现状：测量漂亮、结构上保证写得越长越失忆。

---

### 1. 长程一致性崩塌（上下文编译）

- **A1 recap 裸字符截断** — `apps/api/app/domains/book_runs/book_context.py:157` `return recap[-max_chars:]`。取末尾字符 → older 章节浓缩梗概整段丢弃，最近章正文被从句中腰斩，模型拿到无头正文片段。
- **A2 结构上只保最近 2 章** — `book_context.py:139-147`（`full=prior[-2:]`，older 每章压成 `summary[:200]`，无 summary 时回退 `content[:200]`）。到第 30 章，1-28 章各剩 200 字且被 A1 截掉，早期伏笔/世界观**结构性退出 context**。
- **A3 continuity 预算反向裁早期事实** — `apps/workflow/storyforge_workflow/prompts/context.py:165-196` `_continuity_sort_key` 按"距当前章距离"排序裁剪，距离越远越先被挤出，与长程一致性目标**直接对立**。
- **A4 `_context_cache` 单例无失效** — `book_context.py:301/187/317`，`invalidate()`/`clear_book_context_cache()` 生产代码零调用，`_cache_version`（:89）是死字段。编辑已批准章节后缓存仍持旧全文，一致性修复无法传播。
- **A5 正确答案是孤儿** — `apps/api/app/domains/context_compiler/service.py:compile_context`（带 token 预算 / required 必保留 / dropped 审计 / 可持久化快照）**主链路从不调用**，真正跑的是 `compile_for_chapter` 的朴素截断。
- 次要：两套 recap 实现常量漂移——死路径 `RECAP_MAX_CHARS_DEFAULT=6000`（phase9b_real_llm_smoke.py:69）vs 活路径硬编码 `max_chars=12000`（prompt_assembly.py:77）；同章多 scene 只取首个（book_context.py:251-259）。

---

### 2. 记忆链整体断线（`memory_recall_budget_used=0` 的确切根因）

**不是"预算没用满"，是三段全断：**

1. **抽取端口未注入 → 库里没 atom**：两个 runner 均落到默认 `_skip_memory_extraction`（`apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:37-40`，`return []`）；`write_memory_extract_atoms` 全仓仅定义+测试引用。
2. **并发 compile_context 是空桩 → 不召回**：`apps/api/app/domains/book_runs/phase9b_parallel_ports.py:224-225` 直接 `return f"phase9b_parallel:{id}:{idx}"`，完全不触达 `recall_scene_memory_atoms`。命名 `phase9b_parallel_no_memory_retrieval`（:445）即字面真相。
3. **指标分子从未写入 → 恒为 0**：`memory_recall_chars` 全仓**只有读取处**（phase9b_real_llm_smoke.py:1138），无任何写入。
4. **召回无语义检索**：`story_memory` 域**零 embedding/pgvector**，只有子串匹配 `term in haystack`（`apps/api/app/domains/story_memory/service.py:601-603`），排序按词表出现顺序，与 recency/relevance 无关。
5. **角色死亡无法召回**：`character_bible` atom 只载静态人设（`immutable rule`），且在 prompt 注入路径被**主动剔除**（`apps/api/app/domains/book_runs/prompt_assembly.py:217-218`）。

---

### 3. 串行阻塞 + 假并发（剧情规划 / 编排）

- **C1 全局单锁串行化 judge** — `phase9b_parallel_ports.py:216` 单个 `db_write_lock`；`judge_scene`（:250-266）把整个 judge+repair 循环、**含 :257 真实 LLM judge 调用**整段持锁。6 章里只有草稿生成（:230，锁外）真并行，评审网络 IO 全串行。
- **C2 并发切断 recap 依赖** — `apps/workflow/storyforge_workflow/orchestrators/book_loop.py:166` `_fill_chapter_window` 一次性 submit 窗口内全部章节；commit 按 `next_commit_index` 序（:169）。第 2 章生成时第 1 章尚未 approved，BookContext 取不到 → 并发与长程一致性互斥。
- **C3 利用率是测量假象** — `book_loop.py:360` `utilization = max_in_flight / target_window`，只统计"提交了几个 future"，不证明真并行也不证明做了有效工作，`1.0` 廉价可得。
- **C4 arc 屏障没接线** — `phase9b_parallel_ports.py:155-160` 调 `run_book_loop` **不传 `consistency_barrier`**，`apps/workflow/storyforge_workflow/quality/arc_consistency.py` 的"埋了线必须收"屏障在真实 runner 里完全不生效。

---

### 4. 重构蓝图（分阶段，按 ROI 排序）

**P0 — 止血：让"已建好的正确机制"接线（改动小、收益最大）**
1. 主链路 `assemble_prompt_injection` 改调 `context_compiler.compile_context`，废弃裸截断；把角色硬设定/活跃伏笔/世界观规则标记为不可裁剪。
2. `run_book_loop_with_thread_sessions` 透传 `consistency_barrier`，让埋线不收在 payoff 章被阻断。
3. 把 judge LLM 调用移出 `db_write_lock`（只在真正写 DB 瞬间持锁），或改 session-per-chapter 真实隔离 + 行级提交。

**P1 — 修依赖模型：让并发与一致性不再互斥**
4. 滑窗依赖调度：第 N 章 submit 时快照"截至 N-1 章已 approved"上下文；允许相邻章并行生成草稿，N+1 上下文等 N commit 后补一次轻量校正，或采用两段式（草稿无前文、评审带前文）。
5. `concurrent_chapter_utilization` 改为基于实际重叠执行时间（Σ章节并行时长 / wall-clock），而非提交计数。

**P2 — 重建记忆链（最大工程量，长程一致性的根）**
6. 注入真实 `extract_memory` 端口，章末抽取 character_states / world_facts / foreshadow 写 `memory_atoms`。
7. 召回换语义检索：`story_memory` 接 pgvector（复用 `retrieval` 域能力），按 relevance+recency+immutable 加权。
8. 打通 character_bible → 注入：去掉 prompt_assembly.py:217-218 的剔除，让角色状态变更进后期章节。
9. 接上 `memory_recall_chars` 指标写入，消除"绿色的 0"自欺。

**P3 — 数据陈旧与多 scene**
10. scene 编辑入口调用 `clear_book_context_cache()`/`invalidate()`，或给缓存加 `_cache_version` 真实比对。
11. `from_db` 同章多 scene 改为按序拼接全文（book_context.py:251-259）。

---

### 5. 优先级建议

先做 P0 三条——均为"接一根线"级改动，直接堵住最致命崩塌点：① 上下文裸截断（接 compile_context）、② 串行阻塞主因（judge 移出锁）、③ 规划埋线无人收（接 barrier）。P2 记忆链重建是长程一致性根治，工程量大，建议 P0 验证收益后再立项。

### 6. 审计方法与限制

- 上下文编译、记忆链两条线由并行 Explore 子代理读源定位；剧情规划/并发线因子代理中途 503 中断，由主会话直接读 `book_loop.py` + `phase9b_parallel_ports.py` 源码补全，证据等价。
- 本轮为纯分析，未运行测试、未改业务代码。所有 `file:line` 锚点基于 2026-06-07 工作区状态，落地前需复核行号是否漂移。
