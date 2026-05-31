---
skill_name: power_scale_guard
name: power_scale_guard
version: 1.0.0
stage: chapter
genre: xuanhuan
dynamic_execution: false
description: 检查玄幻章节战力等级、突破代价与胜负因果是否自洽。
---

## 触发条件

仅当 BookRun 或 Blueprint 显式选择 `xuanhuan` 题材技能包时启用；默认通用技能链不加载本技能。

## 输入契约

- `chapter_id`
- `draft_ref`
- `power_system_ref`
- `character_power_refs`

## 输出契约

- `power_scale_report_id`
- `power_violation_refs`

## 硬门禁

- `draft_ref`
- `power_system_ref`

## 审计字段

- `power_scale_report_id`
- `power_violation_refs`
- `scale_consistency_score`

## 状态映射

- `pass` -> `scale_consistent`
- `warn` -> `scale_warning`
- `fail` -> `scale_broken`

## 下一步

结果只作为玄幻题材审计引用，后续可供 `judge` 或人工审阅查看，不新增 BookLoop 终态。
