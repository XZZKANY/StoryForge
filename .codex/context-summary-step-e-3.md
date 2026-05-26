## 项目上下文摘要（Step E-3 Provider 错误恢复测试）

生成时间：2026-05-26 14:06:34 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/tests/test_provider_adapter.py`
  - 模式：pytest 函数级测试，使用注入的 `generate_text_fn`、`config_loader`、`timer` 验证 adapter 行为。
  - 可复用：通过依赖注入模拟 provider 行为，不发真实网络请求。
  - 需注意：当前只覆盖成功路径和 mock provider。
- **实现2**: `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`
  - 模式：`ProviderClientAdapter` 包装现有 `generate_text()`，归一化为 `ProviderResponse`。
  - 可复用：统一 adapter 边界、provider 配置真相源、响应字段归一化。
  - 需注意：当前没有 provider 专用异常类型，HTTP/timeout 异常会直接透传。
- **实现3**: `apps/workflow/storyforge_workflow/provider_client.py`
  - 模式：使用 `urllib.request.urlopen()` 调用 OpenAI 兼容端点，超时来自 `STORYFORGE_LLM_TIMEOUT_SECONDS`。
  - 可复用：`urllib.error.HTTPError` 与 `TimeoutError` 是 provider 故障测试的模拟来源。
  - 需注意：该模块保持低层 HTTP 调用，E-3 应在 runtime adapter 层转换为清晰异常。

### 2. 项目约定

- **命名约定**: Python 函数 snake_case，类 PascalCase，异常类以 `Error` 结尾。
- **文件组织**: Runtime provider 适配逻辑位于 `storyforge_workflow/runtime/provider_adapter.py`，测试位于 `apps/workflow/tests/`。
- **导入顺序**: `from __future__ import annotations`、标准库、第三方、项目内模块。
- **代码风格**: Python docstring 与测试说明使用简体中文。

### 3. 可复用组件清单

- `ProviderClientAdapter`: 错误映射实现位置。
- `ProviderRequest`: 测试输入契约。
- `ProviderResponse`: 成功路径保持不变。
- `pytest.raises`: 验证异常类型、状态码和中文错误消息。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 通过注入 `generate_text_fn` 抛出 `HTTPError` 和 `TimeoutError`，避免真实 provider 调用。
- **参考文件**: `apps/workflow/tests/test_provider_adapter.py`。
- **覆盖要求**: HTTP 429、HTTP 500、连接超时。

### 5. 依赖和集成点

- **外部依赖**: Python 标准库 `urllib.error.HTTPError`。
- **内部依赖**: `ProviderClientAdapter.generate()` 需要捕获低层异常并抛出 provider 专用异常。
- **集成方式**: 上层 `execute_provider_text()` 继续通过 adapter 调用；异常语义由 adapter 对外统一。
- **配置来源**: `config_loader()` 注入 provider_name 和 model。

### 6. 技术选型理由

- **为什么用这个方案**: 在 adapter 边界统一异常类型，避免调用方依赖 urllib 低层细节。
- **优势**: 测试可控、错误包含 status_code、timeout 独立异常便于后续恢复策略。
- **劣势和风险**: E-3 只定义清晰错误，不实现复杂重试调度。

### 7. 关键风险点

- **并发问题**: 无共享状态。
- **边界条件**: HTTPError 可能没有 body，测试只依赖 status code。
- **性能瓶颈**: 无真实网络调用。
- **安全考虑**: 不记录 API Key 或请求正文。

