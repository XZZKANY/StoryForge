# Agent 壳子接线契约（新桌面壳子必须继续对接的接缝）

> 目的：`apps/desktop/frontend` 的对话/编辑壳子在重做。壳子的**视觉与组件结构**可以随便改，
> 但下面这些**接缝**是后端 FastAPI、Rust 侧 Tauri 命令、以及既有纯逻辑模块已经依赖的硬契约。
> 重连壳子时对着本文逐条核对；每条都有金测钉死，漂移即红。
>
> 金测：
> - 后端帧形状 → `apps/api/tests/test_ws_contract_golden.py`
> - 前端事件桥 + WS 守卫 + F10 重建 → `apps/desktop/frontend/tests/behavior/event-bus-contract.vitest.ts`
> - 写回时序不变量 → `apps/desktop/frontend/tests/behavior/writeback-guard.vitest.ts`（W7）
> - 会话切换守卫 → `apps/desktop/frontend/tests/behavior/agent-session-guard.vitest.ts`（W7）
>
> 权威源文件（改契约要同时改这些 + 对应金测）：
> 后端 `apps/api/app/domains/agent_runs/{event_encoders,event_types,trace}.py`；
> 前端 `apps/desktop/frontend/src/lib/api/{agent-socket,agent-run-events,types}.ts`、`src/lib/assistant-events.ts`。

---

## A. Agent WebSocket 协议

端点：`/api/ide/agent/sessions/{sessionId}`（`sessionId` 是 IDE 侧会话标识，需 URL 编码）。
鉴权：URL query `?api_key=...`。发送端 `agent-socket.ts::sendAgentUserMessage` / `sendAgentControlMessage`。

### A.1 出站帧（壳子 → 后端）

**用户消息**（`onopen` 即发）：

```json
{ "type": "user_message", "stream": true, "run_id": "<可选，续跑用>",
  "user_message": "……", "assistant_session_id": 7, "intent": "chat.explain",
  "args": { "agent_role_hints": ["editor"], "agent_role_mentions": ["@editor"] } }
```

- `stream` 缺省 = 是否传了 `onEvent` 回调；传了就走流式，逐帧回调。
- `intent` 省略/自由文本 → 后端一律落 `chat.explain` 工具循环（W1-F11：关键词表已下线，固定管线只认显式 intent）。

**控制消息**（另开一条 socket，`sendAgentControlMessage`）：

```json
{ "type": "approve_permission | deny_permission | pause_run | resume_run | stop_run | retry_from_checkpoint",
  "run_id": "<run 公共 id>", "payload": {} }
```

### A.2 入站流帧（后端 → 壳子）

壳子按 `type` 判别式解码。**判别式就是契约**——后端还会带更多键（见 A.4），壳子按需取，别假设「只有这些键」。

| `type` | 判别式（`agent-socket.ts` 守卫要的最小键） | 壳子拿它干什么 |
|---|---|---|
| `agent_run_started` | `run_id: string` | 记 runId、回填 @role 提及 |
| `agent_step` | `step: string`、`status: string` | 流程树逐步渲染 |
| `tool_trace` | `trace: object`（非 null） | 工具调用轨迹 + 成本（`trace.output_summary`）|
| `permission_required` | `run_id: string` | 弹补丁确认（读 `proposed_patch`）|
| `agent_result` | `assistant_session_id: number`、`plan: []`、`tool_trace: []` | **happy-path 结算帧**：settle 整轮 |
| `error` | `detail: string` | 报错结算 |

`agent_result` 是 happy-path 唯一 settle 信号，`isAgentResultMessage` 认它就 resolve。它的 `agent_result.proposed_patch`、`agent_result.requires_user_confirmation`、`system_jobs`（title/summary/compaction）都是壳子要消费的载荷。

### A.3 控制回执 + 类型映射坑 ⚠️

