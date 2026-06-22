# StoryForge Cursor for Fiction Phase 1 Plan

生成时间：2026-06-22 +08:00

## 完成状态

完成时间：2026-06-22 20:56:33 +08:00

本阶段已按 Definition of Done 重新验收通过。下方 P0-P6 保留原始计划拆解；实际完成证据以本节和 `.codex/verification-report.md` 的「Cursor for Fiction Phase 1 收口（2026-06-22）」为准。

本轮重跑结果：

- `npm --prefix apps/desktop/frontend run typecheck`：通过。
- `npm --prefix apps/desktop/frontend run test`：15 passed。
- `npm --prefix apps/desktop/frontend run verify:smoke`：Desktop frontend smoke passed。
- `npm --prefix apps/desktop/frontend run verify:agent-conversation`：通过，Agent conversation verification passed。
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py -q`：17 passed。
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`：通过。
- `node apps/desktop/scripts/verify-tauri-smoke.mjs`：通过；覆盖临时小说项目、未确认不写盘、确认后真实写回、版本快照和 author-loop 记录。

补充说明：Tauri smoke 构建期间仍有 Monaco chunk 体积提示和 Chromium 退出清理日志，命令退出码为 0，不阻塞 Phase 1 验收。

## 目标

把 StoryForge 第一阶段收口为“面向小说项目的 Cursor”：

> 用户打开一个本地小说项目，在 Desktop IDE 中编辑稿件；Agent 能理解当前文件和项目上下文，进行审稿、解释、定向修订和续写；所有写入先生成 diff / proposed patch，用户确认后才写回本地文件，并留下版本记录。

本阶段不以 BookRun 控制台为主入口。BookRun、Judge、Repair、Story Memory、导出等能力作为 Agent 可调用工具存在。

## 当前代码事实

- `apps/desktop/frontend/src/App.tsx` 已经是 Cursor/Codex-like shell，包含本地项目、文件树、编辑器、Assistant 面板、布局切换和 Tauri 菜单事件。
- `apps/desktop/frontend/src/components/ChatWindow.tsx` 承接 Agent 对话、工具步骤和 proposed patch 展示。
- `apps/desktop/frontend/src/components/Editor.tsx` 承接当前文件读取、编辑、保存和写回。
- `apps/desktop/frontend/src/components/ResourceExplorer.tsx` 承接本地项目文件树。
- `apps/api/app/domains/ide/orchestrator.py` 已支持 `chat.explain`、`file.review`、`file.revise`、`chapter.review`、`chapter.repair`、`bookrun.start`。
- `file.revise` 已返回 `proposed_patch`，并标记 `requires_user_confirmation=True`，方向正确。
- `apps/api/tests/test_ide_agent_orchestrator.py` 已覆盖 file review、file revise、scope 选择、confirm writeback 防误判、chapter review 和 bookrun.start。
- `apps/desktop/frontend/scripts/verify-agent-conversation.mjs` 已是 Desktop Agent 对话链路验证入口，但真实 Tauri 写回端到端仍未完成。

## 非目标

- 不恢复 `apps/web` 作为主体验。
- 不把 BookRun 页面化为第一优先级。
- 不先做完整自动长篇生产闭环。
- 不在本阶段引入新微服务或新大型前端状态框架。
- 不让 Agent 直接静默写本地文件；所有写入必须可预览、可确认、可拒绝。

## 用户体验定义

第一阶段完成后，用户应该能完成这条路径：

1. 启动 `pnpm dev` 打开 Desktop IDE。
2. 打开一个本地小说项目目录。
3. 在文件树中选择章节 Markdown。
4. 在编辑器查看和修改当前稿件。
5. 在 Agent 面板发起“审稿当前章节”。
6. Agent 返回剧情、人物、文风三类问题，并保留稳定 issue id。
7. 用户说“只修第 2 条”或“只修人物问题，保留结尾”。
8. Agent 生成 proposed patch / diff，不直接写入。
9. 用户确认后写回本地文件。
10. 写回后产生版本记录，能看到本次修改来源。

## 架构原则

### Desktop 是产品主入口

Desktop 负责本地项目、文件树、编辑器、对话、diff 确认、写回和版本记录。

### API 是 Agent 能力层

API 负责意图识别、审稿推理、修订生成、工具审计和后端能力调用。API 不直接操作用户本地文件。

### Tauri 是本地写回层

Tauri/前端负责读取和写入本地文件。API 只能返回 proposed patch。

### Workflow 是后台重型引擎

BookRun 和长程生成不再作为第一屏主流程，而是 Agent 可以调用的工具。

## 阶段拆分

### P0. 锁定 Cursor for Fiction 产品契约

**目标**：让文档、README 和当前阶段事实都不再把 StoryForge 描述成 Web 控制台或自动出书机优先。

