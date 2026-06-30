# 项目上下文摘要（Q4 P0 story_state 真相源填 required_facts）

生成时间：2026-06-30 +08:00

## 1. 相似实现分析

- `_build_judge_payload()` 是真实生成路径构造 `JudgeIssueCreate` 的唯一入口，原先 `required_facts=[]`。
- `StoryStateLedger` 是 Q1 P0/P2 已接入的跨章当前态投影。
- `deterministic_judge_fallback()` 原本把 `required_facts` 全部当“必须出现”，缺失即报 `setting_conflict`。

## 2. 项目约定

- 从 `story_state` 注入的是“已知事实”，不是“本章必须复述事实”。
- `已知事实：` 前缀用于 deterministic 的 conflict-only 模式：检查直接矛盾，但不因正文没复述而报缺失。
- 不改变公开 schema，不改路由/OpenAPI，不触碰 `apps/web`。

## 3. 可复用组件清单

- `StoryStateLedger.state`：读取 `status` / `rule` / `phase` / `holder` / `location`。
- `JudgeIssueCreate.required_facts`：继续作为 deterministic 与 semantic judge 的上下文入口。
- `evidence_links`：记录 fact 来源为 `story_state_ledger`。

## 4. 测试策略

- `test_book_generation_judge_payload_uses_story_state_required_facts`：先提交 `左臂受伤` 到 story_state，再生成下一章矛盾正文，断言 deterministic 抓到 `左臂完好无损`。
- `test_conflict_only_story_state_fact_does_not_require_restatement`：确认 `已知事实：左臂受伤` 不会因为正文没复述就误报缺失。
- 回归 `test_book_generation.py`、`test_book_generation_parallel.py`、`test_story_state.py`、judge semantic/failure/repair。

## 5. 风险与边界

- 这是 Q4 的第一刀：已激活 `required_facts` 真相源，但尚未实现跨章语义新维度、称谓一致性维度、edge 类 CHANGES 或全量 Q9 重跑。
- `required_facts` 中旧调用方传入的普通字符串仍保持“必须出现”语义；只有 `已知事实：` 前缀进入 conflict-only。
