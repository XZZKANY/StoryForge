# StoryForge Assistant 架构诊断与实施建议

生成时间：2026-06-09
对比对象：

- StoryForge：`D:\StoryForge`
- claw-code：`C:\Users\kanye\claw-code`

本文目标不是重新设计一个聊天机器人，而是说明 StoryForge 如何把已有功能收束成一个真正可用的 Assistant：用户通过自然语言输入任务，Assistant 调用现有 API、Workflow、BookRun、Judge、Repair、Artifacts 等能力，并把过程记录为可恢复、可审计的工具链。

## 1. 结论

StoryForge 已经吸收了 claw-code 的一部分思想，但还没有形成完整的 Assistant runtime。

已经完成的部分：

- 有 Assistant 会话模型：`apps/api/app/domains/assistant/*`
- 有自然语言意图解析：`apps/web/components/home/assistant-intent.ts`
- 有工具状态树：`apps/web/components/home/AssistantToolTree.tsx`
- 有 BookRun 到工具节点的映射：`assistant-tool-node-mapper.ts`
- 有真实 API 调用动作：`assistant-book-run-actions.ts`、`assistant-chapter-review-actions.ts`、`assistant-artifact-export-actions.ts`
- 有创作工具注册表：`apps/workflow/storyforge_workflow/tools/registry.py`
- 有运行时工具 API：`apps/api/app/domains/runtime_tools/*`

关键缺口：

- 工具调用分散在前端 Server Action 里，没有统一 ToolRegistry/ToolExecutor。
- 后端 Assistant 只存 session/message，没有存 tool call/event。
- 没有统一权限/确认策略。
- 没有稳定的 orchestrator，把“意图 -> 工具计划 -> 执行 -> 状态 -> 恢复”串起来。
- 新 `UnifiedSidebar` 把原先从 `/api/assistant/sessions` 读取真实最近会话的能力断开，改成了 localStorage 最近记录。

推荐方向：

> 不要再做一个“聊天框”。要做一个 StoryForge Assistant Runtime：意图解析、工具选择、权限判断、工具执行、事件记录、状态映射和会话恢复统一管理。

## 2. claw-code 值得学习什么

claw-code 的价值不在业务功能，而在它把一个 Assistant/CLI 系统拆成了几个稳定层。

### 2.1 工具和命令注册

相关文件：

- `C:\Users\kanye\claw-code\src\commands.py`
- `C:\Users\kanye\claw-code\src\tools.py`
- `C:\Users\kanye\claw-code\src\execution_registry.py`
- `C:\Users\kanye\claw-code\src\command_graph.py`

claw-code 的模式：

```text
commands/tools snapshot
  -> registry
  -> route prompt
  -> execute matched command/tool
  -> return structured execution messages
```

StoryForge 当前对应物：

- `apps/workflow/storyforge_workflow/tools/registry.py`
- `apps/api/app/domains/runtime_tools/service.py`
- `apps/api/app/domains/runtime_tools/router.py`
- `apps/web/components/home/assistant-tool-node-mapper.ts`

差距：

- StoryForge 有“工具目录”，但没有“Assistant 可执行工具注册表”。
- 当前 `CreativeToolRegistry` 是说明性元数据，不负责执行。
- 当前执行散在多个前端 action 文件里。

应该补：

```text
AssistantToolRegistry
  - tool name
  - category/domain
  - input schema
  - output schema
  - permission level
  - required context
  - execute handler
  - evidence mapping
```

### 2.2 Runtime session

相关文件：

- `C:\Users\kanye\claw-code\src\runtime.py`
- `C:\Users\kanye\claw-code\src\session_store.py`
- `C:\Users\kanye\claw-code\src\history.py`
- `C:\Users\kanye\claw-code\src\transcript.py`

claw-code 的模式：

```text
prompt
  -> context
  -> setup
  -> routed matches
  -> command/tool execution
  -> stream events
  -> turn result
  -> persisted session
```

StoryForge 当前对应物：

- `AssistantSession`
- `AssistantMessage`
- `BookRun`
- `ModelRun`
- `WorkflowCheckpoint`
- `BookRun.progress`

差距：

- StoryForge session 只存消息和业务 ID。
- 工具执行过程没有独立事实源。
- `AssistantToolTree` 多数状态是从 `BookRun` 推导出来的，不是从真实 tool call event 重放出来的。

