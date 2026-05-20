## 项目上下文摘要（workflow-api-adapter）

生成时间：2026-05-20 00:00:00 +08:00

### 1. 相似实现分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/storyforge_workflow/runtime/runner.py`
  - 模式：`WorkflowRuntime` 通过可注入 `model_run_sink` 发送 `ModelRunPayload`。
  - 可复用：`_emit_model_run_payload`、成功/失败 provider 路径、`RuntimeCheckpointStore`。
  - 需注意：`job_run_id` 是 workflow 字符串标识，不能直接写入 API `JobRun.id`。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/storyforge_workflow/runtime/checkpoints.py`
  - 模式：dataclass 保存运行时记录，`ModelRunPayload.to_api_payload(api_job_run_id=...)` 做边界转换。
  - 可复用：正整数 `api_job_run_id` 校验与 `payload.runtime_job_run_id` 审计字段。
  - 需注意：checkpoint 通过 `checkpoint_reference_state` 只保存引用字段。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/model_runs/service.py`
  - 模式：API 领域 service 接收 SQLAlchemy `Session` 和 Pydantic `ModelRunCreate`，先校验引用再 `add/commit/refresh`。
  - 可复用：`record_runtime_model_run`、`record_failed_runtime_model_run`、`list_model_runs`。
  - 需注意：`_validate_references` 会拒绝不存在的 `JobRun.id`。
- **实现4**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/jobs/service.py`
  - 模式：API service helper 直接同步 runtime 状态到 `JobRun.progress`。
  - 可复用：薄桥接函数风格，不新增 HTTP client。

### 2. 项目约定

- **命名约定**: Python 文件、函数、参数使用 `snake_case`；模型类使用 `PascalCase`。
- **文件组织**: workflow runtime 位于 `apps/workflow/storyforge_workflow/runtime/`；API 领域逻辑位于 `apps/api/app/domains/<domain>/`。
- **导入顺序**: `__future__`、标准库、第三方、项目内模块。
- **代码风格**: 类型标注、中文 docstring、pytest 函数式测试。
### 3. 可复用组件清单

- `ModelRunPayload.to_api_payload`: 将 workflow payload 映射成 API `ModelRunCreate` 字段。
- `RuntimeCheckpointStore.save_state`: 保存前强制引用化 checkpoint。
- `record_runtime_model_run`: 成功 ModelRun 真表写入 helper。
- `record_failed_runtime_model_run`: 失败 ModelRun 真表写入 helper。
- `sync_job_run_with_runtime`: API 侧 runtime 桥接函数风格参考。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: workflow 使用内存 checkpoint/sink；API 使用 SQLite 内存库和 `session_factory`。
- **参考文件**: `apps/workflow/tests/test_runtime_runner.py`、`apps/api/tests/test_model_runs.py`。
- **覆盖要求**: 成功落库、失败落库、非法 `api_job_run_id`、checkpoint 保留 API `model_run_id`。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy Session；Context7 查询确认 `Session.add/commit/refresh` 与 `Session.get` 是当前 ORM 常规用法。
- **内部依赖**: workflow `ModelRunSink` → API model_runs service helper。
- **集成方式**: 可注入 sink，返回持久化 `model_run.id`，runner 写回 state/checkpoint。
- **配置来源**: 本任务不新增配置。
### 6. 技术选型理由

- **为什么用这个方案**: 现有代码已有 sink 和 API service helper，只缺最小桥接，不需要 HTTP client 或微服务。
- **优势**: 改动小、边界清晰、测试可直接证明真表写入。
- **劣势和风险**: workflow 包测试环境默认不包含 API 包路径，跨 app 集成测试应放在 API 测试内完成。

### 7. 关键风险点

- **并发问题**: 本次不引入并发队列；每次 provider 调用一次 insert。
- **边界条件**: `api_job_run_id` 必须是正整数且对应真实 `JobRun`。
- **性能瓶颈**: 单次 commit；后续如批量 provider 调用可再引入事务聚合。
- **安全考虑**: 本任务仅记录为何不新增认证/HTTP 安全层，不作为验收条件。

### 8. 充分性检查

- 能定义接口契约：是，sink 接收 `ModelRunPayload`，返回 `int | None`。
- 理解技术选型：是，复用 API service helper 与 workflow sink。
- 识别风险点：是，重点是 ID 类型边界和跨 app 导入路径。
- 知道如何验证：是，执行用户指定两组 pytest。


### 9. 2026-05-21 继续执行补充

- 当前 `apps/workflow/storyforge_workflow/runtime/checkpoints.py` 已有部分 `ApiModelRunAdapter` 改动：sink 返回 `int | None`、adapter 接收 `dict -> int` 回调，但尚未严格拒绝非 `int`/`bool` 类型，也未把 sink 返回的 API ModelRun ID 写回 runtime state。
- 当前 `apps/workflow/storyforge_workflow/runtime/runner.py` 在成功/失败 provider 路径均会调用 `_emit_model_run_payload`，但返回值被丢弃；checkpoint 仍保存内存 `RuntimeModelRunRecord.model_run_id`。
- 当前 `apps/api/app/domains/model_runs/service.py` 已有 `record_runtime_model_run` 与 `record_failed_runtime_model_run`，应新增薄 helper 接收 workflow adapter payload 并路由到这两个 helper，避免新增 HTTP client。
- API 测试环境未安装 workflow 依赖 `langgraph`，因此 API service 不应直接 import workflow 包；跨 app 集成通过 payload 契约和 workflow 侧 adapter 测试共同验证。
- Context7 已查询 SQLAlchemy ORM：`Session.add()` 暂存对象、`Session.commit()` 提交、`Session.refresh()` 刷新、`Session.get()` 按主键读取，现有 service 模式与官方用法一致。
- `github.search_code` 工具在当前会话不可用；本轮改用项目内 3+ 个相似实现和 Context7 官方文档作为依据，并在操作日志留痕。
