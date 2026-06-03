# StoryForge Assistant 完整工作流实施计划

> **给执行代理的要求：** 实施本计划时必须使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 按任务推进。每个任务完成后必须本地验证并更新 `.codex/verification-report.md`。

**目标：** 将当前 StoryForge 首页从“输入优先的入口界面”升级为真正能执行创作任务的 StoryForge Assistant 工作流对话台，最终支持创作目标分析、Blueprint、章节生成、质量审阅、修复建议、批准写回、导出审计、多轮调整、可追溯会话，以及从三章试读扩展到短篇、中篇、长篇分卷的连续生产能力。

**架构：** 总体采用“对话台前端 + 现有业务能力工具化 + 轻量 Assistant 编排适配层”的方式。前端继续复用 `HomeShell`、`HomeComposer`、`AssistantToolTree`、`HomeSidebar`、`HomeProjectsPanel`、`ArtifactsPageContent` 和首页 `projects` 子视图；后端优先复用 `CreativeToolRegistry`、`Runtime Tools`、`Novel Skill Registry`、`BookRun`、`Judge`、`Repair`、`Artifacts`、`Provider Gateway` 和 `api-client`，只在缺少统一会话、工具调用记录或任务编排契约时补薄层，不新增大而全 Agent 框架。

**技术栈：** Next.js App Router、React Server/Client Components、TypeScript、Node test、FastAPI、SQLAlchemy、pytest、BookRun、Runtime Tools、StoryForge OpenAPI 契约。

---

## 0. 当前完成度对账

生成时间：2026-06-02 11:28:16 +08:00。

本计划已进入“核心闭环已落地，产品化能力继续推进”的状态。后续执行者必须先按本节核对现状，再决定是否从剩余清单继续实施。

### 0.1 已完成并通过本地验证

- Assistant 首页对话台骨架已经接入，包含 `AssistantConversation`、`AssistantMessageList`、`AssistantActionBar` 和 `HomeShell` 集成。
- 静态成功工具树已下线，`AssistantToolTree` 只消费传入的真实 `toolNodes`。
- 确定性意图解析已经支持生成类、章节审阅、导出类、章节数、目标字数、分批和续写模式。
- Blueprint / BookRun 创建链路已经消费 Assistant intent，不再固定三章雾港样例。
- BookRun 工具树映射、工具事件解析、暂停、恢复、停止、重试和查看审计入口已经接入。
- BookRun 后端已经补充 pause、stop、retry 原生端点，并刷新 OpenAPI 契约。
- Assistant 会话后端薄层已经创建，包含 session/message schema、service、router、ORM 模型和 Alembic 迁移。
- `submitStudioApproval()` 的 Server Action redirect 控制流已修复，避免把成功跳转误判为失败。
- 最新本地核心门禁快照显示：2026-06-03 `pnpm verify` 通过，Web 契约测试 209 passed，API 单元测试 376 passed（6 warnings），Workflow 单元测试 164 passed，API/Workflow Ruff、OpenAPI 漂移检查均通过；该快照不包含真实外部 LLM 10 章或 3-5 万字长程验收。
- 最新浏览器与 E2E 复验显示：2026-06-03 `pnpm --filter @storyforge/web verify:browser-session` 通过，真实 Chromium 覆盖 Assistant 连续会话提交、URL 参数保留和刷新后 hidden input 恢复；`pnpm --filter @storyforge/web verify:settings-browser` 通过；`pnpm e2e` 通过，OpenAPI refresh/drift passed、Node 合约 28 passed、API verification 59 passed、Workflow verification 37 passed。该复验不读取 `.env`，不运行真实外部 LLM，不代表真实 LLM 长程验收完成。

### 0.2 已完成本地闭环但仍有限制

- 首页最近记录已从 `/api/assistant/sessions` 读取真实 Assistant 会话，并能携带 `assistant_session_id`、`book_run_id`、`artifact_id`、`blueprint_id` 回到 Assistant 上下文；`GET /api/assistant/sessions/{id}` 详情端点和前端 `readAssistantSession()` 历史消息恢复已补齐。限制是该能力只证明本地 Assistant 会话恢复，不代表真实外部 LLM 长程产物验收。
- 章节修订审阅、Repair Patch 和批准写回已接入 Assistant 对话内编排：自然语言章节定位、真实 `scene_packet_id` 定位、Judge/Repair 主动创建和 Studio 写回均有本地测试证据；限制是缺少真实 `book_id` 时仍提示选择作品，不伪造默认作品。
- 导出审计报告链路已能基于 completed BookRun 导出 Markdown、EPUB、audit_report.json，并在消息流展示制品摘要、版本、关联 BookRun 和 Artifacts 下载摘要提示；限制是该闭环只证明本地 completed BookRun 导出，不代表真实外部 LLM 长程产物验收。
- Provider、预算和安全门禁已接入 Assistant 工具树和 settings 本地浏览器验证：Provider 不可用不伪装运行或完成，token/time/chapter 预算触顶会暂停并展示原因，Provider 设置页不把凭据写入普通前端状态；限制是真实供应商连通性和真实外部 LLM 长程验收仍需独立证据。

### 0.3 尚未完成且禁止提前宣称

- deterministic/mock 10 章短篇 BookRun 和 3-5 万字短篇导出已有本地测试证据；真实 LLM 证据仍未完成。
- 真实 LLM 10 章或 3-5 万字短篇尚未稳定验收。
- 长篇分卷 dispatch 前 readiness gate 已要求 Story Memory、Character Bible、Timeline 和 Foreshadow 四类证据；真实跨卷生产、质量门禁和人工通读仍未完成。
- 当前真实 LLM 证据只覆盖 1 章和 3 章冒烟；长篇稳定生产能力不得对外宣称。

### 0.4 继续执行前置门禁

- 必须先阅读 `.codex/context-summary-storyforge-assistant-workflow.md`、`.codex/operations-log.md` 和 `.codex/verification-report.md` 的最新段落。
- 必须运行目标任务相关的定向测试，失败时先修测试或实现，不允许只更新文档跳过失败。
- 涉及后端 schema、router 或模型时必须同步 OpenAPI、Alembic 或 ORM 漂移验证。
- 涉及真实 LLM 时必须设置 token、时间、章节预算，并把产物 ID、审计报告 ID 和模型风险写入 `.codex/verification-report.md`。

---

## 1. 总体范围

### 1.1 最终要做到

- 用户可以在首页输入自然语言创作任务，例如“三章试读生成”“生成 10 章短篇”“继续写下一卷”“修订第二章”“导出审计报告”。
- Assistant 在消息流中确认目标、展示计划、执行工具、回显进度、显示失败原因和下一步操作。
- 工具流程树展示真实状态，不伪造完成节点。
- 三章试读生成链路只是早期验收样本；总计划必须继续支持多章节短篇、中篇和长篇分卷 BookRun。
- 生成链路能从用户意图进入 Blueprint、章节计划、BookRun、Judge、Repair、Artifacts，并按章节预算和分批调度扩展。
- 章节修订审阅链路能读取章节、Judge 问题、Repair Patch，并支持批准写回。
- 导出审计报告链路能读取 completed BookRun，导出 Markdown、EPUB、audit_report.json，并展示制品追溯。
- 最近记录、当前项目、产物入口来自真实 API 或明确的本地草稿状态。
- Provider、凭据、预算、暂停、重试、失败恢复和审计留痕都有可验证边界。

### 1.2 不做的事情

- 不做纯视觉假演示。
- 不用静态成功数据冒充真实执行。
- 不新增脱离现有 `Runtime Tools` / `BookRun` / `Artifacts` 的大型 Agent 平台。
- 不把 API Key 明文保存在普通前端状态或创作偏好里。
- 不一次性重构所有 Studio、Runs、Artifacts 页面。
- 不承诺真实 LLM 长篇稳定生产，除非完成对应真实运行证据和人工通读门禁。

---

## 2. 现有事实源

### 2.1 已有前端入口

- `apps/web/app/page.tsx`：首页入口，负责解析 `searchParams` 并渲染 `HomeShell`。
- `apps/web/components/home/HomeShell.tsx`：首页外壳，当前负责 Assistant 首屏、Projects、Artifacts 子视图。
- `apps/web/components/home/HomeComposer.tsx`：底部输入框，计划初始基线中提交后通过 `view=projects&intent=...` 进入 Projects 子视图；后续实现已开始接入 Assistant 任务提交。
- `apps/web/components/home/HomeProjectsPanel.tsx`：当前项目与本地项目列表入口，`New project` 已并入 Projects。
- `apps/web/components/home/AssistantToolTree.tsx`：工具流程树展示组件，计划初始基线曾消费静态 `assistantToolNodes`；后续实现要求只消费真实传入节点。
- `apps/web/components/home/HomeSidebar.tsx`：左侧导航、最近记录、工作区菜单。
- `apps/web/components/home/home-data.ts`：首页导航和文案事实源；静态成功工具节点必须保持下线。
- `apps/web/components/home/home-view.ts`：首页 view query 契约，当前只保留 `assistant`、`projects`、`artifacts`，旧 `new-project` 会重定向到 `projects`。

