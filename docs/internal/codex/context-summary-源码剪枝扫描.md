## 项目上下文摘要（源码剪枝扫描）

生成时间：2026-06-05 02:41:35 +08:00

### 1. 相似实现分析

- **API 入口模式**: `apps/api/app/main.py:25`
  - 模式：FastAPI 主应用集中导入领域 `router`，再通过 `app.include_router(...)` 挂载。
  - 可复用：`APIRouter` 领域模块结构、`app.models` ORM 聚合导入、`tests` 中的 API surface/领域测试。
  - 需注意：FastAPI 路由端点函数通常只有装饰器引用，不能按普通调用计数判死。
- **Workflow 图编排模式**: `apps/workflow/storyforge_workflow/graph.py:40`
  - 模式：`StateGraph(GenerationState)` 注册节点、边和条件路由，再 `compile(checkpointer=...)`。
  - 可复用：`runtime/runner.py` 的 `WorkflowRuntime`、`orchestrators/book_loop.py` 与 `novel_loop.py` 的端口注入模式。
  - 需注意：图节点由 `add_node` 注册，`SKILL.md` 由注册表引用，不能只按 Python import 判死。
- **Web App Router 模式**: `apps/web/app/page.tsx:1`
  - 模式：Next.js App Router 以 `page.tsx`、`layout.tsx`、`route.ts`、`loading.tsx`、`error.tsx` 作为框架入口。
  - 可复用：`apps/web/lib/api-client.ts` 的 `readJson/apiFetch`、`studio` 与 `artifacts` 的 `types/api/validators` 拆分。
  - 需注意：App Router 入口可能没有普通 import；动态导入组件也需要计入引用。

### 2. 项目约定

- **命名约定**：Python 使用 snake_case 函数与 PascalCase 类；TypeScript 使用 camelCase 函数和 PascalCase 组件；API payload 保持后端 snake_case。
- **文件组织**：`apps/api/app/domains/<domain>` 按 `router/service/schemas/models` 组织；`apps/workflow/storyforge_workflow` 按 `graph/runtime/orchestrators/nodes/skills/tools` 组织；`apps/web/app` 放页面入口，`components` 放复用组件，`packages/shared/src` 放 OpenAPI 类型和共享契约。
- **导入顺序**：Python 遵循 ruff/isort；TypeScript 使用相对导入和 `@storyforge/shared` 工作区包。
- **代码风格**：Python 行宽 120，TypeScript 严格模式，Prettier 单引号、分号、尾逗号、100 列。

### 3. 可复用组件清单

- `apps/api/app/main.py`: API 路由挂载真相源。
- `apps/api/app/models.py`: ORM 模型聚合真相源，不能按未直接路由判死。
- `apps/workflow/storyforge_workflow/graph.py`: LangGraph 节点和边的真相源。
- `apps/workflow/storyforge_workflow/skills/definitions.py`: 技能和题材技能元数据真相源。
- `apps/web/lib/api-client.ts`: Web 调 API 的统一入口。
- `packages/shared/src/index.ts`: Web/shared 类型导出入口。

### 4. 测试策略

- **API**：`cd apps/api && uv run pytest`，定向可运行领域测试；路由 surface 参考 `tests/test_api_surface.py`。
- **Workflow**：`cd apps/workflow && uv run pytest`，图和运行器参考 `tests/test_generation_graph.py`、`tests/test_runtime_runner.py`。
- **Web/shared**：`pnpm --filter @storyforge/web test` 与 `pnpm --filter @storyforge/shared test`；Web 测试使用 `node:test` 与静态源码断言。
- **本次扫描验证**：只读静态扫描，不改业务源码；以 `rg`、PowerShell 枚举、Context7 官方文档和 GitHub code search 作为证据。

### 5. 依赖和集成点

- **外部依赖**：FastAPI、LangGraph、Next.js、React、TypeScript、Pydantic、pytest、ruff。
- **内部依赖**：
  - API `main.py` 挂载领域 router，领域服务调用共享模型和跨领域服务。
  - Workflow `runtime/runner.py` 调用 `create_generation_graph` 和 provider execution；`book_run_adapter.py` 串联 BookLoop、NovelLoop 和技能 runner。
  - Web 页面通过 `api-client.ts` 调 API，并通过 shared OpenAPI 类型约束响应。
- **配置来源**：根 `package.json`、`apps/api/pyproject.toml`、`apps/workflow/pyproject.toml`、`apps/web/package.json`、`apps/web/tsconfig.json`、`eslint.config.mjs`。

### 6. 技术选型理由

