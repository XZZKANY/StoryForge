# Workflow 到 API ModelRun adapter 契约

## 目标

本契约只描述 Phase 5 Workflow/ModelRun 调用链的最小交接边界，不新增 HTTP client、不拆微服务、不新增数据库迁移。

核心目标是防止 workflow runtime 的字符串 `job_run_id` 被误当成 API/SQLAlchemy 的 `JobRun.id`。API 真表仍以现有模型和 Pydantic 契约为准。

## 已实现

- `WorkflowRuntime` 可接收 `model_run_sink`，成功和失败 provider 路径都会投递 `ModelRunPayload`。
- `RuntimeCheckpointStore` 会保存轻量 `RuntimeModelRunRecord`，并保留失败 checkpoint。
- `ModelRunPayload.to_api_payload(api_job_run_id:int)` 输出 API `ModelRunCreate` 兼容字段。
- `ApiModelRunAdapter` 通过可注入 `dict -> int` 回调把 payload 写入 API 真表，并把返回的 API `ModelRun.id` 交回 runtime state。
- API 侧 `record_workflow_model_run_payload()` 根据 `status` 复用成功/失败 ModelRun service helper。
- `api_job_run_id` 必须是已持久化 `JobRun.id` 正整数；非法值抛出中文 `ValueError`。
- workflow runtime 字符串任务标识只允许进入 `payload.runtime_job_run_id`，用于排查和关联。

## Adapter 调用方职责

1. 在 API 侧或集成层先创建/查找 `JobRun` 真表记录。
2. 取得已持久化的 `JobRun.id:int`。
3. 构造 `ApiModelRunAdapter(api_job_run_id=job_run.id, record_api_model_run=...)`，由 adapter 调用 `ModelRunPayload.to_api_payload(api_job_run_id=job_run.id)`。
4. `record_api_model_run` 回调应调用 API 侧 `record_workflow_model_run_payload(session, payload).id`，该 helper 会继续复用 `record_runtime_model_run()` / `record_failed_runtime_model_run()`。

## 状态区分

### 已实现

- workflow 内存级 ModelRun 记录。
- 成功/失败 sink 投递。
- API-compatible payload 映射与正整数 `api_job_run_id` 边界测试。
- API 成功/失败 ModelRun helper。
- workflow-to-api 最小 adapter/client 与成功/失败真表写入测试。

### 已有契约但未持久化 / 未联通

- `ModelRun` 与 `compiled_context_id` 的正式数据库关联。
- 跨进程错误恢复与重试入口。

### 完全不存在

- HTTP 传输层 client。
- 认证、鉴权或跨服务安全设计。
- 真实 provider SDK 端到端运行链。

### 竞品启发

- 仅采用运行日志与 checkpoint 分层思想；未引入新 Agent 框架、微服务或外部编排平台。

## 验收方式

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow
uv run pytest tests/test_runtime_runner.py tests/test_generation_state_references.py -q

cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run pytest tests/test_model_runs.py -q
```

通过条件：workflow payload 映射测试、失败 checkpoint 测试和 API ModelRun 成功/失败 helper 测试均通过。
