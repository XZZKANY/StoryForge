---
skill_name: relationship_arc_judge
name: relationship_arc_judge
version: 1.0.0
stage: chapter
genre: romance
dynamic_execution: false
description: 检查言情章节关系推进、情绪转折和互动边界是否连续可信。
---

## 触发条件

仅当 BookRun 或 Blueprint 显式选择 `romance` 题材技能包时启用；默认通用技能链不加载本技能。

## 输入契约

- `chapter_id`
- `draft_ref`
- `relationship_state_ref`
- `emotional_beats_ref`

## 输出契约

- `relationship_arc_report_id`
- `arc_issue_refs`

## 硬门禁

- `draft_ref`
- `relationship_state_ref`

## 审计字段

- `relationship_arc_report_id`
- `arc_issue_refs`
- `arc_progress_score`

## 状态映射

- `pass` -> `arc_coherent`
- `warn` -> `arc_warning`
- `fail` -> `arc_broken`

## 下一步

结果只作为言情题材审计引用，后续可供 `judge` 或人工审阅查看，不新增 BookLoop 终态。
