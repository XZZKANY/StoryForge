# 项目上下文摘要（真实 LLM 探针空正文重试）

生成时间：2026-06-05 19:42:24 +08:00

## 1. 相似实现分析

- **实现1**: `.codex/run-real-llm-connectivity-probe.ps1`
  - 模式：先 `/models`，再 `/chat/completions`，输出 `models_probe`、`chat_probe`、`chat_content` 和 gate。
  - 可复用：`Invoke-ProviderJson`、`Join-ProviderPath`、脱敏错误输出和 finally 清理凭据。
  - 需注意：当前 `chat_probe: ok` 但 content 为空时直接 `gate: fail_empty_chat`，会阻断真实长程启动。
- **实现2**: `.codex/run-real-llm-10ch-current-env.ps1`
  - 模式：只接受探针输出中的 `gate: pass_connectivity_probe`，否则停止长程。
  - 可复用：无需修改 wrapper，只需让探针在一次空正文后做有限重试。
  - 需注意：不能绕过探针；chat HTTP 失败仍必须失败。
- **实现3**: `apps/api/tests/test_real_llm_connectivity_probe_script.py`
  - 模式：本地 HTTPServer fake provider 验证 PowerShell 脚本。
  - 可复用：新增“第一次空正文、第二次 OK”的 fake provider 测试，不触发真实外部网络。
  - 需注意：测试里只能使用假凭据和本地 URL。
- **实现4**: `.codex/operations-log.md` 既有 ProbeOnly 调试记录
  - 模式：此前已将 `max_completion_tokens` 从极小值提高到 64，以适配推理模型。
  - 可复用：本轮延续“低成本但更稳”的方向，增加一次空正文重试。
  - 需注意：第二次仍空时继续失败，避免把 provider 不可用误判为可用。

## 2. 项目约定

- **命名约定**：PowerShell 函数 PascalCase；输出继续使用 `key: value` 和 `gate: ...`。
- **文件组织**：脚本在 `.codex/`，测试在 `apps/api/tests/`，审计材料写入 `.codex/`。
- **导入顺序**：Python 测试保持 Ruff 排序。
- **代码风格**：中文说明；不输出私有 Base URL、API key 或 Authorization 值。

## 3. 可复用组件清单

- `Invoke-ProviderJson`: HTTP 调用封装。
- `Read-ModelIds`: `/models` 结果解析。
- `Redact-PrivateRuntimeText`: 错误输出脱敏。
- `_ProbeProviderHandler`: 本地 fake provider 模式。

## 4. 测试策略

- **测试框架**：pytest、Ruff、PowerShell Parser。
- **测试模式**：本地 HTTPServer 第一次 chat 返回空 content，第二次返回 `OK`。
- **参考文件**：`test_real_llm_connectivity_probe_script.py`。
- **覆盖要求**：一次空正文后重试并通过；缺环境仍 `fail_preflight`；正常 fake provider 仍通过；敏感字符串不输出。

## 5. 依赖和集成点

- **外部依赖**：本轮不调用真实外部 LLM。
- **内部依赖**：wrapper 只消费 `pass_connectivity_probe` gate。
- **集成方式**：探针脚本内部处理空 content 重试，wrapper 无需改动。
- **配置来源**：仍读取当前进程 `STORYFORGE_LLM_*`。

## 6. 技术选型理由

- **为什么用这个方案**：一次空正文可能是短探针偶发行为，有限重试能降低误阻断；连续空正文仍失败，保留安全边界。
- **优势**：改动小、成本低、不影响真实长程生成。
- **劣势和风险**：多一次低成本 chat 调用；如果 provider 持续空正文仍会失败。

## 7. 关键风险点

- **边界条件**：第二次仍空必须 `fail_empty_chat`。
- **性能瓶颈**：最多增加一次 chat 探针，成本可忽略。
- **安全考虑**：不得写入或输出真实凭据；finally 继续清理 API key。
