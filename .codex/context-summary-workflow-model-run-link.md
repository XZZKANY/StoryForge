## 项目上下文摘要（workflow-model-run-link）

生成时间：2026-05-19 03:20:00 +08:00

### 1. 相似实现分析

- `apps/api/app/domains/model_runs/models.py`：已有 `ModelRun` SQLAlchemy 模型，主键来自 `IdMixin`，相关外键均为 `int | None`，包括 `job_run_id`、`book_id`、`scene_id` 等；本轮不新增迁移。
- `apps/api/app/domains/model_runs/service.py`：已有 `create_model_run()`、`list_model_runs()`、`record_runtime_model_run()`，说明 API 侧已有模型运行日志契约与持久化服务。
- `apps/workflow/storyforge_workflow/runtime/provider_execution.py`：workflow 侧已有 `ProviderExecutionResult` 与 `simulate_provider_execution()`，用于确定性模拟 provider 调用。
- `apps/workflow/storyforge_workflow/runtime/runner.py`：`WorkflowRuntime.start()` 和 `resume()` 会模拟 provider 执行并写 checkpoint record，但目前 `start()` 把 `state["model_run_id"]` 错写为 token_usage，缺少可审计 model run 引用。
- `apps/workflow/storyforge_workflow/state.py`：`GenerationState` 已有 `model_run_id: int`，`checkpoint_reference_state()` 会保留该字段，适合接入轻量引用。
- `apps/workflow/tests/test_runtime_runner.py`：已有 runtime start/resume 测试，断言 provider 执行摘要和 checkpoint 记录，可按相同风格补充 model run 引用测试。

### 2. 项目约定

- workflow 使用 dataclass 记录运行结果和内存 checkpoint store；测试使用 `uv run pytest`。
- API 与 workflow 仍是模块化单体内的两个包，本轮只在 workflow 内记录可替换的轻量模型运行引用，不跨进程调用 API 数据库。
- 日志、TODO、验证报告必须写入项目内 `.codex/` 与 `TODO.md`。

### 3. 可复用组件清单

- `ProviderExecutionResult`：已有 provider 调用摘要。
- `GenerationState.model_run_id`：已有引用字段。
- `RuntimeCheckpointStore.save_state()`：保存前调用 `checkpoint_reference_state()`，能保留 `model_run_id`。
- `RuntimeCheckpointStore.record()`：可扩展 record 元数据，或新增独立内存模型运行记录列表。

### 4. 测试策略

- 第1轮红灯：在 `test_runtime_runner.py` 断言 runtime start 生成 `model_run_id` 且 checkpoint state 保留同一引用；当前应失败，因为值等于 token_usage 且没有稳定模型运行记录接口。
- 第2轮转绿：新增轻量 `RuntimeModelRunRecord` 或 helper，根据 provider_execution 生成递增引用 ID 并写入 state/checkpoint。
- 第3轮：补失败路径测试，确保 provider 调用失败时 checkpoint 保留 `error_code` 与可恢复状态。

### 5. 依赖和集成点

- 与 API `ModelRun` 的关系：API 已有真实表和服务；workflow 本轮只记录运行引用和 payload 形状，后续可替换为 API/DB 写入。
- 与 state 引用化关系：必须只保存 `model_run_id`，不得保存完整 prompt、完整 Scene Packet 或完整草稿。
- 与总计划第 11 节关系：属于 Phase 5 后续真实 provider / ModelRun / workflow 调用链闭环，建立在 11.7 引用型 State 已完成基础上。

### 6. 技术选型理由

- 用内存 `RuntimeModelRunRecord` 延续 `RuntimeRecord` 模式，避免新增数据库迁移或跨包依赖。
- `model_run_id` 使用 int，符合 API 现有 SQLAlchemy `IdMixin` 事实，不凭空假设 UUID。
- 失败状态只记录错误摘要和 checkpoint，不引入真实 provider SDK。

### 7. 关键风险点

- 不能把 token_usage 伪装成 model run ID；需要明确引用 ID 与 token_usage 分离。
- 不能把完整 provider prompt 或大上下文写入 checkpoint。
- 不能声明已经写入 API 数据库；本轮只能声明 workflow runtime 内存记录，API 持久化仍是已有契约。