应该补：

```text
AssistantSession
  has many AssistantMessage
  has many AssistantToolCall
  has many AssistantEvent

AssistantToolCall
  session_id
  tool_name
  status
  input_summary
  output_summary
  error_message
  related_ids
  started_at
  finished_at
  token_usage
  cost_estimate
```

### 2.3 权限和作用域

相关文件：

- `C:\Users\kanye\claw-code\src\permissions.py`
- `C:\Users\kanye\claw-code\src\path_scope.py`

claw-code 的模式：

```text
tool execution
  -> permission context
  -> deny names/prefixes
  -> path scope validation
  -> allow or deny with reason
```

StoryForge 当前对应物：

- Studio approve 写回需要用户动作。
- BookRun pause/stop/retry 是显式按钮。
- Provider 和预算在工具树里展示。
- 后端服务本身有业务校验。

差距：

- 没有统一的 Assistant 权限策略。
- Assistant 无法系统判断“这个工具能不能自动执行”。
- 高成本、高影响动作没有统一确认协议。

应该补：

```text
PermissionLevel:
  read_only
  write_safe
  high_cost
  destructive_or_irreversible
  requires_human_approval

AssistantPermissionPolicy:
  - read-only 查询可自动执行
  - 创建草稿可自动执行
  - 启动真实 LLM 长任务需要确认预算
  - 批准写回必须人工确认
  - 删除/覆盖/停止任务必须确认
```

### 2.4 路由和匹配

相关文件：

- `C:\Users\kanye\claw-code\src\runtime.py`
- `C:\Users\kanye\claw-code\src\query_engine.py`

claw-code 的模式：

```text
prompt tokens
  -> score commands/tools
  -> selected matches
  -> execution registry
```

StoryForge 当前对应物：

- `assistant-intent.ts`

差距：

- StoryForge 现在是确定性正则解析，适合 MVP。
- 还没有根据工具目录选择工具序列。
- 还没有“需要补充上下文”的机制。

应该补：

```text
AssistantIntentRouter
  input: user text + session context + available tools
  output:
    - task_type
    - required_context
    - missing_context
    - planned_tools
    - confirmation_required
```

## 3. StoryForge 当前 Assistant 现状

### 3.1 后端 Assistant 已有能力

文件：

- `apps/api/app/domains/assistant/models.py`
- `apps/api/app/domains/assistant/schemas.py`
- `apps/api/app/domains/assistant/service.py`
- `apps/api/app/domains/assistant/router.py`

已支持：

- 创建 Assistant 会话。
- 追加 Assistant 消息。
- 读取最近 Assistant 会话。
- 读取指定 Assistant 会话详情。
- 会话绑定 `blueprint_id`、`book_run_id`、`artifact_id`。
- 不保存 Provider 凭据。

局限：

- 没有 `tool_calls`。
- 没有 `events`。
- 没有 `current_context`。
- 没有权限记录。
- 没有“执行一次 Assistant turn”的端点。

### 3.2 前端 Assistant 已有能力

文件：

- `AssistantConversation.tsx`
- `AssistantMessageList.tsx`
- `AssistantToolTree.tsx`
- `AssistantActionBar.tsx`
- `assistant-intent.ts`
- `assistant-session-store.ts`
- `assistant-tool-node-mapper.ts`
- `assistant-book-run-actions.ts`
- `assistant-chapter-review-actions.ts`
- `assistant-artifact-export-actions.ts`

已支持：

- 首页 Assistant 对话台。
- 从 URL 恢复 `assistant_session_id`。
- 从 Assistant 会话恢复消息。
- 从 `book_run_id` 读取 BookRun 并展示工具树。
- 识别试读生成、章节审阅、产物导出、目标调整。
- 暂停、恢复、停止、重试 BookRun。
- 章节审阅时定位 Scene Packet 并调用 Studio review。
- completed BookRun 导出 Markdown、EPUB、audit_report。
- 每次动作写回 Assistant session。

局限：

- 前端 action 既做意图执行，又做工具调用，又做 session 写入，边界混在一起。
- 工具执行结果通过 URL query 回传，随着能力变复杂会越来越脆。
- 工具树不是从统一 tool call log 重放，而是从 BookRun 和 query 状态拼出来。
- 最近会话在 `UnifiedSidebar` 里断开真实 API。

### 3.3 Workflow 和 runtime 已有能力

