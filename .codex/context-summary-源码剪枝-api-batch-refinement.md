## 项目上下文摘要（源码剪枝 api-batch-refinement）

生成时间：2026-06-05 09:55:22

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/batch_refinement/router.py`
  - 模式：FastAPI 领域 router，prefix 为 `/api/batch-refinement`，标签为“批量精修兼容”。
  - 可复用：无。本域是旧 Phase 2 同步兼容接口，内部自行组织 JobRun、JudgeIssue、RepairPatch 响应。
  - 需注意：docstring 明确写明“兼容 Phase 2 早期草稿 API”。
- **实现2**: `apps/api/app/domains/batch_refinery/router.py`
  - 模式：当前批量精修主 router，prefix 为 `/api/batch-refinery`，使用 `BackgroundTasks` 提交后台执行。
  - 可复用：`create_batch_refinery_job`、`run_batch_refinery_in_background`、`get_batch_refinery_run`。
  - 需注意：本轮必须保留该主链路。
- **实现3**: `apps/api/tests/test_batch_refinery.py`
  - 模式：验证主链路排队、后台执行、逐项进度、部分失败和独立 session。
  - 可复用：作为本轮回归测试，证明批量精修主链路未被削弱。
  - 需注意：`scripts/run-e2e.mjs` 也纳入该测试，而未纳入 `test_batch_refinement_api.py`。

### 2. 项目约定

- **命名约定**: API Python 模块使用 snake_case；领域目录放在 `apps/api/app/domains/<domain>`；测试文件使用 `test_*.py`。
- **文件组织**: FastAPI 主应用在 `apps/api/app/main.py` 集中导入并 `include_router`；共享 OpenAPI 合约在 `packages/shared/src/contracts/storyforge.openapi.json`；生成类型在 `packages/shared/src/generated/api-types.ts`。
- **导入顺序**: Python 由 ruff/isort 管理；TypeScript 类型由 `openapi-typescript` 生成。
- **代码风格**: API 测试使用 pytest 和 FastAPI `app` 直接检查路由 surface；用户可见说明使用简体中文。

### 3. 可复用组件清单

- `apps/api/app/main.py`: 路由挂载事实源。
- `apps/api/app/domains/batch_refinery`: 当前批量精修主实现，必须保留。
- `apps/api/tests/test_batch_refinery.py`: 主链路回归测试。
- `apps/api/tests/test_api_middleware.py`: 验证 `/api/batch-refinery` 批量限流。
- `scripts/generate-openapi.mjs`: 重新生成 OpenAPI 合约。
- `packages/shared/package.json`: `generate:types` 脚本生成 shared API 类型。

### 4. 测试策略

- **测试框架**: pytest、TypeScript `tsc --noEmit`。
- **测试模式**: 新增 API source-pruning 护栏，先红灯确认 `/api/batch-refinement` 和 `batch_refinement` 域仍存在；删除后绿灯。
- **参考文件**: `apps/api/tests/test_api_surface.py`、`apps/api/tests/test_batch_refinery.py`、`apps/workflow/tests/test_source_pruning.py`。
- **覆盖要求**: `batch_refinery` 路由、OpenAPI、限流、后台执行和 shared 类型检查全部保持通过。

### 5. 依赖和集成点

- **外部依赖**: FastAPI、Pydantic、SQLAlchemy、pytest、openapi-typescript。
- **内部依赖**:
  - `batch_refinement` 依赖 books、jobs、judge、repair、continuity 的模型和服务。
  - `batch_refinery` 依赖 jobs、judge、repair，并接入 metrics、批量限流和 e2e 脚本。
- **集成方式**: `main.py` 通过导入 router 并调用 `app.include_router(...)` 暴露 API；OpenAPI 从 `app.openapi()` 生成。
- **配置来源**: 根 `package.json` 的 `openapi` 脚本、`packages/shared/package.json` 的 `generate:types` 脚本、`apps/api/pyproject.toml` 的 pytest/ruff 配置。

### 6. 技术选型理由

- **为什么用这个方案**: 旧兼容接口造成 `/api/batch-refinement` 与 `/api/batch-refinery` 双入口维护；当前主链路是 `batch_refinery`，具备后台任务、部分失败进度、限流和指标覆盖。
- **优势**: 减少 API surface、OpenAPI schema 和 generated types 维护面，避免两个批量精修概念继续并存。
- **劣势和风险**: 删除会破坏旧 Phase 2 草稿 API；项目准则要求破坏式清理，不做兼容保留。

### 7. 关键风险点

- **并发问题**: 不修改 `batch_refinery` 后台任务和 session 管理。
- **边界条件**: 必须清理 OpenAPI/shared 生成契约，避免 Python 删除后仍暴露旧类型。
- **性能瓶颈**: 删除旧同步接口可减少长请求路径；保留批量限流。
- **安全考虑**: 不修改认证、授权、安全头或限流逻辑；仅删除旧兼容路径。

### 8. 充分性检查

- 能定义清晰接口契约：是。本轮交付为移除 `/api/batch-refinement` 及其 schema/type 残留，保留 `/api/batch-refinery`。
- 理解技术选型理由：是。旧接口被标记为兼容，当前主实现由 `batch_refinery` 承担。
- 识别主要风险点：是。核心风险是遗留 OpenAPI/generated 类型和误伤主链路。
- 知道如何验证实现：是。运行 source-pruning、batch_refinery、api_middleware、api_surface、OpenAPI 生成、shared tsc、引用搜索和 diff check。
