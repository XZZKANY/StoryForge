## 项目上下文摘要（P2 人工通读门禁审计证据）

生成时间：2026-06-03 05:24:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_book_runs.py`
  - 模式：通过 FastAPI TestClient 创建 BookRun，再 PATCH progress 验证服务层保存结构化进度字段。
  - 可复用：`test_patch_book_run_progress_persists_manual_read_gate`。
  - 需注意：该测试只证明本地 progress 保存，不代表真实外部 LLM 已产出长程文本。
- **实现2**: `apps/api/app/domains/exports/book_markdown_exporter.py`
  - 模式：completed BookRun 导出 `audit_report.json` 时从 `book_run.progress` 组装审计 payload。
  - 可复用：`export_book_run_audit_report()`、`_manual_read_gate_projection()`。
  - 需注意：导出器会校验每章 `model_run_id`、`judge_report_id`、`approved_scene_id`，避免无证据审计报告。
- **实现3**: `apps/api/tests/test_book_exporter.py`
  - 模式：本地 seed completed BookRun，调用 Markdown、audit_report、EPUB 导出器并断言 Artifact payload。
  - 可复用：`test_book_run_markdown_and_audit_report_exports_artifacts`。
  - 需注意：测试中的人工通读门禁是 fixture 证据，不是实际人工通读生产报告。
- **实现4**: `.codex/context-summary-p2-real-llm-gate.md`
  - 模式：真实 LLM 长程声明必须收集脱敏运行参数、预算消耗、产物、审计报告、质量风险和人工通读证据。
  - 可复用：真实长程声明门禁字段清单。
  - 需注意：本轮只补本地证据闭包，不勾选真实长程完成项。

### 2. 项目约定

- **命名约定**: 后端进度字段使用 snake_case，例如 `manual_read_gate`、`completed_chapters`、`audit_report`。
- **文件组织**: BookRun 状态更新测试在 `apps/api/tests/test_book_runs.py`；导出器在 `apps/api/app/domains/exports/`；导出测试在 `apps/api/tests/test_book_exporter.py`。
- **代码风格**: 后端使用 pytest 和 FastAPI TestClient；文档和测试说明使用简体中文。

### 3. 可复用组件清单

- `apply_book_run_progress()`：保存 BookRun progress 并维持状态。
- `BookRunProgressUpdate`：BookRun progress 更新输入契约。
- `export_book_run_audit_report()`：生成 `audit_report.json` Artifact。
- `_manual_read_gate_projection()`：从 progress 投影人工通读门禁。

### 4. 测试策略

- **定向验证**: `cd apps/api; uv run pytest tests/test_book_runs.py::test_patch_book_run_progress_persists_manual_read_gate tests/test_book_exporter.py::test_book_run_markdown_and_audit_report_exports_artifacts -q`。
- **覆盖内容**: `manual_read_gate` 可保存到 BookRun progress；`audit_report.json` payload 包含人工通读门禁；completed BookRun 可导出 Markdown、audit_report、EPUB。
- **不覆盖范围**: 不运行真实外部 LLM；不证明真实 10 章或 3-5 万字文本质量；不提供实际人工通读结论。

### 5. 依赖和集成点

- **外部依赖**: pytest、SQLAlchemy 本地测试数据库、FastAPI TestClient。
- **内部依赖**: BookRun progress、Artifacts、Book export service。
- **集成方式**: Workflow 或 API 将 `manual_read_gate` 写入 BookRun progress 后，导出器从 progress 投影到 `audit_report.json`。
- **配置来源**: 不读取 `.env`；不使用 provider 配置；不调用真实外部模型。

### 6. 技术选型理由

- **为什么用这个方案**: 主计划真实长程验收当前不能执行，但本地门禁证据链可以通过现有测试证明，能降低后续真实运行声明误报风险。
- **优势**: 验证成本低、范围清晰、完全本地、直接对应“审计报告和人工通读证据”门禁字段。
- **劣势和风险**: 只能证明字段保存与投影，不代表人工通读已经实际完成，也不代表真实 LLM 长程稳定。

### 7. 关键风险点

- **声明风险**: 不得把本地 fixture 的 `manual_read_gate` 当成真实人工通读证据。
- **审计完整性**: audit_report 仍需章节级 model/judge/approve 证据，否则导出器应拒绝。
- **安全考虑**: 本轮未读取 `.env`，未运行真实外部 LLM，未使用、复述或落盘 provider 信息。

### 8. 本轮验证记录

- `uv run pytest tests/test_book_runs.py::test_patch_book_run_progress_persists_manual_read_gate tests/test_book_exporter.py::test_book_run_markdown_and_audit_report_exports_artifacts -q`：2 passed。

### 9. 充分性检查

- □ 我能定义清晰接口契约吗？是：`manual_read_gate` 作为 BookRun progress 字段保存，并在 `audit_report.json` payload 中以同名字段投影。
- □ 我理解关键技术选型理由吗？是：复用已有 BookRun progress 和 export service，不新增并行审计源。
- □ 我识别主要风险点吗？是：fixture 门禁不等于真实人工通读；真实 LLM 长程仍未完成。
- □ 我知道如何验证实现吗？是：定向 pytest、diff check 和敏感扫描。
