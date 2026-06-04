## 项目上下文摘要（真实10章安全运行手册）

生成时间：2026-06-04 04:22:33 +08:00

### 1. 相似实现分析

- **实现1**: `.codex/run-real-llm-10ch-current-env.ps1`
  - 模式：10 章真实 LLM 包装入口，先做当前进程环境变量预检，再执行连通性探针，通过后才允许启动长程 runner。
  - 可复用：`-Interactive`、`-ProbeOnly`、`gate: fail_preflight`、`gate: pass_probe_only`、`gate: fail_connectivity_probe`。
  - 需注意：脚本只应使用当前 PowerShell 进程运行时变量或交互输入，不应把 provider URL 或凭据写入文件。
- **实现2**: `.codex/run-real-llm-connectivity-probe.ps1`
  - 模式：低成本 Provider 探针，检查 `/models` 和极短 `/chat/completions`，失败时阻断长程。
  - 可复用：`-Interactive`、`-AsSecureString`、`gate: pass_connectivity_probe`。
  - 需注意：探针不创建 BookRun、不生成章节，不能作为真实 10 章完成证据。
- **实现3**: `.codex/validate-real-llm-long-evidence.ps1`
  - 模式：脱敏产物验收脚本，校验 summary、metadata、正文、审计报告、artifact ID、质量指标和 token 预算。
  - 可复用：`-RequireManualReadthrough` 最终验收模式。
  - 需注意：默认 `gate: pass_for_real_10ch_scope` 只覆盖技术证据；人工通读完成后才可进入最终验收 gate，且仍不代表 3-5 万字长程完成。
- **实现4**: `apps/api/tests/test_real_llm_connectivity_probe_script.py`
  - 模式：pytest 静态契约和本地 fake provider 回归测试，使用 `Path.read_text(encoding="utf-8")` 与普通 `assert`。
  - 可复用：敏感信息负断言、PowerShell 脚本契约断言、`ProbeOnly` 不启动长程断言。
  - 需注意：测试描述使用简体中文，不触发真实外部 LLM。

### 2. 项目约定

- **命名约定**: PowerShell switch 使用 PascalCase，如 `Interactive`、`ProbeOnly`、`RequireManualReadthrough`；pytest 文件使用 `test_*.py`。
- **文件组织**: Phase 9 运行脚本、上下文摘要、操作日志和验证报告统一放在项目本地 `.codex/`；API 测试位于 `apps/api/tests/`。
- **导入顺序**: Python 测试先 `from __future__ import annotations`，再标准库导入。
- **代码风格**: pytest 使用普通 `assert`；文档使用 Markdown 小节和 PowerShell fenced code block；说明文字使用简体中文。

### 3. 可复用组件清单

- `.codex/run-real-llm-10ch-current-env.ps1`: 真实 10 章 wrapper 与 ProbeOnly 门禁。
- `.codex/run-real-llm-connectivity-probe.ps1`: Provider 连通性探针。
- `.codex/validate-real-llm-long-evidence.ps1`: 长程脱敏证据验收与人工通读最终门禁。
- `apps/api/tests/test_real_llm_connectivity_probe_script.py`: 本地脚本契约测试模式。
- `apps/api/tests/test_real_llm_long_evidence_validator.py`: 长程证据验证器测试模式。

### 4. 测试策略

- **测试框架**: pytest，由 `apps/api` 下的 `uv run pytest ... -q` 执行。
- **测试模式**: 新增文档契约测试，读取 `.codex/real-llm-smoke-gate.md` 并断言关键步骤存在。
- **参考文件**: `apps/api/tests/test_real_llm_connectivity_probe_script.py`、`apps/api/tests/test_real_llm_long_evidence_validator.py`。
- **覆盖要求**: 覆盖 `-Interactive`、`-ProbeOnly`、正式运行、长程验证器、`-RequireManualReadthrough`、凭据不落盘、敏感信息负断言和真实长程未完成边界。

### 5. 依赖和集成点

- **外部依赖**: pytest；PowerShell；无需真实外部 LLM。
- **内部依赖**: `.codex/real-llm-smoke-gate.md` 作为人工运行事实源，测试负责锁定关键契约。
- **集成方式**: 文档指向既有 wrapper、探针和验证器；不新增运行脚本。
- **配置来源**: 当前 PowerShell 进程环境变量或显式 `-Interactive` 输入；不读取 `.env`。

### 6. 技术选型理由

- **为什么用这个方案**: 当前缺口是操作手册和验收顺序可审计性，不是运行能力缺失；文档契约测试能防止后续门禁说明退化。
- **优势**: 低风险、可本地重复验证、不触碰真实凭据、不启动真实外部 LLM。
- **劣势和风险**: 文档测试只能锁定文字契约，不能证明真实 10 章已经跑通；真实长程仍需要后续人工安全执行。

### 7. 关键风险点

- **凭据泄露**: 禁止写入 provider URL、key、鉴权头、令牌、密钥前缀或供应商凭据。
- **边界误判**: 3 章 smoke 不能外推为 10 章或 3-5 万字长程完成。
- **验证不足**: 本轮只做文档契约和本地静态验证，不做真实外部调用。
- **历史噪音**: `.codex/operations-log.md` 与 `.codex/verification-report.md` 存在历史换行和空白噪音，验证时只做本轮目标文件或新增片段的定向检查。

### 8. 上下文充分性检查

- 能定义接口契约：是，文档必须给出 `-Interactive -ProbeOnly`、正式运行、`validate-real-llm-long-evidence.ps1` 和 `-RequireManualReadthrough` 的顺序。
- 理解技术选型：是，复用既有 wrapper、探针和验证器，不新增自研运行通道。
- 识别主要风险：是，凭据泄露、误声明长程完成、文档和脚本契约漂移。
- 知道如何验证：是，新增 pytest 文档契约，运行敏感扫描和目标文件空白检查。
