## 项目上下文摘要（源码剪枝 workflow-nodes-package-export）

生成时间：2026-06-05 11:21:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/nodes/director.py`
  - 模式：Book Director 节点事实源，定义 `create_book_strategy`。
  - 可复用：必须保留具体模块和节点行为。
  - 需注意：`graph.py` 当前直接从该模块导入。
- **实现2**: `apps/workflow/storyforge_workflow/nodes/scene_architect.py`
  - 模式：Scene Architect 节点事实源，定义 `create_chapter_plan` 和 `create_scene_beats`。
  - 可复用：必须保留具体模块和节点行为。
  - 需注意：`graph.py` 当前直接从该模块导入。
- **实现3**: `apps/workflow/storyforge_workflow/nodes/draft_writer.py`
  - 模式：Draft Writer/Critic/Reviser 节点事实源，定义 `create_draft_excerpt` 等函数。
  - 可复用：必须保留具体模块和节点行为。
  - 需注意：`nodes/__init__.py` 仅转导出 `create_draft_excerpt`，但 graph 直接导入具体模块。
- **实现4**: `apps/workflow/storyforge_workflow/nodes/__init__.py`
  - 模式：仅重新导出具体节点模块中的部分函数。
  - 可复用：当前仓库无包级调用方；属于重复公共出口。
  - 需注意：保留包目录语义即可，不应继续转导出具体节点函数。
- **实现5**: `apps/workflow/storyforge_workflow/graph.py`
  - 模式：LangGraph 图编排集成点，直接导入 `nodes.director`、`nodes.scene_architect`、`nodes.draft_writer`。
  - 可复用：本批定向验证核心集成点。
  - 需注意：本批不修改图结构、节点名、timeout、checkpoint 或审批中断。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_` 前缀，docstring 使用简体中文。
- **文件组织**: Workflow 节点事实源位于 `storyforge_workflow/nodes/` 的具体模块；包级初始化文件不承担重复公共出口。
- **导入顺序**: 标准库导入在前，项目内导入在后；本批不新增业务导入。
- **代码风格**: ruff 目标 Python 3.11，行宽 120。

### 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/nodes/director.py`: Book Director 节点事实源。
- `apps/workflow/storyforge_workflow/nodes/scene_architect.py`: Scene Architect 节点事实源。
- `apps/workflow/storyforge_workflow/nodes/draft_writer.py`: Draft Writer/Critic/Reviser 节点事实源。
- `apps/workflow/storyforge_workflow/graph.py`: 图编排集成点。
- `apps/workflow/tests/test_generation_graph.py`: generation graph 定向测试。
- `apps/workflow/tests/test_runtime_runner.py`: runtime runner 定向测试。
- `apps/workflow/tests/test_source_pruning.py`: 本批剪枝护栏。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 先扩展 source-pruning 红灯测试，再移除包级转导出。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_generation_graph.py`、`tests/test_runtime_runner.py`。
- **覆盖要求**: `nodes/__init__.py` 不再转导出 generation node 符号；图编排和 runtime runner 行为不变。

### 5. 依赖和集成点

- **外部依赖**: pytest、ruff、LangGraph。
- **内部依赖**: `graph.py` 直接导入 `nodes.director`、`nodes.scene_architect`、`nodes.draft_writer`。
- **集成方式**: 移除重复包级出口，不修改具体节点模块或图编排。
- **配置来源**: `apps/workflow/pyproject.toml` 指定 pytest 和 ruff 规则。

### 6. 技术选型理由

- **为什么用这个方案**: 当前仓库无 `from storyforge_workflow.nodes import ...` 调用，包级转导出只增加重复入口。
- **优势**: 具体节点模块成为唯一入口，降低维护面。
- **劣势和风险**: 外部未记录包级导入会失效；当前仓库内无此调用。

### 7. 关键风险点

- **并发问题**: 不修改节点执行、timeout 或线程池逻辑。
- **边界条件**: 不删除或修改 `director.py`、`scene_architect.py`、`draft_writer.py` 或 `graph.py`。
- **性能瓶颈**: 无性能影响。
- **安全考虑**: 不修改 API、Provider、认证或外部请求逻辑。

### 8. 暂不处理的候选

- `storyforge_workflow/quality/__init__.py`: 当前 `tests/test_prose_static_check.py` 使用包级导入。
- `storyforge_workflow/prompts/__init__.py`: 当前生产节点和 `tests/test_prompt_builder.py` 使用包级导入。
- API domain `__init__.py`: 当前存在 `from app.domains.batch_refinery import service` 等包语义导入。
