## 项目上下文摘要（真实 LLM 长程最终人工通读门禁）

生成时间：2026-06-04 03:52:16 +08:00

### 1. 相似实现分析

- **实现1**: `.codex/validate-real-llm-long-evidence.ps1`
  - 模式：解析长程产物目录，输出 presence、summary、metadata 和 gate；用 `$failures` 累加失败原因。
  - 可复用：`Write-Presence`、`Read-JsonOrNull`、`$failures` 和 `gate` 输出模式。
  - 需注意：当前默认 gate 只覆盖真实 10 章技术 scope，明确人工通读完成前不得最终验收。
- **实现2**: `apps/api/tests/test_real_llm_long_evidence_validator.py`
  - 模式：pytest 使用 `tmp_path` 构造最小脱敏产物目录，通过 `subprocess.run` 执行 PowerShell 验证器。
  - 可复用：`_write_minimal_long_evidence()` 和 `_run_validator()`。
  - 需注意：当前测试覆盖 artifact ID 和技术 scope，不覆盖最终人工通读门禁。
- **实现3**: `.codex/real-llm-3ch-20260603-173932/manual-readthrough-completion.md`
  - 模式：人工通读完成记录使用独立 Markdown 文件，包含“结论：通过...”。
  - 可复用：以 `manual-readthrough-completion.md` 作为最终人工通读证据文件名。
  - 需注意：3 章通读只作为 10 章评估前置证据，不能直接替代 10 章最终通读。
- **实现4**: `.codex/real-llm-smoke-gate.md`
  - 模式：区分 smoke 范围和长程完成声明，长程完成声明必须具备人工通读证据。
  - 可复用：最终验收必须显式具备人工通读证据的门禁语言。
  - 需注意：不能把绿色测试或 10 章技术 gate 当成长程最终完成。

### 2. 项目约定

- **命名约定**: PowerShell switch 参数使用 PascalCase，如 `RequireManualReadthrough`；Python 测试使用 `test_*`。
- **文件组织**: `.codex` 存放验证脚本、上下文摘要和真实运行证据；`apps/api/tests` 存放 pytest 契约测试。
- **导入顺序**: Python 测试标准库导入在前，本轮不需要项目模块导入。
- **代码风格**: 输出、注释、测试 docstring 和文档均使用简体中文。

### 3. 可复用组件清单

- `.codex/validate-real-llm-long-evidence.ps1`: 长程证据验证器，本轮新增最终验收模式。
- `apps/api/tests/test_real_llm_long_evidence_validator.py`: 现有长程验证器契约测试。
- `.codex/real-llm-3ch-20260603-173932/manual-readthrough-completion.md`: 人工通读完成记录格式参考。
- `.codex/real-llm-smoke-gate.md`: 长程完成声明门禁事实源。

### 4. 测试策略

- **测试框架**: pytest，通过 `uv run pytest` 执行。
- **测试模式**: 使用 `tmp_path` 构造脱敏产物目录；通过 `subprocess.run` 执行 PowerShell。
- **红灯**: 启用 `-RequireManualReadthrough` 但缺少 `manual-readthrough-completion.md` 时，当前脚本应失败但实际会报参数不支持或误通过。
- **绿灯**: 增加开关后，缺人工通读完成文件失败；存在包含“结论：通过”的完成文件时输出最终验收 gate。

### 5. 依赖和集成点

- **外部依赖**: PowerShell、pytest、Python 标准库。
- **内部依赖**: 长程证据目录中的 `manual-readthrough-completion.md`。
- **集成方式**: 验证器默认保持技术 scope；调用方显式传入 `-RequireManualReadthrough` 才进入最终验收门禁。
- **配置来源**: 不读取 `.env`，不需要真实 provider 环境变量。

### 6. 技术选型理由

- **为什么用这个方案**: 现有脚本已区分“10 章技术 scope”与“最终验收”，新增开关可以保持兼容并让最终声明可自动验证。
- **优势**: 不破坏已有技术 smoke 验证；最终验收有可重复本地门禁。
- **劣势和风险**: 文本包含“结论：通过”是轻量门禁，不能替代真实阅读质量判断本身。

### 7. 关键风险点

- **并发问题**: 无共享状态，测试目录由 `tmp_path` 隔离。
- **边界条件**: 存在完成文件但没有通过结论时必须失败。
- **性能瓶颈**: 只读取一个 Markdown 文件，开销低。
- **安全考虑**: 完成文件和测试 fixture 只使用脱敏假数据，不出现真实 provider 信息。

### 8. 充分性检查

- 能定义接口契约：是，新增 `-RequireManualReadthrough`，失败输出 `gate: fail`，成功输出 `gate: pass_for_real_10ch_final_acceptance`。
- 理解技术选型：是，复用现有验证器与人工通读完成记录格式。
- 识别主要风险：是，默认技术 gate 不能被误用为最终验收。
- 知道如何验证：是，红绿测试、相关回归、PowerShell 解析、敏感扫描和空白检查。
