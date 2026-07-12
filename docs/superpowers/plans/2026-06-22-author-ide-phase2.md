# StoryForge 作者辅助 IDE Phase 2 Plan

生成时间：2026-06-22 21:00:04 +08:00

## 完成状态

完成时间：2026-06-23 00:33:51 +08:00

本阶段已按 Definition of Done 完成本地验收。下方 P0-P7 保留原始计划拆解；实际完成证据以本节和 `.codex/verification-report.md` 的「作者辅助 IDE Phase 2 收口（2026-06-23）」为准。

已落地能力：

- Agent WebSocket 支持 `agent_run_started`、`agent_step`、`tool_trace`、`agent_result`、`error` 事件流，并保持旧单结果协议兼容。
- Desktop Agent 面板支持上下文摘要、文件选择、pin/unpin、预算/截断/缺失提示，Agent payload 带 `context_bundle.budget`。
- Review report issue 支持多选、按 category 过滤、修选中问题和只修本类问题，并继续回显后端 `applied_scope`。
- `PatchReviewPanel` 展示 patch id、文件路径、增删行、模型、assistant session、issue scope；接受前检查当前编辑器内容是否仍等于 `before`，冲突时不写盘。
- Agent 写回后的版本快照与 author-loop 记录包含 patch id、assistant session id、issue ids 和 context files；版本面板支持来源筛选。
- managed Writing Run 通过 `bookrun.start` 兼容入口完成预检/确认两段式，返回章节计划、预算、风险和确认 action；确认后前端订阅 run events 并展示轻量进度。
- Phase 2 smoke 已覆盖流式事件、上下文 pin、issue 多选、patch 冲突保护和版本/author-loop meta。

本轮重跑结果：

- `npm --prefix apps/desktop/frontend run typecheck`：通过。
- `npm --prefix apps/desktop/frontend run test`：20 passed。
- `npm --prefix apps/desktop/frontend run verify:smoke`：Desktop frontend smoke passed。
- `npm --prefix apps/desktop/frontend run verify:agent-conversation`：Agent conversation verification passed。
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py tests/test_ide_run_events.py -q`：24 passed。
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`：通过。
- `node apps/desktop/scripts/verify-tauri-smoke.mjs`：通过；覆盖未确认不写盘、拒绝不写盘、旧 patch 冲突阻止、确认写回、版本 Agent meta 和 author-loop meta。

补充说明：后端 WebSocket 中间事件目前由编排最终结果投影生成，已满足协议与前端可观察性门槛；真实 token 级/工具级实时流可作为后续增强，不影响 Phase 2 DoD。

## 阶段目标

Phase 1 已经证明 StoryForge 能完成作者辅助小说项目 IDE 的最小闭环：本地项目、当前稿、Agent 审稿、定向修订、proposed patch、确认写回和版本记录。

Phase 2 的目标不是重写这条闭环，而是把它从“能跑通”推进到“像日常工具一样好用”：

> 作者在 Desktop IDE 中与 Agent 连续协作；Agent 的思考步骤、工具调用、上下文选择、审稿问题、修订范围和补丁写回都可见、可控、可回溯。长篇、短篇和修订输出统一表现为 Writing Run / 写作任务；长程任务进入 managed 模式并展示轻量进度，但不抢主界面。

## 当前代码事实

