## 项目上下文摘要（真实 Judge 与审计乱码修复）

生成时间：2026-06-03 17:17:40 +08:00

### 相似实现分析

- apps/api/app/domains/judge/service.py：semantic_judge_with_status() 直接 json.loads(raw_content)，无法处理真实模型常见的 fenced JSON 或前后说明文本；失败时会注入 judge_system_failure。
- apps/api/tests/test_judge_semantic.py：已有 httpx FakeClient 测试远程 Judge 请求和纯 JSON 响应解析，是新增 JSON 容错测试的最小复用点。
- apps/api/tests/test_judge_failure_marker.py：验证真正调用失败时仍必须注入 judge_system_failure，本轮修复不能吞掉真实失败。
- apps/api/app/domains/exports/book_markdown_exporter.py：_manual_review_recommendations() 当前模板已损坏为问号，导致 audit_report.json 落盘乱码。
- apps/api/tests/test_book_exporter.py：已有 BookRun audit 导出测试和 high severity issue fixture，可复用来断言中文建议不乱码。

### 项目约定

- Python 使用 snake_case、私有 helper、pytest plain assert。
- 文档、注释、测试描述必须使用简体中文。
- 真实 LLM 凭据只来自运行时环境，不写入源码、日志或报告。
- 真实 smoke 产物必须写入 .codex/real-llm-* 隔离目录。

### 可复用组件

- semantic_judge_with_status()：唯一远程 Judge 状态入口。
- DetectedIssue / _issues_from_provider_items()：模型 JSON 到内部问题对象的规整路径。
- _top_quality_issues() / _quality_summary()：审计报告质量摘要来源。
- .codex/run-real-llm-3ch-direct.py：上轮临时脱敏真实 3 章执行包装。

### 测试策略

- 红灯 1：模型返回 `json fenced 数组时，semantic_judge_with_status().failed 应为 False，且能解析问题。
- 红灯 2：manual_review_recommendations 应输出清晰中文，不包含 ???。
- 绿灯：tests/test_judge_semantic.py、tests/test_judge_failure_marker.py、tests/test_book_exporter.py、tests/test_phase9b_real_llm_smoke.py。
- 真实复验：修复后重跑真实 3 章 smoke，检查 audit 无 judge_system_failure 与乱码。

### 外部参考

- Context7/OpenAI 文档：Chat Completions 支持 
esponse_format JSON mode / JSON schema，但仍需提示模型输出 JSON。
- GitHub 代码搜索：LLM JSON 解析常需要处理 `json fenced code block，再进行 json.loads。

### 风险

- 完全无 JSON 的模型响应仍应失败并留痕，不能误判通过。
- 部分 OpenAI-compatible provider 可能不支持 
esponse_format，本轮优先 parser 容错，不强依赖供应商扩展字段。
- 真实复验会产生外部 LLM 调用；只输出脱敏摘要。

### 8. ?????2026-06-03 17:55 +08:00?

- ????????????? `STORYFORGE_LLM_BASE_URL` ??????Judge ?? httpx ????????????? JSON 404 HTML???? `JSONDecodeError: Expecting value` ??? `judge_system_failure`?
- ?????Judge ?? URL ???? `_chat_completions_url()` ?? `strip().rstrip('/')` ???? `/chat/completions`?
- ???????`.codex/real-llm-3ch-20260603-173932`?
- ?????`quality_summary.status=ok`??? `judge_system_failure`??? `??`?`manual_review_recommendations=[]`????? `sensitive_hit_count=0`?
