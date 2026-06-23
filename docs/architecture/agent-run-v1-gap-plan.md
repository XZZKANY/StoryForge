# AgentRun v1 Gap Plan

## 结论

`AgentRun` v1 已经不是从零开始。当前后端已有 `apps/api/app/domains/agent_runs`、Alembic 迁移、REST/SSE 只读接口、WebSocket 接入、BookRun 进度投影和静态 skills 清单。

本计划在 2026-06-23 已完成 v1 收敛实现：现有实现已从“事件投影层”收敛成 **Agent Runtime 控制平面** 的最小闭环。

```text
Root Agent 唯一主控
WebSocket 只做实时控制
SSE/REST 只读事件源
现有 orchestrator 降级为兼容 adapter
Tool Registry / Permission Gate / Subagent Executor 补齐真实执行能力
```

## v1 完成状态

已完成：

- WebSocket `user_message` 主路径进入 `AgentRuntime.run_user_message()`，不再由 WebSocket 直接调用 legacy orchestrator。
- `orchestrate_agent_message()` 保留为 `legacy.orchestrator` adapter，只服务尚未迁移 intent。
- `chapter_polish` 已成为可执行 skill：`context.load -> file.review/subagents -> file.revise -> judge.run -> permission_required/proposed_patch`。
- Tool Registry v1 已包装 `context.load`、`file.review`、`file.revise`、`judge.run`、`judge.repair`、`bookrun.start`、`bookrun.pause`、`bookrun.resume`、`bookrun.retry_from_checkpoint`。
- Permission Gate v1 已接入工具执行路径；待确认 patch 会写入 `permission_required` 并将 run 暂停在 `permission.confirm`。
- WebSocket `approve_permission` / `deny_permission` 会推动 paused run 收口为 completed / failed。
- Subagent Executor v1 已同步调度剧情、人物、文风、一致性四个 reviewer，并写入 `subagent_started` / `subagent_completed` / `tool_trace`。
- `proposed_patch` 仍保持 Desktop PatchReviewPanel 兼容，不自动写本地文件。
- BookRun 创建、进度、checkpoint、完成、停止继续投影到同一 AgentRunEvent；`bookrun-{id}` 的 WebSocket pause/resume/stop 控制会驱动真实 BookRun 状态机。
- Desktop ChatWindow 已能展示 AgentRun timeline、`permission_required`、批准/拒绝、暂停/恢复/停止控制。
- RuntimeTools 读侧已暴露内部工具与只读 MCP 工具，并标记 permission、read_only、event_store_required，写入型 MCP 仍未接入。

验证：

```text
uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py tests/test_ide_commands.py tests/test_book_runs.py tests/test_runtime_tools.py
npm --prefix apps/desktop/frontend run typecheck
npm --prefix apps/desktop/frontend run test
```

结果：API 68 passed，Desktop 21 passed，TypeScript typecheck passed。

## 当前已完成

### AgentRun 数据基座

已存在核心表和 ORM：

- `agent_runs`
- `agent_run_events`
- `subagent_runs`
- `agent_artifacts`

对应模型已覆盖：

- `AgentRun`
- `AgentRunEvent`
- `SubagentRun`
- `AgentArtifact`

迁移文件已存在：

```text
apps/api/alembic/versions/20260623_0001_add_agent_runs.py
```

### REST / SSE 事件回放

已存在只读接口：

```text
GET /api/agent-runs/skills
GET /api/agent-runs/{run_id}
GET /api/agent-runs/{run_id}/events
GET /api/agent-runs/{run_id}/artifacts
GET /api/agent-runs/{run_id}/checkpoints
GET /api/agent-runs/{run_id}/events/stream
```

这些接口已经体现了“Event Store 是事实来源”的方向。

### WebSocket 初步接入

现有 `/api/ide/agent/sessions/{session_id}` 已经：

- 在 `user_message` 时创建或续接 AgentRun。
- 将 orchestrator 结果投影成 AgentRunEvent。
- 支持 `approve_permission`、`deny_permission`、`pause_run`、`resume_run`、`stop_run` 控制消息。
- command 携带 `run_id` 时会记录为 `tool_trace`。

### Skills v1 清单

已存在静态 skills：

- `chapter_polish`
- `short_story_draft`
- `long_chapter_generate`
- `consistency_review`
- `bookrun_generation`

这些 skill 当前主要用于计划事件和展示，还不是完整的 planner/executor。

### BookRun 投影

BookRun 进度已能映射为 `bookrun-{id}` AgentRun，并写入：

- `agent_run_started`
- `agent_plan_created`
- `tool_trace`
- `bookrun_checkpoint`
- `agent_run_completed` / `agent_run_failed`

### 测试覆盖

已有测试覆盖：