- `apps/desktop/frontend/src/components/ChatWindow.tsx` 已负责 Agent 对话、审稿报告渲染、`selected_issue_ids` / `included_categories` 推断、显式 `@文件` 上下文读取和本地确认写回事件。
- `apps/desktop/frontend/src/lib/api-client.ts` 的 `sendAgentUserMessage()` 当前通过 WebSocket 发送一条 `user_message`，收到第一条消息后就关闭连接；它是“一次请求一次最终结果”，还不是持续事件流。
- `apps/api/app/domains/ide/router.py` 的 Agent WebSocket 当前在 `user_message` 后同步调用 `orchestrate_agent_message()`，再发送单个 `agent_result`。
- `apps/api/app/domains/ide/orchestrator.py` 已支持 `chat.explain`、`file.review`、`file.revise`、`chapter.review`、`chapter.repair`、`bookrun.start`，并返回 `plan`、`tool_trace`、`review_report` 和 `proposed_patch`。
- `apps/desktop/frontend/src/components/AgentStepsPanel.tsx` 已能展示 running / waiting / completed / failed 步骤，但多数步骤仍由前端预填或最终结果一次性替换。
- `apps/desktop/frontend/src/lib/project-context.ts` 已能扫描推荐小说目录，生成轻量 context bundle，但 UI 只有 prompt 弹窗和 `@文件` 文本引用，缺少明确上下文选择器。
- `apps/desktop/frontend/src/components/Editor.tsx` 已持有 pending suggestion，接受时会写入版本快照和 author-loop 记录；当前 diff 是 before/after 两栏截断预览，还不是完整补丁审阅工作台。
- `apps/api/app/domains/ide/router.py` 已有 managed Writing Run 的 SSE 快照端点 `/api/ide/runs/{book_run_id}/events`，但 Desktop Agent 尚未把长程写作任务进度作为轻量工具面板接起来。

## 非目标

- 不恢复 `apps/web`。
- 不把 BookRun 控制台重新变成主产品入口。
- 不绕过 proposed patch 和用户确认。
- 不在本阶段重写编辑器、文件树或引入大型前端状态框架。
- 不把真实 3-5 万字长程质量验收混入本阶段；长程质量整改仍按 `docs/internal/TODO.md` 单独推进。

## 用户体验定义

Phase 2 完成后，用户应该能完成这条更自然的路径：

1. 打开 Desktop IDE 和本地小说项目。
2. 在文件树中选择章节。
3. 在 Agent 面板看到当前文件、已选上下文和上下文预算。
4. 通过上下文选择器勾选大纲、人物、设定、时间线或 `@文件`。
5. 发起“审一下当前章”。
6. Agent 步骤实时更新：读取上下文、读取当前稿、多视角审稿、合并结果。
7. 审稿问题以稳定 issue 卡片展示，用户可多选、按 category 筛选或只修某几条。
8. Agent 生成 proposed patch，并展示清楚的修改范围、摘要、风险和来源。
9. 用户可接受、拒绝、保存旁注，或在文件已变化时看到冲突提示。
10. 写回后版本记录、author-loop 记录和对话会话互相可追溯。
11. 用户要求启动长程写作任务时，Agent 先说明章节计划、预算和风险；确认后在轻量 tool trace 中显示进度。

## 架构原则

### 保持 Desktop 本地控制

上下文选择、文件读取、diff 确认、写回和版本记录继续由 Desktop/Tauri 负责。API 不直接写用户本地文件。

### Agent 协议从结果式升级为事件式

继续复用现有 WebSocket，但协议升级为多消息事件流：`agent_run_started`、`agent_step`、`tool_trace`、`agent_result`、`error`。前端不再只能等待最终结果。

### Patch 是独立产品对象

`proposed_patch` 不只是 API 字段，而是 Desktop 里的可审阅对象：有 id、来源、摘要、before/after、文件路径、确认状态、写回记录和冲突保护。

### Writing Run 统一长短任务表达

Agent 可以发起 inline 或 managed Writing Run。UI 只展示轻量计划、预算、状态和事件，不创建新的 BookRun 主控制台；BookRun 保留为 managed full-book run 的内部兼容实现。

## 阶段拆分

### P0. Phase 2 契约与门禁落位

**目标**：把 Phase 2 明确定义为 Agent 交互体验增强，而不是新的产品方向漂移。

**涉及文件**：

- `docs/superpowers/plans/2026-06-22-author-ide-phase2.md`
- `docs/internal/TODO.md`
- `docs/internal/current-phase.md`
- `.codex/verification-report.md`

**任务**：

