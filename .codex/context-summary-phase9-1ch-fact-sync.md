## 项目上下文摘要（Phase9 1章事实同步）

生成时间：2026-06-04 04:44:15 +08:00

### 1. 相似实现分析

- **实现1**: `current-phase.md`
  - 模式：阶段事实源，记录当前已完成能力、最新脱敏证据目录和禁止宣称范围。
  - 可复用：1 章证据目录 `.codex/real-llm-1ch-20260603-142925` 与“真实 10 章或 3-5 万字仍未完成”的边界。
  - 需注意：该文件声明 1 章已补人工通读，但证据目录缺少独立完成文件，需要标准化。
- **实现2**: `.dev_plan.md`
  - 模式：总计划勾选状态与证据描述事实源。
  - 可复用：9B-4b 已完成项的证据描述格式。
  - 需注意：9B-4a 当前仍是 `[ ]`，与 current-phase/README 的 1 章完成事实不一致。
- **实现3**: `.codex/validate-real-llm-smoke-evidence.ps1`
  - 模式：1/3 章 smoke 脱敏产物验收，输出 `gate: pass_for_current_smoke_scope`。
  - 可复用：验证 1 章目录 summary、metadata、质量风险和人工通读待办存在。
  - 需注意：该验证器不要求独立 `manual-readthrough-completion.md`，本轮通过文档契约补齐。
- **实现4**: `apps/api/tests/test_real_llm_smoke_gate_document.py`
  - 模式：pytest 读取 Markdown 文件并用普通 `assert` 锁定事实源契约。
  - 可复用：`Path.read_text(encoding="utf-8")`、简体中文测试说明、敏感信息负断言。
  - 需注意：本轮应新增独立阶段事实源测试，避免和 runbook 测试混杂。

### 2. 项目约定

- **命名约定**: pytest 文件使用 `test_*.py`，函数名以 `test_` 开头；`.codex` 上下文摘要使用任务名。
- **文件组织**: 阶段计划在 `.dev_plan.md`；脱敏产物在 `.codex/real-llm-*`；测试在 `apps/api/tests/`。
- **导入顺序**: Python 测试先 `from __future__ import annotations`，再标准库导入和常量。
- **代码风格**: 使用普通 `assert`；文档和测试说明使用简体中文；不写入 provider 私有信息。

### 3. 可复用组件清单

- `.codex/validate-real-llm-smoke-evidence.ps1`: 1 章 smoke 验证器。
- `.codex/real-llm-1ch-20260603-142925/summary.json`: 1 章完成摘要。
- `.codex/real-llm-1ch-20260603-142925/run-metadata.json`: 1 章脱敏运行元数据。
- `.codex/real-llm-1ch-20260603-142925/human-readthrough-todo.md`: 已含人工通读完成记录。
- `apps/api/tests/test_real_llm_smoke_gate_document.py`: 文档契约测试模式参考。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 新增 `apps/api/tests/test_phase9_fact_sources.py`，读取 `.dev_plan.md` 和 1 章人工通读完成文件。
- **参考文件**: `apps/api/tests/test_real_llm_smoke_gate_document.py`、`apps/api/tests/test_real_llm_long_evidence_validator.py`。
- **覆盖要求**: 9B-4a 必须 `[x]`；必须记录 1 章证据目录、tokens、artifact ID、人工通读；独立完成文件必须包含“结论：通过”；不得外推真实 10 章或 3-5 万字完成。

### 5. 依赖和集成点

- **外部依赖**: pytest、PowerShell。
- **内部依赖**: `.dev_plan.md`、1 章脱敏产物目录、smoke 验证器。
- **集成方式**: 不修改业务代码；只同步计划事实源和标准化人工通读完成文件。
- **配置来源**: 只读取现有脱敏产物，不读取 `.env`。

### 6. 技术选型理由

- **为什么用这个方案**: `.dev_plan.md` 是计划勾选事实源，必须与已验证的 1 章 smoke 证据一致。
- **优势**: 小范围、可重复验证、降低计划状态误报或漏报风险。
- **劣势和风险**: 文档同步不等于真实 10 章或 3-5 万字长程完成。

### 7. 关键风险点

- **事实漂移**: current-phase、README 和 .dev_plan 对 1 章完成状态不一致。
- **证据标准化**: 已有人工通读完成记录在 todo 文件中，需要独立完成文件便于审计。
- **声明边界**: 1 章 smoke 只能证明当前 smoke 范围，不代表 10 章或 3-5 万字长程完成。
- **敏感信息**: 不读取 `.env`，不写入 provider 私有端点或凭据。

### 8. 上下文充分性检查

- 能定义接口契约：是，9B-4a 勾选、证据目录和人工通读完成文件均可断言。
- 理解技术选型：是，复用现有 smoke 验证器与文档契约测试模式。
- 识别主要风险：是，防止 1 章证据外推为长程完成。
- 知道如何验证：是，pytest 红绿、smoke 验证器、安全扫描和空白检查。
