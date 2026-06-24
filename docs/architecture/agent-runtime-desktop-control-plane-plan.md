# Agent Runtime Desktop Control Plane Plan

## 用途

这份文档是 `Agent Role Catalog / @角色消费` 已基本落地之后的下一阶段计划。

本阶段不再继续补角色目录，而是把已经存在的 AgentRun 事件、权限请求、控制消息和 managed Writing Run 投影，收敛成一个稳定、可恢复、可解释的桌面端控制平面。

核心判断：

- `root_agent / subagent` 角色目录已经存在。
- `@剧情 / @人物 / @文风 / @伏笔 / @写作任务` 解析已经进入 Desktop 与 Runtime。
- `AgentRunEvent`、`tool_trace`、`permission_required`、`subagent_started`、`subagent_completed`、`agent_artifact` 已经有后端事件基础。
- Desktop 已经能展示轻量步骤面板，并发送 `approve_permission / deny_permission / pause_run / resume_run / stop_run`。
- 下一阶段的真实缺口是体验闭环：事件类型覆盖、权限档位选择、断线恢复、BookRun 控制收敛、测试固定。

## 阶段目标

把 StoryForge Agent 从“后端已经会跑”推进到“作者在桌面端能放心使用”：

```text
用户发起目标
-> Root Agent 创建 AgentRun
-> Desktop 展示 timeline
-> tool / subagent / artifact / permission 事件持续进入 UI
-> 用户可选择权限档位
-> 用户可批准、拒绝、暂停、恢复、停止
-> 断线后通过 REST/SSE 从 AgentRunEvent 恢复
-> BookRun 长任务也通过同一控制面呈现
```

## 不做事项

本阶段不做：

- 不重写 AgentRuntime 调度内核。
- 不做真实并发 subagent。
- 不开放写入型 MCP。
- 不让后端直接写本地文件。
- 不把 ChatWindow 改成重型任务管理器。
- 不新增 basic / advanced 两套 Agent 模式。
- 不引入新的数据库大模型，除非现有事件字段无法表达必要状态。

## WebSocket 与 REST/SSE 分工

WebSocket 不冲突，也不应该变成第二套状态源。

推荐分工：

```text
WebSocket
- 发送 user_message
- 推送当前 run 的实时事件
- 发送 control message
- 收 control ack

REST
- 读取 AgentRun 当前快照
- 读取 AgentRunEvent 历史
- 读取 AgentArtifact / checkpoint
- 页面刷新或断线后恢复

SSE
- 从 AgentRunEvent Store 回放或订阅事件
- 不做决策
- 不生成独立事实
```

事实来源只能是：

```text
AgentRun + AgentRunEvent + AgentArtifact
```

## 计划表

| 顺序 | 阶段 | 目标 | 主要文件 | 验收 |
| --- | --- | --- | --- | --- |
| 1 | Timeline event coverage | Desktop 覆盖后端核心事件类型 | `ChatWindow.tsx`、`AgentStepsPanel.tsx`、`api-client.ts` | `subagent_*`、`agent_artifact`、`permission_required` 都能稳定显示 |
| 2 | Permission profile UI | 作者能选择 AgentRun 权限档位 | `ChatWindow.tsx`、`api-client.ts` | user message 携带 `permission_profile`，后端 run 记录正确 |
| 3 | Control message hardening | 批准/拒绝/暂停/恢复/停止状态一致 | `ChatWindow.tsx`、`agent_runs/service.py` 测试 | 控制 ack 不把 run 误标 completed |
| 4 | Event recovery | 断线或刷新后从 REST/SSE 恢复 timeline | `api-client.ts`、`ChatWindow.tsx` | 给定 run_id 可重建步骤面板 |
| 5 | Artifact surface | 审稿报告、patch、checkpoint 有统一入口 | `AgentStepsPanel.tsx`、PatchReview 相关组件 | artifact 不只埋在文本 summary 里 |
| 6 | BookRun convergence UX | BookRun 作为 AgentRun 长任务显示和控制 | `ChatWindow.tsx`、BookRun event bridge | pause/resume/stop 与 BookRun 投影不打架 |
| 7 | Test and contract lock | 固定下一阶段行为 | API tests、frontend tests、OpenAPI/generated types | 后端 AgentRun 测试绿，前端事件解析测试绿 |

