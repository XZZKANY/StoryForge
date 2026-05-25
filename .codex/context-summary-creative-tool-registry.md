## 项目上下文摘要（CreativeToolRegistry 静态工具注册表）

生成时间：2026-05-25 00:00:00 +08:00

### 1. 相似实现分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/storyforge_workflow/runtime/provider_adapter.py:9-198`
  - 模式：`frozen=True` dataclass 表达不可变请求/响应，`Protocol` 表达运行时边界。
  - 可复用：`ProviderRequest.capability`、`ProviderParityHarness` 的静态字段比较思路。
  - 需注意：`__post_init__` 复制可变输入，避免外部修改快照。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/storyforge_workflow/runtime/provider_execution.py:9-44`
  - 模式：轻量 dataclass 返回统一运行摘要。
  - 可复用：`capability`、`provider_name`、`model_name` 字段命名。
  - 需注意：该文件执行 provider 调用，注册表只描述能力，不应调用 provider。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/storyforge_workflow/graph.py:18-120`
  - 模式：显式注册 LangGraph 节点名，并通过字符串节点名记录审计输入输出。
  - 可复用：`book_director`、`scene_architect.chapter_plan`、`scene_architect.scene_beats`、`draft_writer`、`human_approval` 作为 workflow 对应关系。
  - 需注意：节点注册是执行图，CreativeToolRegistry 只能保存元数据引用。
- **实现4**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/provider_gateway/runtime_config.py:10-155`
  - 模式：`Literal` 限定能力枚举，Pydantic model 保存 provider 运行时配置。
  - 可复用：能力值 `llm`、`embedding`、`reranker`。
  - 需注意：workflow 注册表不导入 API 模块，避免跨应用耦合。

### 2. 项目约定

- **命名约定**：Python 文件、函数和变量使用 `snake_case`；类使用 `PascalCase`；常量使用大写。
- **文件组织**：workflow 包按 `runtime/`、`nodes/`、顶层 `graph.py/state.py` 分层；新增工具元数据适合放入 `storyforge_workflow/tools/`。
- **导入顺序**：`from __future__ import annotations` 在首行后，标准库导入在前，项目内导入在后。
- **代码风格**：类型标注完整，中文 docstring 描述意图；测试采用 `pytest` + 直接 `assert`。

### 3. 可复用组件清单

- `ProviderRequest.capability`：统一能力字段来源。
- `ProviderExecutionResult`：provider 执行摘要字段命名参考。
- `WorkflowRuntime.start()`：当前运行时将 provider 能力固定为 `llm`。
- `GenerationState`：workflow 引用型状态字段说明。
- `graph.py` 节点名：注册表 workflow 对应关系的静态字符串来源。
### 4. 已核验 domain 对应关系

- `retrieval`：API `POST /api/retrieval/search`，schema `RetrievalSearchCreate` → `list[RetrievalHitRead]`，能力 `embedding`、可选 `reranker`，证据字段包含 `source_ref`、`chunk_id`、`score`、`rank`。
- `scene_packets`：API `POST /api/scene-packets`，schema `ScenePacketCreate` → `ScenePacketRead`，依赖检索与上下文预算，证据字段包含 `evidence_links`、`budget_statistics`、`compiled_context_id`。
- `judge`：API `POST /api/judge/issues`，schema `JudgeIssueCreate` → `list[JudgeIssueRead]`，能力 `llm`，证据字段包含 `span_start`、`span_end`、`evidence_links`、`recommended_repair_mode`。
- `repair`：API `POST /api/repair/patches`，schema `RepairPatchCreate` → `RepairPatchRead`，不直接要求 provider，证据字段包含 `target_span`、`replacement_text`、`requires_rejudge`。
- `artifacts`：API `POST /api/artifacts`，schema `ArtifactCreate` → `ArtifactRead`，证据字段包含 `lineage_key`、`storage_uri`、`version`、`payload`。
- `evaluations`：API `POST /api/evaluations/runs`，schema `EvaluationRunCreate` → `EvaluationRunRead`，证据字段包含 `metrics`、`summary`、`failed_sample_count`。
- `provider_gateway`：API `GET /api/provider-gateway/resolve`，schema 查询参数 `capability/workspace_id` → `ProviderResolutionRead`，能力值限定 `llm`、`embedding`、`reranker`。

### 5. 测试策略

- **测试框架**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/pyproject.toml` 配置 pytest，`pythonpath=["."]`。
- **参考文件**：`tests/test_provider_adapter.py`、`tests/test_provider_parity_harness.py`。
- **测试模式**：中文 docstring；直接断言 dataclass 字段；用 `pytest.raises(..., match=...)` 验证异常。
### 6. 外部资料与工具记录

- Context7：查询 `/pytest-dev/pytest`，确认 `pytest.raises` 和 dataclass equality 断言为官方推荐模式。
- GitHub 代码搜索：当前会话未暴露 `github.search_code` 工具；已通过工具发现记录无可用 GitHub code search，并用 GitHub 站点搜索作为补偿参考。
- 本地文件分析：全部指定文件和 domain 搜索均使用 desktop-commander 完成。

### 7. 技术选型理由

- **为什么用静态 dataclass 注册表**：与 ProviderAdapter、retrieval clients 的不可变快照风格一致，且满足“不做动态插件/不接 MCP”。
- **优势**：无运行时副作用、无外部依赖、可单测、查询成本低。
- **劣势和风险**：静态 schema 需要后续人工同步 API 变更；本阶段通过测试锁定七个 domain 覆盖和关键字段。

### 8. 充分性检查

- 我能说出至少 3 个相似实现路径：是，已列出 provider_adapter、provider_execution、graph/runtime_config。
- 我理解项目实现模式：是，静态快照、显式节点名、pytest 断言。
- 我知道可复用工具函数/类：是，复用命名与能力字段，不复用执行逻辑。
- 我理解命名和代码风格：是，snake_case、PascalCase、中文 docstring、类型标注。
- 我知道如何测试：是，新增 workflow pytest，并运行 provider 相关回归测试。
- 我确认没有重复造轮子：是，workflow 内无等价 Registry；API provider_gateway 是 provider 解析而非工具目录。
- 我理解依赖和集成点：是，注册表仅保存 `api_paths/page_refs/workflow_nodes` 字符串映射，不导入 API/Web。

### 9. 页面对应关系补充

- `retrieval`：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/app/retrieval/page.tsx` 读取 `/api/retrieval/workbench/sources`、`/api/retrieval/workbench/refresh-runs`、`/api/retrieval/workbench/search`。
- `scene_packets`：`apps/web/app/studio/api.ts` 读取 `/api/studio/scene-packets`；组件 `components/scene-packet/ScenePacketPanel.tsx` 展示场景包证据链接。
- `judge`：`apps/web/app/studio/api.ts` 读取 `/api/studio/judge-reviews`；组件 `components/judge-panel/JudgeIssueList.tsx` 展示评审问题。
- `repair`：`apps/web/app/studio/api.ts` 读取 `/api/studio/repair-patches`；组件 `components/diff-viewer/RepairDiffViewer.tsx` 展示修订差异。
- `artifacts`：`apps/web/app/artifacts/page.tsx` 读取 `/api/artifacts`、详情和下载摘要。
- `evaluations`：`apps/web/app/evaluations/page.tsx` 读取 `/api/evaluations/runs`、详情和失败样例。
- `provider_gateway`：`apps/web/app/providers/page.tsx` 展示 LLM、Embedding、Reranker 能力；当前未读取 provider API。