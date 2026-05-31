---
name: power_scale_guard
version: 1.0.0
description: 检查玄幻章节战力等级、境界压制和升级节奏是否自洽。
genre: xuanhuan
---

## 触发条件

- 仅在 BookRun 显式选择 $(System.Collections.Hashtable.Genre) 题材技能包时启用。
- 通用 generate 产出候选草稿后，可作为题材附加评审运行。
- 输入引用齐备且不需要读取完整 prompt。

## 输入契约

- draft_hash: 候选草稿哈希。
- chapter_index: 当前章节序号。
- genre_context_ref: 题材上下文引用。
- continuity_refs: 与题材判断相关的连续性引用集合。

## 输出契约

- decision: 只能为 pass、epair 或 waiting_review。
- issue_count: 题材问题数量。
- eport_id: 题材评审报告引用。

## 硬门禁

- 战力突破必须引用等级表和角色状态，禁止无依据越级获胜。
- 不得新增 BookLoop 终态，不得直接批准或暂停整书。
- 不得把完整正文、完整 prompt 或完整 Scene Packet 写入 checkpoint。

## 审计字段

- skill_name
- skill_version
- power_scale_report_id、scale_issue_count、decision
- chapter_index
- draft_hash

## 下一步

- pass: 回到通用 approve 前的评审汇总。
- epair: 交给通用 repair 生成定向修复。
- waiting_review: 交由人工审查，不继续自动批准。
