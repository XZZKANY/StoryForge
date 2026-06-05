## 项目上下文摘要（源码剪枝 API JobRun runtime bridge helper）

生成时间：2026-06-05 18:07:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/jobs/service.py`
  - 模式：定义 `sync_job_run_with_runtime()`，按 `job_run_id` 读取 `JobRun`，合并 `progress.thread_id/current_node/approval_status/provider_execution`，写 `status` 后提交。
  - 可复用：无真实生产调用证据；逻辑可由测试直接构造 `JobRun.progress` 覆盖读侧契约。
  - 需注意：不能把 `JobRun.progress` 相关字段视为死字段。
- **实现2**: `apps/api/app/domains/model_runs/service.py::get_runs_job_run`
  - 模式：真实 Runs 读侧 API 从 `JobRun.progress` 派生 `checkpoint` 和 `runtime_diagnostics`。
  - 可复用：`test_model_runs.py` 已通过直接设置 `JobRun.progress` 验证 `thread_id`、`current_node`、`approval_status`、`provider_execution` 等读侧字段。
  - 需注意：这是保留契约，不是剪枝对象。
- **实现3**: `apps/api/app/domains/model_runs/service.py::record_workflow_model_run_payload`
  - 模式：现行 workflow adapter payload 写入 API ModelRun 真表的 helper。
  - 可复用：证明 workflow→API ModelRun 桥接已由 `record_workflow_model_run_payload()` 负责。
  - 需注意：它记录模型运行日志，不负责修改 `JobRun.progress`。
- **实现4**: `apps/workflow/storyforge_workflow/runtime/checkpoints.py::ApiModelRunAdapter`
  - 模式：workflow 侧将 `ModelRunPayload` 转为 API payload 并通过注入回调写入 API 真表。
  - 可复用：现行 workflow→API bridge 边界，不依赖 `sync_job_run_with_runtime()`。

### 2. 项目约定

- **命名约定**: API 服务函数使用动词短语；测试标题和断言使用简体中文。
- **文件组织**: JobRun ORM 保留在 `app/domains/jobs/models.py`；Runs 读侧服务保留在 `app/domains/model_runs/service.py`；source-pruning 护栏集中在 `apps/api/tests/test_source_pruning.py`。
- **导入顺序**: 标准库、第三方、项目内导入分组。
- **代码风格**: API 剪枝护栏使用 Path 读取源码、FastAPI app routes/OpenAPI 和 forbidden markers。

### 3. 可复用组件清单

- `apps/api/app/domains/jobs/models.py`: `JobRun` 模型和 `progress` JSON 字段必须保留。
- `apps/api/app/domains/model_runs/router.py`: `/api/model-runs/job-runs/{job_run_id}` 真实 Runs 读侧 API。
- `apps/api/app/domains/model_runs/service.py`: `get_runs_job_run()`、`record_workflow_model_run_payload()`。
- `apps/api/tests/test_model_runs.py`: 已覆盖 checkpoint、runtime diagnostics、retry、workflow adapter payload。
- `apps/workflow/storyforge_workflow/runtime/checkpoints.py`: `ApiModelRunAdapter`。

### 4. 测试策略

- **测试框架**: Pytest。
- **测试模式**: 先在 `apps/api/tests/test_source_pruning.py` 新增红灯护栏，要求 `sync_job_run_with_runtime` 和 `JobRuntimeBridgeError` 不再出现；同时要求 `get_runs_job_run`、`runtime_diagnostics`、`record_workflow_model_run_payload` 和 `JobRun.progress` 读侧契约仍存在。
- **参考文件**:
  - `apps/api/tests/test_source_pruning.py`
  - `apps/api/tests/test_model_runs.py`
  - `apps/api/tests/test_job_runtime_bridge.py`
  - `apps/api/tests/test_phase4_service_acceptance.py`
- **覆盖要求**:
  - 红灯：source-pruning 新护栏失败，命中 `jobs/service.py` 仍存在旧 helper。
  - 绿灯：删除旧 helper，并迁移旧测试不再导入它。
  - 定向：source-pruning、model_runs、phase4_service_acceptance、job_runtime_bridge 或其迁移后替代测试通过。
  - 全量：API 全量通过。

### 5. 依赖和集成点

- **外部依赖**: GitHub search 未找到 `sync_job_run_with_runtime` 同名实现。
- **内部依赖**:
  - `sync_job_run_with_runtime` 当前只被 `apps/api/tests/test_job_runtime_bridge.py` 和 `apps/api/tests/test_phase4_service_acceptance.py` 直接调用。
  - `apps/api/app/main.py` 注册 `model_runs_router`，没有注册 jobs service/router。
  - `packages/shared` 和 OpenAPI 暴露的是 `/api/model-runs/job-runs/{job_run_id}` Runs 读侧契约。
- **集成方式**: 旧测试改为直接构造 `JobRun(progress={...})` 并调用真实 Runs 读侧 API/服务验证。
- **配置来源**: 无配置改动。

### 6. 技术选型理由

- **为什么用这个方案**: 删除仅旧测试直接调用的 helper，保留 `JobRun.progress` 作为读侧事实源，避免旧桥接函数暗示仍有生产同步职责。
- **优势**: API jobs 领域只保留模型职责；runtime diagnostics 和 ModelRun 桥接集中在 model_runs 与 workflow adapter 现行链路。
- **劣势和风险**: 旧测试需要迁移，且必须避免误删 progress 读侧字段。

### 7. 关键风险点

- **并发问题**: 删除 helper 不改变运行时并发行为。
- **边界条件**: `JobRun.progress` 字段、`get_runs_job_run()`、`record_workflow_model_run_payload()`、`ApiModelRunAdapter` 不得删除。
- **性能瓶颈**: 无性能影响。
- **安全考虑**: 不涉及认证、鉴权、外部网络或凭据。
