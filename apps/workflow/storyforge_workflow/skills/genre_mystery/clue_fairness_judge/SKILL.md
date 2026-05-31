---
name: clue_fairness_judge
version: 1.0.0
description: 检查悬疑章节是否公平埋设线索、误导与揭示。
genre: mystery
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

- 线索揭示不得依赖读者无法获得的信息，误导必须有可回溯依据。
- 不得新增 BookLoop 终态，不得直接批准或暂停整书。
- 不得把完整正文、完整 prompt 或完整 Scene Packet 写入 checkpoint。

## 审计字段

- skill_name
- skill_version
- fairness_report_id、clue_issue_count、decision
- chapter_index
- draft_hash

## 下一步

- pass: 回到通用 approve 前的评审汇总。
- epair: 交给通用 repair 生成定向修复。
- waiting_review: 交由人工审查，不继续自动批准。
