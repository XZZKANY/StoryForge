---
skill_name: clue_fairness_judge
name: clue_fairness_judge
version: 1.0.0
stage: chapter
genre: mystery
dynamic_execution: false
description: 检查悬疑章节是否公平埋设线索、误导与揭示。
---

## 触发条件

仅当 BookRun 或 Blueprint 显式选择 `mystery` 题材技能包时启用；默认通用技能链不加载本技能。

## 输入契约

- `chapter_id`
- `draft_ref`
- `judge_report_id`
- `clue_map_ref`

## 输出契约

- `clue_fairness_report_id`
- `unfair_clue_refs`

## 硬门禁

- `draft_ref`
- `judge_report_id`

## 审计字段

- `clue_fairness_report_id`
- `unfair_clue_refs`
- `fairness_score`

## 状态映射

- `pass` -> `clue_fair`
- `warn` -> `clue_warning`
- `fail` -> `clue_unfair`

## 下一步

结果只作为悬疑题材审计引用，后续可供 `judge` 或人工审阅查看，不新增 BookLoop 终态。
