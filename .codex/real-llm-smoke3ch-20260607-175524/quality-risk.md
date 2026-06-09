# 真实 LLM 3 章 smoke 质量风险记录

生成时间：2026-06-07 17:57:31 +0800

## 脱敏运行参数

- provider_protocol: openai-compatible
- model: mimo-v2.5-pro
- chapter_count: 3
- target_word_count: 3000
- token_budget: 200000
- timeout_seconds: 240
- time_budget_seconds: 1800
- outer_timeout_seconds: 2400
- database_mode: ephemeral_sqlite

## 运行结果

- runner_exit_code: 1
- summary_present: True
- sensitive_hit_count: 0
- book_run_status: completed
- actual_chapter_count: 3
- tokens_used: 11755
- estimated_cost: 0.0
- actual_total_chars: 5781
- markdown_artifact_id: 1
- audit_artifact_id: 2

## 质量风险

- 本次最多只能证明真实外部 LLM 3 章 smoke 完成与否，不能证明 3-5 万字长程完成。
- 本次使用一次性 SQLite 数据库，不能证明默认 Postgres 或跨卷生产稳定性。
- 必须完成全篇人工通读后，才能把本次 smoke 记为通过。
- 若发现重复段落、设定漂移、角色口吻异常或模型痕迹，必须暂停扩大到更长程。