### 2.2 已有业务能力

- `apps/web/app/blueprints/api.tsx`：Blueprint 创建、锁定、章节计划、BookRun 启动的 Server Action 与请求 helper。
- `apps/web/lib/api-client.ts`：统一 API 请求入口，注入 `X-StoryForge-API-Key` 并使用 `cache: "no-store"`。
- `apps/api/app/domains/book_runs/router.py`：BookRun 创建、读取、恢复、进度回填、导出 Markdown/EPUB/审计报告。
- `apps/api/app/domains/runtime_tools/router.py`：对外暴露 `CreativeToolRegistry` 的运行时工具清单。
- `apps/workflow/storyforge_workflow/tools/registry.py`：创作工具静态注册表，已有 `retrieval.search`、`scene_packets.assemble`、`judge.create_issues`、`repair.create_patch`、`artifacts.create`、`evaluations.create_run`、`provider_gateway.resolve`。
- `apps/workflow/storyforge_workflow/skills/definitions.py`：小说技能注册表，已有 `generate`、`judge`、`repair`、`approve`、`memory_extract`、`export` 和题材技能包。
- `apps/api/app/domains/studio/router.py`、`judge/router.py`、`repair/router.py`：章节审阅、修复和批准写回相关能力。
- `apps/api/app/domains/artifacts/router.py`：制品列表、详情和下载摘要。
- `apps/web/app/settings/ProviderSettingsPanel.tsx` 与 `apps/web/app/api/provider-models`：Provider 端点检测。

### 2.3 已有测试模式

- `apps/web/tests/home-page.test.tsx`：首页契约测试，偏字符串与组件结构检查。
- `apps/web/tests/book-runs.test.tsx`：BookRun 面板和导出 helper 测试。
- `apps/web/tests/api-client.test.ts`：API client 行为测试。
- `apps/api/tests/test_runtime_tools.py`：运行时工具清单和工具契约测试。
- `apps/workflow/tests/test_novel_skill_registry.py`：小说技能注册表测试。
- `apps/api/tests/test_book_runs.py`、`test_book_exporter.py`：BookRun 与导出契约测试。

---

## 3. 目标架构

### 3.1 核心原则：复用功能作为工具调用

Assistant 不直接重写业务流程，而是把现有能力包装成可调用工具：

| Assistant 工具名 | 复用能力 | 事实源 |
| --- | --- | --- |
| `provider_gateway.resolve` | Provider 能力解析和凭据状态 | `CreativeToolRegistry`、`/api/runtime-tools`、Provider Gateway |
| `goal.analyze` | 前端确定性意图解析和后续 LLM 意图增强 | `assistant-intent.ts`、Assistant 会话 |
| `blueprint.create` | Blueprint 创建、锁定、章节计划 | `apps/web/app/blueprints/api.tsx`、`/api/blueprints` |
| `book_run.start` | BookRun 启动和 workflow dispatch payload | `/api/book-runs` |
| `book_run.progress` | BookRun 状态、checkpoint、预算 | `/api/book-runs/{book_run_id}` |
| `book_run.pause` | 暂停 BookRun | `pause_book_run`，新增原生 BookRun API |
| `book_run.resume` | 恢复 BookRun | `/api/book-runs/{book_run_id}/resume` |
| `book_run.stop` | 停止 BookRun | `stop_book_run`，新增原生 BookRun API |
| `retrieval.search` | 检索资料和证据 | `CreativeToolRegistry`、Retrieval API |
| `scene_packets.assemble` | 组装场景上下文包 | `CreativeToolRegistry`、Scene Packet API |
| `chapter.generate` | 章节生成技能 | `Novel Skill Registry`、BookRun / workflow |
| `judge.create_issues` | 质量审阅 | `CreativeToolRegistry`、Judge API |
| `repair.create_patch` | 修复建议 | `CreativeToolRegistry`、Repair API |
| `approval.apply` | 批准写回 | Studio approve API |
| `artifacts.create` | 制品创建 | `CreativeToolRegistry`、Artifacts API |
| `artifact.export` | Markdown、EPUB、审计报告导出 | BookRun export API |
| `evaluations.create_run` | 质量评测运行 | `CreativeToolRegistry`、Evaluations API |

创新点不在于重新实现这些能力，而在于：

- 用对话把多个既有能力串成可理解的创作流程。
- 用工具流程树把执行过程、证据、成本、等待批准和失败恢复展示出来。
- 用 Assistant 会话把 Blueprint、BookRun、Judge、Repair、Artifact 串成同一条可追溯故事线。
- 用题材技能包把“悬疑线索公平性”“玄幻战力自洽”“言情关系推进”等专业能力变成可选择工具。

### 3.2 前端分层

```text
HomePage
  └─ HomeShell
      ├─ HomeSidebar
      ├─ AssistantConversation
      │   ├─ AssistantMessageList
      │   ├─ AssistantToolTree
      │   └─ AssistantActionBar
      └─ HomeComposer

前端适配层
  ├─ assistant-types.ts
  ├─ assistant-intent.ts
  ├─ assistant-tool-node-mapper.ts
  ├─ assistant-tool-catalog.ts
  ├─ assistant-tool-call.ts
  ├─ assistant-session-store.ts
  └─ assistant-actions.ts
```

### 3.3 后端分层

```text
现有 API
  ├─ /api/runtime-tools
  ├─ /api/blueprints
  ├─ /api/book-runs
  ├─ /api/studio/*
  ├─ /api/judge/*
  ├─ /api/repair/*
  └─ /api/artifacts/*

后续薄层
  ├─ /api/assistant/sessions
  ├─ /api/assistant/sessions/{session_id}/messages
  ├─ /api/assistant/sessions/{session_id}/tool-calls
  └─ /api/assistant/sessions/{session_id}/events
```

后续薄层只负责会话、消息、任务路由、工具调用记录和审计引用，不负责重写创作业务逻辑。

### 3.4 数据流

```text
用户输入
  → Assistant intent 解析
  → 选择工作流类型
  → 查询 Runtime Tools / Novel Skill Registry
  → 生成工具调用计划
  → 调用现有业务 API 或 BookRun 原生控制 API
  → 写入 BookRun / Studio / Artifact 真相源
  → 记录 AssistantToolCall
  → 读取 BookRunRead / Artifact / Judge / Repair 结果
  → 映射 AssistantToolNode
  → 消息流展示结果、按钮和下一步
```

### 3.5 工具调用生命周期

```text
planned → running → completed
                  ↘ failed
                  ↘ needs_approval
                  ↘ paused
```

每次工具调用必须记录：

- `tool_name`
- `input_summary`
- `output_summary`
- `status`
- `started_at`
- `finished_at`
- `elapsed_ms`
- `token_usage`
- `cost_estimate`
- `evidence_refs`
- `error_message`
- `related_ids`

前端工具树只展示摘要，完整证据进入审计报告或详情面板。

---

## 4. 阶段路线图

### Phase 0：计划、上下文和验证基线

**目标：** 形成可执行总计划，确认当前首页、Runtime Tools、Novel Skills、BookRun、Artifacts 和测试基线。

**交付物：**

- 本计划文档。
- `.codex/context-summary-storyforge-assistant-workflow.md`。
- `.codex/operations-log.md` 更新。
- `.codex/verification-report.md` 更新。

**验收：**

- 文档覆盖完整路线，而不是只覆盖第一版。
- 明确复用现有模块和真实事实源。
- 无空白条目、无临时任务描述。

### Phase 1：对话台骨架和静态数据下线

**目标：** 首页从单输入首屏变为对话台布局，但仍不伪造真实执行。

**实现内容：**

- 新增 `AssistantConversation`，负责消息流结构。
- 新增 `AssistantMessageList`，展示用户消息、Assistant 消息和工具树容器。
- 改造 `HomeComposer`，提交后在同一页展示用户消息和 Assistant 接收消息。
- 将 `home-data.ts` 中的静态工具树改为仅用于测试 fixture 或移除。
- 左侧快捷入口调整为真实任务类型：
  - 新的创作对话
  - 三章试读生成
  - 章节修订审阅
  - 导出审计报告

**不做：**

- 不宣称真实生成已完成。
- 不接真实 LLM。

**验收：**

- 首页首屏是对话台。
- 输入消息后显示用户消息和 Assistant 确认消息。
- 没有默认展示静态“已完成”工具树。

### Phase 2：试读生成主链路

**目标：** 用户一句话可以从 Assistant 输入进入 Projects，并启动真实试读链路。三章试读是本阶段默认验收样本，不是最终能力上限。

**实现内容：**

- 新增 `assistant-intent.ts`：
  - 解析用户输入中的标题、题材、主角、核心冲突、章节数、交付物。
  - 第一批使用确定性规则，不调用 LLM 做意图解析。
- 改造 `createBlueprintRequest`：
  - 支持从 intent 生成 `premise`、`tone`、`target_chapter_count`、`metadata`。