控制回执 `status` 恒为 `"recorded"`。**回执的 `type` ≠ 你发的 `type`**：

| 发出（inbound） | 回执（ack `type`） |
|---|---|
| `approve_permission` | `permission_approved` |
| `deny_permission` | `permission_denied` |
| `pause_run` / `resume_run` / `stop_run` / `retry_from_checkpoint` | 原样透传 |

映射函数：后端 `event_types.py::event_type_for_control_message`。前端守卫 `isAgentControlAckMessage` 认的是**映射后**的值集合。重写控制条时若手搓判断，别拿 `approve_permission` 去等回执——等不到。

### A.4 漂移旗标（重连壳子时的已知落差，别当 bug）

1. **后端多带、FE 类型少列的键**：`agent_step`/`tool_trace`/`permission_required` 帧后端都带 `event_id`、`sequence`；`permission_required` 还带 `confirmation_action`、`blocked_tool`；`agent_run_started` 带 `event_id`。FE `types.ts` 没在类型里列全，但帧里有——需要幂等/去重（用 `event_id`/`sequence`）时可直接取。
2. **终态帧 `agent_run_completed` / `agent_run_failed` 在 socket 路径上无 FE 类型、无守卫**（`_websocket_terminal_event` 会推，但 happy-path 靠 `agent_result` settle）。它们只在**断线转轮询**路径经 REST 被 `reconstructAgentResultFromEvents` 解码（见 B.3）。壳子的 socket `onmessage` 不要依赖终态帧结算。
3. **`proposed_patch` 定义在三处**：后端 `runtime.py`（生成）、`event_encoders.py::_websocket_permission_required_event`（回嵌进 permission 帧）、FE `types.ts::AgentProposedPatch`（`file_revision` / `repair_patch` 两态判别联合）。改补丁形状要三处一起动。

---

## B. F10 断线重建（超时 → 轮询事件表 → 重建终态）

`sendAgentUserMessage` 超时后**不硬 reject**（真模型 8×300s 结构性长于前端超时，run 还在跑还在花钱）：close socket → 转 REST 轮询 `GET /api/agent-runs/{runId}/events` → 用纯函数 `reconstructAgentResultFromEvents` 从持久化事件重建终态。壳子换了但这套超时语义要保住（否则慢响应误判失败、重复烧 key）。

`reconstructAgentResultFromEvents`（`agent-run-events.ts`，纯函数）读**终态事件的 `payload`**：

- `agent_run_failed` → `{type:'error', detail: 事件 message}`
- `agent_run_completed` / `permission_required` → `agent_result`，**要求 `payload.assistant_session_id` 是 number**（缺了返回 null 继续轮询）；`payload.proposed_patch`/`summary`/`intent`/`requires_user_confirmation` 按需取；`permission_required` 恒标 `requires_user_confirmation=true`。

⇒ **跨侧接缝**：后端 `_websocket_terminal_event` 把 `event.payload` 原样带出，所以**终态事件落库时 payload 必须含 `assistant_session_id`**，否则断线重建拿不回结果。`test_ws_contract_golden.py::test_terminal_frames_carry_reconstructable_payload` 钉后端侧，`event-bus-contract.vitest.ts` 的 F10 组钉前端侧。

---

## C. DOM CustomEvent 事件桥（编辑器 ↔ 对话协调）

`src/lib/assistant-events.ts`，纯 DOM（`window.dispatchEvent`/`addEventListener`）。这是壳子内**编辑器区与对话区解耦通信**的总线。8 个事件名是字符串常量契约，改名即断开所有协调：

