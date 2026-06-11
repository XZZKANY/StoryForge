## 项目上下文摘要（OpenAPI 验证治理三轮）

生成时间：2026-05-18 13:55:00 +08:00

### 1. 相似实现分析

- `scripts/run-e2e.mjs`：Node 编排脚本先刷新 OpenAPI，再运行 Node 契约、API 验证和 workflow 验证；内部已有 `resolvePythonCommand`、`runPythonCommand`、`runPythonScript` 可复用的运行时回退模式。
- `scripts/generate-openapi.ps1`：PowerShell OpenAPI 生成入口，目前直接执行 `uv run python -`，与 e2e 的 `uv → python3 → python` 回退策略不一致。
- `scripts/verify-local.ps1`：PowerShell 本地验证脚本使用中文输出、明确失败原因和非零退出码，适合作为 PowerShell 脚本风格参考。
- `docs/operations/troubleshooting.md`、`docs/operations/local-start.md`、`docs/operations/README.md`：运维文档均按适用范围、命令、失败处理和已知限制组织。
### 2. 项目约定

- 文档、日志、错误提示和测试描述使用简体中文。
- Node 脚本使用 ESM、`node:test`、`node:assert/strict` 和明确中文断言消息。
- PowerShell 脚本以 `$ErrorActionPreference`、`Push-Location/Pop-Location`、清晰中文输出和非零退出码表达验证结果。
- 运维文档只承诺当前代码已落地能力，不把真实 provider、embedding、reranker 作为通过条件。

### 3. 可复用组件清单

- `scripts/run-e2e.mjs` 的 `resolvePythonCommand` 思路：优先 uv，退回 python3，再退回 python。
- `scripts/verify-local.ps1` 的 `Get-Command` 检查方式：用于 PowerShell 中判断命令可用性。
- `package.json` 的既有脚本：`pnpm openapi`、`pnpm e2e`、`pnpm test`、`pnpm verify`，本轮不新增脚本。

### 4. 测试策略

- PowerShell 语法：使用 `[System.Management.Automation.PSParser]::Tokenize()` 解析脚本。
- OpenAPI 生成：执行 `pnpm openapi`，确认契约可刷新。
- 主链路回归：执行 `pnpm e2e` 和必要的 `pnpm test`。
- 文本契约：用 `Select-String` 检查 TODO、运维文档和日志关键条目。
### 5. 依赖和集成点

- `pnpm openapi` 调用 `scripts/generate-openapi.ps1`。
- `pnpm e2e` 调用 `scripts/run-e2e.mjs`，并在其中刷新 OpenAPI。
- `docs/operations/local-start.md`、`docs/operations/troubleshooting.md` 和 `README.md` 共同说明本地验证入口。
- `.codex/operations-log.md`、`.codex/verification-report.md` 和 `TODO.md` 是每轮留痕入口。

### 6. 技术选型理由

- 继续复用现有 PowerShell 与 Node 脚本，不新增工具，降低发布治理维护面。
- 让 `pnpm openapi` 与 `pnpm e2e` 的 Python 运行时策略保持一致，可减少新机器仅安装 Python 但未安装 uv 时的误判。
- 文档同步只记录已验证脚本行为，避免承诺未实现能力。

### 7. 关键风险点

- Docker 当前不可查询，`pnpm verify` 预计仍会失败，不能声称完整通过。
- 修改 OpenAPI 生成脚本必须保证生成结果稳定，不引入契约噪音。
- 当前工作区已有未提交变更，本轮不得自动提交，只能继续记录状态。
