# 真实 LLM smoke 阶段门禁

生成目的：为 StoryForge 真实外部 LLM 推进阶段提供可重复、脱敏、可审计的执行边界。本文不包含任何 provider URL、key 或供应商凭据。

## 0. 总原则

- 不读取 `.env`。
- 不把 provider URL、key、鉴权头、令牌、密钥前缀或供应商凭据写入代码、文档、日志、测试输出、提交信息或产物。
- 真实调用前必须明确预算、章节数、目标字数、超时、中止条件和预期产物。
- 真实调用后必须记录脱敏运行参数、消耗、产物 ID、审计报告 ID、质量风险和人工通读待办。
- 1 章或 3 章 smoke 只能证明当前 smoke 范围，不能宣称 10 章或 3-5 万字长程完成。
- 10 章或 3-5 万字完成声明必须同时具备真实运行证据、正文产物、审计报告、成本统计、质量风险记录和人工通读证据。

## 1. 当前可用脚本

### 1.1 交互式真实 smoke 运行脚本

```powershell
cd D:\StoryForge
.\.codex\run-real-llm-smoke-interactive.ps1
```

默认门禁：

- 章节数：1
- 目标字数：900
- token 预算：20000
- 章节字数范围：600-1600
- 单请求超时：60 秒
- 总时间预算：900 秒

脚本会交互输入运行时配置，只设置当前 PowerShell 进程环境变量，并在 runner 完成后生成脱敏产物目录。

### 1.2 脱敏产物验收脚本

```powershell
cd D:\StoryForge
.\.codex\validate-real-llm-smoke-evidence.ps1 -RunDirectory <真实 smoke 产物目录>
```

验收脚本只输出白名单字段和门禁结论，不输出 stdout/stderr 原文。

### 1.3 低成本 Provider 连通性探针

```powershell
cd D:\StoryForge
.\.codex\run-real-llm-connectivity-probe.ps1 -Interactive -Model <模型ID> -TimeoutSeconds 20
```

或在同一个 PowerShell 进程中已安全注入运行时变量后执行：

```powershell
cd D:\StoryForge
.\.codex\run-real-llm-connectivity-probe.ps1 -TimeoutSeconds 20
```

探针只做两件事：

- 请求 OpenAI 兼容 `/models`，确认端点、鉴权和目标模型可见性。
- 请求极短 `/chat/completions`，确认模型可返回非空内容。

探针不会创建 BookRun，不会生成章节，不会写入 provider URL 或凭据。缺少当前进程运行时变量且未使用 `-Interactive` 时，必须停在 `gate: fail_preflight`。

## 2. 预期产物目录

真实 smoke 成功后，产物目录应包含：

- `summary.json`
- `stdout.json`
- `stderr.log`
- `run-metadata.json`
- `quality-risk.md`
- `human-readthrough-todo.md`

其中：

- `summary.json` 记录 BookRun 状态、目标章节数、实际章节数、token 消耗、估算成本、正文字符数、Markdown artifact ID、audit artifact ID、逐章指标。
- `run-metadata.json` 记录脱敏运行参数、runner 退出码、summary 状态和敏感扫描结果。
- `quality-risk.md` 记录质量风险。
- `human-readthrough-todo.md` 记录人工逐章通读待办。

## 3. 1 章 smoke 进入条件

可以启动 1 章 smoke 的条件：

- 用户在同一 PowerShell 会话中交互输入运行时配置，或 Codex 当前执行环境的运行时变量全部为 present。
- 已明确本次预算、章节数、目标字数、超时、中止条件和预期产物。
- 当前没有将 provider 配置写入仓库文件。

1 章 smoke 通过条件：

- `runner_exit_code` 为 0。
- `summary.json` 为 present。
- `sensitive_hit_count` 为 0。
- `book_run_status` 为 `completed`。
- `actual_chapter_count` 等于 1。
- `markdown_artifact_id` 与 `audit_artifact_id` 存在。
- `quality-risk.md` 与 `human-readthrough-todo.md` 存在。

1 章 smoke 通过后仍必须记录：

- 脱敏运行参数。
- token 消耗与估算成本。
- Markdown 产物 ID。
- 审计报告 ID。
- 质量风险。
- 人工通读待办与通读结论。

## 4. 3 章 smoke 进入条件

只有在 1 章 smoke 满足第 3 节通过条件后，才能进入 3 章 smoke。

建议 3 章参数：

- 章节数：3
- 目标字数：2700
- token 预算：60000
- 章节字数范围：600-1600
- 单请求超时：60 秒
- 总时间预算：1800 秒

