# 真实 LLM 1 章 smoke 质量风险记录

生成时间：2026-06-03 15:15:28 +08:00

## 脱敏运行参数

- provider_protocol: openai-compatible
- model: mimo-v2.5
- chapter_count: 1
- target_word_count: 900
- token_budget: 20000
- timeout_seconds: 60
- time_budget_seconds: 900
- database_mode: ephemeral_sqlite

## 运行结果

- runner_exit_code: 0
- summary_present: true
- sensitive_hit_count: 0
- book_run_status: completed
- actual_chapter_count: 1
- tokens_used: 3047
- estimated_cost: 0.0
- actual_total_chars: 2364
- markdown_artifact_id: 1
- audit_artifact_id: 2

## 质量风险

- 本次只证明真实外部 LLM 1 章 smoke 完成，不能证明 3 章、10 章或 3-5 万字长程完成。
- 实际供应商可用模型与脚本默认模型不同，后续复现必须记录实际模型。
- 本次使用一次性 SQLite 数据库完成 smoke，不能证明默认 Postgres 或跨卷生产稳定性。
- 需要人工通读正文后，才能决定是否进入 3 章 smoke。
- 进入 3 章前必须确认成本、质量、人工通读结果和脱敏验收 gate 均通过。
