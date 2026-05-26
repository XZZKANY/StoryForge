## 项目上下文摘要（Step F-1 Workflow SQLite 快照与恢复入口）

生成时间：2026-05-26 14:06:34 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/runtime/checkpoints.py`
  - 模式：`RuntimeCheckpointStore` 已使用 SQLite，支持 `record()`、`record_model_run()`、`save_state()`、`load_state()`。
  - 可复用：SQLite 连接、`sqlite3.Row`、`checkpoint_reference_state()`、`STORYFORGE_WORKFLOW_SQLITE_PATH` 默认路径。
  - 需注意：当前 `save_state()` 只 upsert 最新状态，没有快照历史，也没有列出未完成 workflow。
- **实现2**: `apps/workflow/storyforge_workflow/runtime/runner.py`
  - 模式：`WorkflowRuntime.start()` 串联 provider、LangGraph stream、checkpoint_store、lifecycle_store、session_store。
  - 可复用：现有 `checkpoint_store.save_state()` 与 lifecycle/session 状态流。
  - 需注意：当前只在图运行结束后保存一次状态，不能覆盖节点完成后的崩溃恢复窗口。
- **实现3**: `apps/workflow/storyforge_workflow/graph.py`
  - 模式：每个 LangGraph 节点通过 `_audited_node()` 写入 `InMemoryWorkflowStore` 审计记录。
  - 可复用：节点输出携带 `current_node` 和轻量引用字段，可用于 runner 增量合并后保存。
  - 需注意：graph 层只有审计 store，不应直接耦合 SQLite runtime store。
- **实现4**: `apps/workflow/tests/test_generation_state_references.py`
  - 模式：验证 `RuntimeCheckpointStore` 持久化状态跨实例读取，并确认大对象不会进入 checkpoint。
  - 可复用：`tmp_path` SQLite、跨实例读取、引用化断言。
  - 需注意：F-1 需要新增快照历史和恢复发现断言。

### 2. 项目约定

- **命名约定**: Python 函数 snake_case，类/数据类 PascalCase。
- **文件组织**: runtime 持久化在 `runtime/checkpoints.py`，编排在 `runtime/runner.py`，测试在 `apps/workflow/tests/`。
- **导入顺序**: `from __future__ import annotations`、标准库、第三方、项目内模块。
- **代码风格**: docstring 和测试说明使用简体中文；状态字段使用既有英文枚举值。

### 3. 可复用组件清单

- `RuntimeCheckpointStore`: SQLite runtime store。
- `InMemoryRuntimeCheckpointStore`: 测试替身需保持接口一致。
- `checkpoint_reference_state()`: 状态引用化边界。
- `WorkflowRuntime.start()` / `resume()`: 节点完成后 flush 与恢复入口集成点。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: `test_runtime_runner.py` 覆盖节点完成后快照历史；`test_workflow_lifecycle.py` 覆盖启动恢复发现。
- **参考文件**: `test_runtime_runner.py`、`test_workflow_lifecycle.py`、`test_generation_state_references.py`。
- **覆盖要求**: `uv run python -m pytest tests/test_runtime_runner.py tests/test_workflow_lifecycle.py -q`。

### 5. 依赖和集成点

- **外部依赖**: Python 标准库 `sqlite3`。已通过 Context7 查询 Python sqlite3 文档，确认连接上下文管理会提交/回滚事务，`sqlite3.Row` 可按列名读取。
- **内部依赖**: runner 从 LangGraph stream chunk 合并节点输出，调用 checkpoint store 保存快照。
- **集成方式**: `RuntimeCheckpointStore.list_incomplete_workflows()` 为启动恢复提供可恢复项列表。
- **配置来源**: `STORYFORGE_WORKFLOW_SQLITE_PATH`。

### 6. 技术选型理由

- **为什么用这个方案**: 项目已有 SQLite runtime store，扩展其状态快照和恢复查询比新增平行存储更符合既有架构。
- **优势**: 保留最新状态读取兼容性，新增快照历史证明每个节点完成都落库。
- **劣势和风险**: 快照历史会增长；后续可按 thread/job 增加清理策略。

### 7. 关键风险点

- **并发问题**: 当前 SQLite 写入使用短连接事务，测试覆盖单进程路径。
- **边界条件**: 已批准 workflow 不应出现在未完成列表；pending/failed 应可恢复。
- **性能瓶颈**: 每个节点一次小 JSON 写入，当前节点数少，成本可控。
- **安全考虑**: checkpoint 继续引用化，不保存完整草稿或大对象。

