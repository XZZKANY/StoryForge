## 项目上下文摘要（真实10章失败证据防误报）

生成时间：2026-06-04 04:33:00 +08:00

### 1. 相似实现分析

- **实现1**: `.codex/validate-real-llm-long-evidence.ps1`
  - 模式：读取 `summary.json` 与 `run-metadata.json`，检查必需产物、runner 退出码、敏感扫描、章节数、token 预算、artifact ID 和质量指标。
  - 可复用：`$failures += ...` 聚合失败原因，最后统一输出 `gate: fail`。
  - 需注意：当前会打印 `summary_present`，但尚未把 `summary_present=false` 作为独立失败条件。
- **实现2**: `apps/api/tests/test_real_llm_long_evidence_validator.py`
  - 模式：使用 `tmp_path` 构造最小长程证据目录，通过 `subprocess.run` 调用 PowerShell 验证器并断言输出。
  - 可复用：`_write_minimal_long_evidence`、`_run_validator`、普通 `assert`。
  - 需注意：可通过新增可选参数构造 metadata 不一致场景，避免触碰真实外部 LLM。
- **实现3**: `.codex/real-llm-10ch-20260603-192512/run-metadata.json`
  - 模式：历史真实 10 章失败目录，`runner_exit_code=1`、`summary_present=false`、`sensitive_hit_count=0`。
  - 可复用：作为失败证据形态参考。
  - 需注意：缺少 `summary.json`、`book.md` 和 `audit_report.json`，不能作为完成证据。
- **实现4**: `.codex/real-llm-10ch-20260603-193901/run-metadata.json`
  - 模式：第二个历史真实 10 章失败目录，同样 `runner_exit_code=1`、`summary_present=false`。
  - 可复用：用于复验验证器仍拒绝历史失败目录。
  - 需注意：失败目录只可用于防误报回归，不能被描述为 10 章完成。

### 2. 项目约定

- **命名约定**: pytest 文件使用 `test_*.py`；PowerShell 参数与变量沿用 PascalCase 和现有字段名。
- **文件组织**: 长程验证器在 `.codex/`，相关 pytest 在 `apps/api/tests/`，上下文摘要、操作日志和验证报告写入项目本地 `.codex/`。
- **导入顺序**: Python 测试保持 `from __future__ import annotations`、标准库导入、常量、helper、测试函数。
- **代码风格**: 测试说明与失败文本使用简体中文；PowerShell 使用既有 `$failures` 聚合模式。

### 3. 可复用组件清单

- `.codex/validate-real-llm-long-evidence.ps1`: 本轮补强对象。
- `apps/api/tests/test_real_llm_long_evidence_validator.py`: 本轮扩展测试。
- `.codex/real-llm-10ch-20260603-192512`: 历史失败目录复验对象。
- `.codex/real-llm-10ch-20260603-193901`: 历史失败目录复验对象。
- `current-phase.md` 与 `README.md`: 当前能力边界事实源。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 构造完整 summary 文件但 metadata 标记 `summary_present=false`，期望验证器失败。
- **参考文件**: `apps/api/tests/test_real_llm_long_evidence_validator.py`。
- **覆盖要求**: 红灯确认旧验证器误通过；绿灯确认新增 failure；两个历史失败目录仍输出 `gate: fail`。

### 5. 依赖和集成点

- **外部依赖**: PowerShell、pytest；不需要真实外部 LLM。
- **内部依赖**: 验证器读取 `summary.json` 与 `run-metadata.json` 的一致性。
- **集成方式**: 在 metadata 已解析分支内增加 `summary_present` 失败条件，不改变成功证据字段格式。
- **配置来源**: 临时测试目录和历史脱敏产物目录；不读取 `.env`。

### 6. 技术选型理由

- **为什么用这个方案**: 防误报门禁应落在长程证据验证器，而不是只靠文档提醒。
- **优势**: 小范围、可重复、能阻止 metadata 与文件状态自相矛盾的证据通过。
- **劣势和风险**: 该门禁不执行真实 10 章长程，只提升证据验收严格度。

### 7. 关键风险点

- **边界误判**: 失败目录不能被修补为完成证据。
- **敏感信息**: 不读取 `.env`，不写入 provider 私有端点或凭据。
- **历史噪音**: 日志和报告存在历史空白/编码噪音，验证只检查本轮新增片段和目标文件。
- **目标状态**: 真实 10 章或 3-5 万字长程仍未完成。

### 8. 上下文充分性检查

- 能定义接口契约：是，`summary_present=false` 必须导致 `gate: fail`。
- 理解技术选型：是，复用现有长程验证器失败聚合模式。
- 识别主要风险：是，防止不一致 metadata 或失败目录误报。
- 知道如何验证：是，pytest 红绿、历史失败目录验证、敏感扫描和目标空白检查。
