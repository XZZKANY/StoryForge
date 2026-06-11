## 项目上下文摘要（源码剪枝-workflow-prompt-quality-models）

生成时间：2026-06-05 18:38:58 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/prompts/models.py:135`
  - 模式：冻结 dataclass 承载 prompt 构建器真实输入。
  - 可复用：`SceneQualityPlan.has_content()` 被 builder 渲染前检查消费。
  - 需注意：`SceneQualityPlan` 是活模型，不属于本批剪枝对象。
- **实现2**: `apps/workflow/storyforge_workflow/prompts/builder.py:362`
  - 模式：`build_critique_prompt()` 使用 `DECISION` / `SCORE` / `ISSUE` 字符串契约约束 LLM 输出。
  - 可复用：现有字符串契约已覆盖评审维度和修订策略，不依赖 `QualityIssue` 类型。
  - 需注意：不能删除或改写 builder 的评审/修订契约。
- **实现3**: `apps/workflow/storyforge_workflow/nodes/draft_writer.py:38`
  - 模式：Draft Critic 调用 builder 后用 `_parse_issues()` 解析为 `list[str]`。
  - 可复用：`draft_issues` 是当前 critic→reviser 的真实运行时工作键。
  - 需注意：本批不改变节点、图路由或状态协议。
- **实现4**: `apps/workflow/tests/test_source_pruning.py`
  - 模式：源码剪枝护栏以源码字符串和路径存在性防止旧入口回潮。
  - 可复用：新增护栏沿用同一文件、同一断言风格。
  - 需注意：测试标题、断言信息保持简体中文。

### 2. 项目约定

- **命名约定**: Python 模块使用 snake_case；dataclass 类型使用 PascalCase；测试函数使用 `test_` 前缀。
- **文件组织**: prompt 结构模型集中在 `prompts/models.py`，包级公共入口在 `prompts/__init__.py`，源码剪枝护栏集中在 `apps/workflow/tests/test_source_pruning.py`。
- **导入顺序**: `from __future__ import annotations` 在文件头部；标准库导入在项目内导入前。
- **代码风格**: 测试通过读取源码字符串表达架构边界，不新增测试框架或运行脚本。

### 3. 可复用组件清单

- `apps/workflow/tests/test_source_pruning.py`: 复用源码剪枝护栏模式。
- `apps/workflow/storyforge_workflow/prompts/builder.py`: 保留 `build_critique_prompt()` 和 `build_revision_prompt()` 字符串契约。
- `apps/workflow/storyforge_workflow/prompts/context.py`: 保留 `SceneQualityPlan` 到 `NarrativeContext` 的映射。
- `apps/workflow/storyforge_workflow/nodes/draft_writer.py`: 保留 `draft_issues: list[str]` 的 critic→reviser 工作流。
- `apps/api/app/domains/book_runs/workflow_prompt_bridge.py`: 保留 API 进程内按文件加载 prompt 层的桥接方式。

### 4. 测试策略

- **测试框架**: Pytest，经 `uv run pytest` 运行。
- **测试模式**: 先在 `apps/workflow/tests/test_source_pruning.py` 增加红灯护栏，再删除生产代码。
- **参考文件**: `apps/workflow/tests/test_source_pruning.py`、`apps/workflow/tests/test_prompt_builder.py`、`apps/workflow/tests/test_generation_graph.py`、`apps/workflow/tests/test_runtime_runner.py`。
- **覆盖要求**: 红灯命中未接入质量模型仍存在；绿灯后覆盖 source-pruning、prompt builder、generation graph、runtime runner、workflow 全量、残留搜索、保留搜索和 diff check。

### 5. 依赖和集成点

- **外部依赖**: Python dataclasses；Context7 查询 Python 官方 dataclasses 文档，确认本批不涉及复杂库行为变更。
- **内部依赖**:
  - `prompts/models.py` 定义当前 prompt 输入模型。
  - `prompts/__init__.py` 负责包级转导出。
  - `builder.py` 消费 `NarrativeContext` 并输出字符串 prompt。
  - `draft_writer.py` 将 critic 输出解析为 `draft_issues: list[str]`。
  - `graph.py` 只按 `draft_issues` 是否存在路由到 reviser。
  - `workflow_prompt_bridge.py` 只按文件加载 models/context/builder，不按 `QualityIssue` 等名称取对象。
- **集成方式**: 删除未接入 dataclass 与对应转导出；不改变 builder、context、nodes、graph 或 API bridge 行为。
- **配置来源**: 无新增配置。

### 6. 技术选型理由

- **为什么用这个方案**: 仓库内搜索显示 `QualityScore`、`RevisionStrategy`、`QualityIssue`、`QualityReport`、`to_contract_line()` 只在定义和转导出中出现；真实运行链路已经由字符串契约承担质量评审和修订职责。
- **优势**: 减少 prompt 层公共 API 暴露面，避免未落地预留模型误导后续维护。
- **劣势和风险**: 仓库外若直接从 `storyforge_workflow.prompts` 导入这些名称会被破坏；仓库内无消费者，且项目规则要求破坏式删除未接入实现。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不得删除 `SceneQualityPlan`，它被 `NarrativeContext`、`context.py`、`builder.py` 与 `test_prompt_builder.py` 消费。
- **性能瓶颈**: 删除未实例化 dataclass 仅减少加载与维护面，无新增性能开销。
- **安全考虑**: 不涉及认证、鉴权、限流、请求超时或审计安全基线。

### 8. 外部检索与子代理复核

- **Context7**: 查询 `/python/cpython` dataclasses 文档，确认 `field(default_factory=...)` 是 dataclass 默认值机制；本批删除未消费模型，不改变活模型默认值语义。
- **GitHub search**: 搜索 `build_revision_prompt` 与 `Iterable[str]` 的公开实现，仅作为流程性参考；删除依据仍以仓库内调用链为准。
- **子代理 Halley**: 只读复核确认四个质量结构模型和 `to_contract_line()` 可剪，`SceneQualityPlan` 必须保留；API bridge 不按这些对象名动态取值。

### 9. 充分性检查

- **接口契约**: 当前 critic/reviser 契约为 prompt 字符串与 `draft_issues: list[str]`，不是结构化质量模型。
- **技术选型理由**: 已确认现有 builder 字符串契约是运行事实源。
- **主要风险点**: 误删 `SceneQualityPlan` 或包级转导出不同步导致导入失败。
- **验证方式**: TDD 红灯、定向 Workflow 测试、全量 Workflow 测试、残留搜索、保留搜索、`git diff --check`。