- 新增 Assistant / Projects Server Action：
  - 创建 Blueprint。
  - 锁定 Blueprint。
  - 触发章节计划。
  - 启动 BookRun。
- 返回 `blueprint_id` 和 `book_run_id`，Projects 子视图和 Assistant 消息流展示真实 ID 和状态。

**验收：**

- 首页输入“三章试读”后通过 `view=projects&intent=...` 进入 Projects 并创建真实 Blueprint。
- 首页输入“生成 5 章试读”或“生成 10 章短篇”时，章节数应进入 Blueprint 和 BookRun 请求，而不是被固定为 3。
- 成功后能启动真实 BookRun。
- 页面能展示 BookRun ID、状态、章节进度、token 预算。
- API 失败时显示失败消息，不显示成功工具节点。

### Phase 3：工具流程树真实映射

**目标：** 工具流程树从 Runtime Tools、Novel Skills、BookRun 和 AssistantToolCall 映射真实状态。

**实现内容：**

- 新增 `assistant-tool-node-mapper.ts`：
  - `mapBookRunToAssistantToolNodes(bookRun: BookRunRead): AssistantToolNode[]`
  - `mapToolCallsToAssistantToolNodes(toolCalls: AssistantToolCall[]): AssistantToolNode[]`
  - `mapRuntimeToolCatalogToAssistantActions(tools: RuntimeToolRead[]): AssistantAction[]`
- 节点映射：
  - `Goal.analyze`
  - `Blueprint.create`
  - `Chapter.generate`
  - `Judge.review`
  - `Repair.suggest`
  - `Approval.apply`
  - `Artifact.export`
- 优先从 `BookRunRead.progress`、`checkpoint`、`cost_summary`、`current_chapter_index`、`status` 和 Assistant 工具调用记录映射。
- Runtime Tools 只提供可调用能力清单，工具执行结果以 AssistantToolCall 和对应业务事实源为准。

**验收：**

- `running` BookRun 显示运行中章节。
- `awaiting_review` 显示 Judge/Repair 等待或需要批准。
- `completed` 显示章节完成和导出入口。
- `failed` 或 `paused_*` 显示失败或暂停原因。

### Phase 4：Assistant 工具事件和流程控制

**目标：** 工具树能随 Assistant 工具调用和 BookRun 状态变化更新，用户可以暂停、恢复、停止、重试和查看审计。

**实现内容：**

- 新增 Assistant 事件读取：
  - `/api/assistant/sessions/{session_id}/events` 返回工具调用快照或事件流。
  - 事件类型包括 `tool_planned`、`tool_running`、`tool_completed`、`tool_failed`、`needs_approval`、`book_run_progress`。
- 操作按钮接入 BookRun 原生 API 或 Assistant 工具 API：
  - 暂停流程：`POST /api/book-runs/{book_run_id}/pause`。
  - 恢复流程：复用 `POST /api/book-runs/{book_run_id}/resume`。
  - 停止流程：`POST /api/book-runs/{book_run_id}/stop`。
  - 从 checkpoint 重试：`POST /api/book-runs/{book_run_id}/retry`。
  - 查看审计：跳转到 BookRun 审计页或制品审计报告。
- 对无法执行的按钮显示明确原因。

**验收：**

- Assistant 工具调用状态变化后工具树能更新。
- 暂停、恢复、停止和重试必须真实更新 BookRun 状态。
- 不存在的 BookRun 返回错误提示。

### Phase 5：会话持久化和最近记录

**目标：** Assistant 对话、任务引用、最近项目和最近制品可追溯。

**实现内容：**

- 后端新增轻量 Assistant 会话模型：
  - `AssistantSession`
  - `AssistantMessage`
  - `AssistantTaskReference`
- 会话只保存消息、任务类型、关联 ID、审计引用，不保存敏感凭据。
- 前端 `HomeSidebar` 读取最近会话和最近任务。
- `recentItems={[]}` 替换为真实数据读取。

**验收：**

- 刷新页面后能看到最近对话。
- 最近记录能跳回关联 Blueprint、BookRun、Artifact。
- 无数据时显示真实空状态。

**2026-06-03 补充证据：**

- `HomeComposer` 客户端提交已保留 `book_id`、`assistant_session_id`、`book_run_id`、`scene_packet_id`、`repair_patch_id`、`target_chapter_ordinal` 和 `artifact_id`，避免继续发言时丢失章节目标或产物追溯。
- `HomeComposer` 原生 GET 降级表单已接收 `AssistantConversation` 传入的 `searchParams`，并用同一 `preservedContextQueryKeys` 渲染已有上下文 hidden input，减少客户端提交与未水合降级路径漂移。
- TDD 红灯：`pnpm --filter @storyforge/web test -- home-page` 曾失败于 `AssistantConversation` 未传 `initialSearchParams`。
- 绿灯验证：`pnpm --filter @storyforge/web test -- home-page` 13 passed；相关 Assistant store/action 回归 `pnpm --filter @storyforge/web test -- assistant-session-store assistant-chapter-review-actions assistant-artifact-export-actions assistant-book-run-actions` 26 passed；`pnpm --filter @storyforge/web lint` 通过；`git diff --check` 通过。
- 浏览器级验证：`pnpm --filter @storyforge/web verify:browser-session` 通过，已覆盖真实浏览器打开带上下文参数的 Assistant 页面、提交后 URL 参数保留，以及刷新后 hidden input 恢复；连续会话点击/刷新恢复缺口已关闭。限制：该验证不运行真实外部 LLM，不代表真实 LLM 长程验收完成。

### Phase 6：章节修订审阅链路

**目标：** Assistant 能处理“审阅这一章”“修复第二章”“角色有点崩”这类任务。

**实现内容：**

- 新增任务类型 `chapter-review`。
- 读取现有章节或场景正文。
- 调用 Judge 相关 API。
- 展示 Judge 问题列表。
- 调用 Repair 相关 API 生成修复建议。
- 用户批准后调用 Studio 批准写回能力。

**验收：**

- 可对指定章节发起审阅。
- 可展示 Judge 问题、严重级别和建议。
- 可生成 Repair Patch。
- 批准后真实写回章节或场景。

### Phase 7：导出审计报告链路

**目标：** Assistant 能执行“导出这次试读的 Markdown/EPUB/审计报告”。

**实现内容：**

- 新增任务类型 `artifact-export`。
- 读取 completed BookRun。
- 调用：
  - `/api/book-runs/{book_run_id}/exports/markdown`
  - `/api/book-runs/{book_run_id}/exports/epub`
  - `/api/book-runs/{book_run_id}/exports/audit-report`
- 消息流展示制品摘要、版本、关联 BookRun、下载摘要。
- 工具树增加 `Artifact.export` 节点。

**验收：**

- completed BookRun 能导出 Markdown、EPUB、audit_report.json。
- 非 completed BookRun 显示不可导出原因。
- Artifacts 页面能读取并展示导出制品。

### Phase 8：Provider、预算和安全边界

**目标：** Assistant 执行前能检查 Provider、预算和权限，不让真实模型运行失控。

**实现内容：**

- Provider 状态胶囊读取真实检测状态。
- 输入任务前提示 Provider 未配置或不可用。
- BookRun 创建时支持 token/time/chapter 预算。
- 工具树展示 tokens、剩余预算、estimated cost。
- API Key 仍走服务端环境或受控凭据边界，不放入普通前端本地状态。
- 记录暂停原因：
  - 预算触顶。
  - Provider 降级。
  - 用户暂停。
  - 工具失败。

**验收：**

- Provider 不可用时不能伪装运行。
- 预算触顶后 BookRun 暂停并展示原因。
- 安全头、认证和 API Key 注入不被削弱。

### Phase 9：多轮调整和上下文记忆

**目标：** 用户可以在同一对话中调整目标，Assistant 能基于会话和现有任务继续工作。

**实现内容：**

- 支持 `Goal.update`。
- 支持 `Blueprint.update` 或重新生成草稿。
- 支持 `Chapter.regenerate`。
- 对话消息关联同一个 `session_id`。
- 写入 Story Memory 或读取已有 Story Memory 摘要。
- 展示“本轮修改影响了哪些节点”。

**验收：**

- 用户输入“女主更冷一点”“第二章加反转”能生成新的工具流程。
- 能区分新任务和旧任务。
- 能显示修改前后影响范围。

### Phase 10：章节规模升级和长篇分卷

**目标：** 将三章试读闭环升级为多章节、短篇、中篇和长篇分卷生产能力。

**实现内容：**

- 支持用户显式指定章节数、目标字数、分卷数量和每批生成章节数。
- `AssistantIntent` 增加：
  - `targetWordCount`
  - `targetChapterCount`
  - `volumeCount`
  - `batchChapterCount`
  - `continuationMode`
- BookRun 创建时写入章节预算和 token/time 预算。
- 支持按批次执行：
  - 第 1 批：章节 1-3。
  - 第 2 批：章节 4-6。
  - 后续批次根据 checkpoint 和 Story Memory 继续。
