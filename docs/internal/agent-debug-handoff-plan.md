# Agent Debug Handoff 计划

> 生成时间：2026-07-08
> 定位：开发者诊断接手包规划。目标不是做通用日志平台，而是把外部用户/测试人员发来的日志、StoryForge 已有运行事件、工具调用和源码线索整理成 AI coding agent 能快速接手的问题现场。

## 1. 问题定义

StoryForge 当前的 Agent / Desktop / sidecar 链路已经有不少证据源：

- 外部日志：用户、测试人员或另一台机器发来的 sidecar stdout/stderr、Desktop console、pytest/e2e 输出、安装包启动失败日志。
- `agent_run_events`：Agent run 的事件事实源，前端断线后也靠它重建终态。
- `assistant_tool_calls`：LLM 工具调用证据链，包含工具名、输入摘要、输出摘要、错误信息和 token/模型信息。
- sidecar stdout/stderr：包含 API 启动、版本握手、sqlite schema 状态、prompt layer 打包状态和运行时异常。
- Desktop 前端错误：WebSocket 超时、重建失败、写回失败、Tauri IPC 失败等。
- git 状态、最近改动和验证命令输出。

但这些证据分散在 DB、终端日志、前端运行时、测试输出和本地文件里。开发 agent 接手时会反复付探索税：

- 不知道哪个 run 真正失败、暂停或后台成功但前端没看到。
- 不知道问题在 Desktop WS、API runtime、provider、工具调用、写回护栏还是 sidecar 启动。
- 别人只发来一段日志时，不知道它对应当前代码的哪个文件、哪个函数、哪条已知风险。
- 不知道该先读哪些文件、跑哪些最小复现命令。
- 容易把原始日志整段贴进上下文，导致 token 噪声、隐私风险和误判。

## 2. 产品目标

做一个本地开发者工具：**Agent Debug Handoff**。

一句话目标：当别人发来 StoryForge 故障日志，或本机出现 Agent / Desktop / sidecar 相关故障时，一条命令生成可交给 Codex/Claude 的高信号诊断包，帮助它把日志对照当前代码库快速锁定疑似 bug 点并开始修复。

非目标：

- 不替代 Codex / Claude，不自动修代码。
- 不做 Sentry / LangSmith / Langfuse 式平台化观测系统。
- 不默认上传任何日志或项目内容。
- 不把用户稿件原文全文放进诊断包。
- 不扩大到所有产品日志，第一版聚焦外部日志 -> 源码定位，以及 Agent loop / Desktop sidecar 故障。

## 3. 参考模型

优先参考本地项目 `C:\Users\kanye\Documents\ai-dev-Context Pipeline`。

可复用的设计原则：

- 管线：`Collect -> Redact -> Budget -> Render`
- 命令失败自动生成 `AI_CONTEXT.md`
- 日志/traceback 解析后附相关源码片段
- 脱敏默认开启
- 每个 section 有预算，截断必须显式标记
- 输出 Markdown + 语义标签，既能给人读，也能给 agent 读

外部参照：

- Sentry Seer / Autofix：错误上下文、trace、代码线索和 root cause analysis。
- Sentry MCP：让 coding agent 读取生产 issue、trace 和 log 上下文。
- LangSmith / Langfuse：LLM trace、tool call、latency、cost、session 观测。
- OpenTelemetry：traces / logs / metrics 的底层概念，但 StoryForge 第一版不引入完整 OTel。

结论：StoryForge 应做 Context Pipeline 的项目专用版，而不是接入重型外部观测平台。

## 4. 第一版范围

### 命令入口

建议先做 CLI，后做 Desktop 开发菜单。

```powershell
pnpm diagnose:log -- --log path/to/failure.log
Get-Content path/to/failure.log | pnpm diagnose:log -- --stdin
pnpm diagnose:latest
pnpm diagnose:agent --run <run_id>
pnpm diagnose:desktop
pnpm diagnose:cmd -- <command>
```