- AgentRun 模型进入 metadata。
- WebSocket user_message 创建 run、events、artifacts。
- proposed_patch 记录 `permission_required`。
- SSE 从 Event Store 回放。
- WebSocket 控制消息写入事件。
- command 携带 run_id 时写入 tool_trace。
- BookRun 进度投影到 AgentRunEvent。
- skills endpoint 暴露静态 skill 清单。
- 根据一致性目标选择 `consistency_review` skill。

## 核心差距

### 差距 1：orchestrator 仍是第二个大脑

当前 `execute_agent_user_message_run()` 仍调用现有 `orchestrate_agent_message()`，然后把结果投影为事件。

这意味着 AgentRun 现在主要是 wrapper / event projection，而不是真正的主控 runtime。

目标状态：

```text
WebSocket -> AgentRuntime.run()
AgentRuntime -> Planner -> Tool Registry -> Permission Gate -> Executor -> Event Store
```

而不是：

```text
WebSocket -> orchestrator -> result -> AgentRunEvent projection
```

收敛策略：

1. 保留 `orchestrate_agent_message()` 作为 legacy adapter。
2. 新增 `AgentRuntime` 服务作为唯一入口。
3. 将 intent 识别、skill 选择、tool 调度逐步搬入 runtime。
4. orchestrator 中的旧分支按工具或 skill 逐步迁移。

### 差距 2：Tool Registry 仍不是执行层

当前已有 `runtime_tools` 只读元数据，也有 IDE command registry，但还没有统一的可执行 `ToolDefinition` / `ToolExecutor`。

目标状态：

```text
ToolDefinition
- name
- description
- input_schema
- output_schema
- permission_level
- requires_confirmation
- handler
```

首批可执行工具：

- `context.load`
- `file.review`
- `file.revise`
- `judge.run`
- `judge.repair`
- `bookrun.start`
- `bookrun.pause`
- `bookrun.resume`
- `bookrun.retry_from_checkpoint`

收敛策略：

1. 新增 Agent Runtime 内部 tool registry。
2. 先包装现有 orchestrator 和 IDE command 能力。
3. 后续把 `runtime_tools` 只读元数据接入同一 registry。
4. MCP 只读工具最后接入，不先做写入能力。

### 差距 3：Permission Gate 还只是事件记录

当前 proposed_patch 会写 `permission_required`，控制消息也会记录批准/拒绝，但权限还没有真正参与 tool 执行前的拦截。

目标状态：

```text
tool call request
-> Permission Gate
-> auto allow / require approval / deny
-> executor
```

四档权限：

- `step_confirm`
- `risk_confirm`
- `autonomous_approval`
- `full_allow`

收敛策略：

1. 定义工具风险等级：read、analyze、propose_patch、write_pending、long_running、network、high_cost。
2. 在 ToolExecutor 执行前调用 Permission Gate。
3. 需要确认时写入 `permission_required` 并暂停 run。
4. WebSocket 的 `approve_permission` / `deny_permission` 驱动 run 继续或失败。
5. 本地文件写回仍默认只能通过 Desktop PatchReviewPanel。

### 差距 4：Subagent 仍是 trace 投影，不是真实执行模型

当前 `subagent_runs` 主要从 `tool_trace` 中 `subagent.*` 投影出来，不能独立调度、并发、失败重试或汇总。

目标状态：

```text
Root Agent
-> Subagent Executor
-> plot_reviewer / character_reviewer / prose_reviewer / continuity_reviewer
-> Synthesizer
-> Root Agent final decision
```

收敛策略：

1. 定义 `SubagentDefinition`：role、input_schema、output_schema、handler。
2. 先实现同步串行子代理。
3. 单章润色 MVP 中真正调用四个 reviewer 子代理。
4. 子代理输出统一进入 Synthesizer，再进入 repair tool。
5. 并行执行和独立模型配置放到 v2。

### 差距 5：Skills 还不是 Planner

当前 skills 是静态清单，用于选择和写入计划事件，但还没有真正决定执行步骤。

目标状态：

```text
User Goal
-> Skill Selection
-> Plan
-> Tool/Subagent Steps
-> Stop Conditions
```

收敛策略：

1. 保留当前静态 skills 作为 v1 recipe。
2. 让 `chapter_polish` 先成为可执行 skill。
3. 每个 skill 定义 steps、required_tools、subagents、artifacts、stop_conditions。
4. Root Agent 根据 skill plan 驱动 executor。

### 差距 6：BookRun 仍是投影，不是完全 Agent 化

当前 BookRun 已能投影为 AgentRun，但 BookRun 本体仍主要由 `book_runs` 域驱动。

目标状态：

```text
bookrun.start tool
-> long-running AgentRun
-> checkpoint per chapter
-> Judge / Repair / Memory update events
-> pause/resume/retry through AgentRun control channel
```