- **FastAPI 入口保护**：官方文档确认 `app.include_router()` 是大型应用合并路由的启动期入口，因此端点函数低调用计数不是死代码证据。
- **Next.js 入口保护**：官方文档确认 App Router 使用文件系统路由，`page.tsx` 与 `layout.tsx` 是入口文件。
- **LangGraph 入口保护**：官方示例使用 `StateGraph.add_node/add_edge/compile` 建立动态图，节点函数可由图调用。
- **开源参考**：GitHub 搜索 `vercel/next.js` App Router 相关文件，确认 Next.js 自身围绕文件约定解析路由，静态 import 不是唯一入口来源。

### 7. 关键风险点

- **误报风险**：装饰器路由、App Router 文件、LangGraph 节点、动态 `import()`、技能元数据文件都可能没有普通调用。
- **重复职责风险**：兼容 API 与新 API 并存、provider client 与 adapter 并存、页面内验证器与集中 validators 并存，会造成维护成本。
- **安全考虑**：本次不删除、不改认证/鉴权/限流/安全头相关代码；所有建议均需后续单独测试和迁移计划。
- **性能考虑**：扫描排除 `node_modules`、`.next`、`.venv`、`__pycache__`、`.pytest_cache`、`.pytest-tmp`，避免无效 I/O。

## 扫描结论摘要

### 高置信疑似死代码

- `apps/web/lib/phase6-data-sources.ts`
  - 证据：`rg -n 'phase6DataSources|phase6FirstDataSourceSpike|Phase6DataSource|phase6-data-sources' apps/web packages/shared apps/web/tests` 只命中本文件自身。
  - 置信度：高。
  - 建议：下一轮可先移除并运行 `pnpm --filter @storyforge/web test` 与 `pnpm --filter @storyforge/web lint`。

### 中置信仅测试/规划式代码

- `apps/web/components/home/assistant-tool-events.ts`
  - 证据：生产代码未导入，`home-page.test.tsx` 只检查文件包含解析函数。
  - 置信度：中。
  - 建议：确认是否计划接入实时工具事件；若没有，移除测试约束和文件。
- `apps/web/components/home/assistant-workflows.ts`
  - 证据：当前主要由 `assistant-workflows.test.ts` 覆盖，未进入首页业务链路。
  - 置信度：中。
  - 建议：产品化接入 Assistant UI，或归档为设计草案后移除。
- `apps/workflow/storyforge_workflow/longform.py`
  - 证据：主要由 `tests/test_longform_generation.py` 和模块 CLI 入口覆盖，未进入 `WorkflowRuntime` 或 BookRun adapter。
  - 置信度：中。
  - 建议：若长文 CLI 不再作为运行入口，可迁移到 scripts 或归档；否则保留为独立工具。

### 重复职责和重构候选

- `apps/api/app/domains/batch_refinement` 与 `apps/api/app/domains/batch_refinery`
  - 证据：两个 router 分别暴露 `/api/batch-refinement` 与 `/api/batch-refinery`，命名和职责均指向批量精修；前者标签含“兼容”。
  - 置信度：中。
  - 建议：先统计 Web、脚本、外部客户端是否仍调用兼容路径，再制定破坏式迁移。
- `apps/workflow/storyforge_workflow/provider_client.py` 与 `runtime/provider_adapter.py`
  - 证据：`ProviderClientAdapter` 包装 `provider_client.generate_text/provider_config`，同时节点仍直接导入 `generate_text`。
  - 置信度：中。
  - 建议：后续将节点侧 provider 调用统一到 adapter/ports，降低双入口维护面。
- Web 页面内验证器与集中 validators
  - 证据：`studio`、`artifacts` 已有 `types/api/validators` 模式，但 `ide/page.tsx`、`runs/page.tsx`、`retrieval/page.tsx`、`worldbuilding/page.tsx` 仍内联大量 `isRecord` 和响应验证器。
  - 置信度：中。
  - 建议：按页面逐步拆出 `types.ts` 与 `validators.ts`，优先处理 `ide/page.tsx` 和 `runs/page.tsx`。

### 不建议剪枝的误报保护项

- API `books`、`jobs`、`context_compiler`、`story_memory` 没有直接 router，但被大量领域服务、ORM 聚合和测试引用，是共享内核而非死代码。
- API router 端点函数调用计数低属于 FastAPI 装饰器入口特征。
- Workflow `SKILL.md` 由 `skills/definitions.py` 的 `source_refs` 和题材注册表管理，不能按 Python import 判死。
- Next.js `page.tsx/layout.tsx/route.ts/loading.tsx/error.tsx` 是框架入口，不能按普通 import 判死。