**涉及文件**：

- `docs/architecture/ide-first-product-direction.md`
- `docs/internal/current-phase.md`
- `README.md`
- `docs/internal/TODO.md`

**任务**：

- [ ] 明确写入“StoryForge = Cursor for Fiction”。
- [ ] 明确 `apps/desktop` 是唯一主体验。
- [ ] 明确 BookRun 是 Agent tool / 后台引擎。
- [ ] 明确第一阶段验收链路是本地文件审稿、修订、diff 确认、写回、版本记录。

**验收**：

- 文档中不再把旧 Web 或 BookRun 控制台描述成主产品入口。
- README 的当前边界与 `docs/internal/current-phase.md` 一致。

### P1. Desktop 本地项目与上下文入口收口

**目标**：Agent 每次对话都能稳定知道当前项目、当前文件、选区、文件内容和可选项目上下文。

**涉及文件**：

- `apps/desktop/frontend/src/App.tsx`
- `apps/desktop/frontend/src/components/ChatWindow.tsx`
- `apps/desktop/frontend/src/components/Editor.tsx`
- `apps/desktop/frontend/src/lib/project-context.ts`
- `apps/desktop/frontend/src/lib/local-conversation-action.ts`
- `apps/desktop/frontend/tests/project-context.test.ts`
- `apps/desktop/frontend/tests/local-conversation-action.test.ts`

**任务**：

- [ ] 固化 Agent 请求中的 `projectPath`、`currentFile`、`content`、`selection`、`assistant_session_id`。
- [ ] 为当前文件上下文建立稳定 payload，不让 ChatWindow 临时拼散字段。
- [ ] 允许用户显式添加项目上下文：大纲、人物、设定、世界观、时间线。
- [ ] 为“无当前文件”和“无项目目录”提供明确降级行为。

**验收**：

- 单元测试覆盖当前文件、选区、项目路径、缺文件降级。
- `verify:agent-conversation` 能显示 Agent 正确拿到当前文件内容。

### P2. Agent 审稿报告产品化

**目标**：file.review 成为小说 Cursor 的核心能力，而不是后端测试里的结构化对象。

**涉及文件**：

- `apps/api/app/domains/ide/orchestrator.py`
- `apps/api/app/domains/ide/review_reasoning.py`
- `apps/api/app/domains/ide/review_skills.py`
- `apps/api/tests/test_ide_agent_orchestrator.py`
- `apps/desktop/frontend/src/components/ChatWindow.tsx`
- `apps/desktop/frontend/src/components/AgentStepsPanel.tsx`

**任务**：

- [ ] 保持三视角审稿：剧情、人物、文风。
- [ ] 稳定 issue id：如 `plot-1`、`character-1`、`prose-1`。
- [ ] 每条问题必须包含 category、severity、message、evidence、suggested action。
- [ ] 前端展示审稿报告时支持按问题选择修订。
- [ ] 未配置 LLM 时继续启发式预扫，但界面必须明确标识。

**验收**：

- API 测试覆盖 LLM、mixed、heuristic、llm_failed 四种模式。
- 前端测试覆盖报告渲染、问题选择和“只修第 N 条”的输入路径。

### P3. Proposed Patch 与 Diff 确认链路

**目标**：所有写入必须走 proposed patch；用户确认后才写回。

**涉及文件**：

- `apps/api/app/domains/ide/orchestrator.py`
- `apps/api/app/domains/assistant/service.py`
- `apps/desktop/frontend/src/components/ChatWindow.tsx`
- `apps/desktop/frontend/src/components/Editor.tsx`
- `apps/desktop/frontend/src/lib/assistant-events.ts`
- `apps/desktop/frontend/tests/assistant-events.test.ts`
- `apps/desktop/frontend/tests/local-conversation-action.test.ts`

**任务**：

- [ ] `file.revise` 只返回 `proposed_patch.kind=file_revision`。
- [ ] proposed patch 必须包含 before、after、file_path、requires_confirmation。
- [ ] 前端 diff 预览必须清楚展示修改范围。
- [ ] “确认写回 / 应用补丁 / 接受修订”不能重新触发 revise。
- [ ] 拒绝 patch 后不修改本地文件。

**验收**：

- API 测试覆盖确认短语不会被识别为 revise。
- 前端测试覆盖 accept event。
- Desktop smoke 覆盖 patch 出现但未确认时文件未变化。

### P4. Tauri 真实写回与版本记录

**目标**：跑通真实桌面端到端：打开文件 -> Agent 修订 -> diff 确认 -> 写回 -> 版本记录。

**涉及文件**：

