# Agent Role Consumption Plan

## 目标

`Agent Role Catalog v1` 已经落地，下一阶段目标是让 Runtime 和 Desktop 真正消费这个角色目录。

当前状态：

- 后端已有 `/api/agent-runs/roles`。
- 后端已有 `/api/agent-runs/roles/resolve`。
- 后端已有 `AgentRoleRead`、`list_agent_roles()`、`resolve_agent_role_alias()`。
- 后端已有 `@剧情`、`@人物`、`@文风`、`@伏笔`、`@设定`、`@BookRun`、`@探索`、`@资料` 映射。
- `AgentRuntime` 内部仍硬编码 `SubagentDefinition`。
- Desktop 还没有解析 `@角色`，也没有把 `agent_role_hints` 传给后端。

本阶段完成后：

```text
Desktop @角色输入
-> agent_role_hints
-> AgentRun scope / events
-> AgentRuntime 读取 role catalog
-> Root Agent 调度对应 subagent
```

## 不做事项

本阶段不做：

- 新数据库表。
- 新 Alembic 迁移。
- 并发子代理。
- 写入型 MCP。
- 自动写本地文件。
- 大规模重写 AgentRuntime。
- 重型 Agent Run 看板。

## 阶段 1：Runtime uses Agent Role Catalog

### 目标

让 `AgentRuntime` 不再只依赖硬编码子代理定义，而是以角色目录作为子代理调度的事实来源。

### 后端改动

在 `apps/api/app/domains/agent_runs/service.py` 中提供轻量查询 helper：

```text
get_agent_role(name: str) -> AgentRoleRead | None
list_subagent_roles() -> list[AgentRoleRead]
is_role_allowed_tool(role_name: str, tool_name: str) -> bool
```

在 `apps/api/app/domains/agent_runs/runtime.py` 中：

- 保持现有 `SubagentDefinition` handler。
- 将 `SubagentDefinition` 的初始化与角色目录校验对齐。
- 如果 role catalog 中不存在对应 role，启动时或运行时失败并写清晰事件。
- 调用 subagent 前校验 role 是否允许对应 tool。
- 只读 role 不允许调用 `file.revise`、`judge.repair`、`bookrun.start`。

### 验收标准

- `plot_reviewer`、`character_reviewer`、`prose_reviewer`、`continuity_reviewer` 必须存在于 role catalog。
- Runtime 调用 subagent 时使用 role catalog 中的 role name。
- 只读 role 不能调用写入工具。
- unknown role 不执行，并产生可读错误。

### 测试建议

在 `apps/api/tests/test_agent_runs.py` 增加：

```text
test_runtime_subagent_definitions_are_backed_by_role_catalog
test_runtime_rejects_unknown_subagent_role
test_readonly_subagent_roles_cannot_execute_write_tools
```

## 阶段 2：Persist agent_role_hints

### 目标

后端接收前端传来的角色提示，并把它写入 AgentRun scope 和事件。

### Payload 约定

Desktop 发给 WebSocket：

```text
args.agent_role_hints = ["plot_reviewer", "character_reviewer"]
```

或者：

```text
args.agent_role_mentions = ["@剧情", "@人物"]
```

推荐 v1 同时支持两者：

- `agent_role_hints` 是规范 role name。
- `agent_role_mentions` 是原始用户 mention。

后端归一化后写入：

```text
run.scope.agent_role_hints
run.scope.agent_role_mentions
```

`agent_run_started` payload 增加：

```text
agent_role_hints
agent_role_mentions
```

未知 mention 不报错，只保留在用户原文，不进入 hints。

### 验收标准

- WebSocket user_message 携带 `agent_role_hints` 后，AgentRun scope 能查询到。
- `agent_run_started` 事件 payload 能看到 role hints。
- unknown role hint 会被过滤或记录 warning，不执行未知 subagent。

### 测试建议

```text
test_websocket_user_message_persists_agent_role_hints
test_unknown_agent_role_hint_is_ignored_or_warned
```

## 阶段 3：Runtime respects agent_role_hints

### 目标

Root Agent 将用户显式 `@角色` 作为调度偏好。

规则：

