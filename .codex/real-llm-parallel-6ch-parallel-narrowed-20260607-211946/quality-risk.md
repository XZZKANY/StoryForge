# 真实 LLM 并发 smoke 质量风险记录

生成时间：2026-06-07 21:19:54 +0800

## 脱敏运行参数

- provider_protocol: openai-compatible
- model: mimo-v2.5-pro
- chapter_count: 6
- chapter_parallelism: 3
- target_word_count: 7200
- token_budget: 120000

## 运行结果

- runner_exit_code: 1
- summary_present: False
- sensitive_hit_count: 0
- book_run_status: None
- actual_chapter_count: None
- tokens_used: None
- integration_metrics: None
- metric_results: None

## 风险说明

- 本次只证明小规模并发链路和实测指标，不证明 30 章长程稳定。
- context_cache_hit_rate 与 db_query_count_per_chapter 只有在真实采集时才写入，缺失即按失败记录。
- chapter_generation_time_p50 受模型 reasoning 延迟影响，本次只如实记录。
