## 项目上下文摘要（主链路精修）

生成时间：2026-06-05 14:07:41

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`
  - 模式：Protocol sink + frozen dataclass ports，adapter 不依赖 API ORM。
  - 可复用：`BookRunAdapterRequest`、`BookRunAdapterPorts`、`BookRunProgressSink`、`CapturingProgressSink`、`CallableProgressSink`。
  - 需注意：当前只在 `run_book_loop` 正常返回后 emit 一次 progress，异常路径没有失败回填。
- **实现2**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`
  - 模式：纯函数顺序驱动章节，返回 `BookLoopResult(status, current_chapter_index, progress)`。
  - 可复用：`BookLoopRequest`、`BookLoopResult`、`run_book_loop`、`_paused_by_budget`、`_checkpoint_entry`。
  - 需注意：状态词已有 `completed`、`awaiting_review`、`paused_by_budget`、`paused_by_provider_degradation`，异常尚未语义化。
- **实现3**: `apps/workflow/storyforge_workflow/runtime/runner.py` 与 `apps/workflow/tests/test_runtime_runner.py`
  - 模式：运行时失败时保留 checkpoint、记录 failed payload，并隔离 sink 写入失败。
  - 可复用思想：失败记录链路不能覆盖 provider 原始失败；失败状态保留可恢复证据。
  - 需注意：BookRun adapter 不应直接复用 RuntimeCheckpointStore，只借鉴失败语义。
- **实现4**: `apps/api/app/domains/book_runs/service.py`
  - 模式：API 是 BookRun 真相源，`apply_book_run_progress()` 接收 workflow progress 并写入 status/checkpoint/budget。
  - 可复用：`BookRunProgressUpdate` 的 `progress: dict[str, Any]` 可承载普通失败证据；`volume_progress` 是受控卷摘要入口。
  - 需注意：不能把 `volume/current_volume/chapter_range/volume_checkpoint` 直接塞进普通 progress。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case 函数和变量、PascalCase dataclass/Protocol。
- **文件组织**: workflow 编排代码位于 `apps/workflow/storyforge_workflow/orchestrators/`；测试位于 `apps/workflow/tests/`。
- **导入顺序**: `from __future__ import annotations` 在首行；标准库、第三方、本地包分组。
- **代码风格**: Python 3.11+，ruff 规则 `E/F/W/I/UP/B/SIM`，行宽 120，测试说明使用简体中文。

### 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`: BookRun adapter ports 与 progress sink。
- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`: BookLoop 主循环与 progress 结构。
- `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`: NovelLoop 章节闭环与 `NovelLoopResult`。
- `apps/workflow/storyforge_workflow/skills/runner.py`: `NovelSkillRunner` 记录引用化 skill_runs。
- `apps/api/app/domains/book_runs/service.py`: API progress 应用和卷摘要受控合并。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 行为测试，直接构造 ports/sink，使用 `pytest.raises(..., match=...)` 验证异常消息。
- **参考文件**: `apps/workflow/tests/test_book_run_adapter.py`、`apps/workflow/tests/test_book_run_dispatch_payload.py`、`apps/workflow/tests/test_runtime_runner.py`。
- **覆盖要求**: 正常调度开始、完章中间 progress、最终 progress、业务异常失败 progress、sink 失败隔离。

### 5. 依赖和集成点

- **外部依赖**: pytest、ruff，无新增依赖。
- **内部依赖**: API dispatch payload -> workflow adapter -> BookLoop -> NovelLoop -> NovelSkillRunner -> progress sink -> API progress endpoint。
- **集成方式**: ports/dataclass + callable sink，不引入 API ORM 或 HTTP client。
- **配置来源**: workflow 测试由 `apps/workflow/pyproject.toml` 配置。

### 6. 技术选型理由

- **为什么用这个方案**: 当前项目已经采用 ports/dataclass 隔离 API 与 workflow，增强 adapter 可在不扩大架构面的前提下补齐生产证据。
- **优势**: 小范围改动、可测试、失败语义明确，继续复用 API progress 契约。
- **劣势和风险**: 中间 progress 会改变 sink payload 数量，既有测试需改为断言关键语义而非固定单条 payload。

### 7. 关键风险点

- **并发问题**: 当前 BookLoop 是顺序执行；本次不引入并发。
- **边界条件**: sink 写入失败、章节端口异常、恢复 checkpoint、卷摘要不能污染普通 progress。
- **性能瓶颈**: 新增 emit 只构造小字典，I/O 成本由外部 sink 决定。
- **安全考虑**: 不写入完整正文、完整提示词或密钥；失败摘要仅保存异常字符串。

### 8. 外部资料来源与用途

- Context7 `/pytest-dev/pytest`: 确认 `pytest.raises` 的 `match` 和 `excinfo` 用法，用于异常路径测试。
- GitHub code search `progress sink workflow adapter failure pytest language:Python`: 参考通用 adapter/sink 失败隔离思路；最终实现以本仓库 `WorkflowRuntime` 既有模式为准。

### 9. 上下文充分性检查

- 能说出至少 3 个相似实现：是，见实现1-4。
- 理解实现模式：是，adapter ports + sink，BookLoop 纯函数返回 progress。
- 知道可复用工具：是，见组件清单。
- 理解命名和风格：是，Python dataclass/Protocol/pytest/ruff。
- 知道如何测试：是，目标 pytest 文件已定位。
- 确认没有重复造轮子：是，复用现有 sink 和 BookLoop，不新增框架。
- 理解依赖和集成点：是，见第 5 节。
