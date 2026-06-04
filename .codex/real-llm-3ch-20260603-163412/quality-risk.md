# 真实 LLM 3 章 smoke 质量风险记录

生成时间：2026-06-03 16:35:15 +0800

## 脱敏运行参数

- provider_protocol: openai-compatible
- model: mimo-v2.5-pro
- chapter_count: 3
- target_word_count: 2700
- token_budget: 60000
- timeout_seconds: 60
- time_budget_seconds: 900
- database_mode: ephemeral_sqlite

## 运行结果

- runner_exit_code: 1
- summary_present: False
- sensitive_hit_count: 0
- book_run_status: None
- actual_chapter_count: None
- tokens_used: None
- estimated_cost: None
- actual_total_chars: None
- markdown_artifact_id: None
- audit_artifact_id: None

## 质量风险

- 本次只证明真实外部 LLM 3 章 smoke 完成与否，不能证明 10 章或 3-5 万字长程完成。
- 本次使用一次性 SQLite 数据库，不能证明默认 Postgres 或跨卷生产稳定性。
- 必须完成三章人工通读后，才能把 9B-4b 记为通过。
- 若发现重复段落、设定漂移、角色口吻异常或模型痕迹，必须暂停扩大到长程。
