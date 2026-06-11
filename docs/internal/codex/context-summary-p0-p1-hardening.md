## 项目上下文摘要（P0/P1 安全与可观测性修复）

生成时间：2026-06-10 22:12:55 +08:00

### 1. 相似实现分析

- **Web BFF 代理**: `apps/web/app/api/book-runs/[bookRunId]/events/route.ts`
  - 模式：Next.js App Router Route Handler 在服务端调用 `apiFetch`，再把上游响应转为同源响应。
  - 可复用：动态参数读取、上游状态码透传、`Cache-Control` 设置。
  - 需注意：浏览器侧不应导入 `lib/api-client.ts`，只访问同源 BFF。
- **Web workspaces 代理**: `apps/web/app/api/workspaces/route.ts`
  - 模式：Route Handler 通过 `apiFetch` 注入服务端 API key，并对后端不可达做本地降级。
  - 可复用：服务端统一认证边界和 `NextResponse.json`。
  - 需注意：IDE command BFF 应透传错误而不是静默空数组。
- **Artifacts 路由与服务**: `apps/api/app/domains/artifacts/router.py`、`apps/api/app/domains/artifacts/service.py`
  - 模式：router 层把 service 异常映射为 HTTP 状态，service 层负责 ORM 读取和领域错误。
  - 可复用：`ArtifactNotFoundError`、`get_artifact`、`read_artifact_download`。
  - 需注意：新增 `workspace_id` 不匹配应返回 403，资源不存在仍保持 404。
- **Exports 路由与服务**: `apps/api/app/domains/exports/router.py`、`apps/api/app/domains/exports/service.py`
  - 模式：`GET /api/books/{book_id}/exports/{format}` 调 service 生成内容，缺资源转 404。
  - 可复用：`_load_export_source` 集中读取 Book 与 approved Scene。
  - 需注意：本轮要求 `workspace_id` 为强制查询参数，缺参由 FastAPI 返回 422。
- **ModelRun/BookRun 可观测性**: `apps/api/app/domains/model_runs/*`、`apps/api/app/domains/book_runs/*`
  - 模式：SQLAlchemy 2.0 `Mapped/mapped_column`、Pydantic v2 schema、service helper、router response_model。
  - 可复用：`record_runtime_model_run`、`record_failed_runtime_model_run`、`record_workflow_model_run_payload`、`apply_book_run_progress`。
  - 需注意：`token_usage` 是现有读侧兼容字段，新增 token 拆分字段不能替代它。
- **Workflow ProviderAdapter**: `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`
  - 模式：`ProviderRequest`、`ProviderResponse`、`ProviderError`、`FallbackProviderAdapter` 组成统一边界。
  - 可复用：已有 `prompt_tokens`、`completion_tokens`、`cost_estimate`、`fallback_metadata` 字段和成本估算表。
  - 需注意：当前真实 client 只返回字符串，adapter 使用估算 token；本轮需要优先使用 provider usage，缺失时再估算。

### 2. 项目约定

- **命名约定**: TypeScript 使用 camelCase helper 与 PascalCase React 组件；Python 函数和 JSON 字段使用 snake_case，Pydantic/ORM 类使用 PascalCase。
- **文件组织**: Web 按 `apps/web/app` Route Handler、`components` 组件、`lib` 服务端 client 分层；API 按 domain 的 `models/schemas/service/router` 分层；Workflow 按 `provider_client.py` 与 `runtime/*` 分层。
- **导入顺序**: Python 使用 `from __future__ import annotations` 开头，标准库、第三方、项目内依次导入；TypeScript 先外部包再本地模块。
- **代码风格**: 测试描述、注释、错误信息使用简体中文；pytest 使用 plain assert；Web 使用 `node:test` 与 `assert` 的源码约束和行为测试。

### 3. 可复用组件清单

- `apps/web/lib/api-client.ts`: 服务端统一 FastAPI client，需要加入 `server-only` 并强制读取 `STORYFORGE_API_KEY`。
- `apps/web/app/api/book-runs/[bookRunId]/events/route.ts`: BFF 转发模式参考。
- `apps/api/app/domains/artifacts/service.py`: 制品读取、下载摘要和缓存失效工具。
- `apps/api/app/domains/exports/service.py`: 作品导出来源读取与制品登记。
- `apps/api/app/domains/model_runs/service.py`: ModelRun 真表写入、workflow payload 接收与 Runs 摘要聚合。
- `apps/api/app/domains/book_runs/service.py`: BookRun progress 回填、预算聚合和 checkpoint 派生。
- `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`: provider 响应、错误、fallback 和成本估算边界。
- `apps/workflow/storyforge_workflow/runtime/checkpoints.py`: `ModelRunPayload` 到 API payload 的映射边界。

### 4. 测试策略

- **Web 测试框架**: `node:test` + `assert`，命令 `pnpm --filter @storyforge/web test`。
- **API 测试框架**: pytest + FastAPI TestClient + SQLite 内存库，命令 `cd apps/api && uv run pytest ... -q`。
- **Workflow 测试框架**: pytest，命令 `cd apps/workflow && uv run pytest ... -q`。
- **参考文件**:
  - `apps/web/tests/api-client.test.ts`
  - `apps/web/tests/ide-command-registry.test.tsx`
  - `apps/api/tests/test_artifacts.py`
  - `apps/api/tests/test_exports.py`
  - `apps/api/tests/test_model_runs.py`
  - `apps/api/tests/test_book_runs.py`
  - `apps/workflow/tests/test_provider_adapter.py`
  - `apps/workflow/tests/test_provider_fallback.py`
  - `apps/workflow/tests/test_model_run_token_tracking.py`
