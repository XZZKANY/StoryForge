## 项目上下文摘要（源码剪枝 workflow-runtime-generate-text-export）

生成时间：2026-06-05 10:12:21

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/provider_client.py`
  - 模式：底层 OpenAI 兼容 HTTP client，提供 `generate_text`、`provider_config`、分层温度和模型读取。
  - 可复用：`generate_text` 仍由节点和 `ProviderClientAdapter` 使用。
  - 需注意：本轮不得删除该底层 client。
- **实现2**: `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`
  - 模式：runtime provider adapter，定义 `ProviderRequest`、`ProviderResponse`、`ProviderClientAdapter`、fallback 和 parity harness。
  - 可复用：`ProviderClientAdapter` 仍包装 `provider_client.generate_text`。
  - 需注意：本轮不改 adapter 行为。
- **实现3**: `apps/workflow/storyforge_workflow/runtime/provider_execution.py`
  - 模式：运行时执行摘要入口，`execute_provider_text` 委托 `ProviderAdapter` 并返回 `ProviderExecutionResult`。
  - 可复用：`execute_provider_text` 是 `WorkflowRuntime` 调用 provider 的当前入口。
  - 需注意：当前文件额外导入并 `__all__` 暴露 `generate_text`，但仓库无调用该转导出口。
- **实现4**: `apps/workflow/storyforge_workflow/runtime/__init__.py`
  - 模式：runtime 包级导出入口。
  - 可复用：继续导出 runtime 类型、adapter、runner 和 `execute_provider_text`。
  - 需注意：当前包级又导出 `generate_text`，形成第三个 provider 调用入口。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case 函数和 PascalCase 类型；测试文件使用 `test_*.py`。
- **文件组织**: `runtime/provider_execution.py` 暴露运行时执行摘要；`provider_client.py` 保持底层 provider client；`runtime/__init__.py` 汇总 runtime 公共 API。
- **导入顺序**: Python import 由 ruff/isort 约束。
- **代码风格**: 剪枝护栏使用 pytest、pathlib 和文本断言；说明文字使用简体中文。

### 3. 可复用组件清单

- `apps/workflow/tests/test_source_pruning.py`: workflow 剪枝防回归测试。
- `apps/workflow/tests/test_provider_adapter.py`: 验证 `execute_provider_text` 仍委托 adapter。
- `apps/workflow/tests/test_provider_fallback.py`: 验证 provider adapter fallback 行为。
- `apps/workflow/tests/test_llm_provider.py`: 验证底层 `provider_client.generate_text` 行为。

### 4. 测试策略

- **测试框架**: pytest、ruff。
- **测试模式**: 新增 source-pruning 红灯，断言 runtime 层不再转导出 `generate_text`；删除后绿灯。
- **参考文件**: `apps/workflow/tests/test_source_pruning.py`、`apps/workflow/tests/test_provider_adapter.py`。
- **覆盖要求**: `provider_client.generate_text` 保留并由 `test_llm_provider.py` 覆盖；`execute_provider_text` 保留并由 `test_provider_adapter.py` 覆盖。

### 5. 依赖和集成点

- **外部依赖**: pytest、ruff。
- **内部依赖**: `WorkflowRuntime` 调用 `execute_provider_text`；`ProviderClientAdapter` 调用 `provider_client.generate_text`；图节点仍直接调用 `provider_client.generate_text` 并传入 temperature/model。
- **集成方式**: 只清理 runtime 转导出，不改变执行调用。
- **配置来源**: `apps/workflow/pyproject.toml`。

### 6. 技术选型理由

- **为什么用这个方案**: 当前 runtime 层 `generate_text` 转导出无仓库调用，会制造 provider 调用边界混淆；删除转导出可减少入口数量。
- **优势**: 改动小，不改变真实 provider 行为，防止后续误从 runtime 包绕过 adapter。
- **劣势和风险**: 外部未记录调用 `storyforge_workflow.runtime.generate_text` 会被破坏；仓库内无此调用。

### 7. 关键风险点

- **并发问题**: 不修改 runtime 执行和图节点调用。
- **边界条件**: 不删除 `provider_client.generate_text`，不把节点改到 adapter。
- **性能瓶颈**: 无运行时路径变化。
- **安全考虑**: 不修改 provider 密钥读取、HTTP 调用或 fallback 配置。

### 8. 充分性检查

- 能定义清晰接口契约：是。本轮只移除 runtime 层 `generate_text` 转导出。
- 理解技术选型理由：是。底层 client 保留，runtime 公共入口收敛到 adapter/execution。
- 识别主要风险点：是。避免误删底层 client 和误改节点分层采样。
- 知道如何验证实现：是。运行 source-pruning、provider adapter/fallback/llm provider、workflow 全量 pytest、ruff、引用搜索和 diff check。
