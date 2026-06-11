## 项目上下文摘要（Workflow State 引用化）

生成时间：2026-05-19 01:30:00 +08:00

### 1. 相似实现分析

- `apps/workflow/storyforge_workflow/state.py`：当前 `GenerationState` 仍包含 `scene_packet`、`book_strategy`、`chapter_plan`、`scene_beats`、`draft_excerpt` 等大对象字段，触发总计划 11.7 风险。
- `apps/workflow/storyforge_workflow/persistence.py`：审计记录已通过 `summarize_value()` 截断大对象摘要，是“记录摘要不存全文”的既有模式。
- `apps/workflow/storyforge_workflow/runtime/checkpoints.py`：`save_state()` 当前直接 `dict(state)` 保存完整状态，是本轮最小修复的集成点。
- `apps/api/app/domains/context_compiler/schemas.py`：已有 `WorkflowStateReference` 契约，明确 workflow checkpoint 应保存 `compiled_context_id`、`model_run_ids`、`artifact_ids` 等引用。

### 2. 项目约定

- Workflow 使用 Python `TypedDict` 描述 LangGraph state，节点返回局部 dict 更新状态。
- 测试使用 pytest，`apps/workflow/pyproject.toml` 已设置 `pythonpath = ["."]`。
- 运行验证以 `python -m compileall storyforge_workflow tests` 和定向 pytest 为主。

### 3. 可复用组件清单

- `initial_generation_state()`：构造初始状态，应扩展为优先接收引用字段。
- `RuntimeCheckpointStore.save_state()`：真实持久化实现替换前的最小 checkpoint 边界。
- `summarize_value()`：避免审计记录保存完整大对象的既有摘要模式。
- API 侧 `ModelRun.id`、`Artifact.id`、`CompiledContextRecord.compiled_context_id`、`MemoryAtomRecord.id` 均可作为后续引用来源。

### 4. 测试策略

- 先新增 `apps/workflow/tests/test_generation_state_references.py`，检查 `GenerationState` 不再暴露大对象字段，并验证 checkpoint sanitizer 删除完整 payload。
- 红灯后最小实现引用字段与 `checkpoint_reference_state()`，再让 `RuntimeCheckpointStore.save_state()` 调用该函数。

### 5. 依赖和集成点

- LangGraph 官方文档强调 checkpointer 会保存状态以支持中断恢复，interrupt payload 需 JSON 可序列化；因此 state 中保留完整上下文会直接放大 checkpoint 成本。
- 本轮不改 API 数据库、不新增迁移；引用 ID 类型保持字符串或 int 的运行时引用，不假设 UUID。

### 6. 技术选型理由

- 以 TypedDict 字段和 sanitizer 形成最小可验证边界，比重写整条 graph 更小。
- 暂时保留节点内部可使用的确定性小 payload 摘要字段，但 checkpoint 输出只允许 ID、状态、审批和引用列表。

### 7. 关键风险点

- 如果直接删除所有大对象字段，会破坏现有 deterministic graph 测试；应先通过引用字段和 checkpoint sanitizer 收口持久化边界。
- `draft_excerpt` 当前用于 human approval interrupt 展示，不能在未提供 artifact 替代前完全删除运行时临时输出；但不得保存进 checkpoint。
- GitHub 开源搜索工具当前不可用；已用 LangGraph 官方 Context7 文档和项目内 3 个实现补偿。