- **覆盖要求**: 正常流程、缺参 422、错 `workspace_id` 403、资源不存在 404、真实 usage、Retry-After、错误 kind、fallback metadata、runtime sink payload。

### 5. 依赖和集成点

- **外部依赖**: Next.js App Router、FastAPI、SQLAlchemy 2.0、Pydantic v2、Alembic、pytest、node:test。
- **内部依赖**:
  - Web `command-client.ts` 只能依赖浏览器 `fetch`，由 BFF 依赖 `apiFetch`。
  - Artifact 下载与 Book 导出依赖资源的 `workspace_id` 所属关系。
  - Workflow `ProviderClientAdapter` 依赖 `provider_client` 的完整 Chat Completion 结果。
  - API `record_workflow_model_run_payload` 依赖 Workflow `ModelRunPayload.to_api_payload` 输出字段。
- **配置来源**:
  - Web API base/key: `STORYFORGE_API_BASE_URL`、`STORYFORGE_API_KEY`。
  - Workflow LLM: `STORYFORGE_LLM_*` 和 `STORYFORGE_LLM_FALLBACK_*`。
- **OpenAPI/shared types**: API schema 变更后必须运行 `pnpm openapi` 和 `pnpm --filter @storyforge/shared generate:types`。

### 6. 技术选型理由

- **为什么用 BFF**: 现有 Web 已有 Route Handler 代理模式，可把 API key 留在服务端，并让浏览器只访问同源路径。
- **为什么用 Query 必填参数**: FastAPI 对无默认值查询参数自动返回 422，符合用户要求的缺参行为。
- **为什么扩展现有 ProviderAdapter**: 已有冻结 dataclass、fallback metadata、成本估算和 runtime sink，扩展能避免新增自研 provider 框架。
- **优势**: 改动贴合现有边界，测试和 OpenAPI 能直接验证。
- **劣势和风险**: 跨模块同步面大；迁移 head、shared types 和旧测试容易遗漏。

### 7. 关键风险点

- **并发问题**: BookRun latency 聚合应在 progress 回填内稳定写入，避免多处重复计算导致读侧不一致。
- **边界条件**: `workspace_id` 不匹配必须是 403；资源不存在不能泄露归属信息，保持 404。
- **性能瓶颈**: 新增校验只做主键读取后的归属比较；Runs 摘要应沿用现有 ModelRun 列表聚合。
- **安全考虑**: `api-client.ts` 加 `server-only`，浏览器侧删除对 `apiFetch` 的动态导入，缺少 `STORYFORGE_API_KEY` 时抛中文错误。

### 8. 外部资料来源与用途

- Context7 `/vercel/next.js`: 确认 `import 'server-only'` 用于阻止客户端误导入，Route Handler 动态参数通过 `params` 获取。
- Context7 `/fastapi/fastapi`: 确认必填 query 参数缺失会由 FastAPI/Pydantic 校验返回 422，HTTPException 状态码按设置返回。
- Context7 `/websites/sqlalchemy_en_20`: 确认 SQLAlchemy 2.0 `Mapped`、`mapped_column`、nullable/ForeignKey/relationship 模式。

### 9. 工具缺失记录

- 未发现 `desktop-commander` 工具；本轮使用 PowerShell、`rg`、`Get-Content` 做本地检索与读取。
- 未发现 `github.search_code` 工具；本轮未进行 GitHub 开源代码搜索，改用 Context7 官方文档和项目内实现作为依据。
- 上述替代方式已通过 `tool_search` 探测结果确认。

### 10. 上下文充分性验证

- □ 我能说出至少 3 个相似实现的文件路径吗？
  - 是：`apps/web/app/api/book-runs/[bookRunId]/events/route.ts`、`apps/web/app/api/workspaces/route.ts`、`apps/api/app/domains/artifacts/router.py`、`apps/api/app/domains/exports/router.py`、`apps/workflow/storyforge_workflow/runtime/provider_adapter.py`。
- □ 我理解项目中这类功能的实现模式吗？
  - 是：Web BFF 代理、API router/service 异常映射、ORM/schema/service/router 分层、Workflow provider adapter 分层。
- □ 我知道项目中有哪些可复用工具函数/类吗？
  - 是：`apiFetch`、`readJson`、`get_artifact`、`read_artifact_download`、`record_workflow_model_run_payload`、`ProviderResponse`、`ModelRunPayload`。
- □ 我理解项目命名约定和代码风格吗？
  - 是：TypeScript camelCase/PascalCase，Python snake_case/PascalCase，测试和错误提示简体中文。
- □ 我知道如何测试这个功能吗？
  - 是：参考上述 Web/API/Workflow 测试文件，先补红灯，再跑定向命令。
- □ 我确认没有重复造轮子吗？
  - 是：已检查 Web BFF、Artifacts/Exports、ModelRun/BookRun、ProviderAdapter/ModelRunPayload 现有边界。
- □ 我理解这个功能的依赖和集成点吗？
  - 是：Web 浏览器/BFF/server-only 边界，API workspace 归属边界，Workflow usage/error 到 API ModelRun 的 payload 边界。
