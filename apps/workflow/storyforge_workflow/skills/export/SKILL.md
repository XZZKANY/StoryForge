---
skill_name: export
version: 1.0.0
stage: book
dynamic_execution: false
---

# export 小说技能

## 意图

汇总 BookLoop 的已完成章节、checkpoint 与预算信息，形成整书导出所需引用。

此文件只声明静态技能元数据，用于让注册表、文档和测试共享同一组契约说明；实际执行仍由现有 NovelLoop 或 BookLoop 编排代码负责。

## 输入引用

- `book_run_id`
- `book_id`
- `completed_chapters`
- `checkpoint`

输入只保存引用标识和运行上下文键，不在此处内联完整输入提示或完整章节文本。

## 输出引用

- `book_artifact_ref`
- `checkpoint`
- `budget`

输出字段必须作为下游节点可追踪的引用或状态摘要使用，不在此处承载大段内容载荷。

## 门禁

- `completed_chapters`
- `checkpoint`

门禁字段缺失时，本技能不应被视为满足进入对应流程节点的条件。

## 审计字段

- `completed_chapters`
- `checkpoint`
- `budget`
- `current_chapter_index`

审计字段用于保留整书完成进度、checkpoint、预算快照与当前章节位置。

## 状态映射

- `success` -> `completed`
- `awaiting_review` -> `awaiting_review`
- `paused` -> `paused_by_budget`

`paused` -> `paused_by_budget` 只表示预算暂停映射。`paused_by_provider_degradation` 是 BookLoop provider 降级门禁产生的整书状态，不属于 export 技能自身状态映射；后续审计投影必须保留该整书状态，避免与预算暂停混淆。

状态映射必须与 `DEFAULT_NOVEL_SKILL_REGISTRY` 中的静态定义保持一致，不额外声明 NovelLoop 或 BookLoop 未承诺的终态。

## 运行边界

- 阶段：book
- 版本：1.0.0
- 所需能力：无
- 页面引用：无
- API 路径：无
- Workflow 节点：`run_book_loop`, `BookLoopResult.status`
- 事实源：`apps/workflow/storyforge_workflow/orchestrators/book_loop.py:36`, `apps/workflow/storyforge_workflow/orchestrators/book_loop.py:87`
- 动态执行：禁用；`dynamic_execution: false` 表示该技能文件仅提供静态说明，不直接触发模型、工具或外部调用。