- [ ] 在 TODO 中把 Desktop IDE Agent 可选增强拆成可执行顺序。
- [ ] 明确 Phase 2 不改变 Phase 1 的写回安全契约。
- [ ] 定义新增验证命令和 smoke 覆盖范围。

**验收**：

- 文档仍明确 `apps/desktop` 是唯一主体验。
- 文档仍明确 Writing Run 是统一输出概念，BookRun 是 managed full-book run 的内部兼容实现。
- 文档没有把真实长程质量验收与 Desktop Agent 体验验收混为一谈。

### P1. Agent WebSocket 事件流

**目标**：让 Agent 步骤从“一次性最终结果”变成可实时观察的过程。

**涉及文件**：

- `apps/api/app/domains/ide/router.py`
- `apps/api/app/domains/ide/orchestrator.py`
- `apps/api/tests/test_ide_agent_orchestrator.py`
- `apps/desktop/frontend/src/lib/api-client.ts`
- `apps/desktop/frontend/src/components/ChatWindow.tsx`
- `apps/desktop/frontend/src/components/AgentStepsPanel.tsx`
- `apps/desktop/frontend/scripts/verify-agent-conversation.mjs`

**任务**：

- [ ] 定义 Agent WebSocket 事件类型：`agent_run_started`、`agent_step`、`tool_trace`、`agent_result`、`error`。
- [ ] 后端在 `user_message` 后先发送 run started，再发送关键步骤事件，最后发送最终 `agent_result`。
- [ ] 前端 `sendAgentUserMessage()` 支持持续接收多条消息，提供 `onEvent` 回调，最终 resolve `agent_result`。
- [ ] `ChatWindow` 用真实事件更新 `AgentStepsPanel`，减少本地假步骤。
- [ ] 保持旧单结果协议兼容，避免已有 smoke 一次性失效。

**验收**：

- API 测试覆盖事件序列和最终结果。
- 前端单测覆盖 `onEvent` 收到 step/tool/result 的状态推进。
- `verify:agent-conversation` 能断言至少一个中间 Agent step 在最终回复前出现。

### P2. 上下文选择器 v1

**目标**：让用户明确知道 Agent 这一轮会读哪些小说资料，而不是靠隐式扫描。

**涉及文件**：

- `apps/desktop/frontend/src/lib/project-context.ts`
- `apps/desktop/frontend/src/components/ChatWindow.tsx`
- `apps/desktop/frontend/src/components/ResourceExplorer.tsx`
- `apps/desktop/frontend/src/components/FileTree.tsx`
- `apps/desktop/frontend/tests/project-context.test.ts`
- `apps/desktop/frontend/scripts/verify-agent-conversation.mjs`

**任务**：

- [ ] 在 Assistant 面板显示当前自动上下文：文件数、类型、预算和相对路径。
- [ ] 增加“添加上下文”入口，替换当前 `window.prompt` 为项目文件选择 UI。
- [ ] 支持 pin/unpin 上下文文件，pin 的文件优先进入 context bundle。
- [ ] 支持 `@文件` 解析失败时显示可见提示，不静默跳过。
- [ ] 为 context bundle 增加预算说明：文件数、字符数、截断状态。

**验收**：

- 单元测试覆盖 pin 文件优先级、预算截断和缺失文件提示。
- smoke 覆盖选择人物/大纲文件后，Agent payload 中出现对应 context file。
- 无当前项目或无当前文件时仍有明确降级文案。

### P3. 审稿问题工作流 v2

**目标**：把 review report 从“展示报告”升级为“可操作问题队列”。

**涉及文件**：

- `apps/desktop/frontend/src/components/ChatWindow.tsx`
- `apps/api/app/domains/ide/orchestrator.py`
- `apps/api/app/domains/ide/review_reasoning.py`
- `apps/api/tests/test_ide_agent_orchestrator.py`
- `apps/desktop/frontend/tests/local-conversation-action.test.ts`

**任务**：