文件：

- `apps/workflow/storyforge_workflow/tools/registry.py`
- `apps/workflow/storyforge_workflow/skills/definitions.py`
- `apps/workflow/storyforge_workflow/runtime/*`
- `apps/workflow/storyforge_workflow/orchestrators/*`
- `apps/api/app/domains/book_runs/*`

已支持：

- CreativeToolRegistry。
- Novel Skill Registry。
- BookRun dispatch payload。
- BookRun pause/resume/stop/retry/progress。
- ModelRun 和 runtime tool 摘要。
- Provider 解析、预算、checkpoint、审计信息。

局限：

- Workflow runtime 和 Assistant runtime 还没有统一。
- Assistant 不能直接查询“可执行工具目录 + 当前工具状态 + 权限要求”。
- Assistant 没有自己的 tool event truth source。

## 4. 目标架构

### 4.1 一句话架构

```text
StoryForge Assistant = Natural Language UI + Assistant Runtime + Existing StoryForge Tools
```

其中：

- Natural Language UI 是首页对话台。
- Assistant Runtime 负责意图、工具计划、权限、执行、事件、会话。
- Existing StoryForge Tools 是你已有的 Workspaces、Blueprint、BookRun、Studio、Judge、Repair、Artifacts、Provider、Runtime Tools。

### 4.2 推荐分层

```text
apps/web
  components/home
    AssistantConversation.tsx
    AssistantToolTree.tsx
    AssistantActionBar.tsx
    assistant-session-store.ts
    assistant-client.ts

apps/api
  domains/assistant
    models.py
    schemas.py
    router.py
    service.py
    intent.py
    tool_registry.py
    tool_executor.py
    permission_policy.py
    orchestrator.py

apps/workflow
  storyforge_workflow/tools/registry.py
  storyforge_workflow/skills/definitions.py
  storyforge_workflow/orchestrators/*
```

### 4.3 Assistant Runtime 数据流

```text
用户输入
  -> POST /api/assistant/sessions/{id}/turns
  -> 读取 session context
  -> intent router 解析任务
  -> tool planner 生成工具计划
  -> permission policy 判断是否可自动执行
  -> tool executor 调已有 API/service
  -> 写 AssistantToolCall 和 AssistantEvent
  -> 更新 session 的业务引用
  -> 返回 messages + tool_calls + next_actions
  -> 前端渲染消息流和工具树
```

### 4.4 最小后端模型

建议新增：

```python
class AssistantToolCall:
    id: int
    session_id: int
    tool_name: str
    status: str  # planned/running/completed/failed/needs_approval/paused
    input_summary: dict
    output_summary: dict
    error_message: str | None
    related_type: str | None
    related_id: int | None
    started_at: datetime | None
    finished_at: datetime | None

class AssistantEvent:
    id: int
    session_id: int
    event_type: str
    payload: dict
    created_at: datetime
```

不要一开始存完整大 payload。先存摘要、状态、关联 ID，避免日志表膨胀。

### 4.5 工具目录

第一批工具应该只封装现有能力：

| Assistant tool | 调用现有能力 | 权限级别 |
| --- | --- | --- |
| `assistant.session.read` | `GET /api/assistant/sessions/{id}` | read_only |
| `workspace.create` | `/api/workspaces` | write_safe |
| `workspace.list` | `/api/workspaces` | read_only |
| `blueprint.create` | `/api/blueprints` | write_safe |
| `book_run.start` | `/api/book-runs` | high_cost |
| `book_run.read` | `/api/book-runs/{id}` | read_only |
| `book_run.pause` | `/api/book-runs/{id}/pause` | requires_confirmation |
| `book_run.resume` | `/api/book-runs/{id}/resume` | write_safe |
| `book_run.retry` | `/api/book-runs/{id}/retry` | requires_confirmation |
| `scene_packet.create` | `/api/studio/scene-packets` | write_safe |
| `chapter.review` | `/api/studio/chapter-review` | write_safe |
| `studio.approve` | `/api/studio/approve` | requires_human_approval |
| `artifact.export` | `/api/book-runs/{id}/exports/*` | write_safe |
| `provider.status` | Provider Gateway / settings | read_only |

### 4.6 工具计划示例

用户输入：

```text
帮我开一本赛博修仙文，先做前三章试读
```

Assistant 计划：