- `apps/desktop/src-tauri/src/fs.rs`
- `apps/desktop/src-tauri/src/watcher.rs`
- `apps/desktop/frontend/src/lib/tauri-fs.ts`
- `apps/desktop/frontend/src/components/Editor.tsx`
- `apps/desktop/frontend/src/components/HistoryPanel.tsx`
- `apps/desktop/scripts/verify-tauri-smoke.mjs`
- `apps/desktop/frontend/scripts/verify-smoke.mjs`

**任务**：

- [ ] 确认写回前创建版本快照。
- [ ] 写回成功后刷新 Editor 内容和文件树状态。
- [ ] 写回失败时保留 proposed patch，不丢用户草稿。
- [ ] HistoryPanel 展示写回来源：Agent、时间、文件、摘要。
- [ ] 增加真实 Tauri smoke：创建临时项目、打开文件、触发修订、确认写回、验证磁盘内容变化。

**验收**：

- `pnpm desktop:dev` 下人工可跑通完整路径。
- `apps/desktop/scripts/verify-tauri-smoke.mjs` 覆盖真实写回。
- `.codex/verification-report.md` 记录真实 Tauri 端到端结果。

### P5. 小说项目索引 v1

**目标**：让 Agent 像 Cursor 理解代码库一样理解小说项目的基本结构。

**涉及文件**：

- `apps/desktop/frontend/src/lib/project-context.ts`
- `apps/api/app/domains/ide/orchestrator.py`
- `apps/api/app/domains/assistant/schemas.py`
- `apps/desktop/frontend/tests/project-context.test.ts`

**任务**：

- [ ] 约定推荐项目目录：`正文/`、`大纲/`、`人物/`、`设定/`、`时间线/`、`伏笔/`。
- [ ] 扫描 Markdown 文件并生成轻量 context bundle。
- [ ] 对当前文件同目录、项目大纲、人物卡做优先注入。
- [ ] 控制 context bundle 大小，避免整项目全文塞入。
- [ ] UI 提供 `@文件` 或“添加上下文”的最小入口。

**验收**：

- 单元测试覆盖项目结构初始化和 context bundle 生成。
- Agent 审稿报告能显示使用了哪些上下文文件。

### P6. Agent Tool 化 BookRun

**目标**：BookRun 保留，但从主入口转为 Agent 可调用工具。

**涉及文件**：

- `apps/api/app/domains/ide/orchestrator.py`
- `apps/api/app/domains/ide/service.py`
- `apps/api/app/domains/book_runs/service.py`
- `apps/api/tests/test_ide_agent_orchestrator.py`
- `apps/desktop/frontend/src/components/ChatWindow.tsx`

**任务**：

- [ ] 保留 `bookrun.start` intent。
- [ ] Agent 启动 BookRun 前必须说明将生成哪些章节、预算是多少。
- [ ] 高风险 BookRun 操作需要用户确认。
- [ ] BookRun 进度以 Agent tool trace 或轻量面板展示，不抢主界面。

**验收**：

- API 测试覆盖 bookrun.start 复用 command registry。
- 前端能展示 BookRun 工具调用结果和失败原因。

## 推荐执行顺序

1. P0：先改文档契约，统一产品目标。
2. P1：收口 Desktop -> Agent 请求上下文。
3. P2：把审稿报告做成用户可用对象。
4. P3：把 proposed patch / diff 确认链路打牢。
5. P4：跑通真实 Tauri 写回和版本记录。
6. P5：补小说项目索引 v1。
7. P6：把 BookRun 工具化，避免它重新变成主入口。

## 第一阶段 Definition of Done

必须同时满足：

1. 用户可在 Desktop 中打开本地小说项目。
2. 用户可选择 Markdown 章节并在编辑器中查看。
3. Agent 可基于当前文件和项目上下文完成三视角审稿。
4. 用户可按 issue id 或 category 指定修订范围。
5. Agent 返回 proposed patch，而不是直接写文件。
6. 用户确认后真实写回本地文件。
7. 写回前后有版本记录。
8. `confirm writeback` 类短语不会重新触发 LLM 修订。
9. 本地验证通过：

```powershell
cd D:/StoryForge
npm --prefix apps/desktop/frontend run typecheck
npm --prefix apps/desktop/frontend run test
npm --prefix apps/desktop/frontend run verify:smoke
npm --prefix apps/desktop/frontend run verify:agent-conversation
cd apps/api
uv run pytest tests/test_ide_agent_orchestrator.py -q
```

10. 真实 Tauri 端到端结果写入 `.codex/verification-report.md`。

## 成功标准

这一阶段成功后，StoryForge 可以对内宣称：

> StoryForge 已具备 Cursor-like 小说项目 IDE 的最小闭环：本地文件编辑、Agent 审稿、定向修订、diff 确认、真实写回和版本记录。

仍然不能宣称：

- 稳定生产级长篇自动生成闭环完成。
- 真实 3-5 万字长程质量验收通过。
- BookRun 已成为成熟批量生产系统。
