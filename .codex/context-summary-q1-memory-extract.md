# 项目上下文摘要（Q1 P1 并发 memory extract 去硬编码）

生成时间：2026-06-30 +08:00

## 1. 相似实现分析

- **并发真实生成 runner**：`apps/api/app/domains/book_runs/book_generation_parallel.py`
  - `_extract_memory_atoms_for_chapter()` 在章节 approved 后写入 Story Memory。
  - 旧 `_character_state_extracts()` 只识别 `林岚`，旧 `_world_fact_extracts()` 只识别 `灯塔/信号`。
- **Story Memory 写入**：`apps/api/app/domains/story_memory/extract.py`
  - `write_memory_extract_atoms()` 接收 `chapter_summary`、`character_states`、`world_facts` 等白名单结构。
- **章节计划上下文**：`blueprints.service.trigger_chapter_plan()`
  - 已把 `pov` 和 `location` 写入 `Chapter`，可作为题材无关抽取锚点。

## 2. 项目约定

- 本刀只去除题材硬编码，不声明完成 Q1 的 LLM 事实抽取。
- 不新增外部调用，不改变 provider/token 预算。
- 不碰 `apps/web`，不接 workflow narrative guard。

## 3. 可复用组件清单

- `Chapter.pov` / `Chapter.location`：作为角色/地点抽取锚点。
- `write_memory_extract_atoms()`：继续负责持久化白名单抽取结果。
- `MemoryAtomRecord`：继续作为 Story Memory 事实存储。

## 4. 测试策略

- 新增 `test_parallel_memory_extracts_use_chapter_context_without_demo_terms`，确认抽取函数不再输出旧 demo 词。
- 回归 `test_book_generation_parallel_runner_extracts_and_recalls_story_memory` 和完整 `test_book_generation_parallel.py`。

## 5. 风险与边界

- 这是通用本地抽取，不是 LLM 语义抽取；复杂状态、称谓归一和 CHANGES grounding 仍需后续 Q1/Q4 接线。
- 串行 runner 尚未写入 Story Memory。
