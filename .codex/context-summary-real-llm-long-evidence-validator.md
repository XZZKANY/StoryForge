## 项目上下文摘要（真实 LLM 长程证据验证器 artifact ID 门禁）

生成时间：2026-06-04 03:42:37 +08:00

### 1. 相似实现分析

- **实现1**: `.codex/validate-real-llm-long-evidence.ps1`
  - 模式：PowerShell 读取产物目录，解析 `summary.json` 与 `run-metadata.json`，累加 `$failures`，最后输出 gate 并用退出码表达通过或失败。
  - 可复用：`Read-JsonOrNull`、`Write-Presence`、`$failures +=` 失败累加模式。
  - 需注意：当前会输出 `markdown_artifact_id` 和 `audit_artifact_id`，但未把缺失 ID 纳入失败条件。
- **实现2**: `.codex/validate-real-llm-smoke-evidence.ps1`
  - 模式：同样使用 PowerShell 验收脱敏产物，但范围只覆盖当前 smoke，不代表长程。
  - 可复用：必需文件 presence 检查和 summary/metadata 只读输出模式。
  - 需注意：smoke 验证器比长程宽松，不能直接替代 10 章长程门禁。
- **实现3**: `apps/api/tests/test_phase9b_real_llm_long_wrapper.py`
  - 模式：pytest 直接加载 `.codex` Python runner，验证长程运行后 gate 条件。
  - 可复用：测试名称使用中文说明行为，验证门禁失败原因的精确中文文本。
  - 需注意：该文件测试 Python runner 内部函数，不覆盖 PowerShell 证据验证器。
- **实现4**: `apps/api/tests/test_real_llm_connectivity_probe_script.py`
  - 模式：pytest 通过 `subprocess.run` 执行 PowerShell 脚本，断言 stdout gate 和退出码。
  - 可复用：`capture_output=True`、`text=True`、`check=False` 的脚本契约测试方式。
  - 需注意：测试输出不得包含凭据或私有端点。

### 2. 项目约定

- **命名约定**: Python 测试文件使用 `test_*.py`，测试函数使用 `test_*`；PowerShell 函数使用 PascalCase，变量使用 camelCase 或描述性英文。
- **文件组织**: `.codex` 放置本地审计脚本与证据；`apps/api/tests` 放置 pytest 契约测试。
- **导入顺序**: Python 测试使用标准库在前，项目导入在后；本轮只需标准库。
- **代码风格**: 文档、注释、测试 docstring、失败信息均使用简体中文。

### 3. 可复用组件清单

- `.codex/validate-real-llm-long-evidence.ps1`: 长程证据验收脚本，本轮直接补强。
- `.codex/validate-real-llm-smoke-evidence.ps1`: smoke 验收参考实现。
- `apps/api/tests/test_real_llm_connectivity_probe_script.py`: PowerShell 脚本 subprocess 测试模式。
- `apps/api/tests/test_phase9b_real_llm_long_wrapper.py`: 长程 gate 中文断言模式。

### 4. 测试策略

- **测试框架**: pytest，通过 `uv run pytest` 执行。
- **测试模式**: 使用 `tmp_path` 构造最小脱敏产物目录，使用 `subprocess.run` 调用 PowerShell 验证脚本。
- **参考文件**: `apps/api/tests/test_real_llm_connectivity_probe_script.py` 与 `apps/api/tests/test_phase9b_real_llm_long_wrapper.py`。
- **覆盖要求**: 缺 `markdown_artifact_id` 或 `audit_artifact_id` 时必须失败；完整 artifact ID 时必须通过；不运行真实外部 LLM。

### 5. 依赖和集成点

- **外部依赖**: PowerShell、pytest、Python 标准库 `json`、`subprocess`、`pathlib`。
- **内部依赖**: `.codex/validate-real-llm-long-evidence.ps1` 的输出 gate 与退出码。
- **集成方式**: pytest 创建本地临时目录并执行 PowerShell 脚本。
- **配置来源**: 测试不读取 `.env`，不需要真实 provider 环境变量。

### 6. 技术选型理由

- **为什么用这个方案**: 最终长程完成声明依赖产物证据，验证器本身必须有契约测试；使用临时目录可复现成功和失败路径。
- **优势**: 不消耗模型、不触碰真实凭据、能防止缺导出 artifact 的运行被误判。
- **劣势和风险**: 该测试只能证明验证器门禁，不证明真实 10 章已运行。

### 7. 关键风险点

- **并发问题**: 无共享状态，`tmp_path` 为每个测试创建独立目录。
- **边界条件**: JSON 可解析但 artifact ID 为空字符串时必须失败。
- **性能瓶颈**: 仅写小型文件并运行 PowerShell，开销低。
- **安全考虑**: 测试数据必须为脱敏假值，不出现私有 URL、key、Authorization 或 Bearer token。

### 8. 外部资料

- **Context7 / pytest 文档**：查询 `tmp_path` 与 subprocess 接受测试模式；用途是确认临时目录 fixture 适合构造脚本产物目录。
- **GitHub search_code**：搜索 pytest + subprocess + PowerShell 示例；用途是确认用 pytest 调用外部脚本并断言 returncode/stdout 是常见实践。

### 9. 充分性检查

- 能定义接口契约：是，输入为 `-RunDirectory` 和可选门禁参数，输出为 stdout gate 与退出码。
- 理解技术选型：是，复用现有 PowerShell 验证器和 pytest subprocess 模式。
- 识别主要风险：是，缺 artifact ID 被误判通过、敏感信息误写入测试输出。
- 知道如何验证：是，红灯测试、绿灯测试、PowerShell 解析、敏感扫描、定向 diff 检查。
