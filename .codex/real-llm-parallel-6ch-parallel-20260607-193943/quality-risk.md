# 真实 LLM 并发 smoke 质量风险记录

生成时间：2026-06-07 19:41:57 +0800

## 脱敏运行参数

- provider_protocol: openai-compatible
- model: mimo-v2.5-pro
- chapter_count: 6
- chapter_parallelism: 3
- target_word_count: 7200
- token_budget: 120000

## 运行结果

- runner_exit_code: 1
- summary_present: True
- sensitive_hit_count: 0
- book_run_status: completed
- actual_chapter_count: 6
- tokens_used: 24148
- integration_metrics: {'concurrent_chapter_utilization': 1.0, 'memory_recall_budget_used': 0, 'arc_completion_rate': 1.0, 'chapter_generation_time_p50': 45.805}
- metric_results: {'context_cache_hit_rate': {'status': 'missing', 'passed': False, 'value': None, 'threshold': 0.95, 'operator': '>'}, 'memory_recall_budget_used': {'status': 'passed', 'passed': True, 'value': 0.0, 'threshold': 8000, 'operator': '<'}, 'arc_completion_rate': {'status': 'passed', 'passed': True, 'value': 1.0, 'threshold': 0.7, 'operator': '>='}, 'db_query_count_per_chapter': {'status': 'missing', 'passed': False, 'value': None, 'threshold': 3, 'operator': '<='}, 'chapter_generation_time_p50': {'status': 'failed', 'passed': False, 'value': 45.805, 'threshold': 20, 'operator': '<'}, 'concurrent_chapter_utilization': {'status': 'passed', 'passed': True, 'value': 1.0, 'threshold': 0.6, 'operator': '>'}}

## 风险说明

- 本次只证明小规模并发链路和实测指标，不证明 30 章长程稳定。
- context_cache_hit_rate 与 db_query_count_per_chapter 只有在真实采集时才写入，缺失即按失败记录。
- chapter_generation_time_p50 受模型 reasoning 延迟影响，本次只如实记录。
