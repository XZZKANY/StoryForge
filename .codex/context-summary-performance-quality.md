## 项目上下文摘要（性能与质量高优先级修复）

生成时间：2026-06-06 15:51:55 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/provider_client.py`
  - 模式：OpenAI 兼容 Chat Completions 客户端，负责环境配置、请求组装、线程本地 HTTP 连接复用和模型名归一化。
  - 可复用：`_post_chat_completion()`、`_request_json_with_reused_connection()`、`_close_cached_connection()`、`close_provider_connections()`。
  - 需注意：当前只有连接异常后立即重试一次，没有 429/5xx 的有限次数退避。
- **实现2**: `apps/workflow/storyforge_workflow/runtime/runner.py`
  - 模式：`WorkflowRuntime.start/resume` 串联 session、lifecycle、provider 执行、LangGraph 和 checkpoint。
  - 可复用：`_stream_graph_with_state_snapshots()`、`_emit_model_run_payload()`、`_record_provider_failure()`。
  - 需注意：`start()` 在 graph 前有一次 provider pre-flight；同时 graph 节点内部也会调用 LLM，移除它会影响 `WorkflowRuntimeResult.provider_execution` 和 ModelRun 合约。
- **实现3**: `apps/workflow/storyforge_workflow/runtime/checkpoints.py`
  - 模式：SQLite checkpoint store 复用单连接，使用 `runtime_states` 保存最新状态、`runtime_state_snapshots` 追加历史快照。
  - 可复用：`checkpoint_reference_state()`、`_connect()`、`save_state()`、`list_state_snapshots()`。
  - 需注意：当前未设置 WAL、`synchronous` 或 `busy_timeout`；快照保存也未做相邻重复状态去重。
- **实现4**: `apps/workflow/storyforge_workflow/nodes/draft_writer.py`
  - 模式：draft、critique、revision 都通过 prompt + `generate_text()`，critique 使用 `_parse_issues()` 把 LLM 输出转为问题列表。
  - 可复用：`_parse_issues()`、`build_critique_prompt()`、`narrative_context_from_state()`。
  - 需注意：prompt 已要求 `DECISION/SCORE/ISSUE`，但解析器仍按简单文本行处理；“审核通过”这类首行会误判为问题。
- **实现5**: `apps/workflow/storyforge_workflow/nodes/director.py` 与 `scene_architect.py`
  - 模式：规划输出按非空行解析，缺行时静默 fallback。
  - 可复用：`planning_temperature()`、`planning_model()`、`advance_status()`。
  - 需注意：缺少结构验证和 warning，垃圾规划可能静默扩散到后续节点。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case，类名使用 PascalCase，测试函数使用 `test_` 前缀。
- **文件组织**: workflow 运行时在 `apps/workflow/storyforge_workflow/runtime`，节点在 `apps/workflow/storyforge_workflow/nodes`，测试在 `apps/workflow/tests`。
- **导入顺序**: 标准库、第三方、项目内部；文件普遍使用 `from __future__ import annotations`。
- **代码风格**: Ruff `py311`、120 行宽、中文 docstring/注释、pytest plain assert。

### 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/provider_client.py`: provider HTTP 调用、连接缓存和关闭函数。
- `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`: `ProviderError`、`ProviderTimeoutError`、fallback warning 模式。
- `apps/workflow/storyforge_workflow/runtime/checkpoints.py`: SQLite checkpoint store 和内存测试替身。
- `apps/workflow/storyforge_workflow/state.py`: `checkpoint_reference_state()` 裁剪 checkpoint 大对象，`advance_status()` 相邻状态去重。
- `apps/workflow/storyforge_workflow/utils/logging.py`: 结构化日志入口。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 使用 `monkeypatch` 注入 LLM/provider fake，使用 `tmp_path` 隔离 SQLite，使用本地 HTTPServer 模拟 provider。
- **参考文件**: `apps/workflow/tests/test_llm_provider.py`、`apps/workflow/tests/test_runtime_runner.py`、`apps/workflow/tests/test_workflow_lifecycle.py`、`apps/workflow/tests/test_generation_graph.py`。
- **覆盖要求**: 重试退避、WAL 配置、critique 通过判定、规划验证 warning、checkpoint 保存行为均需本地自动化验证。

### 5. 依赖和集成点

- **外部依赖**: OpenAI 兼容 `/chat/completions`，配置来自 `STORYFORGE_LLM_*` 环境变量。
- **内部依赖**: `WorkflowRuntime`、`create_generation_graph()`、`RuntimeCheckpointStore`、workflow nodes、`ProviderClientAdapter`。
- **集成方式**: runtime 调 `execute_provider_text()` 记录轻量 ModelRun；graph 节点直接调 `generate_text()` 生成规划和正文。
- **配置来源**: `apps/workflow/pyproject.toml` 定义 pytest/ruff；`apps/workflow/tests/conftest.py` 为每个测试隔离 SQLite。

### 6. 技术选型理由

- **为什么先做局部修复**: 用户清单包含多项跨模块优化，一次全改会破坏既有运行合约；先处理可红绿验证且边界清晰的 provider、SQLite、critique、规划验证。
- **优势**: 减少 429/5xx 单点失败，改善 SQLite 写入模式，降低无意义 critique 修订和垃圾规划扩散。
- **劣势和风险**: runner pre-flight 移除涉及已有返回值与 ModelRun 合约，需单独设计迁移；prompt token budget 接入 context compiler 涉及 API/workflow 跨边界，需后续专项。

### 7. 关键风险点

- **并发问题**: SQLite 单连接配合 WAL 需保持线程锁；provider 连接缓存需在失败时关闭坏连接。
- **边界条件**: 只重试 429/5xx 与连接瞬断，不应重试 4xx 普通错误；规划验证不能吞掉真实错误。
- **性能瓶颈**: graph 前 pre-flight 仍是明显额外 LLM 调用，但当前合约依赖它记录 provider_execution。
- **安全考虑**: 不记录 API key、base URL 凭据或完整 prompt；所有验证只使用本地 fake provider。

### 8. 编码前充分性检查

- 能说出至少 3 个相似实现路径：是，见 provider_client、runner、checkpoints、draft_writer、director/scene_architect。
- 理解实现模式：是，workflow 节点轻量 dict 输出，runtime 统一保存 checkpoint，测试以 monkeypatch fake 为主。
- 知道可复用工具：是，复用 provider 连接函数、checkpoint store、状态裁剪、结构化日志。
- 理解命名与风格：是，Python snake_case、中文 docstring、pytest plain assert。
- 知道如何测试：是，定向运行 `cd apps/workflow && uv run pytest tests/test_llm_provider.py tests/test_workflow_lifecycle.py tests/test_generation_graph.py -q`。
- 确认没有重复造轮子：是，仓库内没有通用 retry/backoff 或 SQLite WAL 配置，结构验证主要在 API 领域层。
- 理解依赖集成点：是，provider、runtime、graph nodes 与 checkpoint 的调用链已确认。