第一版最小可落地入口：

```powershell
pnpm diagnose:log -- --log path/to/failure.log
Get-Content path/to/failure.log | pnpm diagnose:log -- --stdin
```

其中：

- `diagnose:log -- --log`：读取别人发来的日志文件，解析错误块，对照当前仓库源码生成诊断接手包。
- `diagnose:log -- --stdin`：从剪贴板/管道接收日志文本，适合别人直接贴日志。
- `diagnose:agent --run`：围绕指定 AgentRun 生成诊断包。
- `diagnose:latest`：自动找最近一个 failed / paused / running-too-long / permission_required / completed-but-frontend-error 的 run。
- `diagnose:desktop`：后续扩展，收集 Desktop 前端错误、sidecar 启动日志和版本握手状态。
- `diagnose:cmd -- <command>`：后续扩展，类似 Context Pipeline 的 `ctx run`，命令失败后自动写诊断包。

### 输出目录

```text
.codex/diagnostics/<timestamp>-<mode>/
  AI_CONTEXT.md
  metadata.json
  external-log-tail.txt
  parsed-errors.json
  suspected-files.json
  agent-run.json
  agent-run-events.json
  assistant-tool-calls.json
  sidecar-log-tail.txt
  frontend-errors.json
  git-state.txt
  source-snippets.md
  repro.md
```

第一版可以只生成：

- `AI_CONTEXT.md`
- `metadata.json`
- `external-log-tail.txt`
- `parsed-errors.json`
- `suspected-files.json`
- `git-state.txt`
- `repro.md`

如果提供了 `run_id`，再附加 `agent-run-events.json` 和 `assistant-tool-calls.json`。sidecar/frontend 捕获如果没有稳定来源，可先标记为 unavailable，不伪造。

## 5. 数据收集器

### External Log Collector

这是第一版核心 collector。

输入：

- `--log <path>`：日志文件。
- `--stdin`：从管道读入别人粘贴的日志。
- `--text <string>`：可选，短日志直接传入；不推荐用于长日志。

收集：

- 原始日志 tail，默认最多 128 KB。
- 最近的 ERROR / FATAL / CRITICAL / panic / Traceback / stack trace 块。
- Python traceback、Node stack、Rust panic、Tauri / WebView 常见错误、HTTP status、provider error body 摘要。
- 日志中的版本线索：`app_version`、package version、commit sha、构建档位、端口、OS。
- 日志中的 run id / assistant session id / HTTP path / WebSocket path。
- 日志中的文件路径和行号。

输出：

- `external-log-tail.txt`：脱敏、裁剪后的日志尾部。
- `parsed-errors.json`：结构化错误块、stack frames、message、kind、confidence。
- `AI_CONTEXT.md` 中的 `<external-log>`、`<parsed-errors>`、`<suspected-source>`。

要求：

- 不要求本机能复现。
- 不要求日志来自同一台机器。
- 路径不同也要尽量映射：Windows / macOS / Linux 路径都归一到仓库相对路径。
- 如果日志里的版本与当前 checkout 不一致，必须显式提示“版本可能不匹配”，不能强行下结论。
- 原始日志只保留 tail 和错误块；完整日志不默认写入输出包。

### 典型协作流程

别人发来日志后，开发者本地流程应是：

```powershell
# 1. 保存别人发来的日志
Set-Content -Path .codex/tmp/user-failure.log -Value $logText

# 2. 生成诊断包
pnpm diagnose:log -- --log .codex/tmp/user-failure.log

# 3. 把输出目录里的 AI_CONTEXT.md 交给 Codex/Claude
# 4. Agent 根据日志映射出的源码片段、疑似文件和推荐命令开始排障
```

如果日志是直接复制到剪贴板或终端管道：

```powershell
Get-Clipboard | pnpm diagnose:log -- --stdin
```

如果日志里含 `run_id`，工具可以提示开发者再运行：

```powershell
pnpm diagnose:agent -- --run <detected-run-id>
```

