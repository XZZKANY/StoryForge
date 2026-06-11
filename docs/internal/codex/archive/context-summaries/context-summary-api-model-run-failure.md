## 项目上下文摘要（api-model-run-failure）

生成时间：2026-05-19 04:05:00 +08:00

### 1. 相似实现分析

- `apps/api/app/domains/model_runs/models.py`：已有 `ModelRun` SQLAlchemy 模型，外键 `workspace_id`、`book_id`、`scene_id`、`job_run_id`、`prompt_pack_id` 均按现有模型使用 `int | None`，没有 UUID 假设；本轮不新增字段或迁移。
- `apps/api/app/domains/model_runs/service.py`：已有 `create_model_run()`、`list_model_runs()` 与 `record_runtime_model_run()`；其中 runtime helper 固定写入 `status="completed"`，不能表达 provider 失败。
- `apps/api/tests/test_model_runs.py`：已有 SQLite 内存库 + FastAPI TestClient 测试，覆盖成功创建、按 `job_run_id` 查询、provider latency/token/prompt_pack 字段。
- `apps/workflow/storyforge_workflow/runtime/checkpoints.py`：已有内存级 `RuntimeModelRunRecord` 成功/失败记录，可作为 workflow 侧临时记录，但还不是 API 真表持久化。
- `apps/workflow/storyforge_workflow/runtime/runner.py`：provider 失败时已保存失败 checkpoint 与内存 model run，可与 API failed helper 字段对齐。

### 2. 项目约定

- API 服务层通过 Pydantic `ModelRunCreate` 构造 SQLAlchemy 模型；引用对象由 `_validate_references()` 统一校验。
- 测试使用 `pytest`、SQLite `StaticPool`、`Base.metadata.create_all()`。
- 新 helper 应复用 `create_model_run()`，避免重复字段校验或新增模型。

### 3. 可复用组件清单

- `ModelRunCreate`：已有创建契约，包含 `status`、`error_message`、`payload`。
- `create_model_run()`：已有落库入口，包含引用校验与 commit/refresh。
- `list_model_runs()`：验证失败记录可按 `job_run_id` 查询。
- `RuntimeModelRunRecord`：workflow 侧内存记录字段可与 API helper 对齐。

### 4. 测试策略

- 第1轮红灯：在 `test_model_runs.py` 新增服务层测试，导入并调用 `record_failed_runtime_model_run()`；当前应因 helper 不存在失败。
- 第2轮绿灯：新增 helper 复用 `create_model_run()`，写入 `status="failed"`、`token_usage=0`、`error_message` 和 payload。
- 第3轮集成验证：运行 `test_model_runs.py`、workflow runtime 相关 pytest、根级 `pnpm run test:api` / `pnpm run test:workflow`。

### 5. 依赖和集成点

- API 真表已存在：`model_runs` 表与 `ModelRun` 模型已经是业务真相源。
- workflow runtime 当前只有内存记录，不能声明已跨进程写入 API 真表。
- 本轮只补 API failed helper，为后续 workflow API client 或同进程 service adapter 提供最小持久化入口。

### 6. 技术选型理由

- 通过新增 helper 而非新增表/字段，保持 Phase 任务小步闭环。
- `job_run_id` 等字段继续使用现有 `int` 类型，遵守总计划第 11 节类型约束。
- 不直接在 workflow 包导入 API app，避免扩大为跨包耦合或新架构。

### 7. 关键风险点

- 不能把 workflow 内存记录误称为 API 持久化；两者必须在 TODO 和报告中区分。
- 不能新增迁移或外部 SDK。
- 失败记录必须保留 `error_message`，并允许后续按 `job_run_id` 查询。
