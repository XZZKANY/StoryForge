## 项目上下文摘要（P8-009 Workflow 诊断写入失败隔离）

生成时间：2026-05-26 00:00:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/tests/test_runtime_runner.py`
  - 模式：通过 `monkeypatch.setattr("storyforge_workflow.runtime.runner.execute_provider_text", ...)` 固定 provider 行为。
  - 可复用：`CapturingModelRunSink`、`_stub_node_llm`、`InMemoryRuntimeCheckpointStore`。
  - 需注意：成功路径会断言 `sink.payloads[0]` 和 `state["model_run_id"]`。
- **实现2**: `apps/workflow/tests/test_runtime_runner.py`
  - 模式：`test_workflow_runtime_keeps_recoverable_checkpoint_when_provider_fails` 验证 provider 异常后的失败 checkpoint。
  - 可复用：失败 provider 函数、`lifecycle_store` 与 `session_store` 断言方式。
  - 需注意：provider 原始失败结果必须保持 `status == "failed"` 与 `error_code == "provider_execution_failed"`。
- **实现3**: `apps/workflow/tests/test_provider_fallback.py`
  - 模式：用局部失败类和 `pytest.raises(..., match=...)` 验证异常传播语义。
  - 可复用：清晰分离成功路径、fallback 路径和异常传播路径的测试组织。
  - 需注意：本任务禁止修改 `provider_adapter.py`，只借鉴异常语义测试方式。
### 2. 项目约定

- **命名约定**: Python 使用 snake_case；测试函数以 `test_` 开头；测试替身用局部类或小型 helper class。
- **文件组织**: workflow 运行时在 `apps/workflow/storyforge_workflow/runtime/`，测试在 `apps/workflow/tests/`。
- **导入顺序**: `from __future__ import annotations`、标准库、第三方、项目内导入。
- **代码风格**: `pyproject.toml` 配置 Python 3.11、ruff 行宽 120，中文注释和 docstring 已存在。

### 3. 可复用组件清单

- `apps/workflow/tests/test_runtime_runner.py`: `CapturingModelRunSink` 可扩展为抛错 sink。
- `apps/workflow/tests/test_runtime_runner.py`: `_stub_node_llm(monkeypatch)` 固定图节点输出，避免外部模型依赖。
- `apps/workflow/storyforge_workflow/runtime/checkpoints.py`: `ModelRunSink` 协议定义 `record(payload) -> int | None`。
- `apps/workflow/storyforge_workflow/runtime/provider_execution.py`: `ProviderExecutionResult` 是 runner provider 成功路径输入。

### 4. 测试策略

- **测试框架**: pytest 8+，项目通过 `uv run pytest` 执行。
- **测试模式**: runner 测试使用 monkeypatch 替换 provider 和节点 LLM。
- **参考文件**: `apps/workflow/tests/test_runtime_runner.py`、`apps/workflow/tests/test_provider_fallback.py`、`apps/workflow/tests/conftest.py`。
- **覆盖要求**: 成功路径 sink 抛错不中断；provider 失败路径 sink 抛错不覆盖原失败状态。
### 5. 依赖和集成点

- **外部依赖**: `pytest`、`langgraph`、`structlog`，本改动不新增依赖。
- **内部依赖**: `WorkflowRuntime` 调用 `execute_provider_text`、`RuntimeCheckpointStore.record_model_run`、`ModelRunSink.record`。
- **集成方式**: `model_run_sink` 由 `WorkflowRuntime.__init__` 注入，`_emit_model_run_payload` 负责适配 payload。
- **配置来源**: workflow 测试通过 `tests/conftest.py` 隔离 SQLite 路径。

### 6. 技术选型理由

- **为什么用这个方案**: 在 runner 的诊断写入边界做局部 try/except，最小化影响面。
- **优势**: 不修改 provider adapter；保持 provider 成功和失败主路径独立于诊断落库。
- **劣势和风险**: sink 写入失败会被吞掉，只能从日志排查；但符合“诊断写入不打断主路径”的目标。

### 7. 关键风险点

- **并发问题**: 本改动不改变共享状态结构，不引入并发写入。
- **边界条件**: `model_run_sink is None` 仍返回 `None`；sink 返回持久化 ID 时仍回填该 ID。
- **性能瓶颈**: 仅增加局部异常捕获，开销可忽略。
- **安全考虑**: 本任务不涉及认证、鉴权或加密。

### 8. 检索记录

- context7 查询：`/pytest-dev/pytest`，用途是确认 `monkeypatch.setattr` 与 `pytest.raises(..., match=...)` 回归测试写法。
- GitHub 代码搜索：当前会话未提供 `github.search_code` 工具，已改用项目内相似实现作为补偿。
### 9. 上下文充分性检查

- 能说出至少 3 个相似实现路径：是，见第 1 节。
- 理解实现模式：是，runner 负责编排，sink 是可注入诊断边界。
- 知道可复用工具：是，`CapturingModelRunSink`、`_stub_node_llm`、`ProviderExecutionResult`。
- 理解命名和风格：是，snake_case、pytest 函数式测试、中文 docstring。
- 知道如何测试：是，新增两个 runner 回归测试并运行 `uv run pytest tests/test_runtime_runner.py -q`。
- 确认不重复造轮子：是，检查了 runner、checkpoints、provider_execution、provider_fallback 测试。
- 理解依赖和集成点：是，集成点为 `WorkflowRuntime._emit_model_run_payload`。