- 每批完成后自动进行质量审阅、修复建议、记忆抽取和审计摘要。
- 长篇分卷时按卷维护：
  - 卷目标。
  - 卷冲突。
  - 关键人物状态。
  - 伏笔和回收状态。
  - 连续性风险。
- 对真实 LLM 长篇运行强制启用预算、暂停、恢复和人工批准门禁。

**验收：**

- deterministic/mock 环境已跑通 10 章短篇 BookRun。
- 已能按批次恢复，不从第一章重跑。
- 已能导出短篇 Markdown 和审计报告。
- 长篇 readiness gate 已完成，分卷 dispatch 前必须具备 Story Memory、Character Bible、Timeline 和 Foreshadow 四类证据。
- 真实 LLM 仍只完成 1 章和 3 章冒烟；10 章或 3-5 万字长程验收必须等预算、产物、审计报告和人工通读证据齐全后再声明。

### Phase 11：质量评测和发布门禁

**目标：** Assistant 能力进入可发布状态。

**实现内容：**

- 补充 Web 契约测试。
- 补充 API pytest。
- 补充 E2E 冒烟。
- 保留 deterministic 3 章 BookRun、10 章 BookRun 和 3-5 万字短篇导出的本地回归验证。
- 在私有环境运行真实 LLM 1 章冒烟。
- 满足条件后再运行真实 LLM 3 章冒烟。
- 满足成本、质量、产物和人工通读门禁后，再运行真实 LLM 10 章或 3-5 万字短篇。
- 生成 `.codex/verification-report.md`。

**验收：**

- `pnpm --filter @storyforge/web test` 通过。
- `pnpm --filter @storyforge/web lint` 通过。
- `pnpm run test:api` 通过。
- `pnpm run test:workflow` 通过。
- `pnpm e2e` 通过。
- `pnpm openapi` 无未解释 diff。
- 真实 LLM 能力声明必须附带运行产物和审计报告。

---

## 5. 文件改动地图

### 5.1 前端新增文件

- `apps/web/components/home/AssistantConversation.tsx`：对话台容器。
- `apps/web/components/home/AssistantMessageList.tsx`：消息列表。
- `apps/web/components/home/AssistantActionBar.tsx`：工具流程操作按钮。
- `apps/web/components/home/assistant-types.ts`：Assistant 前端类型。
- `apps/web/components/home/assistant-intent.ts`：确定性意图解析。
- `apps/web/components/home/assistant-tool-node-mapper.ts`：BookRun/事件到工具节点映射。
- `apps/web/components/home/assistant-tool-events.ts`：Assistant 工具调用事件读取和解析。
- `apps/web/components/home/assistant-book-run-actions.ts`：BookRun 暂停、停止、重试等控制命令的 Server Action 适配。
- `apps/web/components/home/assistant-tool-catalog.ts`：Assistant 可展示工具能力目录。
- `apps/web/components/home/assistant-workflows.ts`：Assistant 工作流节点和默认流程定义。
- `apps/web/components/home/assistant-session-store.ts`：后续前端会话读取适配，若继续保留该职责，应从 `/api/assistant/sessions` 读取真实会话。

### 5.2 前端修改文件

- `apps/web/app/page.tsx`：读取真实最近记录、会话和关联 ID。
- `apps/web/components/home/HomeShell.tsx`：接入对话台布局和任务视图。
- `apps/web/components/home/HomeComposer.tsx`：从单纯跳转改为提交 Assistant 任务。
- `apps/web/components/home/HomeSidebar.tsx`：展示真实最近会话、快捷任务和工作区状态。
- `apps/web/components/home/HomeProjectsPanel.tsx`：承载 New project、本地项目和后续真实项目/BookRun 入口。
- `apps/web/components/home/AssistantToolTree.tsx`：接收真实节点和交互状态。
- `apps/web/components/home/home-data.ts`：移除静态成功流程，保留文案和导航。
- `apps/web/app/blueprints/api.tsx`：让 Blueprint 创建请求消费 Assistant intent。
- `apps/web/lib/api-client.ts`：如需新增读取 helper，保持统一 header 和 no-store。

### 5.3 后端新增文件

- `apps/api/app/domains/assistant/__init__.py`
- `apps/api/app/domains/assistant/models.py`
- `apps/api/app/domains/assistant/schemas.py`
- `apps/api/app/domains/assistant/service.py`
- `apps/api/app/domains/assistant/router.py`
- `apps/api/alembic/versions/<revision>_add_assistant_sessions.py`
- `apps/api/alembic/versions/20260602_0001_add_assistant_sessions.py`

### 5.4 后端修改文件

- `apps/api/app/main.py`：注册 assistant router。
- `apps/api/app/domains/book_runs/router.py`：补充暂停、停止和 checkpoint 重试的原生 BookRun 端点。
- `apps/api/app/domains/book_runs/schemas.py`：如需要暴露更多进度字段，补充显式字段。

### 5.5 测试新增或修改

- `apps/web/tests/assistant-intent.test.ts`
- `apps/web/tests/assistant-tool-node-mapper.test.ts`
- `apps/web/tests/assistant-conversation.test.tsx`
- `apps/web/tests/assistant-book-run-actions.test.ts`
- `apps/web/tests/assistant-tool-catalog.test.ts`
- `apps/web/tests/assistant-workflows.test.ts`
- `apps/web/tests/home-page.test.tsx`
- `apps/api/tests/test_assistant_sessions.py`
- `apps/api/tests/test_assistant_sessions_migration.py`
- `apps/api/tests/test_runtime_tools.py`
- `apps/api/tests/test_book_runs.py`
- `tests/e2e/storyforge-assistant-workflow.spec.ts`

---

## 6. 详细任务分解

### Task 1：建立上下文摘要和验证基线

**Files:**

- Create: `.codex/context-summary-storyforge-assistant-workflow.md`
- Modify: `.codex/operations-log.md`
- Modify: `.codex/verification-report.md`

- [x] 记录已阅读的相似实现：
  - `apps/web/components/home/HomeShell.tsx`
  - `apps/web/components/home/HomeComposer.tsx`
  - `apps/web/components/home/AssistantToolTree.tsx`
  - `apps/web/app/blueprints/api.tsx`
  - `apps/api/app/domains/runtime_tools/router.py`
  - `apps/workflow/storyforge_workflow/tools/registry.py`
  - `apps/api/app/domains/book_runs/router.py`
- [x] 记录当前测试命令和基线结果。
- [x] 记录本计划范围和不做事项。

**2026-06-03 回填证据：**

- `.codex/context-summary-storyforge-assistant-workflow.md` 已记录 7 个相似实现，包括 `HomeShell`、`HomeComposer`、`AssistantToolTree`、Blueprint API、BookRun router/service、Runtime Tools registry 和 Novel Skills registry。
- 上下文摘要已记录 Web/API/Workflow 测试策略、可复用组件、依赖集成点、技术选型理由、风险点、外部资料和充分性检查。
- `.codex/operations-log.md` 已记录 StoryForge Assistant 工作流计划执行 Phase 0、基线验证和后续 P0/P1/P2 子任务验证结果。
- 本计划范围和不做事项已在第 0 节、最终验收标准、P0/P1/P2 限制说明中持续维护；真实外部 LLM 长程验收仍未完成，不得宣称总计划完成。

**验证命令：**

```powershell
pnpm --filter @storyforge/web test
pnpm --filter @storyforge/web lint
```

### Task 2：定义 Assistant 前端类型

**Files:**

- Create: `apps/web/components/home/assistant-types.ts`
- Test: `apps/web/tests/assistant-tool-node-mapper.test.ts`

**核心类型：**

```ts
export type AssistantTaskType =
  | 'trial_generation'
  | 'chapter_review'
  | 'artifact_export'
  | 'goal_update';

export type AssistantToolStatus =
  | 'completed'
  | 'running'
  | 'waiting'
  | 'failed'
  | 'needs_approval';

export type AssistantToolNode = {
  readonly id: string;
  readonly label: string;
  readonly tool: string;
  readonly status: AssistantToolStatus;
  readonly elapsedLabel?: string;
  readonly tokenLabel?: string;
  readonly toolUseLabel?: string;
  readonly summary: string;
};

export type AssistantMessage = {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly createdAt: string;
  readonly taskType?: AssistantTaskType;
  readonly toolNodes?: readonly AssistantToolNode[];
};
```

**验收：**

- 类型集中，不散落在多个组件里。
- `AssistantToolTree` 只依赖该类型。

### Task 3：实现确定性意图解析

**Files:**

- Create: `apps/web/components/home/assistant-intent.ts`
- Test: `apps/web/tests/assistant-intent.test.ts`

**接口：**

