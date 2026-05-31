---
name: export
version: 1.0.0
description: BookRun 完成后导出 Markdown、EPUB 与审计报告制品引用。
---

## 触发条件

- BookRun completed。
- 已批准章节列表存在。

## 输入契约

- `book_run_id`
- `book_id`
- `approved_chapters`
- `checkpoint`
- `skill_chain_summary`

## 输出契约

- `markdown_artifact_id`
- `epub_artifact_id`
- `audit_artifact_id`
- 阶段状态：`exported`、`export_failed`

## 硬门禁

- 不得把未批准章节作为正式成书正文。
- 审计报告必须覆盖 generate、judge、repair、approve、memory_extract 链路。
- 本技能是 BookRun 级能力，不进入单章 NovelLoop 终态。

## 审计字段

- `skill_name`
- `skill_version`
- `artifact_ids`
- `chapter_count`
- `audit_completeness`

## 下一步

- 登记导出制品引用，供审计页和下载入口消费。
