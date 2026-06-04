## 项目上下文摘要（真实 LLM 10 章包装交互式安全输入）

生成时间：2026-06-04 04:10:44 +08:00

### 1. 相似实现分析

- **实现1**: `.codex/run-real-llm-10ch-current-env.ps1`
  - 模式：读取当前 PowerShell 进程的 `STORYFORGE_LLM_*` 变量，缺失时 `gate: fail_preflight`；环境完整后先跑连通性探针，再执行长程 runner。
  - 可复用：requiredNames、preflight、connectivity probe、ProbeOnly 和 runner 调用顺序。
  - 需注意：当前不支持交互式安全输入，用户必须自行在同一进程注入变量。
- **实现2**: `.codex/run-real-llm-connectivity-probe.ps1`
  - 模式：支持 `-Interactive`，用 `Read-Host -AsSecureString` 读取凭据，`Convert-SecureStringToPlainText` 转为当前进程内明文，finally 清理 API key。
  - 可复用：SecureString 转换、交互式缺项补齐、finally 清理模式。
  - 需注意：探针只做低成本请求，不启动长程。
- **实现3**: `.codex/run-real-llm-smoke-interactive.ps1`
  - 模式：交互式输入真实 LLM 配置，写入当前进程环境变量，运行完成后生成脱敏产物。
  - 可复用：只写 Process scope、不把配置写入文件的安全边界。
  - 需注意：该脚本只允许 1/3 章 smoke，不覆盖 10 章长程 runner。
- **实现4**: `apps/api/tests/test_real_llm_connectivity_probe_script.py`
  - 模式：通过静态契约和本地 fake provider 测试 10 章 wrapper 的探针和 ProbeOnly 行为。
  - 可复用：不运行真实外部 LLM，使用 stdout gate 和脚本文本契约验证安全行为。
  - 需注意：不模拟真实交互输入，避免把私有配置写进测试。

### 2. 项目约定

- **命名约定**: PowerShell switch 使用 PascalCase，如 `Interactive`；环境变量保持 `STORYFORGE_LLM_*`。
- **文件组织**: `.codex` 放置真实 LLM 本地执行脚本；API 测试放在 `apps/api/tests`。
- **导入顺序**: Python 测试保持标准库导入在前。
- **代码风格**: 可读文本、测试 docstring、日志和文档均使用简体中文。

### 3. 可复用组件清单

- `.codex/run-real-llm-10ch-current-env.ps1`: 本轮扩展对象。
- `.codex/run-real-llm-connectivity-probe.ps1`: Interactive 与 SecureString 参考。
- `.codex/run-real-llm-smoke-interactive.ps1`: 交互式真实 smoke 参考。
- `apps/api/tests/test_real_llm_connectivity_probe_script.py`: 契约与 ProbeOnly 回归测试。

### 4. 测试策略

- **测试框架**: pytest。
- **红灯**: 新增静态契约测试，要求 wrapper 支持 `Interactive`、`Read-Host -AsSecureString`、SecureString 转换、交互注入列表和 finally 清理；当前脚本应失败。
- **绿灯**: 修改 wrapper 后运行 `test_real_llm_connectivity_probe_script.py` 和 `test_phase9b_real_llm_long_wrapper.py`。
- **安全回归**: 缺环境非 Interactive 仍 `fail_preflight`；ProbeOnly fake provider 仍 pass；敏感扫描 clean。

### 5. 依赖和集成点

- **外部依赖**: PowerShell、pytest；不需要真实 provider。
- **内部依赖**: 连通性探针脚本和长程 Python runner。
- **集成方式**: 仅在用户显式传入 `-Interactive` 时提示输入；默认环境变量路径保持不变。
- **配置来源**: 交互输入只写当前 PowerShell 进程，不读取 `.env`。

### 6. 技术选型理由

- **为什么用这个方案**: 真实长程仍需要 provider 配置，但把凭据写入命令或文件风险高；显式交互模式能复用已有安全输入经验。
- **优势**: 降低真实 10 章启动门槛，同时不破坏自动化 preflight。
- **劣势和风险**: 交互式路径无法在 CI 中真实输入，只能通过静态契约和默认/ProbeOnly 回归验证。

### 7. 关键风险点

- **凭据泄露**: 不打印 Base URL 或 API key，敏感扫描覆盖脚本、测试和审计记录。
- **环境污染**: 只清理本轮交互注入的环境变量，不破坏调用者预先设置的进程环境。
- **行为回归**: 非 Interactive 缺环境仍必须 `fail_preflight`；ProbeOnly 仍不得启动长程。

### 8. 充分性检查

- 能定义接口契约：是，新增 `-Interactive`，缺项提示输入并写入 Process scope。
- 理解技术选型：是，复用现有 SecureString 和 finally 清理模式。
- 识别主要风险：是，凭据泄露、环境污染和 ProbeOnly 回归。
- 知道如何验证：是，红绿测试、PowerShell 解析、敏感扫描、空白检查和相关回归。