但这一步是增强，不是外部日志定位的前置条件。

### AgentRun Collector

输入：`run_id` 或 latest 策略。

收集：

- run public id、DB id、session id、assistant session id
- goal、scope、status、current_step、created_at、updated_at
- root_plan 摘要
- 是否存在 requires_user_confirmation / permission_required
- 是否 runtime_interrupted
- 是否后台 completed 但前端可能未收到终态

数据源：

- 后端 DB 直接读取，或调用 `/api/agent-runs/{run_id}` 与 `/events`
- 推荐 CLI 先走 sqlite DB / API 二选一：开发态优先 API，离线包可读 sqlite

### Event Timeline Collector

收集 `agent_run_events`，按 sequence 排序。

输出两份：

- 原始脱敏 JSON：`agent-run-events.json`
- 压缩时间线：写入 `AI_CONTEXT.md`

时间线应突出：

- 最后一个事件
- 终态事件是否存在
- tool_trace 序列
- failed/error/permission_required/pause/stop/retry/checkpoint
- sequence 缺口或重复异常

### Tool Call Collector

收集 `assistant_tool_calls`。

重点：

- 工具名
- status
- duration / token / model / provider 摘要
- error_message
- input/output summary 的脱敏摘要
- 与 `tool_trace.assistant_tool_call_id` 的关联

### Log Tail Collector

AgentRun / Desktop 本机诊断使用 Log Tail Collector；外部日志走 External Log Collector。

候选来源：

- 当前终端捕获输出，后续由 `diagnose:cmd` 自动捕获。
- sidecar stdout/stderr tail，若 Tauri 后续把 sidecar 输出写入固定 log 文件。
- `scripts/sidecar-smoke.mjs` / e2e / pytest 失败输出。

规则：

- 只读 tail，不读整文件。
- Python / Node / Rust 常见 traceback/stack/panic 解析。
- 提取 frame 后附源码片段。

### Git Collector

收集：

- branch / HEAD
- `git status --short`
- 最近 5 个 commit
- 与疑似源码文件相关的 diff 摘要
- 未提交改动提示

不能做：

- 不自动 reset / checkout / stash。
- 不 stage 任何文件。

### Source Snippet Resolver

来源：

- 外部日志 stack frame 或仓库相对路径。
- traceback frame
- tool error 指向的模块
- run 类型映射出的热区文件

初始热区映射：

- WebSocket / 终态重建：
  - `apps/desktop/frontend/src/lib/api/agent-socket.ts`
  - `apps/desktop/frontend/src/lib/api/agent-run-events.ts`
  - `apps/api/app/domains/agent_runs/event_encoders.py`
  - `apps/api/app/domains/agent_runs/event_sink.py`
- Agent loop / tool calling：
  - `apps/api/app/domains/agent_runs/runtime.py`
  - `apps/api/app/domains/agent_runs/loop_runtime.py`
  - `apps/api/app/domains/agent_runs/tooling.py`
- provider / LLM：
  - `apps/api/app/common/llm_client.py`
  - `apps/api/app/common/llm_env.py`
- sidecar / Desktop startup：
  - `apps/desktop/src-tauri/src/main.rs`
  - `apps/api/app/main.py`
- writeback / patch：
  - `apps/desktop/frontend/src/components/editor/useSuggestionWriteback.ts`
  - `apps/desktop/frontend/src/lib/writeback.ts`
  - `apps/desktop/src-tauri/src/fs.rs`

## 6. 渲染格式

`AI_CONTEXT.md` 使用 Markdown + XML-style tags，沿用 Context Pipeline 的思路。

