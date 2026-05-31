---
name: repair
version: 1.0.0
description: 根据评审报告执行定向修复，并把修订稿送回 judge 重判。
---

## 触发条件

- `judge` 返回 `repair`。
- `attempt` 小于 `max_repairs`。

## 输入契约

- `draft_summary`
- `draft_hash`
- `judge_report_id`
- `issues`
- `revision_strategy`
- `compiled_context_id`

## 输出契约

- `revised_draft_summary`
- `revised_draft_hash`
- 阶段状态：`repaired`

## 硬门禁

- 不能无问题清单泛泛润色。
- 不能覆盖健康片段。
- 修复次数耗尽后转人工审查，由 NovelLoop 返回 `awaiting_review`。
- `repair_patch_id` 来源于 judge report，本技能只引用，不自行制造。

## 审计字段

- `skill_name`
- `skill_version`
- `source_judge_report_id`
- `repair_patch_id`
- `attempt`
- `revision_strategy`

## 下一步

- 成功后回到 `judge` 重判。
