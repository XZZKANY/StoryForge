## 项目上下文摘要（真实 LLM 10 章长程门禁补强）

生成时间：2026-06-03 18:24:19 +08:00

### 1. 相似实现分析

- `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`：核心真实 LLM runner，支持章节数、token 预算、目标字数、章节字数上下限、summary 输出和 artifact hash。
- `.codex/run-real-llm-3ch-direct.py`：已完成 3 章真实调用包装，但硬编码 3 章且敏感扫描只覆盖 summary/stdout/stderr。
- `.codex/validate-real-llm-smoke-evidence.ps1`：当前只验证 smoke 目录和 metadata 的敏感命中，明确不能代表 10 章或 3-5 万字长程。
- `apps/api/tests/test_phase9b_real_llm_smoke.py`：已有 10 章模拟、summary 脱敏、artifact hash 和 CLI 参数测试，可复用为长程门禁测试模式。

### 2. 项目约定

- 文档、注释、日志和报告使用简体中文。
- 不读取 `.env`，provider 配置只来自当前进程环境变量。
- 不输出、落盘或复述任何 API Key、Authorization、Bearer token、密钥前缀或供应商凭据。
- 所有真实产物写入 `.codex/real-llm-*` 隔离目录，不覆盖历史产物。

### 3. 可复用组件清单

- `run_phase9b_real_llm_smoke()`：真实生成与 BookRun/Blueprint/Judge 链路。
- `_evidence_summary()`、`_artifact_text()`：脱敏 summary 与 artifact 文本读取。
- 现有 pytest 文件：验证 runner 参数、summary 结构和不泄露私有配置。

### 4. 测试策略

- 先写失败测试，证明长程包装脚本必须扫描 `book.md`、`audit_report.json`、`run-metadata.json`、`quality-risk.md`、`human-readthrough-todo.md` 等全部文本产物。
- 再实现参数化包装脚本，支持 10 章预算而非硬编码 3 章。
- 验证命令优先使用 API pytest 定向测试、脚本编译和脱敏扫描。

### 5. 依赖和集成点

- 外部 LLM 调用仍由核心 runner 负责。
- 长程包装脚本只负责参数、隔离目录、SQLite 临时库、artifact 落盘、全产物敏感扫描和 metadata。
- 真实调用前必须重新检查当前进程环境变量 present/missing。

### 6. 风险点

- 当前进程 provider 环境变量为 missing，不能启动真实调用。
- 最新 3 章已补人工通读，但 10 章仍需独立运行证据和独立人工通读。
- 现有 3 章脚本不适合直接扩大到 10 章，需补参数化和全产物扫描门禁。
- 已补 `outer_timeout_seconds` 成功门禁：长程包装脚本会在 runner 调用前后检查外层耗时，超时后不得把本次运行记为成功。
- 已补运行后质量与审计 gate：`tokens_used` 达到预算、artifact hash 缺失、任一章节质量分低于 90、累计质量问题超过 3 时，长程包装脚本不得返回成功。