```ts
export type AssistantIntent = {
  readonly taskType: AssistantTaskType;
  readonly title?: string;
  readonly premise: string;
  readonly tone: string;
  readonly targetWordCount?: number;
  readonly targetChapterCount: number;
  readonly volumeCount?: number;
  readonly batchChapterCount?: number;
  readonly continuationMode?: 'new_book' | 'continue_book' | 'continue_volume';
  readonly requestedArtifacts: readonly ('blueprint' | 'chapters' | 'review' | 'repair' | 'audit')[];
};

export function parseAssistantIntent(input: string): AssistantIntent;
```

**规则：**

- 包含“三章”“3章”“试读”时，`taskType` 为 `trial_generation`。
- 包含“10章”“十章”“短篇”“中篇”“长篇”“分卷”时，仍进入生成类任务，但必须解析章节规模和篇幅目标。
- 包含“审阅”“修订”“修复”时，`taskType` 为 `chapter_review`。
- 包含“导出”“审计报告”“EPUB”“Markdown”时，`taskType` 为 `artifact_export`。
- 未命中时默认进入 `trial_generation`，但 Assistant 消息说明会先创建创作草稿。

**验收：**

- 不调用外部模型。
- 每种任务类型都有测试。
- 空输入返回明确错误，不启动任务。

### Task 4：改造对话台布局

**Files:**

- Create: `apps/web/components/home/AssistantConversation.tsx`
- Create: `apps/web/components/home/AssistantMessageList.tsx`
- Create: `apps/web/components/home/AssistantActionBar.tsx`
- Modify: `apps/web/components/home/HomeShell.tsx`
- Modify: `apps/web/components/home/HomeComposer.tsx`
- Test: `apps/web/tests/assistant-conversation.test.tsx`
- Test: `apps/web/tests/home-page.test.tsx`

**行为：**

- 初始状态显示问候和底部输入。
- 提交后在同一页展示用户消息。
- Assistant 回复确认消息。
- 有真实任务引用时展示工具树。
- 没有真实任务引用时不显示成功工具树。

**验收：**

- 截图参考图中的布局方向可达成。
- 移动端不溢出。
- 输入框始终可访问。

### Task 5：接通三章试读生成

**Files:**

- Modify: `apps/web/app/blueprints/api.tsx`
- Modify: `apps/web/components/home/HomeComposer.tsx`
- Modify: `apps/web/components/home/AssistantConversation.tsx`
- Modify: `apps/web/components/home/HomeProjectsPanel.tsx`
- Test: `apps/web/tests/blueprints.test.tsx`
- Test: `apps/web/tests/assistant-conversation.test.tsx`

**行为：**

- 用户在首页输入创作目标，路由保留 `view=projects&intent=...`。
- Server Action 使用 `parseAssistantIntent` 生成 Blueprint 请求。
- 依次创建 Blueprint、锁定 Blueprint、触发章节计划、启动 BookRun。
- 返回真实 `blueprint_id`、`book_run_id`。
- `HomeProjectsPanel` 读取 query 中的 intent 和返回 ID，展示当前项目与 BookRun 运行入口。

**验收：**

- 成功路径展示真实 ID。
- 失败路径展示 API 错误。
- 不写死“林岚在雾港追查失真的灯塔信号”作为所有输入的结果。
- 不把所有生成任务固定为 3 章；输入中出现明确章节数时必须进入 Blueprint 请求。

### Task 5.1：接通章节规模和分批生成参数

**Files:**

- Modify: `apps/web/components/home/assistant-intent.ts`
- Modify: `apps/web/app/blueprints/api.tsx`
- Modify: `apps/api/app/domains/book_runs/schemas.py`
- Test: `apps/web/tests/assistant-intent.test.ts`
- Test: `apps/api/tests/test_book_run_budget.py`

**行为：**

- 从用户输入解析章节数、目标字数、分卷数和每批生成数量。
- Blueprint 请求使用解析出的 `target_chapter_count` 和 `target_word_count`。
- BookRun 请求使用 `chapter_budget` 和预算字段。
- 长篇请求默认采用分批策略，不一次性无预算启动全书。

**验收：**

- “写 10 章短篇”创建 10 章 Blueprint。
- “写 3-5 万字短篇”进入目标字数字段。
- “先生成前三章”进入 `batchChapterCount=3`。
- “继续上一卷”进入 `continuationMode=continue_volume`。

### Task 6：实现 BookRun 到工具树映射

**Files:**

- Create: `apps/web/components/home/assistant-tool-node-mapper.ts`
- Modify: `apps/web/components/home/AssistantToolTree.tsx`
- Test: `apps/web/tests/assistant-tool-node-mapper.test.ts`

**映射策略：**

- BookRun 已创建：`Blueprint.create` completed。
- `status=running`：`Chapter.generate` running。
- `status=awaiting_review`：`Judge.review` 或 `Repair.suggest` needs_approval。
- `status=completed`：生成、审阅、修复和导出准备 completed 或 waiting。
- `status` 包含 `paused`：对应节点 failed 或 waiting，并展示暂停原因。

**验收：**

- 每个状态都有测试。
- tokens、cost、checkpoint 能显示。

### Task 7：接入 Assistant 工具事件和 BookRun 控制按钮

**Files:**

- Create: `apps/web/components/home/assistant-tool-events.ts`
- Modify: `apps/web/components/home/AssistantActionBar.tsx`
- Modify: `apps/web/components/home/AssistantConversation.tsx`
- Modify: `apps/api/app/domains/book_runs/router.py`
- Test: `apps/web/tests/assistant-tool-events.test.ts`
- Test: `apps/api/tests/test_book_runs.py`

**行为：**

- 读取 Assistant 工具调用事件或快照。
- 支持暂停、恢复、停止、查看审计。
- 暂停、恢复、停止、重试通过 BookRun 原生端点执行。

**验收：**

- 工具事件解析失败不会崩溃页面。
- 暂停/恢复真实更新后端状态。
- 查看审计跳转到 `/book-runs/{id}/audit`。

### Task 8：接通最近记录和当前项目

**Files:**

- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/home/HomeSidebar.tsx`
- Modify: `apps/web/components/home/HomeProjectsPanel.tsx`
- Test: `apps/web/tests/home-page.test.tsx`

**行为：**

- 最近记录来自 Assistant 会话、Blueprint、BookRun 或 Artifact。
- 本地草稿和真实项目必须区分。
- 无真实数据时显示空状态。

**验收：**

- 不出现静态伪历史。
- 最近记录能跳转到关联任务。

### Task 9：新增 Assistant 会话后端薄层

**Files:**

- Create: `apps/api/app/domains/assistant/models.py`
- Create: `apps/api/app/domains/assistant/schemas.py`
- Create: `apps/api/app/domains/assistant/service.py`
- Create: `apps/api/app/domains/assistant/router.py`
- Modify: `apps/api/app/main.py`
- Create: `apps/api/tests/test_assistant_sessions.py`

**数据：**

- 会话标题。
- 消息角色和内容。
- 任务类型。
- 关联 `blueprint_id`、`book_run_id`、`artifact_id`。
- 创建时间和更新时间。

**验收：**

- 可创建会话。
- 可追加消息。
- 可读取最近会话。
- 不存储 API Key。

### Task 10：实现章节修订审阅链路

**Files:**

- Modify: `apps/web/components/home/assistant-intent.ts`
- Modify: `apps/web/components/home/AssistantConversation.tsx`
- Modify: `apps/api/app/domains/assistant/service.py`
- Test: `apps/web/tests/assistant-intent.test.ts`
- Test: `apps/api/tests/test_assistant_sessions.py`

**行为：**

- 用户输入“审阅第二章”进入 `chapter_review`。
- 读取章节或场景正文。
- 调用 Judge。
- 调用 Repair。
- 等待用户批准。
- 批准后复用 Studio 批准写回。

**验收：**

- 缺少章节 ID 时向用户请求选择当前项目章节。
- Judge/Repair 失败时显示可读错误。
- 批准写回必须有后端证据。

### Task 11：实现导出审计报告链路

**Files:**

- Modify: `apps/web/components/home/assistant-intent.ts`
- Modify: `apps/web/components/home/AssistantConversation.tsx`
- Modify: `apps/web/components/home/assistant-tool-node-mapper.ts`
- Test: `apps/web/tests/assistant-intent.test.ts`
- Test: `apps/web/tests/book-runs.test.tsx`
- Test: `apps/api/tests/test_book_exporter.py`

**行为：**

- 用户输入“导出审计报告”进入 `artifact_export`。
- 找到关联 completed BookRun。
- 导出 Markdown、EPUB、audit_report.json。
- 消息流展示制品摘要。

**验收：**

- 非 completed BookRun 不允许导出。
- completed BookRun 导出后可在 Artifacts 页面看到。

### Task 12：Provider、预算和安全门禁

**Files:**

- Modify: `apps/web/app/settings/ProviderSettingsPanel.tsx`
- Modify: `apps/web/components/home/HomeShell.tsx`
- Modify: `apps/web/components/home/AssistantConversation.tsx`
- Modify: `apps/api/app/domains/book_runs/schemas.py`
- Test: `apps/web/tests/settings-page.test.ts`
- Test: `apps/api/tests/test_book_run_budget.py`

**行为：**

- Provider 待检查时，Assistant 显示不可运行原因。
- BookRun 启动时带预算。
- 工具树显示预算和剩余 token。
- 安全认证、限流、超时不被绕过。

**验收：**

- Provider 失败不展示成功状态。
- 预算触顶显示暂停原因。

### Task 13：多轮调整和记忆

**Files:**

- Modify: `apps/web/components/home/assistant-intent.ts`
- Modify: `apps/api/app/domains/assistant/service.py`
- Modify: `apps/api/app/domains/story_memory/service.py`
- Test: `apps/api/tests/test_story_memory_contract.py`
- Test: `apps/web/tests/assistant-intent.test.ts`

**行为：**

- 用户可追加“女主更冷一点”“第二章加反转”。
- Assistant 根据当前会话关联 BookRun 或 Blueprint。
- 生成新的任务节点。
- 展示影响范围。

**验收：**

- 不覆盖旧消息。
- 新旧任务可追溯。

### Task 14：端到端验证和发布报告

**Files:**

- Modify: `.codex/verification-report.md`
- Modify: `README.md`
- Modify: `current-phase.md`

**验证命令：**

```powershell
pnpm --filter @storyforge/web test
pnpm --filter @storyforge/web lint
pnpm run test:api
pnpm run test:workflow
pnpm e2e
pnpm openapi
git diff --check
```

**真实 LLM 冒烟：**

```powershell
cd apps/api
uv run python -m app.domains.book_runs.phase9b_real_llm_smoke --chapter-count 1 --token-budget 8000
uv run python -m app.domains.book_runs.phase9b_real_llm_smoke --chapter-count 3 --token-budget 24000
```

**验收：**

- 所有本地自动化验证通过。
- 真实 LLM 结论只在有真实产物时声明。
- `.codex/verification-report.md` 记录评分、风险和证据。

---

## 7. 测试矩阵

| 能力 | Web 测试 | API 测试 | E2E |
| --- | --- | --- | --- |
| 对话台布局 | `assistant-conversation.test.tsx` | 不需要 | 首页截图和交互 |
| 意图解析 | `assistant-intent.test.ts` | 不需要 | 输入任务 |
| Blueprint 创建 | `blueprints.test.tsx` | `test_blueprint_api.py` | 三章试读启动 |
| BookRun 映射 | `assistant-tool-node-mapper.test.ts` | `test_book_runs.py` | 工具树更新 |
| 暂停恢复 | `assistant-tool-events.test.ts` | `test_book_runs.py` | 按钮操作 |
| 会话持久化 | `home-page.test.tsx` + `verify:browser-session` | `test_assistant_sessions.py` | 刷新恢复；参数保留源码契约和真实浏览器点击/刷新恢复均已补齐 |
| 章节审阅 | `assistant-intent.test.ts` | Judge/Repair 相关测试 | 审阅任务 |
| 导出审计 | `book-runs.test.tsx` | `test_book_exporter.py` | 导出任务 |
| Provider/预算 | `settings-page.test.ts` + `verify:settings-browser` | `test_book_run_budget.py` | Provider 失败提示；settings 本地浏览器交互验证 localStorage 与模型检测请求体安全边界 |

---

## 8. 风险控制

### 8.1 伪造成功风险

控制方式：

- 默认不展示 completed 工具节点。
- 所有 completed 状态必须来自 API 响应、BookRun 状态或 Artifact 记录。
- 测试检查 `home-data.ts` 不包含静态伪历史和静态成功流程。

### 8.2 范围膨胀风险

控制方式：

- 总计划覆盖完整路线，但实施按 Phase 切分。
- 每个 Phase 必须独立可验证。
- 不在 Phase 1 引入后端会话表，不在 Phase 2 引入自由 Agent。

### 8.3 真实 LLM 成本风险

控制方式：

- 默认先跑 deterministic/mock。
- 真实 LLM 必须设置 token、时间、章节预算。
- 预算触顶必须暂停。

### 8.4 安全风险

控制方式：

- 保留 `X-StoryForge-API-Key` 注入。
- 保留后端认证、限流、请求超时和安全响应头。
- Provider 凭据不写入普通前端本地存储。

### 8.5 用户体验风险

控制方式：

- 工具树重点突出中文阶段和状态。
- tokens、tool uses、耗时用低权重展示。
- 失败节点给出下一步按钮，而不是只显示错误。

---

## 9. 里程碑定义

### M1：可交互对话台

- 首页布局接近用户参考图。
- 可以输入消息。
- 可以显示 Assistant 回复。
- 不展示静态假成功流程。

### M2：能启动三章试读

- 输入创作目标后创建 Blueprint。
- 启动 BookRun。
- 工具树展示真实 BookRun 状态。
- 该里程碑只证明最小闭环可运行，不代表总计划完成。

### M3：能实时看进度和控制流程

- 工具树消费事件。
- 支持暂停、恢复、停止、查看审计。

### M4：能追溯会话和产物

- 最近记录真实可点。
- 会话刷新后仍存在。
- 产物可追溯到 BookRun。

### M5：能审阅和修复章节

- 支持章节审阅。
- 支持修复建议。
- 支持批准写回。

### M6：能导出和交付

- 支持 Markdown、EPUB、审计报告导出。
- Artifacts 展示真实制品。

### M7：可发布候选

- 全量本地验证通过。
- 真实 LLM 冒烟有证据。
- README、current-phase、verification-report 同步能力边界。

### M8：能生产短篇和中篇

- deterministic/mock 环境已完成 10 章 BookRun 和 3-5 万字短篇导出。
- 已支持分批生成、暂停、恢复和审计。
- 真实 LLM 短篇长程验收仍需预算、产物、审计报告和人工通读证据后才能声明。

### M9：能支撑长篇分卷

- 长篇 readiness gate 已完成，包含分卷计划、跨卷 Story Memory、Character Bible、Timeline Guard、伏笔回收状态和按批次续写边界。
- 真实 LLM 长篇稳定能力仍需真实长程运行和人工通读通过后才能声明。

---

## 10. 最终验收标准

- 用户可以在首页完成至少三类任务：生成类任务、章节修订审阅、导出审计报告。
- 生成类任务不能只支持 3 章；必须支持用户指定章节数、目标字数和分批生成。
- Assistant 消息流展示真实执行过程和结果。
- 工具流程树状态全部来自真实事实源。
- 最近记录和产物入口可追溯。
- Provider、预算、暂停、失败、审计都有明确 UI 和后端证据。
- 本地 Web、API、Workflow、E2E、OpenAPI 验证通过；连续会话真实浏览器点击/刷新恢复已由 `verify:browser-session` 单独记录并在 2026-06-03 复验通过，settings 页本地浏览器交互验证已由 `verify:settings-browser` 单独记录并复验通过，`pnpm e2e` 已复验 OpenAPI/API/Workflow 合约；不得用源码契约、模拟协议测试或本地页面交互冒充真实外部 LLM 长程验收。
- `.codex/verification-report.md` 包含技术评分、战略评分、综合评分和通过/退回建议。

---

## 11. 执行顺序建议

1. Phase 0：建立上下文摘要和验证基线。
2. Phase 1：对话台骨架和静态数据下线。
3. Phase 2：试读生成主链路。
4. Phase 3：工具流程树真实映射。
5. Phase 4：实时事件和流程控制。
6. Phase 5：会话持久化和最近记录。
7. Phase 6：章节修订审阅链路。
8. Phase 7：导出审计报告链路。
9. Phase 8：Provider、预算和安全边界。
10. Phase 9：多轮调整和上下文记忆。
11. Phase 10：章节规模升级和长篇分卷。
12. Phase 11：质量评测和发布门禁。

该顺序允许前四个阶段先把“能干活”的核心体验跑起来，后续阶段把它扩展成完整可追溯的创作助手，并最终从三章试读升级到短篇、中篇和长篇分卷生产。

---

## 12. 剩余执行清单

本节用于从 2026-06-02 最新状态继续推进。执行者必须按优先级选择任务，不得跳过对应本地验证。

### P0：接通真实最近记录

**目标：** 首页左侧最近记录从 Assistant 会话 API 读取真实数据，替代当前明确传入的空数组。

**Files:**

- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/home/HomeSidebar.tsx`
- Create or Modify: `apps/web/components/home/assistant-session-store.ts`
- Test: `apps/web/tests/home-page.test.tsx`
- Test: `apps/api/tests/test_assistant_sessions.py`

**执行步骤：**

- [x] 写 Web 契约测试：`HomeShell` 或 `HomeSidebar` 必须消费最近 Assistant 会话标题、任务类型和关联链接。
- [x] 运行红灯：`pnpm --filter @storyforge/web test -- home-page`，确认失败点指向最近记录仍为空或未接 API。
- [x] 在 `assistant-session-store.ts` 中实现会话读取 helper，必须复用 `apps/web/lib/api-client.ts`，保持 `cache: "no-store"` 和 `X-StoryForge-API-Key` 边界。
- [x] 在 `apps/web/app/page.tsx` 中读取最近会话，将结果映射为 `HomeSidebar` 可展示的最近记录。
- [x] 对无数据、API 失败和正常返回三种情况补测试；API 失败时显示真实空状态或错误摘要，不伪造历史。
- [x] 运行绿灯：`pnpm --filter @storyforge/web test -- home-page`。
- [x] 运行 API 关联测试：`cd apps/api; uv run pytest tests/test_assistant_sessions.py -q`。

