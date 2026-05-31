---
name: approve
version: 1.0.0
description: 评审通过后把最终草稿写回作品真相源，形成 approved scene 引用。
---

## 触发条件

- `judge` 返回 `pass`。
- 可批准草稿存在。
- 目标章节匹配。

## 输入契约

- `book_id`
- `chapter_id`
- `chapter_index`
- `final_draft_hash`
- `source_model_run_id`
- `judge_report_id`

## 输出契约

- `approved_scene_id`
- `chapter_writeback_summary`
- 阶段状态：`approved`

## 硬门禁

- 未通过评审不得写回。
- 目标章节不匹配不得写回。
- 只有本技能成功后，单章 NovelLoop 才能返回 `approved`。

## 审计字段

- `skill_name`
- `skill_version`
- `approved_scene_id`
- `source_model_run_id`
- `judge_report_id`
- `repair_patch_id`

## 下一步

- 成功后进入 `memory_extract`。
