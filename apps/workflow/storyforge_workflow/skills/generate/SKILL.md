---
skill_name: generate
version: 1.0.0
stage: chapter
dynamic_execution: false
---

# generate 小说技能

## 意图

基于已编译上下文生成单章草稿，并记录模型运行引用。

此文件只声明静态技能元数据，用于让注册表、文档和测试共享同一组契约说明；实际执行仍由现有 NovelLoop 或 BookLoop 编排代码负责。

## 输入引用

- `book_id`
- `chapter_id`
- `chapter_index`
- `chapter_goal`
- `compiled_context_id`

输入只保存引用标识和运行上下文键，不在此处内联完整输入提示或完整章节文本。

## 输出引用

- `draft_ref`
- `model_run_id`

输出字段必须作为下游节点可追踪的引用或状态摘要使用，不在此处承载大段内容载荷。

## 门禁

- `compiled_context_id`

门禁字段缺失时，本技能不应被视为满足进入对应流程节点的条件。

## 审计字段

- `token_usage`
- `elapsed_time_sec`
- `cost_estimate`
- `fallback_metadata`

审计字段用于记录成本、耗时、质量判定、补丁、checkpoint 或结果引用，便于复盘运行链路。

## 状态映射

- `success` -> `generated`
- `fallback` -> `generated`

状态映射必须与 `DEFAULT_NOVEL_SKILL_REGISTRY` 中的静态定义保持一致，不额外声明 NovelLoop 或 BookLoop 未承诺的终态。

## 运行边界

- 阶段：chapter
- 版本：1.0.0
- 所需能力：llm
- 页面引用：无
- API 路径：无
- Workflow 节点：`NovelLoopPorts.compile_context`, `NovelLoopPorts.generate_scene`, `NovelLoopPorts.record_model_run`
- 事实源：`apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:67`, `apps/workflow/storyforge_workflow/orchestrators/book_loop.py:94`
- 动态执行：禁用；`dynamic_execution: false` 表示该技能文件仅提供静态说明，不直接触发模型、工具或外部调用。
