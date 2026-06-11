## 项目上下文摘要（Phase 9 最新 3 章真实 LLM 证据同步）

生成时间：2026-06-04 04:02:41 +08:00

### 1. 相似实现分析

- **实现1**: `current-phase.md`
  - 模式：作为当前阶段事实源，列出真实 LLM 证据目录、限制和未完成项。
  - 可复用：保留“禁止宣称范围”和“证据源”结构。
  - 需注意：当前仍引用旧 3 章目录 `.codex/real-llm-3ch-20260603-163715`，并把语义 Judge 降级列为未完成项。
- **实现2**: `README.md`
  - 模式：面向使用者描述当前状态、不能宣称范围和发布前门禁。
  - 可复用：保留“当前状态 / 当前不能做什么 / 发布前门禁”结构。
  - 需注意：当前仍把 3 章质量评审链路描述为未稳定完成。
- **实现3**: `.dev_plan.md`
  - 模式：Phase 9 计划与完成判定，9B-4b 记录真实 3 章证据。
  - 可复用：保留 9B/9C 分层和完成判定，不把 3 章证据外推到 9C。
  - 需注意：9B-4b 当前证据描述仍是旧目录与降级限制。
- **实现4**: `.codex/real-llm-3ch-20260603-173932`
  - 模式：真实 LLM 3 章脱敏证据目录，包含 summary、metadata、audit、正文、人工通读待办和完成记录。
  - 可复用：作为本轮同步的证据源。
  - 需注意：该证据只覆盖 3 章 smoke，不代表 10 章或 3-5 万字长程。

### 2. 最新证据核验

- `summary.json`: `book_run_status=completed`，`actual_chapter_count=3`，`tokens_used=14158`，`actual_total_chars=7281`，Markdown artifact ID 为 1，audit artifact ID 为 2。
- `run-metadata.json`: `runner_exit_code=0`，`summary_present=true`，`sensitive_hit_count=0`。
- `audit_report.json`: `quality_summary.status=ok`，`manual_review_recommendations=[]`，未出现 `judge_system_failure`。
- `human-readthrough-todo.md`: 通读清单已完成，结论允许评估 10 章真实短篇 smoke。
- `manual-readthrough-completion.md`: 记录 3 章通读通过，并明确不代表 10 章或 3-5 万字完成。

### 3. 项目约定

- **命名约定**: `.codex/real-llm-*` 目录按运行范围和时间戳命名；文档中使用相对路径引用。
- **文件组织**: 阶段事实写入 `current-phase.md`，使用者摘要写入 `README.md`，计划勾选写入 `.dev_plan.md`，审计留痕写入 `.codex`。
- **代码风格**: 本轮只改 Markdown，全部使用简体中文。

### 4. 测试策略

- **证据验证**: 运行 `.codex/validate-real-llm-smoke-evidence.ps1 -RunDirectory .codex/real-llm-3ch-20260603-173932`。
- **回归验证**: 运行 `tests/test_judge_semantic.py`、`tests/test_phase9b_real_llm_smoke.py`、`tests/test_real_llm_long_evidence_validator.py`。
- **安全验证**: 敏感扫描相关文档和审计文件，不允许出现用户提供的私有 URL/key 或 token 片段。

### 5. 依赖和集成点

- **外部依赖**: 无真实外部 LLM 调用；只读本地产物。
- **内部依赖**: `.codex/real-llm-3ch-20260603-173932` 与验证器脚本。
- **集成方式**: 更新事实源后，总计划下一步聚焦 10 章或 3-5 万字真实长程，而不是旧的 3 章 Judge 降级阻塞。

### 6. 技术选型理由

- **为什么用这个方案**: 阶段事实源应反映当前最强证据，否则总计划会停留在已解决的旧阻塞。
- **优势**: 避免重复修复 3 章 Judge 降级；明确下一步真实长程仍未完成。
- **劣势和风险**: 文档同步不等于执行真实 10 章；必须保留禁止宣称范围。

### 7. 关键风险点

- **声明风险**: 3 章证据不能外推为 10 章或 3-5 万字完成。
- **安全风险**: 不得写入用户提供的私有 provider 信息。
- **证据边界**: 当前证据使用一次性 SQLite，不能证明默认 Postgres 或跨卷稳定生产。

### 8. 充分性检查

- 能定义接口契约：是，本轮只同步事实源，不改运行接口。
- 理解技术选型：是，采用最新脱敏证据目录作为权威。
- 识别主要风险：是，防止 3 章证据外推到长程完成。
- 知道如何验证：是，验证脚本、pytest、敏感扫描和空白检查。