```md
# StoryForge Agent Debug Handoff

Generated: 2026-07-08T...
Mode: external-log | agent-run | desktop | command
Run: ...
Branch: ...

<context-contract>
这是脱敏后的诊断接手包，不是完整仓库 dump。
优先相信文件路径、事件 sequence、源码片段和验证命令。
不要假设 omitted content 不存在。
遵守 AGENTS.md / Trellis 任务边界。
</context-contract>

<symptom-summary>
...
</symptom-summary>

<external-log>
...
</external-log>

<parsed-errors>
...
</parsed-errors>

<triage-hypothesis>
...
</triage-hypothesis>

<agent-run-timeline>
...
</agent-run-timeline>

<tool-calls>
...
</tool-calls>

<error-evidence>
...
</error-evidence>

<source-context>
...
</source-context>

<git-state>
...
</git-state>

<recommended-next-steps>
...
</recommended-next-steps>

<agent-task>
请基于以上证据诊断根因，优先做最小复现，修改最小相关文件，并运行推荐验证命令。
</agent-task>
```

## 7. 初步归因规则

第一版不做复杂 AI 判断，只做确定性启发式。

| 信号 | 初步归因 |
| --- | --- |
| Python traceback frame 指向 `apps/api/...` | 先查对应 API 模块和最近相关 diff |
| Node stack 指向 `apps/desktop/frontend/...` | 先查前端调用链、WS/API client 或组件状态 |
| Rust panic / Tauri command error | 先查 `apps/desktop/src-tauri/src/*` |
| 日志出现 `Agent WebSocket 连接失败` / `后台轮询超时` | Desktop WS / REST 终态重建风险 |
| 日志出现 `/health/ready` 超时 | sidecar 起服、sqlite schema、prompt layer 或端口占用风险 |
| `completed` 事件存在，但前端报 timeout | 更像前端 WS/轮询重建问题 |
| 最后事件是 `tool_trace` failed | 先查对应工具实现和 assistant_tool_call |
| `permission_required` 存在 | 不是失败，可能是等待补丁确认 |
| run status `paused/stopped` 且无 terminal result | 用户控制或中断路径，查 runtime interruption |
| provider HTTP 401/403 | BYO-key 或 provider 配置问题 |
| provider 429/5xx | provider / retry / timeout 问题 |
| sequence 缺口或唯一索引冲突 | event_sink 并发写或恢复逻辑问题 |
| sidecar `app_version` 不匹配 | 版本握手 / 孤儿 sidecar |
| sqlite schema log `managed=false` | packaged sidecar 漏打 alembic 或迁移收口失败 |

所有归因都写成“初步定位”，不能写成最终结论。

## 8. 脱敏与预算

脱敏默认不可关闭。

必须脱敏：

- `api_key`, `apiKey`, `authorization`, `bearer`, `token`, `secret`, `password`, `credential`
- provider key / GitHub token / JWT / AWS key 常见形态
- `llm-provider.json` 中真实 key
- WebSocket query 中的 API key
- `.env` / settings 中的 secret 值

预算：

- `AI_CONTEXT.md` 默认不超过 96 KB。
- 单 section 默认 8-40 KB。
- JSON 原始证据文件可更大，但也应裁剪高噪声字段。
- 任何截断必须写 `[TRUNCATED: ...]`。
- 用户稿件内容默认不进包；需要原文时只放路径、hash、行号和最多 20 行上下文，并明确标注。

## 9. 实施分期

### Phase A：外部日志到源码诊断包

- 新增 `scripts/diagnose-log.mjs`、`scripts/diagnose-agent.mjs` 或 `scripts/diagnostics/` 模块。
- 新增 root package scripts：
  - `diagnose:log`
  - `diagnose:agent`
  - `diagnose:latest`
- 第一阶段先从外部日志读取错误块并映射源码。
- 随后读取 API 或 sqlite 中的 AgentRun、AgentRunEvent、assistant_tool_calls。
- 渲染 `.codex/diagnostics/.../AI_CONTEXT.md`。
- 写 `metadata.json`、外部日志 tail、parsed errors、suspected files、事件 JSON、工具调用 JSON。
- 使用现有或新建 JS redactor，规则与 `apps/api/app/common/redaction.py` 对齐。
- 加单元测试：脱敏、预算截断、外部日志解析、路径映射、timeline 渲染、latest run 选择。

