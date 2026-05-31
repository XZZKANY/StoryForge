---
skill_name: approve
version: 1.0.0
stage: chapter
dynamic_execution: false
---

# approve 小说技能

## 意图

在 judge 通过后固化批准场景引用，形成单章 approved 结果。

此文件只声明静态技能元数据，用于让注册表、文档和测试共享同一组契约说明；实际执行仍由现有 NovelLoop 或 BookLoop 编排代码负责。

## 输入引用

- `chapter_id`
- `draft_ref`
- `model_run_id`
- `judge_report_id`

输入只保存引用标识和运行上下文键，不在此处内联完整输入提示或完整章节文本。

## 输出引用

- `approved_scene_id`

输出字段必须作为下游节点可追踪的引用或状态摘要使用，不在此处承载大段内容载荷。

## 门禁

- `model_run_id`
- `judge_report_id`

门禁字段缺失时，本技能不应被视为满足进入对应流程节点的条件。

## 审计字段

- `approved_scene_id`
- `source_model_run_id`
- `judge_report_id`

审计字段用于串联批准结果、来源模型运行与 judge 报告，便于复盘单章批准链路。

## 状态映射

- `success` -> `approved`

状态映射必须与 `DEFAULT_NOVEL_SKILL_REGISTRY` 中的静态定义保持一致，不额外声明 NovelLoop 或 BookLoop 未承诺的终态。

## 运行边界

- 阶段：chapter
- 版本：1.0.0
- 所需能力：无
- 页面引用：无
- API 路径：无
- Workflow 节点：`NovelLoopPorts.approve_scene`, `NovelLoopResult.status`
- 事实源：`apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:87`, `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:94`
- 动态执行：禁用；`dynamic_execution: false` 表示该技能文件仅提供静态说明，不直接触发模型、工具或外部调用。
