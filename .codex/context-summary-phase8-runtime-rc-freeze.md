# 项目上下文摘要（第八阶段 Runtime 诊断治理收尾与发布候选冻结）

生成时间：2026-05-25 15:20:00 +08:00

## 1. 相似实现分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/storyforge_workflow/runtime/runner.py`
  - 模式：`WorkflowRuntime` 串联 session、lifecycle、provider execution、checkpoint、ModelRun sink 与 LangGraph。
  - 可复用：`WorkflowRuntime.start()`、`resume()`、`_emit_model_run_payload()`。
  - 需注意：本阶段只核验链路，不新增 runtime 抽象。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/runtime_tools/service.py`
  - 模式：API 延迟加载 workflow `CreativeToolRegistry`，避免维护第二份工具清单。
  - 可复用：`list_runtime_tools()` 和 `_to_jsonable()`。
  - 需注意：工具事实源应保持 workflow registry 单一来源。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/tests/e2e/phase5-runtime-diagnostics.spec.ts`
  - 模式：同一 e2e 文件校验 OpenAPI、API 响应、Web 字段和发布门禁脚本。
  - 可复用：`assertSchemaFields()`、`runApiPythonJson()`、`gateSources`。
  - 需注意：Runtime 契约治理已纳入既有 e2e，不新增并行契约文件。
## 2. 项目约定

- **命名约定**：Python 使用 `snake_case` 函数与字段、`PascalCase` 类；TypeScript 使用 `camelCase` 函数与 `PascalCase` 类型。
- **文件组织**：workflow runtime 位于 `apps/workflow/storyforge_workflow/runtime/`；API 按 domain 分为 router/service/schema/test；Web Runs 页面位于 `apps/web/app/runs/page.tsx`；e2e 位于根 `tests/e2e/`。
- **导入顺序**：Python 先 `from __future__ import annotations`，再标准库、第三方、项目内模块；Node e2e 使用 `node:*` 标准库导入。
- **代码风格**：文档、注释、测试描述和脚本输出均使用简体中文。

## 3. 可复用组件清单

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/package.json`：统一 `verify`、`test`、`e2e`、`openapi` 入口。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/verify-local.ps1`：发布前环境、Runtime 诊断门禁、OpenAPI Runtime 契约门禁。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/run-e2e.mjs`：先刷新 OpenAPI，再执行 Node/API/workflow 验证。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/packages/shared/src/contracts/storyforge.openapi.json`：共享 OpenAPI 快照。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/storyforge_workflow/tools/registry.py`：Runtime 工具单一事实源。
## 4. 测试策略

- **测试框架**：Python `pytest`、Node 内置 `node:test`、PowerShell 本地门禁、TypeScript `tsc --noEmit`。
- **发布入口**：`pnpm verify` 与 `pnpm e2e`；局部补充为 `pnpm --filter @storyforge/web test`、`pnpm --filter @storyforge/web exec tsc --noEmit`、API/workflow 定向 pytest。
- **Runtime 门禁**：`scripts/verify-local.ps1` 明确检查 `scripts/run-e2e.mjs` 包含 runtime diagnostics e2e、API runtime/model_runs 测试和 workflow runtime/provider/tool registry 测试。
- **OpenAPI 门禁**：Context7/FastAPI 文档确认 `app.openapi()` 返回 OpenAPI schema 字典；项目使用 `scripts/generate-openapi.ps1` 和 `run-e2e.mjs` 刷新同一 shared 快照。

## 5. 依赖和集成点

- Workflow runtime：`session.py` 管理会话快照，`lifecycle.py` 管理生命周期事件，`provider_adapter.py`/`provider_execution.py` 管理 provider 边界，`runner.py` 串联执行与 checkpoint/model run sink。
- API：`/api/runtime-tools` 从 workflow registry 派生工具；`/api/model-runs/job-runs/{job_run_id}` 聚合 `runtime_diagnostics`。
- Web：`apps/web/app/runs/page.tsx` 通过 `readRuntimeTools()` 和 `readRunsJobRun()` 读取 API，不维护静态工具清单。
- e2e：`tests/e2e/phase5-runtime-diagnostics.spec.ts` 校验 OpenAPI/API/Web/e2e/门禁一致性。

## 6. 技术选型理由

- 复用 FastAPI `app.openapi()` 与既有 shared OpenAPI 快照，避免新增契约机制。
- 复用 workflow `CreativeToolRegistry`，API 仅做序列化适配，避免重复工具清单。
- 复用 `run-e2e.mjs` 和 `verify-local.ps1`，避免新增发布脚本。
## 7. 核验事实

- 指定 Workflow runtime 文件均存在：`session.py`、`lifecycle.py`、`provider_adapter.py`、`provider_execution.py`、`runner.py`。
- 本地 API 探针返回 `/api/runtime-tools` 状态码 200、工具数量 7、重复名称为 False。
- OpenAPI 探针确认存在 `/api/runtime-tools`、`/api/model-runs/job-runs/{job_run_id}`、`/api/model-runs`，且 `RunsJobRunRead` 包含 `runtime_diagnostics`。
- `tests/e2e/phase5-runtime-diagnostics.spec.ts` 已包含 Phase 7 Runtime OpenAPI/API schema/Web/e2e 一致性断言。
- `scripts/verify-local.ps1` 已包含 `Test-RuntimeDiagnosticsGate` 与 `Test-OpenApiRuntimeContractGate`。

## 8. 检索限制与补偿

- 当前会话未暴露可调用的 `github.search_code` 工具；已用 `tool_search` 检索但未找到。补偿方式：以项目内既有实现、Context7 FastAPI 官方文档和本地可执行验证为依据。
- `desktop-commander.list_directory` 在本仓库仅返回目录元信息，未展开子项；补偿方式：仍优先使用 desktop-commander 的 `read_file`、`start_search`、`write_file`，目录枚举补充使用 PowerShell。

## 9. 风险点

- `pnpm verify` 依赖 Docker 与 `storyforge-postgres`、`storyforge-redis`、`storyforge-minio` 容器状态；若环境未启动会阻断发布候选。
- `pnpm e2e` 会刷新 OpenAPI 快照；若产生 diff，必须在冻结前解释并提交或回滚。
- 本阶段不删除未知文件、不新增功能；若发现非阻断性陈旧文件，只记录不清理。

## 10. 充分性检查

- 能说出至少三个相似实现路径：是，见第 1 节。
- 理解实现模式：是，workflow runtime、API 派生工具、e2e 契约门禁三层已确认。
- 知道可复用组件：是，见第 3 节。
- 理解命名与风格：是，见第 2 节。
- 知道测试方式：是，见第 4 节。
- 确认无重复造轮子：是，工具清单由 workflow registry 单源派生，API/Web/e2e 不维护第二份清单。
- 理解依赖与集成点：是，见第 5 节。
