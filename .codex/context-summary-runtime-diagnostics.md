## 项目上下文摘要（运行时诊断视图）

生成时间：2026-05-25 03:40:52 +08:00

### 1. 相似实现分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/runtime_tools/service.py:1-74`
  - 模式：API service 延迟加载 workflow registry，并转换为 FastAPI 可序列化只读 DTO。
  - 可复用：`list_runtime_tools()`、`RuntimeToolRead`、`RuntimeToolReferencesRead`。
  - 需注意：Web 不应直接引用 `DEFAULT_CREATIVE_TOOL_REGISTRY`，工具事实源必须由 API 派生。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/model_runs/service.py:31-74`
  - 模式：读侧聚合 `JobRun`、`progress`、`checkpoint` 与 `ModelRun` 摘要。
  - 可复用：`get_runs_job_run()`、`list_model_runs()`、`record_runtime_model_run()`。
  - 需注意：当前响应缺少 `runtime_diagnostics`，可在不改变核心 runtime 的前提下扩展读模型。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/app/runs/page.tsx:1-308`
  - 模式：Next.js App Router async Server Component 通过 `readJson()` 读取真实 API 并用类型守卫校验。
  - 可复用：`readRunsJobRun()`、`readRuntimeTools()`、`isRunsJobRun()`。
  - 需注意：已有 runtime tools 全量展示，但还没有单次运行工具能力、可恢复性、失败分类和聚合 usage 视图。
- **实现4**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/storyforge_workflow/runtime/lifecycle.py:1-119`
  - 模式：`WorkflowLifecycleStatus` 与 `WorkflowFailureKind` 使用字符串枚举定义机器可读状态和失败分类。
  - 可复用：状态名、失败分类名、`recoverable` 语义。
  - 需注意：API 当前无法直接读取 workflow 内存 store，应从已同步到 `JobRun.progress` 的字段和错误摘要派生展示。

### 2. 项目约定

- **命名约定**: Python 函数和字段使用 `snake_case`，类与 Pydantic 模型使用 `PascalCase`；TypeScript 类型 `PascalCase`，函数和常量 `camelCase`。
- **文件组织**: API 按 `router.py` / `service.py` / `schemas.py` / `models.py` 分层；Web 页面保留在 `apps/web/app/<route>/page.tsx`；e2e 放在根 `tests/e2e`。
- **导入顺序**: Python 先 `from __future__ import annotations`，再标准库、第三方、项目内模块；TypeScript 先外部或相对导入，再类型定义与函数。
- **代码风格**: 用户可见文案、注释、测试描述均使用简体中文；Web 使用 Server Component 和 readonly 类型；API 使用 Pydantic BaseModel 与 FastAPI response_model。

### 3. 可复用组件清单

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/runtime_tools/service.py`: `list_runtime_tools()` 提供 CreativeToolRegistry 派生工具事实源。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/model_runs/service.py`: `get_runs_job_run()` 是 `/runs` 页面主数据 API。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/model_runs/schemas.py`: `RunsJobRunRead` 与 `RunsModelRunSummary` 是扩展点。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/lib/api-client.ts`: `readJson()` 和 `apiFetch()` 统一 API Key 与 `cache: "no-store"`。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/tests/e2e/phase4-contract.spec.ts`: `runApiPythonJson()` 模式可用于验证真实 API 与 registry 一致。
### 4. 测试策略

- **测试框架**: API 使用 `pytest` + FastAPI `TestClient` + SQLite 内存库；Web 使用 `node:test` 静态源码契约；e2e 使用 `node:test` 并在需要时运行 API 内嵌 Python 脚本。
- **测试模式**: 先写失败测试，再实现后端 schema/service、Web 类型守卫和 e2e 契约。
- **参考文件**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_model_runs.py`、`D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/tests/phase1-navigation.test.tsx`、`D:/StoryForge/1-renovel-ai-ai-rag-tavern/tests/e2e/phase4-contract.spec.ts`。
- **覆盖要求**: 正常读取、失败可恢复摘要、失败分类、provider/model/token/latency 聚合、工具能力来自 API/registry。

### 5. 依赖和集成点

- **外部依赖**: FastAPI、Pydantic、SQLAlchemy、Next.js App Router、React、node:test。
- **内部依赖**: `JobRun.progress` 承载 runtime 同步字段；`ModelRun` 真表承载 provider/model/usage；`runtime_tools.service` 承载工具 registry 派生能力。
- **集成方式**: 继续使用 `GET /api/model-runs/job-runs/{job_run_id}` 作为 `/runs` 主数据接口；`/api/runtime-tools` 保留为工具事实源；`/runs` 不新增客户端交互。
- **配置来源**: Web API base 和 key 来自 `apps/web/lib/api-client.ts`；API Key 默认由 `app/main.py` 的 `local-dev-key` 提供。

### 6. 技术选型理由

- **为什么用这个方案**: 读侧聚合能满足展示需求，不改变 workflow runtime 核心抽象，也不需要跨进程读取内存 store。
- **优势**: 与现有 `/runs` API 和页面路径兼容；工具清单仍由 API 从 registry 派生；测试可完全本地重复。
- **劣势和风险**: WorkflowSession/Lifecycle 的实时内存事件只能通过 `JobRun.progress` 同步快照展示，不能宣称是完整事件流。

### 7. 关键风险点

- **并发问题**: 只读聚合不写入共享状态；retry 创建任务逻辑不在本阶段改动。
- **边界条件**: 缺少 thread_id、无 ModelRun、无 runtime tool 命中时必须展示明确空状态。
- **性能瓶颈**: 单 JobRun 下 ModelRun 列表聚合为 O(n)，runtime tools 使用已缓存 registry 加载。
- **安全考虑**: 本阶段不把安全作为验收目标，只沿用已有 API Key 中间件和本地测试头。
