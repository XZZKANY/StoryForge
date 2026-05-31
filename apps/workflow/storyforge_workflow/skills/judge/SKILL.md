---
name: judge
version: 1.0.0
description: 对候选草稿执行静态质量门与结构化评审，决定通过、修复或人工审查。
---

## 触发条件

- 草稿已生成。
- 章节目标存在。
- 质量约束存在。

## 输入契约

- `draft_summary`
- `draft_hash`
- `scene_packet_id`
- `compiled_context_id`
- `character_bible_ref`
- `timeline_ref`
- `style_guide_ref`

## 输出契约

- `judge_report_id`
- `repair_patch_id`
- `issue_count`
- `decision`
- 阶段状态：`static_gate_pass`、`static_gate_blocked`、`pass`、`repair`、`awaiting_review`、`judge_failed`

## 硬门禁

- 静态质量门命中高严重度或 regenerate 策略时，直接进入人工审查路径，不调用模型评审。
- 未评审不得进入 `approve`。
- 高严重级别问题不得自动批准。

## 审计字段

- `skill_name`
- `skill_version`
- `judge_report_id`
- `issue_count`
- `max_severity`
- `decision`

## 下一步

- `pass` 后进入 `approve`。
- `repair` 且修复次数未耗尽时进入 `repair`。
- `awaiting_review` 停止自动链路。
