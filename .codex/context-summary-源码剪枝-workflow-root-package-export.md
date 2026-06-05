## 项目上下文摘要（源码剪枝-workflow-root-package-export）

生成时间：2026-06-05 19:02:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/prompts/__init__.py`
  - 模式：包级入口只保留生产节点真实使用的 `build_*` 构建器，不转导出 prompt 模型。
  - 可复用：收缩 barrel 出口但保留具体模块本体。
  - 需注意：本批同样只收缩根包入口，不删除 `graph.py`、`persistence.py` 或 `state.py`。
- **实现2**: `apps/workflow/storyforge_workflow/runtime/__init__.py`
  - 模式：runtime 包级入口不转导出 provider parity 验收工具。
  - 可复用：source-pruning 护栏防止包级公共 API 回潮。
  - 需注意：真实 runtime 公共对象仍在具体模块。
- **实现3**: `apps/workflow/storyforge_workflow/quality/__init__.py`
  - 模式：quality 包级入口不转导出静态检查函数，调用方统一从具体模块读取。
  - 可复用：重复公共入口收缩模式。
  - 需注意：专项测试仍可从具体模块导入。

### 2. 项目约定

- **命名约定**: Python 模块使用 snake_case，测试函数使用 `test_` 前缀。
- **文件组织**: 生成图位于 `graph.py`，checkpoint 存储位于 `persistence.py`，状态模型位于 `state.py`，根包不承担聚合职责。
- **导入顺序**: 标准库 / 第三方 / 项目内具体模块导入。
- **代码风格**: source-pruning 护栏使用源码字符串断言，断言信息使用简体中文。

### 3. 可复用组件清单

- `apps/workflow/tests/test_source_pruning.py`: 复用 barrel 收缩护栏模式。
- `apps/workflow/storyforge_workflow/graph.py`: 保留 `create_generation_graph` 与 `WorkflowNodeTimeoutError`。
- `apps/workflow/storyforge_workflow/persistence.py`: 保留 `InMemoryWorkflowStore` 与 `WorkflowCheckpoint`。
- `apps/workflow/storyforge_workflow/state.py`: 保留 `GenerationState` 与 `initial_generation_state`。
- `apps/workflow/storyforge_workflow/runtime/runner.py`: 将根包导入迁移到 `state.py`。

### 4. 测试策略

- **测试框架**: Pytest。
- **测试模式**: 先新增 source-pruning 红灯护栏，断言根包 `__init__.py` 不应转导出 graph/persistence/state 符号，同时保护具体模块本体。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_generation_graph.py`、`tests/test_runtime_runner.py`。
- **覆盖要求**: 红灯命中根包仍转导出符号；绿灯后覆盖 source-pruning、generation graph、runtime runner、Workflow 全量、残留搜索、保留搜索和 diff check。

### 5. 依赖和集成点

- **外部依赖**: 无新增外部依赖。
- **内部依赖**:
  - `runtime/runner.py` 当前从根包导入 `initial_generation_state`。
  - `tests/test_generation_graph.py` 当前从根包导入 `InMemoryWorkflowStore`、`create_generation_graph`、`initial_generation_state`。
  - 其他生产代码已从具体模块读取 graph/persistence/state。
- **集成方式**: 导入迁移到具体模块；根包降为文档入口。
- **配置来源**: 无新增配置。

### 6. 技术选型理由

- **为什么用这个方案**: 根包 barrel 同时转导出 graph、persistence、state，职责过宽；仓库内消费者极少且可迁移。
- **优势**: 降低公共 API 暴露面，减少根包导入触发的跨模块加载。
- **劣势和风险**: 仓库外若依赖根包导入旧符号会受破坏式剪枝影响；仓库内搜索无生产必要性。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不得删除具体模块本体，不得改变生成图或 runtime runner 行为。
- **性能瓶颈**: 根包 import 面减少，无新增运行时开销。
- **安全考虑**: 不涉及认证、鉴权、限流、请求超时或审计安全基线。

### 8. 充分性检查

- **接口契约**: 根包不再作为 graph/persistence/state 公共入口；具体模块承担真实入口。
- **技术选型理由**: 已有 prompts/runtime/quality 包级入口收缩模式。
- **主要风险点**: 测试或 runner 导入迁移遗漏。
- **验证方式**: TDD 红灯、定向 Workflow 测试、Workflow 全量、残留搜索、保留搜索、`git diff --check`。
