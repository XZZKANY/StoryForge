## 项目上下文摘要（源码剪枝 workflow-chapter-planner）

生成时间：2026-06-05 14:18:39

### 1. 相似实现分析

- **实现1**: `apps/workflow/tests/test_source_pruning.py`
  - 模式：使用 `Path` 检查已下线模块、包级转导出和工具引用不得回归。
  - 可复用：`WORKFLOW_ROOT`、`Path.read_text(encoding="utf-8")`、朴素字符串 forbidden 清单。
  - 需注意：护栏只能禁止未接入 planner 包，不得禁止主图节点名 `chapter_planner`。
- **实现2**: `apps/workflow/storyforge_workflow/graph.py`
  - 模式：`StateGraph` 使用节点名字符串和 callable 绑定真实执行函数。
  - 可复用：保留 `builder.add_node("chapter_planner", _audited_node("scene_architect.chapter_plan", create_chapter_plan, ...))`。
  - 需注意：节点名字符串是运行图边界，不代表导入 `storyforge_workflow.planners.chapter_planner`。
- **实现3**: `apps/workflow/storyforge_workflow/nodes/scene_architect.py`
  - 模式：真实章节计划节点使用 prompt builder、provider client 和 `advance_status` 产出轻量引用。
  - 可复用：继续作为主图章节规划事实源。
  - 需注意：不修改 prompt、provider、state 或 runtime runner。

### 2. 项目约定

- **命名约定**: Python 模块和函数使用 snake_case，测试函数以 `test_` 开头。
- **文件组织**: Workflow 主图节点位于 `storyforge_workflow/nodes/`，运行编排位于 `graph.py` 和 `runtime/runner.py`。
- **导入顺序**: 标准库、第三方、本地模块分组，ruff 负责检查。
- **代码风格**: pytest 使用普通 `assert` 和简体中文 docstring/断言消息。

### 3. 可复用组件清单

- `apps/workflow/tests/test_source_pruning.py`: Workflow 剪枝防回归护栏。
- `apps/workflow/storyforge_workflow/graph.py`: LangGraph 主图事实源。
- `apps/workflow/storyforge_workflow/nodes/scene_architect.py`: 真实章节计划节点实现。
- `apps/workflow/storyforge_workflow/prompts/builder.py`: 章节计划 prompt 事实源。
- `apps/workflow/storyforge_workflow/runtime/runner.py`: Workflow 运行入口。

### 4. 测试策略

- **测试框架**: pytest，命令在 `apps/workflow` 下执行。
- **测试模式**: 先扩展 `test_source_pruning.py` 红灯，确认 planner 包和专属测试仍存在；删除后绿灯。
- **参考文件**: `apps/workflow/tests/test_generation_graph.py`、`apps/workflow/tests/test_runtime_runner.py`、`apps/workflow/tests/test_prompt_builder.py`。
- **覆盖要求**: source-pruning、真实主图/运行时/prompt 定向测试、Workflow 全量 pytest、ruff、残留搜索、diff-check。

### 5. 依赖和集成点

- **外部依赖**: LangGraph、pytest、ruff。
- **内部依赖**: `graph.py` 通过 `scene_architect.create_chapter_plan` 接入章节计划；`planners/chapter_planner.py` 未被主链路导入。
- **集成方式**: 主图边通过节点名 `"chapter_planner"` 连接，但 callable 来自 `scene_architect`。
- **配置来源**: `apps/workflow/pyproject.toml` 的 pytest 与 ruff 配置。

### 6. 技术选型理由

- **为什么用这个方案**: deterministic planner 只被专属测试覆盖，真实运行链路已经由 `scene_architect.create_chapter_plan` 承担。
- **优势**: 删除未接入 planner 包，减少误导性双入口，保留真实 LangGraph 节点名和运行逻辑。
- **劣势和风险**: 仓库外未记录导入 planner 包会失效；主图节点名仍含 `chapter_planner`，残留搜索需避免误判。

### 7. 关键风险点

- **并发问题**: 无运行时并发影响。
- **边界条件**: 不得删除或改名 graph.py 的 `"chapter_planner"` 节点。
- **性能瓶颈**: 删除未接入代码，不增加运行成本。
- **安全考虑**: 不修改 provider、runtime、认证、API 或外呼逻辑。

### 8. 外部依据

- Context7 查询 LangGraph 官方文档：`StateGraph.add_node("my_node", step_1)` 支持自定义节点名和 callable，`add_edge` 使用节点名；因此主图节点名不等于同名 Python 模块导入。
- GitHub code search 查询 LangGraph `builder.add_node` / `add_edge` 开源示例，用于对照节点名和函数绑定模式；最终判断以本仓库 `graph.py` 为准。

### 9. 上下文充分性检查

- 能定义清晰契约：是，未接入 planner 包和专属测试不应继续存在。
- 理解技术选型理由：是，真实章节计划由 `scene_architect.create_chapter_plan` 接入主图。
- 识别主要风险点：是，不能误删主图节点名 `chapter_planner`。
- 知道如何验证实现：是，运行 source-pruning、generation_graph/runtime_runner/prompt_builder、Workflow 全量、ruff、残留搜索和 diff-check。
