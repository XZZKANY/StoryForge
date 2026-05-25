# 项目上下文摘要（第七阶段 Runtime 契约治理）

生成时间：2026-05-25 05:02:22 +08:00

## 1. 相似实现分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/tests/e2e/phase5-runtime-diagnostics.spec.ts`
  - 模式：Node `node:test` 同时校验 OpenAPI、真实 FastAPI TestClient 响应、Web 源码证据和发布前门禁脚本。
  - 可复用：`assertSourceEvidence()`、`runApiPythonJson()`、`gateSources`。
  - 需注意：第七阶段应扩展该文件，避免新增第二套契约文件。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/generate-openapi.ps1`
  - 模式：从 `app.main:app.openapi()` 生成 `packages/shared/src/contracts/storyforge.openapi.json`。
  - 可复用：`pnpm openapi` 作为 shared contract 快照刷新入口。
  - 需注意：OpenAPI 快照必须与 FastAPI 当前 schema 保持一致。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/run-e2e.mjs`
  - 模式：e2e 前刷新同一 shared OpenAPI 快照，再执行 node/API/workflow 验证。
  - 可复用：默认 e2e 与 API/workflow pytest target。
  - 需注意：Runtime 契约治理应纳入现有 e2e，而不是新脚本。
- **实现4**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/runtime_tools/schemas.py`
  - 模式：`RuntimeToolRead` / `RuntimeToolReferencesRead` Pydantic schema 定义 Runtime Tools API 输出。
  - 可复用字段：`name`、`domain`、`input_schema`、`output_schema`、`required_capabilities`、`evidence_fields`、`references.page_refs/api_paths/workflow_nodes`。
  - 需注意：第七阶段只校验关键字段，不复制完整 schema。
- **实现5**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/model_runs/schemas.py`
  - 模式：ModelRun 与 Runs Runtime Diagnostics schema 统一在 model_runs domain 中定义。
  - 可复用字段：`ModelRunRead`、`RunsJobRunRead`、`RunsRuntimeDiagnosticsRead`、`RunsWorkflowSessionSummary`、`RunsWorkflowLifecycleSummary`、`RunsProviderSummary`、`RunsModelUsageSummary`、`RunsRuntimeToolSummary`。
  - 需注意：当前真实 Runtime Diagnostics API 是 `/api/model-runs/job-runs/{job_run_id}`，不是独立 domain。

## 2. 项目约定

- **命名约定**：OpenAPI schema 名称与 Pydantic 类名一致；Python 使用 `snake_case` 字段；Web 类型沿用同名 snake_case JSON 字段。
- **文件组织**：API schema 在 `apps/api/app/domains/*/schemas.py`；shared 快照在 `packages/shared/src/contracts/storyforge.openapi.json`；Web 读取在 `apps/web/app/runs/page.tsx`；e2e 契约在 `tests/e2e`。
- **导入顺序**：Node e2e 先导入 `node:*` 标准库；Python 先 future，再第三方和项目模块。
- **代码风格**：测试标题、断言文案、脚本输出和文档使用简体中文。
## 3. 可复用组件清单

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/package.json`: `openapi`、`verify`、`e2e` 发布前入口。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/generate-openapi.ps1`: shared OpenAPI 快照生成脚本。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/run-e2e.mjs`: e2e 前 OpenAPI 刷新与 API/workflow 验证入口。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/packages/shared/src/contracts/storyforge.openapi.json`: shared contract 快照。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/runtime_tools/schemas.py`: Runtime Tools API schema。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/model_runs/schemas.py`: ModelRun 与 Runtime Diagnostics schema。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/app/runs/page.tsx`: `/runs` 页面 Runtime 字段读取和类型守卫。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/tests/e2e/phase5-runtime-diagnostics.spec.ts`: 可承载第七阶段关键字段治理断言。

## 4. 测试策略

- **测试框架**：Node 内置 `node:test`、FastAPI `app.openapi()`、PowerShell `pnpm openapi`、统一 `run-e2e.mjs`。
- **测试模式**：先新增 Phase7 契约治理断言并观察红灯；再最小修改，使 API schema、shared OpenAPI 快照、Web 源码字段和 e2e 声明一致。
- **覆盖要求**：只校验关键字段，不复制完整 schema。
- **参考文件**：`tests/e2e/phase4-contract.spec.ts`、`tests/e2e/phase5-runtime-diagnostics.spec.ts`、`apps/web/tests/phase1-navigation.test.tsx`。
## 5. 依赖和集成点

- **外部依赖**：Node.js、PowerShell、uv/Python、FastAPI OpenAPI 生成。
- **内部依赖**：`pnpm openapi` 写 shared 快照；`pnpm e2e` 通过 `run-e2e.mjs` 刷新同一快照；`/runs` 页面通过 `readJson()` 读取 `/api/model-runs/job-runs/{id}` 与 `/api/runtime-tools`。
- **集成方式**：扩展既有 e2e 契约测试，必要时扩展 `run-e2e.mjs` 默认 e2e 声明，不新增第二套契约文件。
- **配置来源**：`package.json` scripts 与 `scripts/generate-openapi.ps1`。

## 6. 技术选型理由

- **为什么用这个方案**：FastAPI 官方支持 `app.openapi()` 生成 OpenAPI 字典；项目已经用 `generate-openapi.ps1` 与 `run-e2e.mjs` 写入同一 shared 快照。
- **优势**：无需新增契约文件；关键字段治理可以快速发现 API schema、shared snapshot、Web 字段和 e2e 声明漂移。
- **劣势和风险**：关键字段数组仍是测试内的治理清单；不替代完整 schema diff，但符合“不复制完整 schema”的约束。

## 7. 关键风险点

- **OpenAPI 漂移**：API schema 修改后未运行 `pnpm openapi`，shared 快照会陈旧。
- **Web 字段漂移**：`/runs` 类型守卫可能漏掉新增关键字段，或页面渲染字段与 API schema 不一致。
- **测试遗漏**：e2e 只验证大方向时可能漏掉 nested schema 的字段变更。
- **环境阻断**：`pnpm verify` 依赖 Docker daemon，当前机器可能继续因 Docker 未运行失败。

## 8. 上下文充分性检查

- 能定义清晰接口契约：是，契约围绕 RuntimeToolRead、ModelRunRead、RunsJobRunRead、RunsRuntimeDiagnosticsRead 关键字段。
- 理解关键技术选型理由：是，复用 FastAPI `app.openapi()` 和 shared OpenAPI 快照。
- 识别主要风险点：是，OpenAPI 快照漂移、Web 字段漂移、verify Docker 依赖。
- 知道如何验证实现：是，运行局部 e2e、`pnpm openapi`、全量 e2e、`pnpm verify` 并记录结果。