3 章 smoke 通过条件：

- 1 章 smoke 证据完整。
- 3 章 runner 退出码为 0。
- 3 章 `summary.json`、`run-metadata.json`、`quality-risk.md`、`human-readthrough-todo.md` 均存在。
- `actual_chapter_count` 等于 3。
- `sensitive_hit_count` 为 0。
- 人工通读至少覆盖 3 章，记录章节连贯性、重复段落、设定漂移、角色口吻和模型痕迹。

## 5. 10 章或 3-5 万字长程进入条件

只有 3 章 smoke 通过且成本、质量风险和人工通读结论允许扩大范围时，才能评估 10 章或 3-5 万字。

启动 10 章或 3-5 万字前，还必须先通过低成本 Provider 连通性探针：

- `models_probe: ok`。
- `chat_probe: ok`。
- `chat_content: present`。
- `gate: pass_connectivity_probe`。

如果探针失败，必须记录失败类别并先修复网络、端点、鉴权、模型名或供应商兼容性问题，不得直接重跑长程。

需要只验证 provider 连通性和包装门禁时，可使用 10 章包装的 `-ProbeOnly` 模式；该模式通过探针后只输出 `gate: pass_probe_only` 并退出，不启动长程 runner，也不能作为真实 10 章完成证据。

### 5.1 10 章安全运行顺序

10 章或 3-5 万字运行不得直接跳过探针和证据验证。建议在同一个 PowerShell 进程中执行以下顺序，并且不要把凭据写入文件、命令历史或提交信息。

第一步，先执行 ProbeOnly，验证交互式输入、当前进程运行时变量和 Provider 连通性：

```powershell
cd D:\StoryForge
.\.codex\run-real-llm-10ch-current-env.ps1 -Interactive -ProbeOnly
```

该步骤必须看到：

- `gate: pass_connectivity_probe`
- `gate: pass_probe_only`
- 未启动 `run-real-llm-long-direct.py`

第二步，确认 ProbeOnly 通过且预算允许后，再执行正式 10 章运行：

```powershell
cd D:\StoryForge
.\.codex\run-real-llm-10ch-current-env.ps1 -Interactive
```

正式运行会在探针通过后启动 `run-real-llm-long-direct.py`，并生成 `.codex/real-llm-10ch-*` 脱敏产物目录。若探针失败、预算不足、运行超时或 `sensitive_hit_count` 非 0，必须停止并记录失败原因。

第三步，正式运行结束后先执行长程技术证据验证：

```powershell
cd D:\StoryForge
.\.codex\validate-real-llm-long-evidence.ps1 -RunDirectory <真实10章产物目录>
```

该步骤只覆盖当前真实 10 章技术证据；未完成人工通读前，不得声明 10 章最终验收完成。

第四步，人工通读完成后，补齐 `manual-readthrough-completion.md`，再执行最终验收门禁：

```powershell
cd D:\StoryForge
.\.codex\validate-real-llm-long-evidence.ps1 -RunDirectory <真实10章产物目录> -RequireManualReadthrough
```

只有技术证据和人工通读完成证据均通过时，才可将当前 10 章 smoke 标记为最终验收通过。该结论仍不代表 3-5 万字长程完成；3-5 万字必须另有独立运行证据、正文产物、审计报告、成本统计、质量风险记录和人工通读证据。

长程完成声明必须具备：

- 真实运行证据，不是 mock、deterministic 或本地模拟。
- 完整正文产物。
- 审计报告。
- 成本统计。
- 质量风险记录。
- 人工通读证据。
- 不能只用绿色测试、1 章 smoke 或 3 章 smoke 推断长程完成。

## 6. 失败处理

以下任一情况必须中止当前阶段：

- runner 非 0 退出。
- `summary.json` 缺失。
- `sensitive_hit_count` 非 0。
- `book_run_status` 不是 `completed`。
- artifact ID 缺失。
- 人工通读发现明显不可接受问题。
- 输出中出现不应写入成稿的系统提示、工具痕迹或模型自述。

中止后必须：

- 保留脱敏产物目录。
- 更新 `.codex/operations-log.md` 和 `.codex/verification-report.md`。
- 记录失败原因、预算消耗、质量风险和下一步修复计划。
- 不进入下一阶段。

## 7. 提交注意事项

- 不要 `git add .`。
- 不要提交 provider 配置、真实密钥、私有端点、原始 stdout/stderr 中可能含私有配置的内容。
- 大量截图、临时日志、运行产物和历史 context summary 需要逐项甄别后再决定是否提交。
- 提交信息必须使用简体中文，且不能包含 provider 信息。
