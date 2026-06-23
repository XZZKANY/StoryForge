# AgentRun Runtime Facade Plan

## 目标

下一阶段只做一件事：把 WebSocket 的 user message 主路径收敛到 Agent Runtime Facade。

当前路径仍然偏向：

```text
WebSocket
-> start_agent_user_message_run()
-> execute_agent_user_message_run()
-> legacy orchestrator
-> result projection
```

目标路径：

```text
WebSocket
-> run_agent_user_message()
-> legacy orchestrator adapter
-> AgentRunEvent / AgentArtifact
```

这一阶段不改变用户体验、不改数据库、不改前端协议、不引入真实 Tool Registry，只把“谁是入口”收口。

## 原则

1. WebSocket 只做实时通道。
2. Agent Runtime Facade 才是 user message 执行入口。
3. `orchestrate_agent_message()` 暂时保留为 legacy adapter。
4. 行为保持兼容，现有测试应继续通过。
5. 不把第一刀做成大重构。

## 实施内容

### 1. 新增 Runtime Facade

在 `apps/api/app/domains/agent_runs/service.py` 中新增最小 facade 函数：

```text
run_agent_user_message(session, agent_session_id, message)
```

职责：

```text
1. 创建或续接 AgentRun
2. 写入 agent_run_started
3. 调用现有 execute_agent_user_message_run()
4. 捕获 AgentRuntimeError
5. 保证 result 带 run_id
6. 返回 started_event、run、result
```

建议返回结构：

```text
AgentRuntimeUserMessageResult
- run
- started_event
- result
```

这一阶段可以先用 dataclass，不需要引入复杂 class。

### 2. 收窄 WebSocket 职责

修改 `apps/api/app/domains/ide/router.py` 的 `user_message` 分支。

当前 WebSocket 自己串联：

```text
start_agent_user_message_run()
execute_agent_user_message_run()
error handling
run_id injection
```

改为：

```text
runtime_result = run_agent_user_message(...)
```

WebSocket 保留职责：

- 接收消息。
- 判断是否 `stream`。
- 发送 `agent_run_started`。
- 发送轻量 stream events。
- 发送最终 result。
- 处理 `approve_permission`、`deny_permission`、`pause_run`、`resume_run`、`stop_run`。
- 处理 command 兼容路径。

### 3. 保持 legacy orchestrator

这一阶段不拆：

```text
orchestrate_agent_message()
```

它仍由 runtime facade 内部间接调用。

目标只是从：

```text
WebSocket -> orchestrator
```

推进到：

```text
WebSocket -> Agent Runtime Facade -> orchestrator adapter
```

### 4. 不做事项

本阶段不做：

- 新 DB 表或迁移。
- Tool Registry 执行层。
- 真正 Permission Gate 拦截。
- Subagent Executor。
- MCP 接入。
- BookRun 重构。
- Desktop UI 改动。
- PatchReviewPanel 行为变更。

## 验收标准

### 静态验收

完成后：

```text
apps/api/app/domains/ide/router.py
```

不应直接调用：

```text
start_agent_user_message_run()
execute_agent_user_message_run()
```

它应只调用一个高层入口：

```text
run_agent_user_message()
```

### 行为验收

现有行为保持不变：

- WebSocket 仍支持 `user_message`。
- `stream=true` 时仍返回 `agent_run_started`。
- 最终仍返回 `agent_result`。
- result 仍带 `run_id`。
- `proposed_patch` 格式不变。
- `permission_required` 事件仍写入 AgentRunEvent。
- REST `/api/agent-runs/{run_id}/events` 仍可回放。
- SSE `/api/agent-runs/{run_id}/events/stream` 仍可回放。
- control messages 仍能写入事件。
- command 携带 `run_id` 时仍写入 `tool_trace`。

### 测试建议

优先运行：

```text
uv run pytest tests/test_agent_runs.py -q
uv run pytest tests/test_ide_agent_orchestrator.py -q
uv run pytest tests/test_ide_command_registry.py -q
```

如时间有限，至少运行：

```text
uv run pytest tests/test_agent_runs.py -q
```

## 风险

### 循环 import

当前 `agent_runs.service` 已经 import `ide.orchestrator`。本阶段如果只在 `service.py` 中新增 facade，可避免新增额外循环 import。

后续如果拆出 `agent_runs/runtime.py`，需要先整理依赖方向。

### 行为回归

WebSocket 现在负责较多细节。收口时必须保持：

- error payload 格式。
- stream events 顺序。
- run_id 注入。
- final result 格式。

### 过早抽象

本阶段不应提前设计复杂 runtime class。先用一个 facade 函数收口，等 Tool Registry 和 Permission Gate 进入实现阶段，再决定是否拆成 class。

## 后续阶段

这一步完成后，下一阶段才进入：

```text
Tool Registry v1
```

届时再把：

- `file.review`
- `file.revise`
- `judge.run`
- `judge.repair`
- `bookrun.start`

包装为可执行 tools。