### Phase B：命令失败自动诊断

- 新增 `pnpm diagnose:cmd -- <command>`。
- 透明运行命令，实时 echo stdout/stderr。
- 失败时捕获 tail、解析 traceback、附源码片段。
- 这部分可直接借鉴 Context Pipeline 的 `ctx run` / `ctx debug`。

### Phase C：Desktop / sidecar 开发态日志

- Tauri sidecar stdout/stderr 写入固定开发日志文件，例如：
  - `.codex/runtime/sidecar.log`
  - `.codex/runtime/desktop.log`
- 前端注册 window error / unhandledrejection / WebSocket error ring buffer。
- 开发菜单或命令面板增加“导出诊断包”。
- 诊断包收集最近前端错误、sidecar tail、版本握手、API ready 状态。

### Phase D：开发者体验收口

- `AI_CONTEXT.md` 顶部生成可直接复制给 agent 的 prompt。
- 支持 `--open` 打开输出目录。
- 支持 `--include-source` 精确附源码片段。
- 支持 `--since <time>` / `--session <id>`。
- 后续可考虑 MCP，但不是第一版门槛。

## 10. 验收标准

Phase A 完成标准：

- 能对外部日志文件或 stdin 日志生成诊断目录。
- `AI_CONTEXT.md` 能说明：
  - 一句话症状
  - 日志来源、版本线索和版本是否可能不匹配
  - 解析出的错误块
  - stack frame / 文件路径映射
  - 疑似源码文件
  - 初步定位
  - 推荐下一步文件与验证命令
- 真实 secret 不出现在任何输出文件。
- 没有可识别 traceback 时，仍输出日志 tail、generic error block 和下一步建议，不生成假 stack。
- 有测试覆盖脱敏、截断、外部日志解析、路径映射和源码片段选择。

Phase A.2 完成标准：

- 能对指定 `run_id` 生成诊断目录。
- AgentRun 包含 run 状态、事件时间线、最后事件和终态、失败工具或等待确认点。
- 没有 AgentRun 或 DB/API 不可达时，输出清晰错误，不生成假数据。
- 有测试覆盖 timeline 和 latest 策略。

Phase B 完成标准：

- 包装失败命令时，能生成包含失败输出 tail、stack/traceback、源码片段和 agent task 的 `AI_CONTEXT.md`。
- 命令成功时不生成无意义诊断包。
- 子命令 exit code 原样透传。

Phase C 完成标准：

- 真机 Desktop 故障能导出 sidecar/frontend 最近错误，不需要开发者手动复制终端日志。
- 导出包默认不含稿件全文、不含 provider key、不含 API key。

## 11. 推荐第一刀

先做 Phase A，文件范围控制在：

- `scripts/diagnostics/`
- `scripts/diagnose-log.mjs`
- `package.json`
- `tests` 或 `scripts/__tests__`（按项目现有脚本测试风格决定）
- `.gitignore` 如需允许 `.codex/diagnostics/` 本地生成但不误提交

不要第一刀动 Desktop UI，也不要接外部平台。

推荐最小命令：

```powershell
pnpm diagnose:log -- --log path/to/failure.log
Get-Content path/to/failure.log | pnpm diagnose:log -- --stdin
```

推荐后续 Trellis 任务名：

`agent-debug-handoff-pack`

## 12. Phase A 工程设计

### 文件结构

建议保持 root `scripts/*.mjs` 的轻量风格，不引入运行时依赖。

```text
scripts/
  diagnose-log.mjs
  diagnose-agent.mjs
  diagnostics/
    external-log.mjs
    agent-run.mjs
    assistant-tool-calls.mjs
    budget.mjs
    cli.mjs
    config.mjs
    db.mjs
    git.mjs
    redact.mjs
    render.mjs
    timeline.mjs
    write-package.mjs
```

职责：

