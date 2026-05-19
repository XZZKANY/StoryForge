## 项目上下文摘要（workflow-model-run-sink）

生成时间：2026-05-19 04:45:00 +08:00

### 1. 相似实现分析

- `apps/workflow/storyforge_workflow/runtime/checkpoints.py`：已有 `RuntimeModelRunRecord` 与内存 `record_model_run()`，字段包含 provider、model、capability、latency、token、input/output、status、error，与 API `ModelRunCreate` 高度接近。
- `apps/workflow/storyforge_workflow/runtime/runner.py`：`WorkflowRuntime.start()` 成功路径会写入内存 model run 并把 `model_run_id` 放入 checkpoint；失败路径也会写入 failed 内存记录和 `error_code`。
- `apps/api/app/domains/model_runs/service.py`：已有 `record_runtime_model_run()` 与 `record_failed_runtime_model_run()`，可作为后续真实持久化 adapter 的目标字段形状。
- `apps/workflow/tests/test_runtime_runner.py`：已有成功/失败 runtime 测试，适合补 CapturingModelRunSink，验证 workflow runtime 可把 payload 投递到外部 sink，而不是只能写内存 store。

### 2. 项目约定

- workflow 包不直接依赖 API app 包，避免跨包耦合。
- 运行时扩展采用构造函数注入，类似 `audit_store`、`checkpoint_store`。
- 默认路径必须保持内存可运行，不要求 Docker/PostgreSQL 或 API 服务启动。

### 3. 可复用组件清单

- `RuntimeModelRunRecord`：本轮 sink payload 的来源。
- `RuntimeCheckpointStore.record_model_run()`：默认内存记录仍保留。
- API `record_runtime_model_run()` / `record_failed_runtime_model_run()`：后续 adapter 可调用的真实持久化入口。

### 4. 测试策略

- 第1轮红灯：新增 `CapturingModelRunSink`，构造 `WorkflowRuntime(model_run_sink=sink)`，期望成功路径调用 sink；当前 `WorkflowRuntime.__init__()` 不接受该参数，应红灯。
- 第2轮转绿：新增 `ModelRunSink` Protocol 与 `ModelRunPayload` dataclass；runtime 成功路径投递 sink。
- 第3轮：失败路径也投递 failed payload；运行 API/workflow 相关验证。

### 5. 依赖和集成点

- sink 只定义边界，不实现 HTTP client、认证或跨进程传输。
- `model_run_id` 仍由 checkpoint store 的内存记录提供；sink payload 用于后续真实 API 写入 adapter。
- 不新增数据库字段或 Alembic 迁移。

### 6. 技术选型理由

- Protocol + dataclass 能保持最小可测试边界，避免直接引入复杂架构。
- 成功/失败 payload 与 API helper 字段对齐，减少后续 adapter 代码。
- 保留默认无 sink 行为，保证本地测试稳定。

### 7. 关键风险点

- 不能声称已经跨进程写入 API 真表；本轮只完成 sink 边界和字段投递。
- sink 不应接收完整 Scene Packet 或完整 prompt，只接收摘要字段。
- 失败 sink 也必须保留 `error_message` 与 `status=failed`。