- `@剧情` 明确要求 `plot_reviewer` 参与。
- `@人物` 明确要求 `character_reviewer` 参与。
- `@文风` 明确要求 `prose_reviewer` 参与。
- `@伏笔` / `@设定` 明确要求 `continuity_reviewer` 参与。
- `@BookRun` 只在 BookRun intent 或 long-running 任务中生效。
- Root Agent 可以增加必要子代理，但不能跳过用户显式点名的只读 reviewer。
- 用户显式点名也不能绕过 Permission Gate。

### 验收标准

- 用户只输入 `@剧情` 时，run events 至少出现 `subagent.plot_reviewer`。
- 用户输入 `@人物 @文风` 时，run events 出现对应两个 subagent。
- `@BookRun` 不会在普通 file.revise 中直接启动 BookRun，除非 intent/权限允许。
- role hints 写入 `agent_plan_created` 或 `tool_trace` payload，便于回放解释。

### 测试建议

```text
test_role_hint_for_plot_runs_plot_reviewer
test_multiple_role_hints_run_requested_reviewers
test_bookrun_role_hint_does_not_bypass_permission_gate
```

## 阶段 4：Desktop @role mention parsing

### 目标

Desktop ChatWindow 在发送 user_message 前解析 `@角色`，把规范 role hints 传给后端。

### 前端改动

在 `apps/desktop/frontend/src/lib` 新增或扩展工具函数：

```text
extractAgentRoleMentions(input: string) -> string[]
mapAgentRoleMentionsToHints(mentions: string[], roles: AgentRoleRead[]) -> string[]
```

在 API client 增加类型：

```text
AgentRoleRead
agentRoleHints?: string[]
agentRoleMentions?: string[]
```

ChatWindow 发送消息时：

```text
args.agent_role_mentions = ["@剧情"]
args.agent_role_hints = ["plot_reviewer"]
```

v1 可使用本地内置 alias map，避免发送前必须请求 `/roles`。后续再接 role catalog API 缓存。

### 验收标准

- 输入 `@剧情 看看这一章冲突够不够` 会发送 `agent_role_hints=["plot_reviewer"]`。
- 输入多个 mention 会去重。
- 未知 mention 不进入 hints。
- 原始用户文本不被破坏。

### 测试建议

在前端测试中增加：

```text
extractAgentRoleMentions parses known Chinese mentions
sendAgentUserMessage includes agent_role_hints
unknown mentions stay in message but are not sent as hints
```

## 阶段 5：Desktop lightweight role UX

### 目标

让用户知道可以使用 `@角色`，但不把 UI 做成复杂 agent 面板。

### UI 建议

- 在输入框上方或 placeholder 中轻量提示可用角色。
- 角色建议只在输入 `@` 时出现。
- 可选建议项：
  - `@剧情`
  - `@人物`
  - `@文风`
  - `@伏笔`
  - `@设定`
  - `@BookRun`
  - `@探索`
  - `@资料`

### 验收标准

- 输入 `@` 时可看到角色建议。
- 点击建议会插入 mention。
- 不影响普通聊天输入。
- 不引入重型任务面板。

## 推荐实施顺序

```text
1. Runtime uses Agent Role Catalog
2. Persist agent_role_hints
3. Runtime respects agent_role_hints
4. Desktop @role mention parsing
5. Desktop lightweight role UX
```

如果只做一个最小闭环，先完成前 4 步，不做 UI 建议弹层。

## 推荐测试命令

后端：

```text
cd apps/api
uv run pytest tests/test_agent_runs.py -q
```

涉及 WebSocket 兼容：

```text
cd apps/api
uv run pytest tests/test_ide_agent_orchestrator.py tests/test_ide_command_registry.py -q
```

前端：

```text
cd apps/desktop/frontend
npm test -- --runInBand
```

执行前先检查当前项目实际 test runner。

## 完成定义

本阶段完成时，应满足：

- Role Catalog 不只是只读端点，而被 Runtime 用于子代理调度约束。
- Desktop 可把 `@角色` 变成 `agent_role_hints`。
- AgentRun 能记录用户显式角色意图。
- Runtime 会尊重显式 role hints，但不绕过权限系统。
- 文件写回仍默认由作者确认。