收敛策略：

1. 先保持现有 BookRun 服务为执行引擎。
2. Agent Runtime 将 BookRun 作为 long-running tool 启动。
3. BookRun 所有进度、失败和 checkpoint 继续写入 AgentRunEvent。
4. 后续将 pause/resume/retry 统一走 AgentRun control channel。

### 差距 7：Desktop 只部分感知 AgentRun

当前前端已能识别 `run_id` 和 `agent_run_started`，但还缺完整的 Agent 运行体验。

目标状态：

- ChatWindow 展示 run timeline。
- 显示 subagent_started/subagent_completed。
- 显示 permission_required 并提供批准/拒绝。
- 显示 tool trace。
- 支持 pause/resume/stop。
- 支持从 REST/SSE 恢复断线后的事件。
- IDE 设置权限档位、scope、budget、allowed tools。

收敛策略：

1. 先展示只读 timeline，不改变写回体验。
2. 再接入权限确认控件。
3. 最后接入运行控制和断线恢复。

## 已完成的实现线

第一条实现线已完成：

```text
chapter_polish executable skill
```

已实现目标：

```text
user_message
-> AgentRuntime
-> select chapter_polish
-> context.load
-> plot/character/prose/continuity subagents
-> synthesizer
-> file.revise
-> judge.run
-> permission_required
-> proposed_patch
```

这条线已验证：

- Runtime 是否真正取代 orchestrator 主控。
- Tool Registry 是否能执行。
- Permission Gate 是否能拦截。
- Subagent 是否能真实运行。
- Artifact 是否仍兼容 PatchReviewPanel。

## 实施顺序

| 阶段 | 名称 | 目标 |
| --- | --- | --- |
| 1 | Runtime Facade | 已完成：新增 `AgentRuntime.run_user_message()`，WebSocket 调它，不直接调 orchestrator |
| 2 | Tool Registry v1 | 已完成：包装 `context.load`、`file.review`、`file.revise`、`judge.run`、`judge.repair`、BookRun 控制工具 |
| 3 | Permission Gate v1 | 已完成：工具执行前做风险判断，需确认则暂停 run |
| 4 | Executable Skill | 已完成：`chapter_polish` 从静态 recipe 变成可执行 plan |
| 5 | Subagent Executor v1 | 已完成：实现剧情、人物、文风、一致性四个同步 reviewer |
| 6 | Patch Artifact Compatibility | 已完成：`proposed_patch` 兼容现有 Desktop 写回 |
| 7 | Desktop Timeline | 已完成：展示 AgentRun 事件、权限确认和运行控制 |
| 8 | BookRun Convergence | 已完成：BookRun pause/resume/stop 收口到 AgentRun control channel |
| 9 | MCP Readonly | 已完成读侧目录：只读 MCP 工具进入 RuntimeTools catalog；真实 MCP 执行器留到 v2 |

## 验收标准

- [x] WebSocket user_message 的主路径进入 `AgentRuntime.run_user_message()`。
- [x] `orchestrate_agent_message()` 不再是新路径的主控，只作为 legacy adapter 或 tool handler。
- [x] `chapter_polish` 能作为可执行 skill 跑完最小闭环。
- [x] Tool call 执行前必须经过 Permission Gate。
- [x] `permission_required` 会暂停 run，而不只是记录事件。
- [x] 子代理不再只是 trace 投影，而是由 Root Agent 明确分发。
- [x] 所有步骤继续写入 AgentRunEvent，REST/SSE 可回放。
- [x] `proposed_patch` 仍兼容现有 PatchReviewPanel。
- [x] BookRun 进度不再与 AgentRun 事件源分裂。
- [x] MCP 写入能力不能绕过 Tool Registry 和 Permission Gate；v1 只暴露只读 MCP catalog，不接入写入型 MCP。

## v2 后续

- 将 `chapter.review` / `chapter.repair` 从 legacy adapter 迁入 AgentRuntime 原生 skill。
- 为只读 MCP catalog 增加真实 executor，并要求所有 MCP 结果写 AgentRunEvent。
- 增加预算与 stop condition 的运行中检查，而不是只在 plan / BookRun 层表达。
- 支持子代理并行执行、独立模型配置和失败重试。
- 将 Desktop 断线恢复从 REST/SSE 事件源接回当前 ChatWindow timeline。

## 不做事项

- 不重建一套新的 AgentRun 表。
- 不废弃现有 `/api/ide/agent/sessions/{session_id}` WebSocket 路径。
- 不绕过 Desktop PatchReviewPanel 自动写本地文件。
- 不先接入写入型 MCP 工具。
- 不把 BookRun 控制台重新做成主入口。
- 不把 AgentRun UI 做成重型任务看板；中间区仍保持创作会话体验。
