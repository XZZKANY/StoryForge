## 项目上下文摘要（源码剪枝 Workflow runtime provider parity 包级转导出）

生成时间：2026-06-05 17:50:33 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/tests/test_source_pruning.py`
  - 模式：已有多项包级入口剪枝护栏，断言 `tools`、`orchestrators`、`skills`、`nodes`、`quality` 等 `__init__.py` 不重复转导出具体模块符号。
  - 可复用：读取包级 `__init__.py`，遍历 forbidden symbols 和 import 语句。
  - 需注意：只禁止包级转导出，不删除具体模块真实实现。
- **实现2**: `apps/workflow/storyforge_workflow/runtime/__init__.py`
  - 模式：runtime 包级入口仍集中转导出 checkpoint、lifecycle、session、runner、provider adapter 等公共 runtime 类型。
  - 可复用：保留 `WorkflowRuntime`、`RuntimeCheckpointStore`、`InMemoryWorkflowSessionStore` 等已有测试从包级入口导入的类型。
  - 需注意：`ProviderParityCase`、`ProviderParityHarness`、`ProviderParityResult` 当前也在包级入口，但仓库没有包级消费者。
- **实现3**: `apps/workflow/tests/test_provider_parity_harness.py`
  - 模式：provider parity harness 专项测试直接从 `storyforge_workflow.runtime.provider_adapter` 导入 `ProviderParityCase` 和 `ProviderParityHarness`。
  - 可复用：说明 harness 本体仍是具体模块验收工具，不是本批剪枝对象。
  - 需注意：不能删除 `provider_adapter.py` 中的 parity classes，也不能改专项测试导入。

### 2. 项目约定

- **命名约定**: Python 包级入口使用 `__all__` 暴露公共符号；测试函数和 docstring 使用简体中文。
- **文件组织**: runtime 具体职责位于 `storyforge_workflow/runtime/*.py`；source-pruning 护栏位于 `apps/workflow/tests/test_source_pruning.py`。
- **导入顺序**: 标准库、第三方、项目内导入分组；本批只删 import 列表和 `__all__` 条目。
- **代码风格**: 静态剪枝测试使用 Path 读取源码并断言 forbidden markers。

### 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`: 保留 `ProviderParityCase`、`ProviderParityResult`、`ProviderParityHarness` 定义。
- `apps/workflow/tests/test_provider_parity_harness.py`: 保留 provider parity harness 专项行为测试。
- `apps/workflow/tests/test_runtime_runner.py`: 继续从 `storyforge_workflow.runtime` 导入真实 runtime 公共类型。
- `apps/workflow/tests/test_workflow_lifecycle.py`: 继续从 `storyforge_workflow.runtime` 导入 lifecycle/checkpoint 公共类型。
- `apps/workflow/tests/test_workflow_session.py`: 继续从 `storyforge_workflow.runtime` 导入 session store。

### 4. 测试策略

- **测试框架**: Pytest。
- **测试模式**: 先在 `test_source_pruning.py` 新增红灯护栏，要求 runtime 包级入口不转导出 provider parity harness 三项；红灯应只因 `__init__.py` 仍含三项而失败。
- **参考文件**:
  - `apps/workflow/tests/test_source_pruning.py`
  - `apps/workflow/tests/test_provider_parity_harness.py`
  - `apps/workflow/tests/test_runtime_runner.py`
  - `apps/workflow/tests/test_workflow_lifecycle.py`
  - `apps/workflow/tests/test_workflow_session.py`
- **覆盖要求**:
  - 红灯：source-pruning 新护栏失败。
  - 绿灯：删除包级转导出后，source-pruning、provider parity harness、runtime runner/lifecycle/session 相关测试通过。
  - 全量：Workflow 全量通过。

### 5. 依赖和集成点

- **外部依赖**: 无新增依赖。GitHub search 未找到同名开源 `ProviderParityHarness` 模式，说明该命名为项目内验收工具。
- **内部依赖**:
  - 包级 `storyforge_workflow.runtime` 仍被 runner、lifecycle、session、generation state tests 导入真实 runtime 类型。
  - `ProviderParity*` 只由 `provider_adapter.py` 定义和 `test_provider_parity_harness.py` 直接消费。
- **集成方式**: 停止在 `runtime/__init__.py` 中导入和 `__all__` 暴露 parity harness 三项。
- **配置来源**: 无配置改动。

### 6. 技术选型理由

- **为什么用这个方案**: provider parity harness 是专项验收工具，不需要成为 runtime 包级公共 API；直接从 `provider_adapter.py` 导入更明确。
- **优势**: 缩小 runtime 包级入口职责，减少测试工具符号被误当生产 runtime API 的风险。
- **劣势和风险**: 若外部未知代码从包级入口导入 `ProviderParity*` 会受影响；当前仓库内搜索无此消费者，且项目规则倾向破坏式清理重复入口。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不能删除 `provider_adapter.py` 中的 parity classes；不能删除 `tests/test_provider_parity_harness.py`。
- **性能瓶颈**: 删除包级转导出不改变运行性能。
- **安全考虑**: 不涉及认证、网络、文件系统或 provider 调用行为。
