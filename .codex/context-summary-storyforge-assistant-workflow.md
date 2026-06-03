## 项目上下文摘要（StoryForge Assistant 工作流）

生成时间：2026-06-02 03:41:58 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/home/HomeShell.tsx`
  - 模式：首页 App Router 边界解析 `view` 后交给 `HomeShell`，由 `activeView` 切换 Assistant、Projects、Artifacts 子视图。
  - 可复用：`HomeSidebar`、`HomeComposer`、`HomeProjectsPanel`、`ArtifactsPageContent`。
  - 需注意：当前 Assistant 首屏不默认渲染工具树；非 assistant 子页统一重置全局 `section` 卡片样式。
- **实现2**: `apps/web/components/home/HomeComposer.tsx`
  - 模式：客户端组件使用本地输入状态，空输入禁止提交；提交后写入 `/?view=projects&intent=...`。
  - 可复用：`createHomeViewHref` 和首页 query 驱动模式。
  - 需注意：当前只跳转，不解析创作目标，也不启动真实 Blueprint/BookRun。
- **实现3**: `apps/web/components/home/AssistantToolTree.tsx`
  - 模式：单层工具流程树，用 `statusClass` 和 `statusLabel` 映射展示状态。
  - 可复用：工具节点展示结构。
  - 需注意：当前仍从 `home-data.ts` 读取静态 `assistantToolNodes`，其中包含 completed/running/waiting 示例，和计划“不伪造完成节点”冲突。
- **实现4**: `apps/web/app/blueprints/api.tsx`
  - 模式：Server Action 串联创建 Blueprint、锁定、触发章节计划、启动 BookRun，失败时把错误写回 query。
  - 可复用：`createBlueprintWorkflowAction`、`createBlueprintRequest`、`createBookRunRequest`、`BlueprintWorkbench`。
  - 需注意：`createBlueprintRequest()` 当前写死“林岚在雾港追查失真的灯塔信号。”和 3 章，需改为消费 Assistant intent。
- **实现5**: `apps/api/app/domains/book_runs/router.py` 与 `service.py`
  - 模式：FastAPI router 调 service，service 负责状态约束和 SQLAlchemy 持久化。
  - 可复用：`create_book_run`、`resume_book_run`、`apply_book_run_progress`、`pause_book_run`、`stop_book_run`、`retry_book_run_from_checkpoint`。
  - 需注意：service 已有暂停、停止、重试函数，但 router 只暴露 create/get/resume/dispatch/progress/export，需补原生端点。
- **实现6**: `apps/workflow/storyforge_workflow/tools/registry.py`
  - 模式：静态 `CreativeToolRegistry`，工具定义冻结、可按名称/domain/capability 查询。
  - 可复用：`provider_gateway.resolve`、`retrieval.search`、`scene_packets.assemble`、`judge.create_issues`、`repair.create_patch`、`artifacts.create`、`evaluations.create_run`。
  - 需注意：Runtime Tools 只适合作为能力清单，执行状态应来自 BookRun、AssistantToolCall 或业务事实源。
- **实现7**: `apps/workflow/storyforge_workflow/skills/definitions.py`
  - 模式：静态 `NovelSkillRegistry`，默认技能链为 `generate -> judge -> repair -> approve -> memory_extract -> export`。
  - 可复用：技能名、阶段、审计字段和 BookRun 状态映射。
  - 需注意：题材技能包需要显式加载，不能默认污染所有 BookRun。

### 2. 项目约定

- **命名约定**: TypeScript 组件使用 PascalCase，函数和变量使用 camelCase；Python 使用 snake_case；测试名称多为中文行为描述。
- **文件组织**: Web 首页能力集中在 `apps/web/components/home`；页面边界在 `apps/web/app`；API 领域按 `apps/api/app/domains/<domain>` 拆分 router/service/schema/model。
- **导入顺序**: 先框架和标准库，再项目内部模块；现有 TypeScript 使用相对路径导入，Python 使用绝对包路径。
- **代码风格**: 前端 TypeScript 严格 `readonly` 类型、React 组件显式 props；后端 FastAPI router 只做 HTTP 转换，业务约束放 service。

### 3. 可复用组件清单

- `apps/web/components/home/HomeShell.tsx`: 首页对话台和子视图承载。
- `apps/web/components/home/HomeComposer.tsx`: Assistant 输入框和 query 跳转入口。
- `apps/web/components/home/AssistantToolTree.tsx`: 工具流程树展示组件。
- `apps/web/components/home/home-view.ts`: 首页 view query 契约。
- `apps/web/app/blueprints/api.tsx`: Blueprint、章节计划、BookRun Server Action 链路。
- `apps/web/lib/api-client.ts`: API 请求统一入口，注入 `X-StoryForge-API-Key` 并使用 `cache: "no-store"`。
- `apps/api/app/domains/book_runs/service.py`: BookRun 创建、恢复、暂停、停止、重试、进度回填。
- `apps/workflow/storyforge_workflow/tools/registry.py`: Runtime Tools 事实源。
- `apps/workflow/storyforge_workflow/skills/definitions.py`: Novel Skills 事实源。

### 4. 测试策略

- **测试框架**: Web 使用 `node:test` 加自定义 `apps/web/scripts/phase1-contract-test.mjs` 转译 TypeScript/TSX；API 使用 `pytest` 与 FastAPI TestClient；Workflow 使用 `pytest`。
- **参考文件**:
  - `apps/web/tests/home-page.test.tsx`: 首页源码契约和文案/结构回归。
  - `apps/web/tests/blueprints.test.tsx`: Blueprint API helper 与 Server Action 链路测试。
  - `apps/web/tests/book-runs.test.tsx`: BookRun 展示和导出 helper 测试。
  - `apps/api/tests/test_book_runs.py`: BookRun 创建、预算、进度、恢复测试。
  - `apps/api/tests/test_runtime_tools.py`: Runtime Tools 契约测试。
- **覆盖要求**: 正常流程、空输入、明确章节数、失败状态、暂停/等待状态、不可伪造完成节点。

### 5. 依赖和集成点

- **外部依赖**: Next.js App Router、React、TypeScript、FastAPI、SQLAlchemy、Pydantic、pytest、pnpm。
- **内部依赖**:
  - 首页输入 `HomeComposer` -> `view=projects&intent=...` -> `HomeShell/HomeProjectsPanel`。
  - Blueprint Server Action -> `/api/blueprints` -> `/api/book-runs`。
  - BookRun 状态 -> `AssistantToolNode[]` 映射 -> `AssistantToolTree`。
  - Runtime Tools/Novel Skills -> 工具能力和技能链说明。
- **配置来源**: Web API 通过 `apps/web/lib/api-client.ts` 读取环境变量；用户提供的真实 LLM base URL 和 API key 只允许通过当前进程环境变量传入验证命令，禁止写入仓库。

### 6. 技术选型理由

- **为什么用这个方案**: 计划要求“对话台前端 + 现有业务能力工具化 + 轻量 Assistant 编排适配层”，当前仓库已具备 Blueprint、BookRun、Runtime Tools、Novel Skills 和 Artifacts 事实源，最小风险方案是补前端适配层和薄 API 端点。
- **优势**: 不引入大而全 Agent 框架；状态来自真实业务源；测试能直接覆盖 helper、映射和 router。
- **劣势和风险**: 当前工作区已有大量未提交改动，普通 worktree 无法带走未跟踪计划和 UI 改动；需要小步修改并避免覆盖已有用户改动。

### 7. 关键风险点

- **伪造成功风险**: `home-data.ts` 当前存在静态 `assistantToolNodes`，必须迁移到 fixture 或让工具树接收真实节点。
- **章节规模风险**: `createBlueprintRequest()` 当前固定 3 章和固定 premise，必须由 `parseAssistantIntent()` 解析章节数、字数和分批参数。
- **控制端点风险**: `pause_book_run`、`stop_book_run`、`retry_book_run_from_checkpoint` 已存在 service，但 router 未暴露。
- **安全考虑**: API key 不写入 `.env`、源码、日志、报告或前端本地状态；Provider 凭据继续走受控环境变量。
- **性能瓶颈**: 长篇分卷必须通过 token/time/chapter 预算、checkpoint 和分批调度控制，不能一次性无界执行。

### 8. 外部资料记录

- Context7 查询 Next.js `/vercel/next.js`：确认 App Router `searchParams` 为 Promise 并应 await；Server Action 可由表单调用并使用 `redirect`；服务端 fetch 可用 `cache: "no-store"` 强制每次请求刷新。
- GitHub `search_code` 查询状态映射和确定性意图解析：未找到可直接复用实现；采纳的通用经验是状态映射应由事实源字段派生，不从静态展示数据推断。

### 9. 充分性检查

- □ 我能定义清晰接口契约吗？是：`AssistantIntent`、`AssistantToolNode`、`parseAssistantIntent()`、`mapBookRunToAssistantToolNodes()`。
- □ 我理解关键技术选型理由吗？是：先补前端适配层和 BookRun 控制端点，复用现有业务源。
- □ 我识别主要风险点吗？是：静态完成节点、固定三章、router 端点缺口、凭据泄露、长篇预算失控。
- □ 我知道如何验证实现吗？是：先跑 Web 红绿测试，再跑 API pytest，最后执行 lint、openapi 和真实 LLM smoke。