```text
1. provider.status
2. workspace.create 或 workspace.select
3. blueprint.create
4. book_run.start
5. book_run.read
6. render tool tree
```

用户输入：

```text
审一下第二章，看看有没有人设崩坏
```

Assistant 计划：

```text
1. assistant.context.resolve
2. scene_packet.create
3. chapter.review
4. render issues and repair patch
5. wait for studio.approve
```

用户输入：

```text
导出这次试读的 EPUB 和审计报告
```

Assistant 计划：

```text
1. assistant.context.resolve
2. book_run.read
3. artifact.export markdown
4. artifact.export epub
5. artifact.export audit
6. render artifact links
```

## 5. 和 claw-code 的逐项对照

| claw-code 概念 | claw-code 文件 | StoryForge 当前状态 | 应该怎么做 |
| --- | --- | --- | --- |
| Command registry | `src/commands.py` | 没有 Assistant command registry | 把 task type 和 slash/natural commands 合并到 intent router |
| Tool registry | `src/tools.py`、`execution_registry.py` | 有 CreativeToolRegistry，但不是 Assistant executor | 新增 AssistantToolRegistry，复用 CreativeToolRegistry 元数据 |
| Runtime session | `src/runtime.py` | 有 AssistantSession，但只存消息 | 加 turn/tool/event 三层事实源 |
| Route prompt | `PortRuntime.route_prompt` | 有 `assistant-intent.ts` 正则解析 | 后端化 intent router，前端只做轻量预判 |
| Permission context | `src/permissions.py` | 分散在按钮和业务校验里 | 新增 AssistantPermissionPolicy |
| Scope validation | `src/path_scope.py` | 有业务 scope 校验，但非 Assistant 级 | 对 workspace/book/chapter/artifact 做上下文权限 |
| Transcript | `src/transcript.py` | AssistantMessage 存消息 | 增加 AssistantEvent 存工具事件 |
| Stream events | `runtime.py` | 工具树从 BookRun 推导 | 从 AssistantToolCall/Event 重放工具树 |
| Persisted session | `session_store.py` | DB session 已优于文件存储 | 继续用数据库，但扩展结构 |

## 6. 分阶段实施

### Phase 0：修复当前断点

目标：不要在新侧栏里丢掉 Assistant 已有能力。

任务：

- 让 `UnifiedSidebar` 的最近记录读取 `/api/assistant/sessions`。
- 或新增服务端 `RecentItemsSidebar`，由 layout/server wrapper 读取真实最近会话后传给客户端侧栏。
- 保留 localStorage 最近记录作为补充，不作为唯一来源。
- 更新 `home-page.test.tsx`，不要要求“首页不读 Assistant 最近会话”这种反向约束。

验收：

- 首页左侧能看到真实 Assistant 最近会话。
- 点击最近会话回到 `/?assistant_session_id=...`。
- 刷新后 Assistant 消息恢复。

### Phase 1：新增 Assistant tool call 事实源

目标：工具树不再只靠 BookRun 推导。

任务：

- 新增 `AssistantToolCall` ORM、schema、service、router。
- 新增 Alembic 迁移。
- 后端支持：
  - 创建 tool call
  - 更新状态
  - 列出 session tool calls
- 前端 `AssistantToolTree` 优先消费 tool calls。

验收：

- 执行 BookRun pause/resume 时写入 tool call。
- 执行 chapter review 时写入 tool call。
- 执行 artifact export 时写入 tool call。

### Phase 2：统一现有前端 actions

目标：把分散 action 收拢成工具执行适配器。

当前分散文件：

- `assistant-book-run-actions.ts`
- `assistant-chapter-review-actions.ts`
- `assistant-artifact-export-actions.ts`

建议抽象：

```text
assistant-tools/
  book-run-control.ts
  chapter-review.ts
  artifact-export.ts
  types.ts
  result-url.ts
```

注意：这一阶段仍可留在前端 Server Action 层，不急着全后端化。

验收：

- 外部行为不变。
- 代码中每个工具都有统一输入、输出、错误、session 写入。

### Phase 3：后端 Assistant orchestrator

目标：从“前端 action 编排”升级成“后端 runtime 编排”。

新增端点：

```text
POST /api/assistant/sessions/{session_id}/turns
POST /api/assistant/turns
```

请求：

```json
{
  "message": "帮我开一本悬疑文，先做前三章试读",
  "workspace_id": 1,
  "book_id": null
}
```

