---
name: generate
version: 1.0.0
description: 章节目标和上下文引用齐备时生成候选正文，并记录 ModelRun 引用。
---

## 触发条件

- Blueprint 已锁定。
- 章节目标存在。
- 上下文编译完成。

## 输入契约

- `book_id`
- `chapter_id`
- `chapter_index`
- `chapter_goal`
- `scene_packet_id`
- `compiled_context_id`
- `prompt_pack_id`

## 输出契约

- `draft_summary`
- `draft_hash`
- `model_run_id`
- 阶段状态：`generated`

## 硬门禁

- 缺少章节目标或上下文引用时不得生成。
- provider 连续降级由 BookLoop 统一判定暂停，本技能只记录 fallback 元数据引用。
- 不把完整正文、完整 prompt 或完整 Scene Packet 写入 checkpoint。

## 审计字段

- `skill_name`
- `skill_version`
- `model_run_id`
- `compiled_context_id`
- `token_usage`
- `elapsed_time_sec`
- `fallback_metadata`

## 下一步

- 成功后进入 `judge`。