- `diagnose-log.mjs`：外部日志入口，解析 argv 并调用 `cli.mjs` 的 log mode。
- `diagnose-agent.mjs`：薄入口，只解析 argv 并调用 `cli.mjs`。
- `cli.mjs`：命令分发，支持 `log`、`agent`、`--log`、`--stdin`、`--run`、`--latest`、`--out`、`--api-base-url`、`--sqlite`。
- `external-log.mjs`：读取外部日志、tail、错误块解析、路径归一。
- `db.mjs`：sqlite 离线读取适配。第一版如果缺少 Node sqlite 依赖，可先不做 DB 直连，改走 API；DB 直连留 Phase A.2。
- `agent-run.mjs`：读取 run 元数据与事件。
- `assistant-tool-calls.mjs`：按 assistant session 或 tool_call_id 读取工具调用。
- `timeline.mjs`：把事件转成可读时间线和初步归因。
- `redact.mjs`：对齐后端 `apps/api/app/common/redaction.py` 的 JS 版脱敏。
- `budget.mjs`：per-section 和总预算。
- `render.mjs`：生成 `AI_CONTEXT.md`。
- `write-package.mjs`：创建 `.codex/diagnostics/<timestamp>-agent-run/` 并写文件。

### 外部日志优先读取

第一版优先支持外部日志文件和 stdin，而不是先依赖本地 API 或 sqlite。

原因：

- 用户明确需要“别人发日志，我能对照日志找程序 bug”。
- 外部日志是跨机器、跨安装包、跨开发者协作最常见输入。
- 这条路径不要求本机 sidecar 还能启动。
- 这部分可直接借鉴 Context Pipeline 的 `ctx debug` / `ctx run` 思路。

命令示例：

```powershell
pnpm diagnose:log -- --log C:\Users\kanye\Downloads\storyforge-sidecar.log
Get-Content .\failure.log | pnpm diagnose:log -- --stdin
pnpm diagnose:log -- --log .\failure.log --out .codex/diagnostics/manual-case-001
```

`diagnose:log` 输出应能回答：

- 日志里最可能的错误块是什么？
- 错误路径能否映射到当前仓库文件？
- 日志版本是否可能和当前 checkout 不一致？
- 优先读哪些源码文件？
- 下一步最小复现命令是什么？

### API AgentRun 读取

AgentRun 诊断是 Phase A.2 / PR 2。优先调用本地 API，而不是直接读 sqlite。

原因：

- API 已有 `/api/agent-runs/{run_id}`、`/events`、`/artifacts`。
- 读取逻辑与 Desktop 实际路径一致。
- 可以复用 API 层现有 redaction / response schema。
- 避免新增 Node sqlite 依赖或读取用户机器上不同位置的 sqlite 文件。

命令示例：

```powershell
pnpm diagnose:agent -- --run agent-run-id
pnpm diagnose:agent -- --latest
pnpm diagnose:agent -- --run agent-run-id --api-base-url http://127.0.0.1:8000
```

`STORYFORGE_API_KEY` 默认走环境变量；没有则使用本地默认 `local-dev-key`，但输出时必须脱敏。

### API 缺口

现有 API 可能还缺一个“latest run”查询端点。第一版有两种做法：

- 方案 A：先不加 API，`--latest` 通过 sqlite 直读实现。
- 方案 B：新增只读开发端点 `GET /api/agent-runs/latest?status=...`。

推荐方案 B，但要把它标成 developer diagnostics，只读、脱敏、测试覆盖，并更新 OpenAPI。

如果不想动 API contract，AgentRun 第一刀只交付 `--run`，`--latest` 放 Phase A.3。

### 离线 DB 读取

Phase A.2 再补离线读取：

- 自动查找 Desktop sqlite 默认位置。
- 支持 `--sqlite <path>` 显式指定。
- 只读打开。
- 如果 sqlite schema 缺表或版本不匹配，输出清晰错误。

离线读取适合 sidecar 挂了、API 起不来时生成接手包，但它不是第一刀必需项。