响应：

```json
{
  "session": {},
  "messages": [],
  "tool_calls": [],
  "next_actions": []
}
```

验收：

- 输入“查看上次任务”能只读恢复上下文。
- 输入“导出审计报告”能基于 completed BookRun 调导出工具。
- 输入“审阅第二章”能在缺少 book_id 时返回 missing_context，而不是乱猜。

### Phase 4：权限和确认

目标：Assistant 能明确哪些事情能自动做，哪些必须等用户批准。

权限策略：

| 级别 | 行为 |
| --- | --- |
| read_only | 自动执行 |
| write_safe | 可执行，但必须记录 session |
| high_cost | 需要预算确认 |
| requires_confirmation | 需要用户点击确认 |
| requires_human_approval | 必须人工批准，不能自动写回 |

验收：

- `book_run.start` 在真实 LLM 模式下必须确认预算。
- `studio.approve` 必须人工点击。
- `book_run.stop` 必须确认。
- Provider 不可用时不得显示 running/completed。

### Phase 5：LLM 意图增强

目标：在确定性解析够稳定后，再加 LLM 辅助。

原则：

- LLM 只做解析建议，不直接执行工具。
- LLM 输出必须被 schema 校验。
- 不确定时返回 missing_context。
- 所有执行仍走 AssistantToolRegistry 和 PermissionPolicy。

## 7. 设计原则

### 7.1 Assistant 不复制业务逻辑

错误做法：

```text
Assistant 自己生成章节、自己审稿、自己导出。
```

正确做法：

```text
Assistant 调已有 Blueprint、BookRun、Judge、Repair、Artifacts。
```

### 7.2 工具调用必须可追溯

每次工具调用都要能回答：

- 谁触发的？
- 输入是什么摘要？
- 调了哪个已有能力？
- 成功还是失败？
- 关联了哪个业务对象？
- 失败后下一步是什么？

### 7.3 不伪造完成状态

工具树只能来自：

- AssistantToolCall
- BookRun
- Studio/Judge/Repair
- Artifacts
- Provider Gateway

不能写静态“已完成”假节点。

### 7.4 前端只展示，后端给事实

前端可以做轻量 intent 预判，但最终工具计划、权限、状态、会话应以后端事实为准。

### 7.5 先做有限意图，不做万能 Agent

第一批意图：

- 开新书/生成试读
- 继续上次任务
- 查看运行状态
- 暂停/恢复/重试
- 审阅第 N 章
- 批准写回
- 导出作品/审计报告

## 8. 当前最值得做的三个任务

### 任务 1：恢复真实最近 Assistant 会话

原因：这是当前可见断点，影响你判断 Assistant 是否存在。

涉及：

- `apps/web/components/site-nav/UnifiedSidebar.tsx`
- `apps/web/components/site-nav/RecentItemsList.tsx`
- `apps/web/components/home/assistant-session-store.ts`
- `apps/web/tests/home-page.test.tsx`

### 任务 2：AssistantToolCall 后端表

原因：没有 tool call 事实源，Assistant 永远只是消息 + 推导状态。

涉及：

- `apps/api/app/domains/assistant/models.py`
- `schemas.py`
- `service.py`
- `router.py`
- Alembic migration
- `apps/api/tests/test_assistant_sessions.py`

### 任务 3：把三个前端 action 包成统一工具适配器

原因：现有真实调用已经能用，但边界分散，后续难扩。

涉及：

- `assistant-book-run-actions.ts`
- `assistant-chapter-review-actions.ts`
- `assistant-artifact-export-actions.ts`
- 新增 `assistant-tool-execution.ts` 或 `assistant-tools/*`

## 9. 最终目标形态

用户不需要知道 StoryForge 有多少页面和 API。

用户只需要说：

```text
帮我开一本悬疑文，先做三章试读。
```

Assistant 应该能：

```text
1. 检查 Provider 和预算。
2. 创建或选择 workspace。
3. 创建 Blueprint。
4. 启动 BookRun。
5. 展示章节生成、Judge、Repair、导出状态。
6. 需要批准时停下来。
7. 完成后给出正文、问题单、修复建议、导出和审计报告。
8. 下次回来能继续同一条会话。
```

这才是 StoryForge Assistant 的核心：不是聊天，而是用对话驱动已有创作系统。
