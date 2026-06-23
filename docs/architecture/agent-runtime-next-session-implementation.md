# Agent Runtime Next Session Implementation Guide

## 用途

这份文档给下一次新会话直接接手实现用。它不是新的架构设想，而是基于当前工作树事实整理的实施顺序和第一批可落地任务。

下一会话开始时，先读这四份文档：

1. `docs/architecture/agent-runtime-control-plane-plan.md`
2. `docs/architecture/agent-run-v1-gap-plan.md`
3. `docs/architecture/agent-run-runtime-facade-plan.md`
4. `docs/architecture/agent-runtime-post-facade-master-plan.md`

然后从本文的“下一步第一任务”开始。

## 当前状态快照

按当前工作树静态核对，后端 Agent Runtime 已经不是空白：

- 已有 `apps/api/app/domains/agent_runs/`。
- 已有 `AgentRun`、`AgentRunEvent`、`SubagentRun`、`AgentArtifact`。
- 已有 Alembic 迁移 `20260623_0001_add_agent_runs.py`。
- WebSocket `user_message` 已调用 `run_agent_user_message()`。
- 已有 `AgentRuntime`、`ToolRegistry`、`ToolDefinition`、`PermissionGate`。
- 已有 `chapter_polish` 可执行路径迹象。
- 已有 `SubagentDefinition` 和剧情/人物/文风/连续性 reviewer。
- BookRun 已有 AgentRun 投影和控制测试迹象。
- RuntimeTools 已暴露内部工具和只读 MCP 元数据。

但最新 OpenCode 启发版总计划加入了一个前置阶段：

```text
阶段 0：Agent Role Catalog v1
```

这个阶段目前主要存在于文档里，代码层还没有完整落地。

## 当前阶段判断

如果按旧计划看，后端大约已经做到阶段 4-5：

```text
Runtime Facade
Tool Registry
Permission Gate
Executable Skill
Subagent Executor
Patch Artifact Compatibility
```

如果按 OpenCode 改造后的新计划看，需要先回补：

```text
Agent Role Catalog v1
```

下一会话不要继续直接冲 Desktop Timeline 或 MCP executor。先把角色目录补齐，让后续 `@剧情`、`@人物`、只读探索代理和权限策略有统一来源。

## 下一步第一任务

### 任务名

```text
Implement Agent Role Catalog v1
```

### 目标

新增一个只读角色目录，明确 Primary Agent 和 Subagents 的能力、权限、别名、可用工具、只读约束和 artifact 类型。

这个目录服务后续三件事：

1. Root Agent 调度子代理。
2. Desktop 支持 `@剧情`、`@人物`、`@文风`、`@伏笔`、`@BookRun`。
3. Permission Gate 判断只读代理不能调用写入类工具。

### 不做事项

本任务不做：

- 新 DB 表。
- Alembic 迁移。
- 真实并发子代理。
- Desktop UI 改造。
- 写入型 MCP。
- 自动写本地文件。
- 大规模重构 `AgentRuntime`。

## 实施设计

### 1. 后端 schema

在 `apps/api/app/domains/agent_runs/schemas.py` 增加：

```text
AgentRoleRead
- name
- display_name
- kind
- description
- aliases
- read_only
- default_permission_profile
- allowed_tools
- output_artifacts
- can_be_mentioned
```

字段约束：

- `kind` 使用字符串：`primary` 或 `subagent`。
- `aliases` 存放 `@剧情` 这类用户可输入别名。
- `read_only=true` 的角色不能默认绑定写入类工具。

### 2. 后端 service

在 `apps/api/app/domains/agent_runs/service.py` 增加静态角色定义和查询函数：

```text
list_agent_roles() -> list[AgentRoleRead]
resolve_agent_role_alias(alias: str) -> AgentRoleRead | None
```

首批角色：

```text
root_agent
plot_reviewer
character_reviewer
prose_reviewer
continuity_reviewer
repair_agent
synthesizer
bookrun_agent
context_explorer
external_scout
```

推荐别名：

```text
@剧情 -> plot_reviewer
@人物 -> character_reviewer
@文风 -> prose_reviewer
@伏笔 -> continuity_reviewer
@设定 -> continuity_reviewer
@修复 -> repair_agent
@BookRun -> bookrun_agent
@探索 -> context_explorer
@资料 -> external_scout
```

只读角色：

```text
plot_reviewer
character_reviewer
prose_reviewer
continuity_reviewer
context_explorer
external_scout
```

可写/需确认角色：

```text
repair_agent
bookrun_agent
```

### 3. 后端 router

在 `apps/api/app/domains/agent_runs/router.py` 增加只读接口：

```text
GET /api/agent-runs/roles
```

可选增加：

```text
GET /api/agent-runs/roles/resolve?alias=@剧情
```

如果想保持 v1 更小，只做 `/roles`，前端自己在返回列表里解析 alias。

### 4. Runtime 使用角色目录

第一步不强制 Runtime 完全依赖角色目录，但需要做最小对齐：

