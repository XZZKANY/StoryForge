# 项目上下文摘要（Q2 去 demo premise + 多 arc）

生成时间：2026-06-30 +08:00

## 1. 相似实现分析

- **真实生成默认题材源头**：`apps/api/app/domains/book_runs/book_generation.py`
  - `_create_generation_book()` 写入 Book premise。
  - `_seed_consistency_data()` 写入 Character Bible 与 Style Pack。
  - `_blueprint_payload()` 写入 Blueprint premise / metadata。
  - `_default_planning_arcs()` 写入结构化弧线。
- **Blueprint 章节规划**：`apps/api/app/domains/blueprints/service.py`
  - `trigger_chapter_plan()` 读取 `metadata["planning_arcs"]`，调用 `_planning_arcs_by_chapter()` 分发到 `required_beats`。
  - `_metadata_with_planning_summary()` 生成 `arc_completion_ratio`，被 book generation 指标读取。
- **并发弧线屏障**：`apps/workflow/storyforge_workflow/quality/arc_consistency.py`
  - `ArcConsistencyBarrier` 只消费每章 `planning_refs.arc_ids`，同一 arc 若覆盖全书，第 1 章 approved 后即从 planted 变 progressed。

## 2. 项目约定

- 只改真实生成默认输入源，不批量清理历史测试夹具、golden baseline 或其他 domain 的林岚/灯塔样例。
- 不改路由、不改 OpenAPI。
- 保持 `_default_planning_arcs` 可 monkeypatch，兼容现有并发 runner 测试。

## 3. 可复用组件清单

- `BookBlueprintCreate.metadata`：承载 `pov`、`location`、`title_seed`、`planning_arcs`。
- `trigger_chapter_plan()`：继续负责把 arcs 链接进章节计划和 planning summary。
- `_arc_completion_rate()`：继续从 planning summary 读取指标，无需新增指标路径。

## 4. 测试策略

- 新增 `test_book_generation_defaults_do_not_seed_demo_story_terms`：验证 Book/Blueprint/Character Bible/Style Pack 默认源头不含 `林岚`、`灯塔`、`审计链`。
- 新增 `test_default_planning_arcs_are_multi_arc_and_bounded`：验证默认弧线为 3 条，目标章有界，且不再单条 arc 全书覆盖。
- 回归 `test_book_generation.py` 和 `test_book_generation_parallel.py`，确认 arc completion 指标与并发 runner 不退化。

## 5. 风险与边界

- Q2 只解决 demo 题材源头播种和单 arc 默认规划；并不替代 Q1 的真实逐章事实抽取。
- `book_generation_parallel.py` 的林岚/灯塔写死 memory extract 仍属 Q1 未完成项。
- 历史 golden baseline 保留旧题材是回归事实，不作为新一轮 Q9 题材。