- [ ] 审稿问题卡片支持多选。
- [ ] 增加按 category 过滤：剧情、人物、文风。
- [ ] 增加“修选中问题”动作，直接发送 `selected_issue_ids`。
- [ ] 增加“只修本类问题”动作，发送 `included_categories`。
- [ ] 保留 `lastReviewReport` 与 assistant session 的关联，避免切文件后误用旧报告。
- [ ] 后端继续回显 `applied_scope`，并对未知 issue id 给出明确 dropped 说明。

**验收**：

- 前端测试覆盖多选 issue -> payload。
- API 测试覆盖多 issue、category、未知 id 和跨报告防误用。
- `verify:agent-conversation` 覆盖点击问题动作后发起定向修订。

### P4. Patch 审阅工作台 v1

**目标**：让 proposed patch 成为可认真审阅的写回对象，而不是一块截断 before/after 文本。

**涉及文件**：

- `apps/desktop/frontend/src/components/Editor.tsx`
- `apps/desktop/frontend/src/lib/assistant-suggestions.ts`
- `apps/desktop/frontend/src/lib/versions.ts`
- `apps/desktop/frontend/src/lib/author-loop.ts`
- `apps/desktop/frontend/tests/assistant-events.test.ts`
- `apps/desktop/scripts/verify-tauri-smoke.mjs`

**任务**：

- [ ] 抽出 `PatchReviewPanel`，避免 Editor 继续膨胀。
- [ ] 展示完整差异摘要：新增/删除行数、文件路径、来源模型、issue scope。
- [ ] before/after 预览支持展开全文，不只固定截断到 2400 字符。
- [ ] 接受前检查当前编辑器内容是否仍等于 `suggestion.before`；若不一致，提示需要重新生成或手动处理冲突。
- [ ] 拒绝 patch 时记录原因入口，但不写回正文。
- [ ] 写回后在版本记录中可看到 Agent 来源、patch id、session id 和摘要。

**验收**：

- 单元测试覆盖冲突检测、拒绝不写盘、接受记录 patch id。
- Tauri smoke 覆盖文件变化后旧 patch 被阻止直接写回。
- Phase 1 的确认写回防重复生成测试继续通过。

### P5. managed Writing Run 轻量进度

**目标**：允许 Agent 启动 managed Writing Run，并用 tool trace 展示计划、预算和进度，但不新增 BookRun 主控制台。

**涉及文件**：

- `apps/api/app/domains/ide/orchestrator.py`
- `apps/api/app/domains/ide/service.py`
- `apps/api/app/domains/ide/router.py`
- `apps/api/tests/test_ide_agent_orchestrator.py`
- `apps/desktop/frontend/src/lib/api-client.ts`
- `apps/desktop/frontend/src/components/ChatWindow.tsx`
- `apps/desktop/frontend/src/components/AgentStepsPanel.tsx`

**任务**：

- [ ] `bookrun.start` 在启动前返回计划、预算和风险摘要。
- [ ] 高风险或长预算写作任务需要用户二次确认。
- [ ] 成功启动后返回 `book_run_id`，前端可订阅 `/api/ide/runs/{book_run_id}/events`。
- [ ] Agent 面板展示写作任务轻量进度：章节数、状态、最近事件、失败原因。
- [ ] managed Writing Run 失败不影响当前编辑器草稿和 pending patch。

**验收**：

- API 测试覆盖预算摘要、二次确认和 `book_run_id`。
- 前端 mock SSE 覆盖 managed Writing Run progress 渲染。
- 不新增 BookRun 主页面或 Web 入口。

### P6. 会话、版本和作者闭环串联

**目标**：让一次 Agent 协作从对话、审稿、补丁、写回到版本记录可追溯。

**涉及文件**：

- `apps/desktop/frontend/src/components/ChatWindow.tsx`
- `apps/desktop/frontend/src/components/HistoryPanel.tsx`
- `apps/desktop/frontend/src/components/Editor.tsx`
- `apps/desktop/frontend/src/lib/author-loop.ts`
- `apps/desktop/frontend/src/lib/versions.ts`
- `apps/api/app/domains/assistant/service.py`