## 13. package.json 脚本建议

根 `package.json` 增加：

```json
{
  "scripts": {
    "diagnose:log": "node scripts/diagnose-log.mjs",
    "diagnose:agent": "node scripts/diagnose-agent.mjs",
    "diagnose:latest": "node scripts/diagnose-agent.mjs --latest",
    "diagnose:cmd": "node scripts/diagnostics/run-command.mjs --"
  }
}
```

第一刀只加：

```json
{
  "scripts": {
    "diagnose:log": "node scripts/diagnose-log.mjs"
  }
}
```

`diagnose:agent`、`diagnose:latest` 和 `diagnose:cmd` 放后续 PR。

## 14. AI_CONTEXT.md 详细模板

```md
# StoryForge Agent Debug Handoff

Generated: <iso>
Mode: agent-run
Output: <diagnostics-dir>
StoryForge branch: <branch>
StoryForge HEAD: <sha>

<context-contract>
This package is curated diagnostic context, not a full repository dump.
All secret-looking values should be redacted.
Prefer event sequence, file paths, source snippets, and tests over guesses.
Respect AGENTS.md and the active Trellis task boundary.
</context-contract>

<symptom-summary>
- Run: <run_id>
- Status: <status>
- Goal: <goal excerpt>
- Last event: <sequence> <event_type> <message>
- Terminal event: present|missing
- Tool failures: <count>
- Permission required: yes|no
</symptom-summary>

<triage-hypothesis>
Initial classification: <frontend-ws|api-runtime|tool-failure|provider|permission-wait|sidecar|unknown>
Confidence: low|medium|high
Reason: ...
</triage-hypothesis>

<agent-run-timeline>
...
</agent-run-timeline>

<tool-calls>
...
</tool-calls>

<git-state>
...
</git-state>

<source-context>
...
</source-context>

<recommended-next-steps>
1. ...
2. ...
3. ...
</recommended-next-steps>

<agent-task>
Diagnose the failure using the evidence above.
Make the smallest safe fix.
Run the recommended focused verification first, then report residual risk.
</agent-task>
```

中文项目里也可以中文输出，但 tag 名保持英文，便于 agent 稳定解析。

## 15. 初始源码片段映射

第一版不需要 tree-sitter。用事件类型和错误文本映射到候选文件，再附 30-80 行附近源码。

| 诊断信号 | 候选文件 |
| --- | --- |
| WS close / timeout / poll timeout | `apps/desktop/frontend/src/lib/api/agent-socket.ts` |
| REST events 重建失败 | `apps/desktop/frontend/src/lib/api/agent-run-events.ts` |
| event payload shape 异常 | `apps/api/app/domains/agent_runs/event_encoders.py` |
| event sequence / terminal missing | `apps/api/app/domains/agent_runs/event_sink.py`, `apps/api/app/domains/agent_runs/service.py` |
| tool unknown / failed | `apps/api/app/domains/agent_runs/loop_runtime.py`, `apps/api/app/domains/agent_runs/tooling.py` |
| fs 工具失败 | `apps/api/app/domains/agent_runs/fs_tools.py` |
| provider HTTP / timeout | `apps/api/app/common/llm_client.py`, `apps/api/app/common/llm_env.py` |
| permission_required / patch wait | `apps/api/app/domains/agent_runs/event_sink.py`, `apps/desktop/frontend/src/components/ChatWindow.tsx` |
| writeback / snapshot | `apps/desktop/frontend/src/lib/writeback.ts`, `apps/desktop/frontend/src/components/editor/useSuggestionWriteback.ts`, `apps/desktop/src-tauri/src/fs.rs` |
| sidecar ready / version | `apps/desktop/src-tauri/src/main.rs`, `apps/api/app/main.py` |

源码片段规则：

- 默认只附候选文件的关键函数附近。
- 如果找不到关键函数，只列文件路径，不 dump 全文件。
- 每个文件最多 120 行，整体 `source-context` 最多 40 KB。
- 截断必须显式标记。

