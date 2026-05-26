## 项目上下文摘要（P8-010 Provider fallback 响应解析）

生成时间：2026-05-26 23:31:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`
  - 模式：统一 `ProviderAdapter` 协议，`ProviderClientAdapter` 把底层异常归一为 `ProviderError`/`ProviderTimeoutError`。
  - 可复用：`ProviderError`、`ProviderTimeoutError`、`_http_error_message`、`_request_id`、`FallbackProviderAdapter`。
  - 需注意：`_call_openai_compatible` 当前直接索引 `choices[0].message.content`，缺少结构校验。
- **实现2**: `apps/workflow/tests/test_provider_fallback.py`
  - 模式：使用小型内联类模拟 primary/fallback，使用 `pytest.raises(..., match=...)` 验证错误语义。
  - 可复用：`_make_request()`、`FallbackProviderAdapter`、`build_default_provider_adapter`。
  - 需注意：新增测试必须覆盖 fallback 真实 HTTP 兼容路径，而非只测 Mock。
- **实现3**: `apps/workflow/storyforge_workflow/provider_client.py`
  - 模式：OpenAI 兼容 Chat Completions 请求，读取 JSON 后提取 `choices[0].message.content`。
  - 可复用：请求/响应协议形状。
  - 需注意：该文件仍抛 `RuntimeError`，本任务限定只修 fallback adapter。
- **实现4**: `apps/workflow/tests/test_llm_provider.py`
  - 模式：用 `HTTPServer` 和后台 `Thread` 模拟 OpenAI 兼容 provider。
  - 可复用：本地 HTTP handler、`monkeypatch` 环境变量、`try/finally` 关闭服务器。

### 2. 项目约定

- **命名约定**: Python 类使用 PascalCase，函数和局部变量使用 snake_case，测试函数以 `test_` 开头。
- **文件组织**: workflow 运行时在 `apps/workflow/storyforge_workflow/runtime/`，测试在 `apps/workflow/tests/`。
- **导入顺序**: `from __future__ import annotations` 后接标准库、第三方库、项目内导入，符合 ruff `I` 规则。
- **代码风格**: Python 3.11，行宽 120，测试断言直接清晰，注释和文档字符串使用简体中文。

### 3. 可复用组件清单

- `ProviderError`: provider 调用失败的统一异常，支持 `status_code`。
- `ProviderTimeoutError`: provider 超时专用异常。
- `build_default_provider_adapter`: 生产路径按环境变量装配 fallback provider。
- `FallbackProviderAdapter`: primary 失败后调用 fallback 并附加 metadata。
- `HTTPServer` 测试模式: 来自 `test_llm_provider.py`，用于模拟 OpenAI 兼容响应。

### 4. 测试策略

- **测试框架**: pytest，配置位于 `apps/workflow/pyproject.toml`，`testpaths = ["tests"]`，`pythonpath = ["."]`。
- **测试模式**: 单元/轻量集成测试，使用 monkeypatch 和本地 HTTP server。
- **参考文件**: `tests/test_provider_fallback.py`、`tests/test_provider_adapter.py`、`tests/test_llm_provider.py`。
- **覆盖要求**: fallback provider 返回缺 `choices`、空 `choices`、缺 `message`、缺 `content`、空 `content` 时均抛语义明确的 `ProviderError`。

### 5. 依赖和集成点

- **外部依赖**: pytest、标准库 `urllib.request`、`json`、`HTTPServer`。
- **内部依赖**: `ProviderClientAdapter` 调用 `_call_openai_compatible`；`FallbackProviderAdapter` 传播 fallback 的 `ProviderError`。
- **集成方式**: 通过环境变量 `STORYFORGE_LLM_FALLBACK_*` 配置 fallback HTTP provider。
- **配置来源**: `apps/workflow/pyproject.toml` 和运行时环境变量。

### 6. 技术选型理由

- **为什么用这个方案**: 响应结构校验应位于 `_call_openai_compatible`，这是 fallback OpenAI 兼容响应从 JSON 转文本的唯一边界。
- **优势**: 错误语义靠近数据解析点，避免 `KeyError`/`IndexError` 经外层泛化后丢失上下文。
- **劣势和风险**: 仅修 fallback adapter，不触碰主 `provider_client.py`，保持任务边界但主 provider 仍有类似自研解析逻辑。

### 7. 关键风险点

- **边界条件**: 空 dict、空 choices、choices 元素非对象、缺 message、message 非对象、缺 content、content 空白。
- **性能瓶颈**: 新增校验为常量级，无明显性能影响。
- **安全考虑**: 本任务不新增安全设计，仅处理响应解析错误语义。
- **工具记录**: Context7 查询 `/pytest-dev/pytest`，确认 `pytest.raises(..., match=...)` 用于异常消息匹配。当前会话没有可用 `github.search_code` 工具，无法执行开源代码搜索，已以项目内 4 个实现分析补偿。

### 8. 充分性验证

- 能说出至少 3 个相似实现路径：是，见实现1-4。
- 理解实现模式：是，adapter 协议统一响应，底层异常转为 `ProviderError`。
- 知道可复用工具：是，`ProviderError`、`build_default_provider_adapter`、HTTP server 测试模式。
- 理解命名和风格：是，Python snake_case、pytest 直接断言、中文注释/文档字符串。
- 知道如何测试：是，新增 pytest 参数化测试并运行 `uv run pytest tests/test_provider_fallback.py`。
- 确认不重复造轮子：是，检查了 runtime adapter、provider_client 和现有 provider 测试，未发现 fallback 响应结构校验工具。
- 理解依赖和集成点：是，fallback HTTP provider 由环境变量驱动，解析点在 `_call_openai_compatible`。
