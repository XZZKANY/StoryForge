# 项目上下文摘要（Task 5：LangGraph 生成工作流）

生成时间：2026-05-13 01:20:00 +08:00

## 1. 相似实现分析

- `apps/workflow/pyproject.toml`
  - 模式：独立 Python 子项目，`pythonpath = ["."]`，测试路径为 `tests`。
  - 可复用：依赖已包含 `langgraph>=0.2.0`、`pydantic>=2.10.0`。
  - 注意：当前无源码目录，Task 5 需要初始化 `storyforge_workflow` 包结构。
- `apps/api/tests/test_assets_api.py`
  - 模式：pytest 本地可重复测试，中文测试说明，验证真实行为。
  - 可复用：测试应直接调用工作流图并验证状态、暂停和恢复，不依赖外部服务。
- `apps/api/app/domains/*/service.py`
  - 模式：节点/服务保持单一职责，输入输出结构化。
  - 可复用：Task 5 节点应分为 director、scene_architect、draft_writer，各自只产出对应状态片段。

## 2. 项目约定

- 命名约定：Python 模块使用 snake_case，类名使用 PascalCase，状态字段使用 snake_case。
- 文件组织：`apps/workflow/storyforge_workflow/` 为包根；`nodes/` 放单职责节点；`tests/` 放 pytest。
- 注释与测试描述：简体中文。
- 验证方式：`cd apps/workflow; uv run pytest tests/test_generation_graph.py -q` 与 `uv run python -m compileall storyforge_workflow tests`。

## 3. 可复用组件清单

- LangGraph `StateGraph`：构建状态图。
- LangGraph `interrupt` 与 `Command(resume=...)`：实现人工审批暂停与恢复。
- LangGraph `InMemorySaver`：本地 checkpoint，满足测试可重复。
- Pydantic：可用于输入或 checkpoint 数据结构，但状态可用 TypedDict 保持 LangGraph 兼容。

## 4. 官方文档要点

- Context7 查询 `/websites/reference_langchain_python_langgraph`：
  - `StateGraph.compile(checkpointer=...)` 启用状态持久化。
  - 使用 checkpointer 时，调用配置必须包含 `configurable.thread_id`。
  - `interrupt(value)` 可在节点内暂停并向调用方返回待审批信息。
  - `Command(resume=...)` 可使用相同 thread_id 恢复。

## 5. 依赖和集成点

- 外部依赖：LangGraph、Pydantic；均已在 `apps/workflow/pyproject.toml` 声明。
- 内部集成：本任务不直接调用 API 数据库，使用 Scene Packet 输入摘要模拟生成链路。
- 持久化：`persistence.py` 应保存 `thread_id`、`job_run_id`、当前节点、输入摘要、输出摘要和审批状态，测试可检查内存记录。

## 6. 技术选型理由

- 使用 LangGraph 原生 interrupt/checkpointer 满足人工审批点和恢复要求。
- 节点保持纯函数和确定性输出，保证本地测试稳定。
- 内存持久化足以覆盖 Phase 1 本地闭环，后续可替换 Redis/PostgreSQL 实现。

## 7. 风险点

- LangGraph API 版本可能变化，需在实现前用本地 `uv run python` 探测导入路径。
- interrupt 节点恢复会从节点开头重新执行，节点应保持幂等。
- checkpoint 记录不能只依赖 LangGraph 内部状态，需在项目 `persistence.py` 中保存可审计摘要。
