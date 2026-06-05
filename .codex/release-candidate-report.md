# 第八阶段发布候选报告

生成时间：2026-05-25 15:45:00 +08:00

## 1. 发布候选结论

- 结论：通过，允许进入发布候选冻结。
- 冻结范围：当前 `D:/StoryForge/1-renovel-ai-ai-rag-tavern` 工作区内 Runtime 诊断治理、OpenAPI 契约治理、API/Web/e2e/门禁相关变更。
- 本阶段行为：只做核验、环境启动、报告生成；未新增业务功能、未新增 runtime 抽象、未接 MCP、未做插件动态安装、未引入 `C:\Users\kanye\claw-code` Rust 代码、未删除未知文件。

## 2. Runtime 能力链路

- Workflow runtime 文件齐备：`session.py`、`lifecycle.py`、`provider_adapter.py`、`provider_execution.py`、`runner.py`。
- `WorkflowRuntime` 串联 session、lifecycle、provider execution、checkpoint、ModelRun sink 与 graph 执行。
- API 读侧通过 `/api/model-runs/job-runs/{job_run_id}` 聚合 `runtime_diagnostics`。
- API 读侧仍通过 `/api/model-runs/job-runs/{job_run_id}` 聚合 runtime diagnostics，Web 旧 `/runs` 深链通过 redirect 进入 IDE runs 面板；IDE 面板读取 BookRun 与 `/api/ide/runs/{book_run_id}/events` SSE，不维护静态工具清单。

## 3. 工具清单冻结

- 单一事实源：`apps/workflow/storyforge_workflow/tools/registry.py`。
- API 派生：`apps/api/app/domains/runtime_tools/service.py` 延迟加载 registry 并序列化。
- 本地探针结果：工具数量 7，重复名称 False。
- e2e 断言：Web 源码不得包含 `DEFAULT_CREATIVE_TOOL_REGISTRY`、`runtimeToolList = [`、`runtimeDiagnosticTools = [`。
## 4. OpenAPI / API / Web / e2e 一致性

- OpenAPI 快照：`packages/shared/src/contracts/storyforge.openapi.json`。
- API schema：`apps/api/app/domains/runtime_tools/schemas.py` 与 `apps/api/app/domains/model_runs/schemas.py`。
- Web 入口：`apps/web/app/ide/page.tsx`、`apps/web/components/ide/views/BookRunPanel.tsx`、`apps/web/components/ide/views/BookRunEventsPanel.tsx`。
- e2e 治理：`tests/e2e/phase5-runtime-diagnostics.spec.ts`。
- 本地证据：Phase 7 一致性子测试在定向 e2e 和全量 e2e 中均通过。

## 5. 发布前门禁

- `scripts/verify-local.ps1` 包含 `Test-RuntimeDiagnosticsGate`。
- `scripts/verify-local.ps1` 包含 `Test-OpenApiRuntimeContractGate`。
- `scripts/run-e2e.mjs` 默认纳入 runtime diagnostics e2e、API runtime/model_runs 测试、workflow session/lifecycle/provider/tool registry 测试。
- `package.json` 保留统一入口：`verify`、`test`、`e2e`、`openapi`。

## 6. 最终验证结果

| 命令 | 结果 |
| --- | --- |
| `node scripts/run-e2e.mjs tests/e2e/phase5-runtime-diagnostics.spec.ts` | 通过 |
| `pnpm verify` | 通过；首次因 Docker daemon 未运行失败，启动依赖后复跑通过 |
| `pnpm e2e` | 通过 |
| `pnpm test` | 通过 |
| `pnpm --filter @storyforge/web exec tsc --noEmit` | 通过 |
| `git diff --check` | 通过；仅 CRLF 替换警告 |

## 7. 冻结清单风险

当前 `git status --short` 显示多项第七阶段和第八阶段相关修改/新增文件，包括 runtime、runtime_tools、OpenAPI、e2e、门禁脚本和 `.codex` 报告。冻结前必须把这些文件作为同一 RC diff 审阅，不得遗漏未跟踪文件。

## 8. 回滚说明

- 本阶段未修改业务代码；第八阶段新增/更新的审计文件可通过版本控制回滚。
- 若后续 OpenAPI 快照产生新 diff，执行 `pnpm openapi` 后重新运行 `pnpm verify`、`pnpm e2e`、`pnpm test`。
- 若 Docker 依赖失效，先执行 `docker compose up -d postgres redis minio`，再复跑 `pnpm verify`。

## 9. 最终冻结建议

允许发布候选冻结。建议下一步仅做版本控制层面的 diff 审阅、提交和标签准备，不再引入功能性变更。
