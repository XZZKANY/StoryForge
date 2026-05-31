---
name: memory_extract
version: 1.0.0
description: 仅从已批准章节抽取长期记忆引用，并区分真实更新、跳过和失败。
---

## 触发条件

- 章节已 `approved`。
- `approve_scene` 写回成功。

## 输入契约

- `approved_scene_id`
- `final_draft_hash`
- `chapter_goal`
- `story_memory_ref`
- `character_bible_ref`
- `timeline_ref`

## 输出契约

- `memory_atom_ids`
- `timeline_event_ids`
- `character_state_delta`
- 阶段状态：`memory_updated`、`memory_extract_skipped`、`memory_extract_failed`

## 硬门禁

- 未批准内容不得污染长期记忆。
- 默认空实现返回空数组时必须记为 `memory_extract_skipped`，不得伪装成已更新。
- 真实 adapter 抛错时必须保留失败摘要供审计。

## 审计字段

- `skill_name`
- `skill_version`
- `approved_scene_id`
- `memory_atom_ids`
- `timeline_event_ids`
- `character_state_delta`

## 下一步

- 单章链路结束；全书完成后由 BookRun 进入 `export`。
