---
skill_name: submit_continuity
version: 1.0.0
stage: chapter
dynamic_execution: false
---

# submit_continuity 小说技能

## 意图

把已批准章节的结构化连续性边提交到 API 批准门禁（`POST /api/continuity/chapter-approval`），触发服务端的结构矛盾校验（关系成环 / 时间线倒错 / 状态时间窗冲突）。未注入 adapter 时按默认不提交、不产边，行为与现有回路一致。

此文件只声明静态技能元数据，用于让注册表、文档和测试共享同一组契约说明；实际执行仍由现有 NovelLoop 或 BookLoop 编排代码负责。

## 输入引用

- `chapter_id`
- `draft_ref`
- `approved_scene_id`

输入只保存引用标识和运行上下文键，不在此处内联完整输入提示或完整章节文本。

## 输出引用

- `continuity_edge_count`

输出字段必须作为下游节点可追踪的引用或状态摘要使用，不在此处承载大段内容载荷。

## 门禁

- `approved_scene_id`

门禁字段缺失时，本技能不应被视为满足进入对应流程节点的条件。

## 审计字段

- `continuity_edge_count`
- `approved_scene_id`

审计字段用于串联批准结果与本次提交的结构边数量，便于复盘门禁是否生效。

## 状态映射

- `success` -> `continuity_submitted`
- `skipped` -> `continuity_skipped`

状态映射必须与 `DEFAULT_NOVEL_SKILL_REGISTRY` 中的静态定义保持一致，不额外声明 NovelLoop 或 BookLoop 未承诺的终态。

## 运行边界

- 阶段：chapter
- 版本：1.0.0
- 所需能力：无
- 页面引用：无
- API 路径：`POST /api/continuity/chapter-approval`
- Workflow 节点：`NovelLoopPorts.submit_continuity`, `NovelLoopResult.continuity_edge_count`
- 事实源：`apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:48`, `apps/workflow/storyforge_workflow/storyforge_api_client.py:34`
- 动态执行：禁用；`dynamic_execution: false` 表示该技能文件仅提供静态说明，不直接触发模型、工具或外部调用。
