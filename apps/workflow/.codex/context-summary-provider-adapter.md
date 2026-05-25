## 项目上下文摘要（ProviderAdapter 与 Mock Provider 验收链路）

生成时间：2026-05-25 00:00:00（Asia/Shanghai）

### 1. 相似实现分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/storyforge_workflow/runtime/provider_execution.py:10-38`
  - 模式：不可变 `ProviderExecutionResult` 数据结构 + `execute_provider_text` 薄封装。
  - 可复用：`provider_config()`、`generate_text()`、`perf_counter()` 计时与 token usage 估算。
  - 需注意：该文件直接读取 gateway/provider 配置，adapter 不应替代 provider 解析真相源。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/storyforge_workflow/runtime/checkpoints.py:25-85`
  - 模式：不可变 payload + `Protocol` 边界 + adapter 将 runtime 字段转换为外部 API payload。
  - 可复用：`ModelRunSink`/`ApiModelRunAdapter` 的接口隔离方式。
  - 需注意：输入边界显式校验，测试用替身与真实持久化边界分离。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/storyforge_workflow/runtime/runner.py:28-176`
  - 模式：运行器编排 session、lifecycle、provider execution、checkpoint 与 graph。
  - 可复用：失败路径 `_record_provider_failure` 与 model run 记录字段映射。
  - 需注意：start/resume 当前直接调用 `execute_provider_text`，这是统一 adapter 的集成点。

### 2. 项目约定

- **命名约定**：Python 模块、函数、变量使用 `snake_case`；类与 dataclass 使用 `PascalCase`；测试函数以 `test_` 开头。
- **文件组织**：runtime 内部边界放在 `storyforge_workflow/runtime/`；测试放在 `apps/workflow/tests/`；runtime 对外导出集中在 `runtime/__init__.py`。
- **导入顺序**：`from __future__ import annotations` 位于首行；标准库、第三方、项目内导入分组；现有文件未强制排序工具。
- **代码风格**：大量使用 `@dataclass(frozen=True)` 固定快照；接口边界使用 `typing.Protocol`；测试使用 pytest 普通 `assert` 与 `monkeypatch`。

### 3. 可复用组件清单

- `storyforge_workflow.provider_client.provider_config`：读取真实 provider/gateway 配置，保持 provider 解析真相源。
- `storyforge_workflow.provider_client.generate_text`：通过 OpenAI 兼容 HTTP provider 生成文本。
- `storyforge_workflow.runtime.provider_execution.ProviderExecutionResult`：既有运行器依赖的 provider 执行摘要。
- `storyforge_workflow.runtime.checkpoints.ModelRunPayload`：adapter/payload 设计参照。
- `storyforge_workflow.runtime.checkpoints.ApiModelRunAdapter`：外部持久化 adapter 参照。

### 4. 测试策略

- **测试框架**：`pyproject.toml` 声明 `pytest>=8.0.0`，`testpaths=["tests"]`，`pythonpath=["."]`。
- **测试模式**：单元测试以函数式 pytest 为主；外部 LLM 使用 `monkeypatch` 或本地 HTTPServer 替身隔离。
- **参考文件**：`tests/test_runtime_runner.py`、`tests/test_llm_provider.py`、`tests/test_generation_graph.py`。
- **覆盖要求**：ProviderAdapter dataclass 契约、真实调用桥接、Mock Provider 确定性输出、parity harness 差异报告、既有 runner 行为兼容。

### 5. 依赖和集成点

- **外部依赖**：`langgraph` 用于图执行；`pytest` 用于测试；`urllib.request` 用于 provider HTTP 调用。
- **内部依赖**：`runner.py` 依赖 `execute_provider_text` 与 `ProviderExecutionResult`；`provider_execution.py` 依赖 `provider_client.py`。
- **集成方式**：新增 `provider_adapter.py` 应作为 runtime 内部 provider 调用边界；`provider_execution.py` 可委托默认 adapter，同时保留既有函数名和结果结构。
- **配置来源**：`STORYFORGE_LLM_*` 环境变量由 `provider_config()` 解析，adapter 只读取其结果，不新增解析真相源。

### 6. 技术选型理由

- **为什么用 adapter 协议**：现有 `ModelRunSink` 已用 `Protocol` 固定外部边界；ProviderAdapter 可沿用同一风格，降低 runner 对具体 provider client 的耦合。
- **优势**：真实 provider、mock provider 和 parity harness 共享请求/响应结构，便于本地验收和后续替换实现。
- **劣势和风险**：若 adapter 自行解析模型或 provider，会偏离 API Provider Gateway 真相源；若直接破坏 `ProviderExecutionResult`，既有 runner 测试会失效。

### 7. 关键风险点

- **并发问题**：Mock Provider 若保存可变响应表，需复制请求 metadata，避免调用方后续修改污染验收。
- **边界条件**：空输出、异常 provider、缺失 usage/request_id、负 latency/token usage 均需归一化或拒绝。
- **性能瓶颈**：adapter 层只做一次函数调用与轻量 dataclass 转换，不应引入阻塞额外 I/O。
- **安全考虑**：本阶段不新增认证、加密、审计等安全逻辑，仅保持既有 provider client 行为。

### 8. 外部资料与用途

- **Context7 / pytest 文档**：确认 pytest 推荐普通 `assert`、`monkeypatch.setattr` 和 fixture 方式替换外部调用，用于新增单元测试设计。
- **GitHub 代码搜索**：执行 `gh search code "mock adapter" --language Python --limit 5`，结果显示多个 Python 项目使用 mock adapter 文件或命名，用途是确认 mock adapter 作为测试替身边界属于常见做法。

### 9. 编码前充分性检查

- **至少 3 个相似实现路径**：已确认 `provider_execution.py`、`checkpoints.py`、`runner.py`。
- **实现模式**：不可变 dataclass 固定快照，Protocol 定义可替换边界，pytest 直接断言行为。
- **可复用工具**：`provider_config()`、`generate_text()`、`ProviderExecutionResult`、`ModelRunPayload`、`ApiModelRunAdapter`。
- **命名与风格**：`snake_case` 函数、`PascalCase` 类、中文文档字符串、无复杂抽象。
- **测试方法**：新增 pytest 文件，先验证失败，再实现，最后运行新增与既有 runtime 测试。
- **不重复造轮子证明**：已搜索 `ProviderExecutionResult|execute_provider_text|provider_config|ModelRunPayload`，现有仅有薄 provider 执行封装，无统一 request/response adapter 与 parity harness。
- **依赖和集成点**：`provider_execution.py` 是真实 provider 封装入口；`runner.py` 是 provider 调用编排入口；`runtime/__init__.py` 是导出入口。
