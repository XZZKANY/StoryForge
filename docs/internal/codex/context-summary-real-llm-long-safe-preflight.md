# 项目上下文摘要（真实长程安全预检）

生成时间：2026-06-04 22:46:33 +08:00

## 1. 相似实现分析

- **实现1**: `.codex/run-real-llm-long-direct.py`
  - 模式：读取当前进程 `STORYFORGE_LLM_*` 变量，运行真实 LLM 长程 smoke，并生成脱敏证据目录。
  - 可复用：`--chapter-count`、`--target-word-count`、`--token-budget`、`--label` 参数；`summary.json`、`book.md`、`audit_report.json`、`run-metadata.json` 等产物。
  - 需注意：缺少必需变量时只输出 `missing_env=` 并返回 2；不得把私有值写入命令或文件。
- **实现2**: `.codex/run-real-llm-10ch-current-env.ps1`
  - 模式：先执行低成本连通性探针，再按参数启动长程 runner；支持 `-Interactive` 和 `-ProbeOnly`。
  - 可复用：`-ProbeOnly` 可验证 provider、鉴权和模型；`finally` 会清理交互注入的 API key。
  - 需注意：当前 `shell_command` 不能安全交互输入；不能把用户私有值拼入命令。
- **实现3**: `.codex/run-real-llm-connectivity-probe.ps1`
  - 模式：调用 `/models` 与 `/chat/completions`，只输出 present/missing、延迟和 gate，不输出凭据。
  - 可复用：`gate: pass_connectivity_probe` 是正式长程前置门禁。
  - 需注意：缺运行时变量时必须 `gate: fail_preflight`，不能外呼。
- **实现4**: `.codex/validate-real-llm-long-evidence.ps1`
  - 模式：验证 summary、metadata、book、audit、stdout、stderr、质量分、artifact hash、人工通读等证据。
  - 可复用：长程产物生成后用它做脱敏验收。
  - 需注意：`-RequireManualReadthrough` 只在人工通读完成后使用。

## 2. 项目约定

- **命名约定**：环境变量沿用 `STORYFORGE_LLM_*`；测试函数使用 `test_*`；文档用中文任务名。
- **文件组织**：所有审计材料写入项目本地 `.codex/`；真实 LLM 产物写入 `.codex/real-llm-*`。
- **导入顺序**：本轮不改代码导入。
- **代码风格**：简体中文文档；不写入 `.env`；不输出 API key、Authorization 或可还原 provider 私有值。

## 3. 可复用组件清单

- `.codex/run-real-llm-long-direct.py`：真实长程 runner。
- `.codex/run-real-llm-10ch-current-env.ps1`：安全 wrapper。
- `.codex/run-real-llm-connectivity-probe.ps1`：低成本连通性探针。
- `.codex/validate-real-llm-long-evidence.ps1`：脱敏证据验证器。
- `apps/api/tests/test_phase9b_real_llm_long_wrapper.py`：长程 wrapper 单元门禁。
- `apps/api/tests/test_real_llm_connectivity_probe_script.py`：连通性探针和 wrapper 契约门禁。
- `apps/api/tests/test_real_llm_long_evidence_validator.py`：长程证据验证器门禁。
- `apps/api/tests/test_real_llm_smoke_gate_document.py`：真实运行手册安全顺序门禁。

## 4. 测试策略

- **测试框架**：pytest、Ruff、py_compile、PowerShell wrapper 预检。
- **测试模式**：先跑不依赖真实凭据的本地测试和静态检查，再用空环境预检确认脚本安全失败。
- **参考文件**：`test_real_llm_connectivity_probe_script.py`、`test_phase9b_real_llm_long_wrapper.py`、`test_real_llm_long_evidence_validator.py`。
- **覆盖要求**：缺变量时不得外呼；输出不得包含私有 key；真实长程必须先 ProbeOnly，再正式运行。

## 5. 依赖和集成点

- **外部依赖**：OpenAI-compatible provider，但本轮不启动真实外呼。
- **内部依赖**：BookRun 真实 smoke runner、SQLAlchemy 临时 SQLite、Artifact 导出、Judge 质量摘要。
- **集成方式**：同一 PowerShell 进程设置 `STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL`、`STORYFORGE_LLM_MODEL`、`STORYFORGE_LLM_PROVIDER`、`STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD` 后执行 wrapper。
- **配置来源**：当前 Codex 工具进程中所需变量均为 missing；既有成功 10 章证据的脱敏模型名为 `mimo-v2.5-pro`，provider 协议为 `openai-compatible`。

## 6. 技术选型理由

- **为什么用这个方案**：用户已提供私有运行时配置，但直接写入命令会造成二次泄露；现有 wrapper 已支持安全交互输入和运行后清理。
- **优势**：不污染仓库，不写 `.env`，保留可审计的脱敏产物和明确 gate。
- **劣势和风险**：当前工具不可交互输入，真实外呼必须等待用户在同一 PowerShell 进程注入运行时变量后继续。

## 7. 关键风险点

- **并发问题**：真实长程耗时较长，需设置外层超时和 token 预算。
- **边界条件**：ProbeOnly 不通过时禁止正式长程。
- **性能瓶颈**：3-5 万字长程会消耗较多 token 和时间。
- **安全考虑**：不得把用户提供的 API key、Base URL、Authorization 或 provider 私有细节写入 `.codex`、日志、报告、命令输出或提交。

## 8. 本轮安全门槛

- 当前进程变量状态：`STORYFORGE_LLM_API_KEY=missing`、`STORYFORGE_LLM_BASE_URL=missing`、`STORYFORGE_LLM_MODEL=missing`、`STORYFORGE_LLM_PROVIDER=missing`、`STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD=missing`。
- 本轮只执行无密钥预检，不启动真实外呼。
- 真实外呼继续条件：用户在同一 PowerShell 进程临时注入运行时变量，或在可交互终端执行 `-Interactive`。
