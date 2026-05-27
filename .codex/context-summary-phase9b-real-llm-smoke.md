## 项目上下文摘要（Phase 9B 真实 LLM 冒烟入口）

生成时间：2026-05-27 18:48:00 +08:00

### 1. 相似实现分析

- `apps/api/app/domains/book_runs/deterministic_smoke.py`: 9A deterministic 冒烟已能创建 Book、Blueprint、BookRun、Scene、ModelRun、JudgeIssue，并导出 `book.md` 与 `audit_report.json`。
- `apps/workflow/storyforge_workflow/provider_client.py`: 通过 OpenAI 兼容 `/chat/completions` 调用真实模型，缺少 `STORYFORGE_LLM_API_KEY` 时显式失败。
- `apps/workflow/tests/test_llm_provider.py`: 用本地 HTTPServer 验证 OpenAI 兼容协议，不接触真实密钥。

### 2. 项目约定

- Python 服务模块使用 `from __future__ import annotations`、类型标注和简体中文 docstring。
- API 服务层直接接收 SQLAlchemy `Session`，错误类型继承既有 `InputError` / `RuntimeError` 风格。
- 测试使用 pytest、内存 SQLite、`session_factory` 夹具和本地 HTTPServer 模拟外部协议。

### 3. 可复用组件清单

- `create_book_blueprint()` / `lock_book_blueprint()` / `trigger_chapter_plan()`：复用 Blueprint 到章节计划链路。
- `create_book_run()` / `apply_book_run_progress()`：复用 BookRun 状态、预算和 checkpoint 回填。
- `create_model_run()`：复用模型运行真表与 token 记录。
- `export_book_run_markdown()` / `export_book_run_audit_report()`：复用导出制品。

### 4. 测试策略

- 先新增 `apps/api/tests/test_phase9b_real_llm_smoke.py`，导入尚不存在的模块以获得红灯。
- 用本地 HTTPServer 模拟 OpenAI 兼容响应，验证会真实发起 HTTP 请求、记录 token、完成 BookRun 并导出制品。
- 再验证缺少真实 LLM 环境变量时返回明确缺口，且不打印密钥。

### 5. 依赖和集成点

- 输入：私有环境变量 `STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL`、`STORYFORGE_LLM_MODEL`、`STORYFORGE_LLM_PROVIDER`。
- 输出：BookRun completed、ModelRun token 记录、approved Scene、`book.md`、`audit_report.json`。
- 风险：真实 provider token usage 可能缺失；实现应使用 provider usage 优先，缺失时记录保守估算并在 payload 标明来源。