- `SubagentDefinition` 的 role name 应与角色目录一致。
- `subagent_started` / `subagent_completed` 的 actor 或 payload 中使用 role name。
- 只读 subagent 不应默认调用 `file.revise`、`judge.repair`、`bookrun.start`。

推荐暂时不改复杂调度逻辑，只做命名和约束校验。

### 5. 测试

在 `apps/api/tests/test_agent_runs.py` 增加测试：

```text
test_agent_roles_endpoint_exposes_opencode_inspired_roles
test_agent_role_aliases_resolve_to_expected_subagents
test_readonly_agent_roles_do_not_bind_write_tools
```

验收点：

- `/api/agent-runs/roles` 返回 `root_agent`。
- 只有一个 `kind=primary`。
- `@剧情` 映射到 `plot_reviewer`。
- `@人物` 映射到 `character_reviewer`。
- `@文风` 映射到 `prose_reviewer`。
- `@伏笔` 和 `@设定` 映射到 `continuity_reviewer`。
- `context_explorer` 和 `external_scout` 是 `read_only=true`。
- `read_only=true` 的角色不能包含 `file.revise`、`judge.repair`、`bookrun.start`。

## 下一阶段顺序

Agent Role Catalog v1 完成后，继续按这个顺序推进：

```text
1. Runtime uses Agent Role Catalog
2. Desktop @role mention parsing
3. Desktop Agent Timeline
4. Permission profile UI
5. BookRun control convergence
6. MCP readonly executor
7. Autonomous approval v1
```

### 1. Runtime uses Agent Role Catalog

让 `AgentRuntime` 在选择 subagent 时读取角色目录，而不是硬编码角色名。

验收：

- subagent 事件 actor 与 role catalog 一致。
- unknown role 不会执行。
- 只读 role 无法调用写入类 tool。

### 2. Desktop @role mention parsing

ChatWindow 发送消息前识别 `@剧情`、`@人物`、`@文风` 等 mention，并把结果放入 args。

建议 payload：

```text
args.agent_role_hints = ["plot_reviewer", "character_reviewer"]
```

验收：

- 用户输入 `@剧情` 后，后端 run event 能看到 role hint。
- 未知 `@xxx` 不报错，只作为普通文本。

### 3. Desktop Agent Timeline

显示轻量 timeline，不做重型任务看板。

验收：

- 显示 `agent_run_started`。
- 显示 `subagent_started` / `subagent_completed`。
- 显示 `tool_trace`。
- 显示 `permission_required`。
- 支持 REST/SSE 断线恢复。

### 4. Permission profile UI

IDE 中可选择：

```text
step_confirm
risk_confirm
autonomous_approval
full_allow
```

默认值保持：

```text
risk_confirm
```

验收：

- 前端能传 `permission_profile`。
- 后端 AgentRun 记录该 profile。
- 高风险工具仍触发确认。

### 5. BookRun control convergence

BookRun 的 pause/resume/stop/retry 统一通过 AgentRun control channel。

验收：

- `pause_run` 可暂停关联 BookRun。
- `resume_run` 可恢复关联 BookRun。
- `stop_run` 可停止关联 BookRun。
- checkpoint artifact 可查询。

### 6. MCP readonly executor

将只读 MCP 从 catalog 推进到真实 executor。

验收：

- MCP tool 经 Tool Registry 调用。
- MCP tool 经 Permission Gate。
- MCP result 写入 `tool_trace`。
- MCP 失败有事件，不静默吞掉。

### 7. Autonomous approval v1

在权限系统稳定后开放更自动的推进能力。

验收：

- 有 max steps。
- 有 max repair rounds。
- 有 cost/time budget。
- 遇到高风险 tool 仍暂停。
- 所有自动批准有事件记录。

## 建议测试命令

下一会话每完成一个后端阶段，优先运行：

```text
cd apps/api
uv run pytest tests/test_agent_runs.py -q
```

涉及 IDE WebSocket 时运行：

```text
cd apps/api
uv run pytest tests/test_ide_agent_orchestrator.py tests/test_ide_command_registry.py -q
```

涉及 RuntimeTools / MCP catalog 时运行：

```text
cd apps/api
uv run pytest tests/test_runtime_tools.py -q
```

涉及前端时运行：

```text
cd apps/desktop/frontend
npm test -- --runInBand
```

实际命令以项目当前 package manager 和 test runner 为准，执行前先检查对应 `pyproject.toml` / `package.json`。

## 新会话注意事项

1. 当前工作树有大量未提交/未跟踪文件。新会话开始必须先看 `git status --short`。
2. 不要回滚用户或其他 agent 的改动。
3. `apps/api/app/domains/agent_runs/` 当前是未跟踪目录，但已经包含大量实现，不能当作空目录重建。
4. 先读当前文件再改，不要只按文档想象。
5. 每一阶段只做一条竖切，避免一次性重构 runtime、router、frontend。
6. 文件写回仍必须保持作者确认边界。
7. MCP 写入能力继续禁止，直到 readonly executor 和 Permission Gate 稳定。

