## 项目上下文摘要（Step F-2 Workflow 节点执行超时）

生成时间：2026-05-26 14:26:55 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/graph.py`
  - 模式：`_audited_node()` 包装每个 LangGraph 节点，并在节点返回后写入审计 store。
  - 可复用：节点调用统一入口，适合插入节点级 timeout。
  - 需注意：graph 层应只抛出清晰异常，不负责 lifecycle/session 落库。
- **实现2**: `apps/workflow/storyforge_workflow/runtime/runner.py`
  - 模式：provider 失败通过 `_record_provider_failure()` 统一写 model run、checkpoint、lifecycle、session。
  - 可复用：失败记录模式可扩展为 graph 节点失败记录。
  - 需注意：当前 graph.stream 异常没有被捕获，节点挂住或失败会打断 runner。
- **实现3**: `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`
  - 模式：底层异常被转换为 provider 专用异常，并保留清晰错误消息。
  - 可复用：F-2 可采用节点专用 timeout 异常，避免调用方依赖 `concurrent.futures` 细节。
  - 需注意：节点 timeout 不是 provider HTTP timeout，分类应独立。
- **实现4**: `apps/workflow/tests/test_runtime_runner.py`
  - 模式：通过 monkeypatch 固定节点 LLM 和 provider 执行，验证 checkpoint、lifecycle、session。
  - 可复用：新增测试可复用相同 runtime 构造与 failure 断言。
  - 需注意：测试应使用短 sleep 触发 timeout，避免长时间阻塞。

### 2. 项目约定

- **命名约定**: Python 函数 snake_case，异常类 PascalCase，枚举值小写下划线。
- **文件组织**: 节点 wrapper 在 `graph.py`，失败落库在 `runtime/runner.py`，失败分类在 `runtime/lifecycle.py`。
- **导入顺序**: 标准库、第三方、项目内模块。
- **代码风格**: 中文 docstring 和错误消息。

### 3. 可复用组件清单

- `WorkflowRuntime._record_provider_failure()`: 失败记录模式参考。
- `InMemoryWorkflowLifecycleStore.record_failure()`: lifecycle 失败事件入口。
- `RuntimeCheckpointStore.save_state()` / `record()`: 超时 checkpoint 写入入口。
- `WorkflowFailureKind`: 新增节点超时分类。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 设置 `STORYFORGE_WORKFLOW_NODE_TIMEOUT_SECONDS=0.001`，让 `draft_writer.generate_text` sleep 后返回。
- **参考文件**: `tests/test_runtime_runner.py`。
- **覆盖要求**: `uv run python -m pytest tests/test_runtime_runner.py -q`。

### 5. 依赖和集成点

- **外部依赖**: Python 标准库 `concurrent.futures`。
- **内部依赖**: graph 抛出节点 timeout，runner 捕获后写 checkpoint/lifecycle/session。
- **集成方式**: `create_generation_graph()` 新增可配置 node timeout，runner 构造 graph 时读取环境变量。
- **配置来源**: `STORYFORGE_WORKFLOW_NODE_TIMEOUT_SECONDS`，默认 120 秒。

### 6. 技术选型理由

- **为什么用这个方案**: 同步 LangGraph 节点没有 asyncio 边界，使用线程 future timeout 可以在不大改架构的情况下给每个节点加上上限。
- **优势**: 改动集中，测试可控，保留现有同步节点 API。
- **劣势和风险**: Python 线程无法强制杀死底层阻塞调用；runner 会返回失败，但底层线程可能短暂继续运行。

### 7. 关键风险点

- **并发问题**: 超时后调用 `shutdown(wait=False, cancel_futures=True)` 避免 runner 等待慢任务。
- **边界条件**: 非正数环境变量应回退默认值。
- **性能瓶颈**: 每个节点创建线程池有开销，但当前节点数少，优先保证故障隔离。
- **安全考虑**: 不记录完整 prompt 或草稿，只记录摘要和错误分类。