## 16. 测试计划

### Node 单元测试

如果新建脚本模块，建议用 Node 内置 `node:test`，不引入 Jest/Vitest。

测试文件可放：

```text
scripts/diagnostics/__tests__/
```

覆盖：

- `redact.mjs`：
  - API key / bearer / JWT / password / token key-value 脱敏。
  - URL query 中 `api_key=` 脱敏。
- `external-log.mjs`：
  - Python traceback 提取最近错误块。
  - Node stack 提取 message + frames。
  - Rust panic / generic ERROR fallback。
  - 日志里 `app_version`、commit sha、HTTP path、run id 的提取。
  - Windows / Unix 绝对路径归一到仓库相对路径。
- `source-map.mjs`：
  - stack frame 命中当前仓库文件时附源码片段。
  - frame 指向旧路径或不存在文件时只记录 unmapped，不伪造源码。
  - 热区关键词能映射到候选文件。
- `budget.mjs`：
  - section 截断有 marker。
  - 全局预算会丢低优先级 section。
- `timeline.mjs`：
  - completed terminal present。
  - permission_required 被识别为等待确认而非失败。
  - failed tool trace 被识别为工具失败。
  - completed 事件存在但有 frontend timeout 时归因为重建/传输风险。
- `render.mjs`：
  - 必含 context contract / symptom / timeline / agent-task。
  - secret 不出现在最终 Markdown。

### API 测试

只有在新增 `latest` endpoint 时需要：

```powershell
cd apps/api
uv run pytest tests/test_agent_runs.py -q
```

断言：

- latest 只返回只读摘要。
- status filter 生效。
- response 脱敏。
- 不返回用户稿件全文。

### 脚本 smoke

增加一个不依赖真实 sidecar 的 fixture smoke：

```powershell
node scripts/diagnose-log.mjs --fixture scripts/diagnostics/fixtures/external-log-python-traceback.txt --out .codex/tmp/diagnostics-smoke
```

如果后续接真实 API，可先用 mock fetch 测试模块，避免需要真实服务。

## 17. 与当前安全加固任务的关系

当前 active task 是 `desktop-api-boundary-hardening`，它正在修 API/desktop 边界和脱敏问题。

本计划依赖但不混入该任务：

- 诊断包必须复用或对齐 `apps/api/app/common/redaction.py` 的脱敏规则。
- 如果安全加固任务新增 `.codex/` ignore 规则，诊断包目录也应保持本地生成、不误提交。
- 诊断工具输出不得绕过已修的证据脱敏边界。

建议等安全加固任务完成后，再开独立 Trellis 任务 `agent-debug-handoff-pack` 实施 Phase A。

## 18. 第一刀 PR 拆分

推荐拆成两到三个小 PR：

### PR 1：外部日志诊断 CLI 骨架

- `scripts/diagnostics/redact.mjs`
- `scripts/diagnostics/budget.mjs`
- `scripts/diagnostics/render.mjs`
- `scripts/diagnostics/external-log.mjs`
- `scripts/diagnostics/source-map.mjs`
- `scripts/diagnose-log.mjs`
- root script `diagnose:log`
- fixture + node:test

不接真实 API，先用外部日志 fixture 证明“日志 -> 错误块 -> 疑似源码 -> AI_CONTEXT.md” contract。

### PR 2：接真实 AgentRun API

- 调 `/api/agent-runs/{run_id}`
- 调 `/api/agent-runs/{run_id}/events`
- 调 assistant tool call endpoint 或新增只读聚合读取
- 写 `.codex/diagnostics/...`
- focused smoke 验证真实 run

### PR 3：latest / desktop 日志增强

- latest 策略
- sidecar log tail
- frontend error ring buffer 或 Desktop dev 菜单
- `diagnose:latest`

这样能避免第一刀同时碰外部日志解析、API contract、Desktop UI 和日志持久化。