| 常量 | 事件名 | 方向 / detail |
|---|---|---|
| `EXPORT_CURRENT_FILE_EVENT` | `storyforge:export-current-file` | 对话 → 编辑器；无 detail |
| `APPLY_FILE_SUGGESTION_EVENT` | `storyforge:apply-file-suggestion` | 对话 → 编辑器；detail = `AssistantFileSuggestion`（含缓冲，见下）|
| `ACCEPT_CURRENT_FILE_SUGGESTION_EVENT` | `storyforge:accept-current-file-suggestion` | 对话 → 编辑器；无 detail |
| `SUGGESTION_RESULT_EVENT` | `storyforge:suggestion-result` | 对话 → 编辑器（对话产出补丁建议后通知编辑器同步建议态；对话自身也监听）；`{filePath, status:'ready'|'error', message, assistantSessionId?}` |
| `AUTHOR_LOOP_RESULT_EVENT` | `storyforge:author-loop-result` | 编辑器 → 对话；`{filePath, status, action:'revision_accepted'|'exported', message, artifactPath?, recordPath?}` |
| `REQUEST_SAVE_ACTIVE_FILE_EVENT` | `storyforge:request-save-active-file` | 读盘前请编辑器落盘（握手请求，见 C.2）|
| `SAVE_ACTIVE_FILE_DONE_EVENT` | `storyforge:save-active-file-done` | 编辑器落盘完成（握手应答）|
| `REVIEW_ISSUES_EVENT` | `storyforge:review-issues` | 对话 → 编辑器；`{filePath, issues: ReviewIssueMarker[]}` 打内联标记 |

### C.1 补丁缓冲（目标文件尚未打开时）

Agent 补丁可能指向未打开甚至尚不存在的文件。`emitFileSuggestion` 把补丁存进模块级 `pendingFileSuggestion` 再派事件；编辑器就绪后用 `takePendingFileSuggestion(filePath)` **一次性领取**（filePath 匹配才给，领取即清空）。壳子的「自动打开目标文件 → 编辑器挂载 → 领取补丁」这条链不能少这一步缓冲，否则补丁指向的新文件永远收不到。

### C.2 落盘握手

`flushActiveEditorToDisk(filePath, timeoutMs=2000)`：派 `REQUEST_SAVE_ACTIVE_FILE_EVENT` → 等匹配 `filePath` 的 `SAVE_ACTIVE_FILE_DONE_EVENT` → resolve；**超时也 resolve**（放行读磁盘现状，不阻塞主流程）。审稿/修订读盘前必须先 await 它，确保后端读到的是用户当前看到的内容。壳子重写编辑器区时要保留「监听 request-save → 落盘 → 回派 save-done」这一端。

---

## D. 写回时序不变量（W7 已钉，勿回退）

接受补丁写回走 `performGuardedWriteback`（`src/lib/writeback.ts`）：**快照 → 推进分支头 → 写盘 → 记录**，四步顺序固定；**快照 reject 即阻断 write/record**（不得吞错照写）。Rust `fs.rs::write_file` 是**原子写**（同目录临时文件 + `sync_all` + `rename`），壳子换了但落盘仍走这条 Tauri 命令，别绕过临时文件直接覆盖目标。

会话竞争守卫（W7-F26）：run 起跑时的会话 ≠ 当前活动会话，其结果**不得写回当前会话**（`isRunResultForActiveSession`，`session-guard.ts`）。壳子重写 ChatWindow 时，`runAuthorAgent` 终态块与断线重建回填两处都要过这道守卫。

---

## E. 重连壳子自检清单

- [ ] user_message / 控制消息按 A.1 形状发；控制回执按 A.3 映射后 type 等
- [ ] 六类流帧按 A.2 判别式解码；`agent_result` 作 happy-path settle
- [ ] 超时不硬 reject，转 F10 轮询重建（B）
- [ ] 8 个 DOM 事件名不改；补丁缓冲（C.1）与落盘握手（C.2）两端都在
- [ ] 写回走 `performGuardedWriteback` + 原子 `fs.rs`；会话守卫在两处（D）
- [ ] 跑 `test_ws_contract_golden.py` + `event-bus-contract.vitest.ts` + `writeback-guard` + `agent-session-guard` 全绿