## 阶段 1：Timeline event coverage

### 目标

让 Desktop 的 Agent timeline 明确理解 AgentRun 的核心事件，不再只把所有内容压成普通 `tool_trace`。

首批事件：

```text
agent_run_started
agent_plan_created / agent_step
subagent_started
subagent_completed
tool_trace
permission_required
agent_artifact
agent_run_completed
agent_run_failed
```

### 实施要点

- 在 `api-client.ts` 中补齐事件类型定义和 type guard。
- 在 `ChatWindow.tsx` 中增加 event -> UI step 的映射。
- `subagent_started` 显示为“某角色开始审稿/探索/修复”。
- `subagent_completed` 显示该角色 summary、issue count、artifact id。
- `agent_artifact` 显示产物类型，不直接塞一大段 JSON。
- 未识别事件不要报错，保留为 debug-friendly 的轻量步骤。

### 验收标准

- 后端发送 `subagent_started` 时，timeline 出现对应子代理步骤。
- 后端发送 `subagent_completed` 时，对应步骤完成并显示摘要。
- 后端发送 `agent_artifact` 时，用户能看见产物入口或摘要。
- 旧的 `tool_trace` 展示不回归。

## 阶段 2：Permission profile UI

### 目标

把权限档位变成用户可控的运行参数，而不是固定默认值。

推荐 UI 仍然轻量，放在输入区附近或 Agent control bar 内：

```text
risk_confirm        默认：低风险自动，高风险确认
step_confirm        每一步都确认
autonomous_approval 更自动，但高风险仍确认
full_allow          预留；默认不推荐，必要时仍保留硬边界
```

### Payload 约定

Desktop 发送 user message 时增加：

```text
permission_profile: "risk_confirm"
```

后端仍由 Permission Gate 决定是否真正允许工具执行。前端选择只表达用户偏好，不能绕过工具风险等级。

### 验收标准

- 新 run 能记录用户选择的 `permission_profile`。
- `permission_required` 事件能显示当前 profile。
- 默认仍为 `risk_confirm`。
- `full_allow` 不绕过 dangerous / write 文件硬边界。

## 阶段 3：Control message hardening

### 目标

控制命令的 UI 状态必须和后端状态一致。

当前需要特别注意：

- `approve_permission` 不等于整个 run completed，只代表一个权限请求被批准。
- `deny_permission` 可能让 run failed，也可能只是取消某一步，具体由后端状态决定。
- `pause_run / resume_run / stop_run` 应以 ack 或后续 run event 为准。

### 实施要点

- Desktop 收到 control ack 后只更新对应控制步骤，不抢先推断整个 run 完成。
- 如果 ack payload 有 status 或 event_id，优先展示为控制事件。
- 后续 `agent_run_completed / agent_run_failed` 才决定最终状态。
- 后端测试覆盖重复 approve、paused 状态 approve、stop 后 resume 等边界。

### 验收标准

- 批准权限后 timeline 不会立刻显示“整轮已完成”，除非后端确实完成。
- 拒绝权限后有清晰的“已拒绝”状态和用户可读原因。
- 暂停后不能继续点暂停；恢复后不能继续点恢复。
- stop 后不能再继续批准 pending permission。

## 阶段 4：Event recovery

### 目标

AgentRun 不能只依赖当前 WebSocket 生命周期。刷新页面、切换文件、WebSocket 断开后，Desktop 要能从事件仓库恢复。

### 实施要点

- `api-client.ts` 增加：

```text
getAgentRun(runId)
listAgentRunEvents(runId)
listAgentRunArtifacts(runId)
streamAgentRunEvents(runId)
```

- `ChatWindow.tsx` 保留当前 active run id。
- 页面恢复时先 REST 读取 events，再可选接 SSE。
- REST/SSE 只重放事件，不重新执行任务。

