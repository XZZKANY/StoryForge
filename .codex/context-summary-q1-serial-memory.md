# 项目上下文摘要（Q1 P4 串行 runner Story Memory atoms 写入）

生成时间：2026-06-30 +08:00

## 1. 相似实现分析

- 并发 runner 已在章节 approved 后调用本地抽取并写入 Story Memory。
- 串行 `run_book_generation()` 原先只计算 BookContext / judge / audit，不写 `memory_atom_ids`，导致 CLI 长程路径记忆链弱于并发路径。
- `_serial_integration_metrics()` 已读取 `completed_chapters[*].memory_recall_chars` 形成 `memory_recall_budget_used`。

## 2. 项目约定

- 串行与并发双入口应复用同一套本地 Story Memory 抽取 helper。
- 抽取仍是保守本地桥，不声明为最终 LLM CHANGES。
- 不改变路由/OpenAPI，不触碰 `apps/web`。

## 3. 可复用组件清单

- 新增 `book_generation_memory.py`：承载 `extract_memory_atoms_for_chapter()`、`memory_recall_chars_for_chapter()`、`character_state_extracts()`、`world_fact_extracts()`。
- `write_memory_extract_atoms()`：唯一 Story Memory 写入桥。
- `recall_scene_memory_atoms()`：章节生成前统计相关召回预算。

## 4. 测试策略

- `test_book_generation_runs_one_chapter_and_records_evidence`：串行 1 章通过后写 `memory_atom_ids`，首章召回字符为 0。
- `test_book_generation_runs_ten_chapters_with_word_targets`：串行 10 章从第 2 章开始有记忆召回，`memory_recall_budget_used` 真实大于 0 且低于既有 8000 预算线。
- 并发 runner 继续 re-export 旧私有 helper 名称，保持既有测试导入不变。

## 5. 风险与边界

- 本地抽取摘要已压短，控制召回预算；真实长程仍需 Q9 验证是否随章数膨胀。
- resume 重建历史 completed_chapters 时暂未反查既有 memory atoms；新补章节会写入 memory atoms。
