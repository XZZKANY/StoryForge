## 项目上下文摘要（OpenAPI verify 门禁）

生成时间：2026-05-26 23:18:00

### 1. 相似实现分析

- **实现1**: `scripts/verify-local.ps1`
  - 模式：PowerShell 静态门禁逐项读取文件并检查字符串标记。
  - 可复用：`Write-Ok`、`Write-Fail`、`Test-OpenApiRuntimeContractGate` 的标记检查口径。
  - 需注意：该门禁检查 `scripts/generate-openapi.ps1`，不是 `scripts/generate-openapi.mjs`。
- **实现2**: `scripts/run-e2e.mjs`
  - 模式：先刷新 OpenAPI 快照，再用 `git diff --exit-code` 检查 drift。
  - 可复用：`refreshOpenApiContract`、`checkOpenApiContractDrift`、统一日志格式。
  - 需注意：refresh 直接从 FastAPI `app.openapi()` 生成快照。
- **实现3**: `docs/api/phase1-openapi-review.md`、`phase3-openapi-review.md`、`phase4-openapi-review.md`、`phase6-openapi-review.md`
  - 模式：OpenAPI 快照必须能追溯到 API 事实源和 e2e 契约测试。
  - 可复用：审查记录的“契约快照随 API 变化刷新”口径。
  - 需注意：本任务禁止修改 API 业务逻辑，只能同步脚本与快照。

### 2. 项目约定

- **命名约定**: Node 脚本使用 camelCase；PowerShell 函数使用 Verb-Noun；OpenAPI JSON 保持 FastAPI 生成字段名。
- **文件组织**: `scripts/` 放本地门禁与生成脚本，`packages/shared/src/contracts/` 放共享契约快照。
- **导入顺序**: `.mjs` 先导入 Node 内置模块，再声明常量与函数。
- **代码风格**: ESM 使用单引号、分号、两空格缩进；PowerShell 使用简短包装脚本和中文门禁输出。

### 3. 可复用组件清单

- `scripts/generate-openapi.mjs`: 当前 OpenAPI 生成事实源脚本。
- `scripts/run-e2e.mjs`: e2e OpenAPI refresh 与 drift 门禁。
- `scripts/verify-local.ps1`: verify 静态标记门禁，当前不可修改。
- `packages/shared/src/contracts/storyforge.openapi.json`: OpenAPI 快照文件。

### 4. 测试策略

- **测试框架**: `pnpm verify` 调 PowerShell 静态门禁；`pnpm e2e` 调 Node 脚本、Node test、pytest。
- **测试模式**: 先复现失败，再重新运行 `pnpm verify` 和 `pnpm e2e -- --continue-on-error`。
- **参考文件**: `tests/e2e/phase5-runtime-diagnostics.spec.ts` 检查 OpenAPI 生成与 e2e 声明证据。
- **覆盖要求**: OpenAPI refresh 成功、drift 检查不失败、verify 不再因 OpenAPI 标记失败。

### 5. 依赖和集成点

- **外部依赖**: FastAPI `app.openapi()`；Context7 查询确认其返回 OpenAPI schema 字典。
- **内部依赖**: `apps/api/app/main.py` 装配 FastAPI app；生成脚本在 `apps/api` 工作目录内导入 `app.main`。
- **集成方式**: `pnpm verify` 静态检查脚本/契约标记；`pnpm e2e` 先生成快照再用 git diff 检查漂移。
- **配置来源**: `package.json` 定义 `verify`、`e2e`、`openapi` 脚本；本轮不修改该文件。

### 6. 技术选型理由

- **为什么用这个方案**: 项目已有 `generate-openapi.mjs` 和 `run-e2e.mjs`，继续复用 FastAPI 官方 `app.openapi()` 输出，避免新增工具。
- **优势**: 与 API 事实源一致，OpenAPI drift 可由 Git diff 直接复现。
- **劣势和风险**: 工作区已有大量非本轮改动，快照刷新会包含这些 API 变更产生的契约差异。

### 7. 关键风险点

- **并发问题**: 生成脚本写同一个契约文件，验证时应串行执行。
- **边界条件**: `uv`、`python3`、`python` 的解析顺序需保持现状。
- **性能瓶颈**: OpenAPI 生成为单次 Python 进程，成本较低。
- **安全考虑**: 本任务不新增安全逻辑，只同步门禁和契约快照。

### 8. 复现证据

- `pnpm verify`: 失败于 `scripts/generate-openapi.ps1` 缺少 `app.openapi()` 和 `packages/shared/src/contracts/storyforge.openapi.json` 标记。
- `pnpm e2e -- --continue-on-error`: OpenAPI refresh 通过，OpenAPI drift 失败；API verification 48 passed，Workflow verification 32 passed。
- 非 OpenAPI 相关失败：Contract tests 仍有 Phase 2/3/4/5 静态证据或 JSON 输出解析失败，不属于本任务允许修改范围。