### 验收标准

- 给定一个已有 `run_id`，前端可重建 timeline。
- 重放事件不会重复插入同一个 step。
- 断线后新事件继续接在旧 timeline 后。
- SSE 失败不影响 REST 快照读取。

## 阶段 5：Artifact surface

### 目标

让 Agent 产物有统一入口，而不是散落在 assistant 文本、tool output 或 patch 面板里。

首批 artifact：

```text
review_report
proposed_patch
chapter_draft
bookrun_checkpoint
diagnostic_summary
```

### 实施要点

- `agent_artifact` 事件只展示摘要和入口。
- `proposed_patch` 继续走现有 PatchReviewPanel，不改变写回确认边界。
- `review_report` 可以关联现有 ReviewIssueActions。
- `bookrun_checkpoint` 显示 checkpoint 章节、状态、是否可 retry。

### 验收标准

- 审稿报告能进入“按问题修订”的现有动作。
- patch 仍由作者确认写回。
- checkpoint 可以被看见，不只藏在 BookRun progress 文本里。

## 阶段 6：BookRun convergence UX

### 目标

BookRun 不再像旁路后台任务，而是 AgentRun 的 long-running tool / subagent 投影。

### 实施要点

- BookRun progress panel 与 AgentRun timeline 使用同一个 run id 关联。
- `bookrun.start`、checkpoint、pause/resume/stop 都进入 AgentRunEvent。
- 旧 `/api/ide/runs/{book_run_id}/events` 保持兼容，但 Desktop 优先展示 AgentRun 视角。
- retry from checkpoint 作为后续独立阶段，不和本阶段混在一起。

### 验收标准

- `@写作任务` 启动后，timeline 出现 managed Writing Run 相关 tool/subagent 步骤。
- BookRun progress panel 与 AgentRun control bar 状态一致。
- pause/resume/stop 不出现双通道状态冲突。

## 阶段 7：Test and contract lock

### 后端测试

优先固定：

```text
cd apps/api
uv run pytest tests/test_agent_runs.py -q
```

补充：

```text
cd apps/api
uv run pytest tests/test_ide_agent_orchestrator.py tests/test_runtime_tools.py -q
```

### 前端测试

优先固定：

```text
cd apps/desktop/frontend
npm test -- agent-roles api-client
```

需要新增：

```text
agent timeline event reducer tests
permission profile payload tests
control ack state tests
event recovery mapping tests
```

如果 Windows 下 `npm test` 因临时目录清理 `EBUSY` 失败，但断言通过，需要单独记录，不当作功能失败。

## 推荐实施顺序

最小可交付闭环：

```text
1. api-client 补事件类型和 REST 读取函数
2. ChatWindow 抽出 event -> timeline reducer
3. 覆盖 subagent / artifact / permission event UI
4. 增加 permission_profile 选择与 payload
5. 修正 control ack 状态推断
6. 增加 REST/SSE 恢复
7. BookRun progress 接入 AgentRun 视角
8. 补测试并锁 OpenAPI/generated types
```

## 完成定义

本阶段完成时，应满足：

- 用户仍只面对一个 Agent 模式。
- `@角色` 能驱动专业子代理参与。
- WebSocket 只是实时通道，不是第二事实源。
- Desktop timeline 能解释 Root Agent、Subagent、Tool、Permission、Artifact 的关系。
- 用户能选择权限档位，并明确知道哪些步骤正在等待确认。
- 批准/拒绝/暂停/恢复/停止不会造成前后端状态错位。
- 页面刷新或连接断开后，可以从 AgentRunEvent 恢复。
- BookRun 长任务逐步收敛到 AgentRun control plane。

## 下一阶段之后

本阶段完成后，再进入：

```text
MCP readonly executor
-> Autonomous approval v1
-> true parallel subagent execution
-> write-capable MCP research
```

其中 MCP readonly 必须继续遵守：

- 注册到 Tool Registry。
- 经过 Permission Gate。
- 写入 AgentRunEvent。
- v1 只读，不开放危险 shell / 文件写入。