**任务**：

- [ ] 对话中显示当前 assistant session 与最近 Agent 操作摘要。
- [ ] author-loop 记录 patch id、assistant session id、issue ids 和上下文文件摘要。
- [ ] 版本记录面板能按来源筛选：Editor 手动保存 / Agent 写回。
- [ ] 从版本记录能看到 Agent 修订摘要和关联 session id。
- [ ] 切换文件时清理不匹配的 pending suggestion 和 last review report。

**验收**：

- 单元测试覆盖 author-loop meta 字段。
- Tauri smoke 覆盖 Agent 写回后的版本 meta。
- UI smoke 覆盖切文件后不会把旧 review report 用到新文件。

### P7. 验证门禁

**目标**：Phase 2 的每个增强都要落到本地可重复验证，不靠人工点击记忆。

**涉及文件**：

- `apps/desktop/frontend/scripts/verify-agent-conversation.mjs`
- `apps/desktop/scripts/verify-tauri-smoke.mjs`
- `apps/api/tests/test_ide_agent_orchestrator.py`
- `.codex/verification-report.md`

**任务**：

- [ ] 升级 `verify-agent-conversation`，覆盖流式事件、上下文选择和 issue 多选。
- [ ] 升级 `verify-tauri-smoke`，覆盖 patch 冲突保护和版本 meta。
- [ ] API 测试覆盖 Agent 事件协议、managed Writing Run 工具计划和修订范围。
- [ ] 将 Phase 2 验收结果写入 `.codex/verification-report.md`。

**验收命令**：

```powershell
cd D:/StoryForge
npm --prefix apps/desktop/frontend run typecheck
npm --prefix apps/desktop/frontend run test
npm --prefix apps/desktop/frontend run verify:smoke
npm --prefix apps/desktop/frontend run verify:agent-conversation
cd apps/api
uv run pytest tests/test_ide_agent_orchestrator.py -q
cd D:/StoryForge
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
node apps/desktop/scripts/verify-tauri-smoke.mjs
```

## 推荐执行顺序

1. P1：先改 Agent WebSocket 事件协议，保证过程可见。
2. P2：再补上下文选择器，让 Agent 输入可控。
3. P3：把审稿问题变成可操作队列。
4. P4：升级 patch 审阅，守住写回安全。
5. P6：串联 session、版本和 author-loop。
6. P5：最后接 managed Writing Run 轻量进度，避免长程任务抢主线。
7. P7：每完成一块就升级对应 smoke，最后统一记录验收。

## Phase 2 Definition of Done

必须同时满足：

1. Agent WebSocket 支持中间事件，前端能实时展示步骤。
2. 用户能显式选择或 pin 本轮上下文文件。
3. Agent payload 可见地包含当前文件、选中上下文和预算信息。
4. 审稿 issue 支持多选、按类修订和未知 id 反馈。
5. proposed patch 有完整审阅面板、冲突保护和拒绝路径。
6. 确认写回仍只在 Desktop/Tauri 本地发生。
7. 写回后版本记录和 author-loop 能追溯 patch、session、issue 和上下文。
8. managed Writing Run 可展示计划、预算和轻量进度，但 BookRun 不变成主入口。
9. Phase 1 所有验收命令继续通过。
10. 新增 Phase 2 smoke 和测试结果写入 `.codex/verification-report.md`。

## 成功标准

Phase 2 完成后，StoryForge 可以对内宣称：

> StoryForge 不只具备作者辅助小说项目 IDE 的最小闭环，还具备可观察、可控、可追溯的 Agent 协作体验：流式步骤、显式上下文、问题队列、补丁审阅、版本/作者闭环和 Writing Run 进度。

仍然不能宣称：

- 稳定生产级长篇自动生成质量已经通过。
- 真实 3-5 万字长程人工通读已经验收。
- managed Writing Run 已经成为成熟主产品控制台。