**2026-06-03 完成证据：**

- `apps/web/app/page.tsx` 已调用 `readRecentAssistantSessions()`，成功时将 `recentSessions.data` 作为 `recentItems` 传给 `HomeShell`，失败时回退为空数组，不伪造静态历史。
- `apps/web/components/home/assistant-session-store.ts` 已通过统一 `readJson<readonly AssistantSessionRead[]>('/api/assistant/sessions', { params: { limit } })` 读取最近会话，并映射为 `HomeRecentItem`，href 保留 `assistant_session_id`、`book_run_id`、`artifact_id`、`blueprint_id`。
- `HomeShell` 透传 `recentItems`，`HomeSidebar` 有数据时渲染可追溯链接，无数据时展示真实空状态。
- Assistant sessions API 已提供 `GET /api/assistant/sessions`，按 `updated_at desc, id desc` 读取最近会话；schema 禁止额外敏感字段。
- 本轮核验：`pnpm --filter @storyforge/web test -- home-page assistant-session-store` 20 passed；`cd apps/api; uv run pytest tests/test_assistant_sessions.py -q` 2 passed；`pnpm --filter @storyforge/web lint` 通过；`git diff --check` 通过。
- 会话详情恢复已补齐：`GET /api/assistant/sessions/{assistant_session_id}` 返回单个 Assistant 会话及完整 messages，不存在时返回 404；前端 `readAssistantSession()` 通过统一 `api-client` 读取详情，`AssistantConversation` 在最近记录跳回后按历史 messages 恢复消息流，并在详情缺失时显示可读提示。
- 本轮核验：`pnpm --filter @storyforge/web test -- assistant-session-store home-page` 21 passed；`cd apps/api; uv run pytest tests/test_assistant_sessions.py -q` 3 passed；`pnpm --filter @storyforge/web lint` 通过。
- 限制：该补充只覆盖 Assistant 会话详情读取和历史消息恢复；真实外部 LLM 10 章或 3-5 万字长程验收仍未完成，不得混同为总计划完成。

**验收：**

- 刷新首页后可以看到真实最近 Assistant 会话。
- 最近记录可以跳转到关联 `session_id`、`book_run_id` 或 `artifact_id`。
- 无会话时显示空状态，不出现静态伪历史。

### P0：完成 Assistant 导出审计链路

**目标：** 用户在 Assistant 中输入“导出审计报告”后，可以基于 completed BookRun 调用真实导出 API，并在消息流展示制品摘要。

**Files:**

- Modify: `apps/web/components/home/assistant-intent.ts`
- Modify: `apps/web/components/home/AssistantConversation.tsx`
- Modify: `apps/web/components/home/assistant-tool-node-mapper.ts`
- Test: `apps/web/tests/assistant-intent.test.ts`
- Test: `apps/web/tests/book-runs.test.tsx`
- Test: `apps/api/tests/test_book_exporter.py`

**执行步骤：**

- [x] 写意图解析测试：输入“导出这次试读的 EPUB 和审计报告”必须进入 `artifact_export`，并包含 `audit` 请求。
- [x] 写工具树映射测试：completed BookRun 显示 `Artifact.export` 可执行或已完成；非 completed BookRun 显示不可导出原因。
- [x] 在对话层读取关联 `book_run_id`，只允许 completed BookRun 发起 Markdown、EPUB、audit_report 导出。
- [x] 导出成功后把 artifact 摘要、版本、关联 BookRun 和下载摘要写入 Assistant 消息。
- [x] 运行 Web 测试：`pnpm --filter @storyforge/web test -- assistant-intent assistant-artifact-export-actions assistant-tool-node-mapper book-runs home-page`。
- [x] 运行 API 导出测试：`cd apps/api; uv run pytest tests/test_book_exporter.py -q`。

**验收：**

- completed BookRun 可以导出 Markdown、EPUB、audit_report.json。
- 非 completed BookRun 不允许导出，并向用户显示原因。
- Artifacts 页面可以读取并展示导出制品。

**2026-06-03 完成证据：**

- `parseAssistantIntent('导出这次试读的 EPUB 和审计报告')` 已进入 `artifact_export`，并请求 Markdown、EPUB、audit 三类制品。
- `submitAssistantArtifactExport()` 已对 completed BookRun 依次调用 Markdown、EPUB、audit_report 导出 API；非 completed BookRun 回流 `not_ready`，不写 AssistantSession。
- 导出成功摘要已包含制品名、`#id`、`v版本`、`BookRun #id` 和“Artifacts 下载摘要可查看”提示，并写入 redirect/session payload。
- `Artifact.export` 工具节点已覆盖 completed 等待导出、非 completed 等待原因和 audit_report 证据完成态。
- API 层已覆盖 running BookRun 调用三类导出端点返回 400，且不创建 Artifact。
- 本地验证：Web 定向测试 40 passed；API `test_book_exporter.py` 4 passed；`pnpm --filter @storyforge/web lint` 通过；`git diff --check` 通过；本阶段触及文件敏感扫描 0 命中。
- 限制：该 P0 仅证明本地 completed BookRun 导出审计链路可用，不代表真实外部 LLM 10 章或 3-5 万字长程验收完成。

### P1：完成章节审阅和修复链路

**目标：** Assistant 能处理“审阅第二章”“修复角色崩坏”等任务，串联 Judge、Repair 和 Studio 批准写回。

**Files:**

- Modify: `apps/web/components/home/assistant-intent.ts`
- Modify: `apps/web/components/home/AssistantConversation.tsx`
- Modify: `apps/api/app/domains/assistant/service.py`
- Test: `apps/web/tests/assistant-intent.test.ts`
- Test: `apps/web/tests/studio.test.tsx`
- Test: Judge/Repair 相关 API 测试文件

**执行步骤：**

- [x] 写意图解析测试：审阅、修订、修复输入必须进入 `chapter_review`。
- [x] 定义缺少章节 ID 时的用户提示，不能在无目标章节时直接调用 Judge。
- [x] 对已有章节调用 Judge，展示问题、严重级别和证据引用。
- [x] 对 Judge 问题调用 Repair，生成 Patch 摘要和批准按钮。
- [x] 批准后复用 Studio 写回能力，保留已修复的 redirect 控制流。
- [x] 运行定向测试：`pnpm --filter @storyforge/web test -- assistant-intent studio`。

**2026-06-03 完成证据：**

- 新增 `POST /api/studio/chapter-review`，通过 `scene_packet_id` 读取 ScenePacket、Scene 正文和 packet 约束，主动创建 JudgeIssue 与 RepairPatch，并返回批准摘要。
- `submitAssistantChapterReview()` 已从三段只读 GET 改为一次主动 POST，不保留旧 GET fallback。
- 本地门禁 `pnpm verify` 通过：Web 195 passed、API 364 passed、Workflow 161 passed，Ruff、Prettier、OpenAPI 漂移检查均通过。
- 自然语言章节定位已补齐：`parseAssistantIntent()` 可从“审阅第二章/第2章/2章”解析 `targetChapterOrdinal=2`；`HomeComposer` 对章节审阅保留 Assistant 对话台和当前 `book_id`；`submitAssistantChapterReview()` 在缺 `scene_packet_id` 且有 `book_id + target_chapter_ordinal` 时先调用 `/api/studio/scene-packets` 定位真实 `scene_packet_id`，再调用 `/api/studio/chapter-review`。
- 本轮验证：`pnpm --filter @storyforge/web test -- assistant-intent assistant-chapter-review-actions home-page` 29 passed；`pnpm --filter @storyforge/web test` 200 passed；`pnpm --filter @storyforge/web lint` 通过；Prettier 和 `git diff --check` 触及文件通过。
- 限制：缺少真实 `book_id` 时仍提示选择作品，不伪造默认作品；真实外部 LLM 长程验收仍需后续补齐；连续会话参数保留和浏览器级点击/刷新恢复已通过 `verify:browser-session` 验证。

**验收：**

- 指定章节可以发起审阅。
- Judge 和 Repair 失败时显示可读错误。
- 批准写回必须有后端证据和测试覆盖。

### P1：Provider、预算和暂停原因可视化

**目标：** Assistant 执行前检查 Provider 和预算，执行中展示 token、成本、暂停原因和恢复路径。

**Files:**

- Modify: `apps/web/app/settings/ProviderSettingsPanel.tsx`
- Modify: `apps/web/components/home/AssistantConversation.tsx`
- Modify: `apps/web/components/home/assistant-tool-node-mapper.ts`
- Modify: `apps/api/app/domains/book_runs/schemas.py`
- Test: `apps/web/tests/settings-page.test.ts`
- Test: `apps/web/tests/assistant-tool-node-mapper.test.ts`
- Test: `apps/api/tests/test_book_runs.py`

