# 项目上下文摘要（Q3 fast judge advisory）

生成时间：2026-06-30 +08:00

## 1. 相似实现分析

- **真实生成 Judge loop**：`apps/api/app/domains/book_runs/book_generation_judge.py`
  - `_run_real_judge()` 组合 deterministic、本地一致性检测和 `semantic_judge_with_status()`。
  - 旧 fast path 在 `local_coverage and not local_issues` 时直接返回 pass，完全跳过语义评审。
- **Judge 领域 service**：`apps/api/app/domains/judge/service.py`
  - `create_judge_issues()` 在语义评审失败时注入 `judge_system_failure`，这是硬评审入口。
- **语义评审实现**：`apps/api/app/domains/judge/semantic.py`
  - `semantic_judge_with_status()` 缺 API key 时返回 `failed=False/issues=[]`，远程失败时返回 `failed=True/issues=[]`。

## 2. 项目约定

- Q3 只改变真实生成 fast path：语义评审必经一遍，但作为 advisory 信号，不参与扣分或 repair。
- 硬评审入口 `create_judge_issues()` 的失败标记行为保持不变。
- 不改路由、不改 OpenAPI。

## 3. 可复用组件清单

- `SemanticJudgeOutcome`：继续作为语义结果载体。
- `JudgeIssue.payload`：保存 `semantic_advisory` 审计信号。
- `_record_summary_judge()`：无问题时仍落一条 summary judge，作为 pass 审计记录。

## 4. 测试策略

- 更新 book generation fast path 回归：本地门禁通过时，fake httpx semantic judge 被调用一次，summary judge payload 带 `semantic_advisory`。
- 回归完整 `test_book_generation.py`、`test_book_generation_parallel.py`、`test_judge_semantic.py`、`test_judge_failure_marker.py`。

## 5. 风险与边界

- advisory issue 只记录，不扣分、不触发修复，符合“语义新判定先 advisory”的铁律。
- 当前本地 HTTP 栈在未 fake 时可能因缺 `trio` 让 advisory failed；失败会被记录在 payload，不伪装为 clean。
