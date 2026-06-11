# 项目上下文摘要（第六阶段 Runtime 诊断门禁）

生成时间：2026-05-25 04:39:42 +08:00

## 1. 相似实现分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/tests/e2e/phase5-runtime-diagnostics.spec.ts`
  - 模式：Node 内置 `node:test` + `node:assert/strict` 做源码、OpenAPI、真实 FastAPI TestClient 契约校验。
  - 可复用：`assertSourceEvidence()`、`assertNoSourceEvidence()`、`runApiPythonJson()`。
  - 需注意：e2e 应证明字段来自真实 API，不应只检查页面硬编码。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/run-e2e.mjs`
  - 模式：刷新 OpenAPI 后依次运行 node:test、API pytest、workflow pytest。
  - 可复用：现有 `runApiVerification()`、`runWorkflowVerification()`、`runPythonCommand()`。
  - 需注意：不能新增平行验证脚本，Runtime 门禁应接入该入口。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/verify-local.ps1`
  - 模式：PowerShell 本地预检函数，失败时统一设置 `$Failed` 并最终退出 1。
  - 可复用：`Write-Ok`、`Write-Fail`、`Test-RequiredPath` 风格。
  - 需注意：当前只检查环境与 Docker，不能证明 Runtime 诊断测试未被移除。
- **实现4**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_model_runs.py`
  - 模式：pytest + FastAPI TestClient 验证 `GET /api/model-runs/job-runs/{job_run_id}` 聚合读模型。
  - 可复用：`run_scope` fixture、`session_factory` 修改 JobRun/ModelRun 的真实数据库路径。
  - 需注意：第五阶段真实 Runtime Diagnostics API 复用 `model_runs` domain，不存在独立 `runtime_diagnostics` domain。
- **实现5**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/tests/test_runtime_runner.py`
  - 模式：workflow runtime 测试统一从内存 store、adapter 和 sink 验证 Session/Lifecycle/ModelRun 流。
  - 可复用：workflow pytest target 应由 `run-e2e.mjs` 统一调用。
  - 需注意：第六阶段不改 workflow 抽象，只把既有测试纳入门禁。

## 2. 项目约定

- **命名约定**：Python 测试文件使用 `test_*.py`，测试函数使用 `test_*`；Node e2e 文件使用 `phaseN-*.spec.ts`；脚本函数使用动宾短语。
- **文件组织**：API 测试在 `apps/api/tests`，workflow 测试在 `apps/workflow/tests`，跨端 e2e 契约在 `tests/e2e`，发布前入口在 `scripts`。
- **导入顺序**：Node e2e 先导入 `node:*` 标准库；Python 先 `from __future__ import annotations`，再标准库、第三方、项目模块。
- **代码风格**：用户可见文案、测试描述、注释和脚本输出均使用简体中文；Runtime 事实源通过 API/registry 派生，Web 不维护重复工具清单。
## 3. 可复用组件清单

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/run-e2e.mjs`: 统一运行 OpenAPI 刷新、node:test、API pytest、workflow pytest。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/verify-local.ps1`: `pnpm verify` 入口，适合增加轻量门禁完整性检查。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/tests/e2e/phase5-runtime-diagnostics.spec.ts`: 已有 Runtime 诊断 e2e 契约，可扩展发布前门禁断言。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_model_runs.py`: Runtime Diagnostics API 真实测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_runtime_tools.py`: Runtime Tools API 真实测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/tests/test_workflow_session.py`: WorkflowSession 专项测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/tests/test_workflow_lifecycle.py`: WorkflowLifecycle 专项测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/tests/test_provider_adapter.py`: ProviderAdapter 专项测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/tests/test_provider_parity_harness.py`: Mock Provider Parity Harness 专项测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/tests/test_creative_tool_registry.py`: CreativeToolRegistry 专项测试。

## 4. 测试策略

- **测试框架**：Node 内置 `node:test`、pytest、PowerShell 脚本退出码。
- **测试模式**：先新增发布前门禁契约断言并观察红灯；再修改现有脚本使断言绿灯。
- **参考文件**：`tests/e2e/phase4-contract.spec.ts`、`tests/e2e/phase5-runtime-diagnostics.spec.ts`、`apps/web/tests/phase1-navigation.test.tsx`。
- **覆盖要求**：`pnpm e2e` 默认链路必须覆盖 Phase5 e2e、Runtime Tools API、Runtime Diagnostics API、workflow runtime 五个专项测试；`pnpm verify` 必须能发现门禁 target 被误删。
## 5. 依赖和集成点

- **外部依赖**：Node.js `--test` 运行器、PowerShell、uv/pytest、Docker 容器预检。
- **内部依赖**：`pnpm e2e` 调用 `scripts/run-e2e.mjs`；`pnpm verify` 调用 `scripts/verify-local.ps1`；`run-e2e.mjs` 在 API/workflow 子项目下运行 pytest。
- **集成方式**：不新增脚本，直接扩展现有 e2e workflow pytest target 与 verify 静态门禁检查。
- **配置来源**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/package.json` 中 `verify` 和 `e2e` scripts。

## 6. 技术选型理由

- **为什么用这个方案**：用户明确要求优先复用现有验证入口，不新增平行验证脚本；现有 `run-e2e.mjs` 已是 Runtime 跨端闭环入口。
- **优势**：改动小、可审计、不会引入新的 runtime 抽象；`pnpm e2e` 执行真实测试，`pnpm verify` 轻量防止门禁被移除。
- **劣势和风险**：`pnpm verify` 仍不是全量 e2e 执行，只能静态检查门禁完整性；真正执行能力由 `pnpm e2e` 承担。

## 7. 关键风险点

- **并发问题**：无新增并发逻辑。
- **边界条件**：用户指定 `apps/api/app/domains/runtime_diagnostics/` 与 `test_runtime_diagnostics.py` 不存在；不能为迎合路径新增空 domain。
- **性能瓶颈**：`run-e2e.mjs` 增加 workflow pytest target 会增加少量测试时间；verify 静态读取脚本成本可忽略。
- **安全考虑**：本阶段不新增认证、鉴权、加密或审计逻辑。

## 8. 上下文充分性检查

- 能定义清晰接口契约：是，修改范围限定为 `run-e2e.mjs` workflow target、`verify-local.ps1` 静态门禁、Phase5 e2e 契约断言。
- 理解技术选型理由：是，复用现有发布前入口，避免平行脚本。
- 识别主要风险点：是，重点是 verify 只做静态门禁与不存在 runtime_diagnostics domain 的证据冲突。
- 知道如何验证实现：是，执行红灯测试、局部 e2e、全量 e2e、`pnpm run verify`，并记录结果。