**执行步骤：**

- [x] 写 Provider 不可用测试：Assistant 不能展示 running 或 completed。
- [x] 写预算触顶测试：BookRun 暂停原因必须映射为工具树节点摘要。
- [x] 把 Provider 检测状态、token 预算、time 预算和 chapter 预算传入 Assistant 消息流。
- [x] 保持 API Key 只走服务端环境或受控凭据边界，不写入前端本地状态。
- [x] 运行验证：`pnpm --filter @storyforge/web test -- settings-page assistant-tool-node-mapper`。
- [x] 运行后端验证：`cd apps/api; uv run pytest tests/test_book_runs.py -q`。

**2026-06-03 完成证据：**

- BookRun progress 回填已统一执行 token/time/chapter 预算门禁，触顶后写入 `paused_by_budget`、`pause_reason` 和 `budget_exceeded`。
- `completed` 状态受保护，不会被 token/time/chapter 预算门禁误改；`apps/api/tests/test_book_runs.py` 已覆盖三类预算触顶和 completed 防误暂停。
- Assistant 工具树已覆盖 Provider 不可用时 running/completed 防伪装、无预算上限的已用量展示、paused_by_budget 缺少 `pause_reason` 时的“预算触顶”兜底。
- Provider 设置页只保存 `Provider Base URL` 到 `storyforge-provider-settings`，不渲染或保存 API Key；模型检测仍走 `/api/provider-models`。
- 本轮验证：`uv run pytest tests/test_book_runs.py -q` 19 passed；`pnpm --filter @storyforge/web test -- settings-page assistant-tool-node-mapper` 14 passed；`pnpm --filter @storyforge/web lint` 通过。后续补充 settings 专属浏览器验证：`pnpm --filter @storyforge/web verify:settings-browser` 通过；`pnpm --filter @storyforge/web test -- settings-page` 6 passed；`pnpm --filter @storyforge/web lint` 通过；`git diff --check` 通过。
- 限制：settings 页已补充专属本地浏览器交互验证，覆盖 Provider Base URL 写入浏览器本地存储、模型检测请求体不携带密钥类字段、创作偏好与 Provider 设置分离；该验证不读取 `.env`，不使用或落盘供应商凭据，不运行真实外部 LLM。真实外部 LLM 长程验收仍需后续补齐；连续会话浏览器级点击/刷新恢复已通过 `verify:browser-session` 验证。

**验收：**

- Provider 不可用时不能伪装运行。
- 预算触顶后 BookRun 暂停并展示原因。
- 安全头、认证、请求超时和 API Key 注入不被削弱。

### P2：短篇、中篇和长篇分卷产品化

**目标：** 已完成 deterministic 10 章短篇、3-5 万字短篇导出和长篇 readiness gate；剩余重点是真实 LLM 10 章或 3-5 万字长程验收。

**Files:**

- Modify: `apps/web/components/home/assistant-intent.ts`
- Modify: `apps/web/components/home/assistant-workflows.ts`
- Modify: `apps/api/app/domains/book_runs/schemas.py`
- Modify: Story Memory、Character Bible、Timeline Guard 相关服务文件
- Test: `apps/web/tests/assistant-intent.test.ts`
- Test: `apps/api/tests/test_story_memory_contract.py`
- Test: BookRun 长章节预算相关测试

**执行步骤：**

- [x] deterministic/mock 环境跑通 10 章 BookRun。
- [x] deterministic/mock 环境跑通 3-5 万字短篇导出。
- [x] 加入分卷计划、每批章节数和 checkpoint 恢复验证，并在 dispatch 前接入长篇上下文 readiness gate。
- [x] 长篇/分卷 dispatch 前必须引入 Story Memory、Character Bible、Timeline 和 Foreshadow 四类证据，不得只扩章节数。
- [ ] 真实 LLM 10 章或 3-5 万字短篇只在预算、产物、审计报告和人工通读证据齐全后声明。

**2026-06-03 完成证据：**

- 前端规模意图链路已补齐：`parseAssistantIntent()` 覆盖 10 章、3-5 万字、2 卷、前 3 章批次；`BlueprintWorkspacePanel` 已把 URL `intent` 透传给 `createBlueprintWorkflowAction()`；`createBlueprintRequest()` 会写入 `target_word_count`、`target_chapter_count`、`metadata.batch_chapter_count`、`metadata.volume_count`。
- phase9b 本地模拟预检证据：`uv run pytest tests/test_phase9b_real_llm_smoke.py -q` 7 passed，覆盖缺私有配置 preflight 阻止、pytest 内本地 HTTP 模拟 1 章/10 章路径、目标字数进入蓝图和请求 payload、Markdown/audit artifact 生成、CLI 摘要脱敏。该证据不访问真实供应商，不代表真实外部 LLM 长程验收完成。
- deterministic/mock 证据：`uv run pytest tests/test_phase9a_deterministic_smoke.py tests/test_book_exporter.py tests/test_book_run_recorded_skill_runs_export.py -q` 6 passed，覆盖 10 章 BookRun、3-5 万字范围内 Markdown、`book.md` 与 `audit_report.json` 导出基础证据。
- 人工通读门禁本地审计证据：`manual_read_gate` 可保存到 BookRun progress，并会投影进 `audit_report.json`；`uv run pytest tests/test_book_runs.py::test_patch_book_run_progress_persists_manual_read_gate tests/test_book_exporter.py::test_book_run_markdown_and_audit_report_exports_artifacts -q` 2 passed。该证据只证明门禁字段和审计报告投影可追溯，不代表真实人工通读或真实外部 LLM 长程验收完成。
- API 恢复 dispatch 证据：resume 后 dispatch 从最新 checkpoint 下一章开始并保留 `volume_plan`；retry 后优先 `retry_from_chapter_index` 并清理陈旧 `resume_from_chapter_index`；`uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_book_runs.py tests/test_book_run_resume.py -q` 28 passed。
- Workflow 恢复预算证据：`_checkpoint_entry` 保留 `status`、预算字段和 `skill_runs`，adapter/dispatch payload 恢复时保留历史 completed_chapters 与预算摘要；`uv run pytest tests/test_book_loop_resume.py tests/test_book_run_adapter.py tests/test_book_run_dispatch_payload.py -q` 13 passed。
- OpenAPI/shared 证据：`pnpm openapi`、`pnpm --filter @storyforge/shared generate:types`、`pnpm --filter @storyforge/shared test` 均通过；OpenAPI/generated types 中包含 `BookRunVolumeProgress`、`BookRunProgressUpdate.volume_progress`、`BookRunWorkflowDispatch.volume_plan`。
- 长篇上下文 readiness gate 证据：分卷或显式长篇请求缺 Story Memory、Character Bible、Timeline、Foreshadow 证据时会被 `BookRunBlockedError` 阻断；补齐四类证据后 dispatch 通过；普通单卷短篇不受影响；历史验证 `uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_story_memory_contract.py tests/test_character_bible_api.py tests/test_timeline_events.py tests/test_foreshadow_lifecycle.py -q` 32 passed，Ruff 检查通过；2026-06-03 复验 `uv run pytest tests/test_book_run_workflow_dispatch.py::test_longform_volume_dispatch_requires_context_readiness tests/test_book_run_workflow_dispatch.py::test_longform_volume_dispatch_passes_after_context_readiness tests/test_book_run_workflow_dispatch.py::test_single_volume_dispatch_does_not_require_longform_context tests/test_story_memory_contract.py tests/test_character_bible_api.py tests/test_timeline_events.py tests/test_foreshadow_lifecycle.py -q` 24 passed。
- 限制：`3-5 万字` deterministic 证据按现有统计口径产生，不等同于真实中文质量门禁；长篇 readiness gate 已完成，但真实 LLM 长程验收仍未完成，不得宣称总计划完成或真实 LLM 长篇稳定生产。

**验收：**

- deterministic 10 章和 3-5 万字短篇均有本地运行证据。
- 长篇分卷可以按批次继续写作，不从头重跑。
- `.codex/verification-report.md` 明确记录真实 LLM 模型、产物 ID、审计报告 ID、成本和质量风险。

### 文档和门禁验证

每完成一个 P0/P1/P2 子任务后，至少运行以下命令：

```powershell
pnpm --filter @storyforge/web test
pnpm --filter @storyforge/web lint
pnpm run test:api
pnpm run test:workflow
pnpm openapi
git diff --check
```

若涉及 E2E 或发布候选，还必须运行：

```powershell
pnpm e2e
pnpm verify
```

若涉及后端迁移，还必须运行：

```powershell
cd apps/api
uv run pytest tests/test_assistant_sessions_migration.py tests/test_alembic_schema_current_orm.py -q
```

若涉及真实 LLM，还必须使用当前进程环境变量传入凭据，禁止写入源码、`.env`、日志或报告正文。
