# 项目上下文摘要（Phase 3 Planning 持久化）

生成时间：2026-06-06 21:25:37 +08:00

## 1. 相似实现分析

- **实现1**: `apps/api/app/domains/blueprints/service.py`
  - 模式：`trigger_chapter_plan()` 在 API 侧校验 locked Blueprint，并把章节规划写回 `Chapter`。
  - 可复用：`BookBlueprint.metadata_`、`Chapter.required_beats`、`Chapter.planning_source`、`Chapter.summary`。
  - 需注意：`metadata_` 是 SQLAlchemy JSON，写入派生 summary 时必须整体重赋值，避免原地修改未被追踪。
- **实现2**: `apps/api/app/domains/book_runs/service.py`
  - 模式：`build_book_run_workflow_dispatch()` 从 API 数据库读取已规划章节，输出 workflow worker 可消费的轻量 payload。
  - 可复用：`BookRunWorkflowChapter`、`BookRunWorkflowDispatch`、`_chapter_goal()`、`_volume_plan_from_blueprint()`。
  - 需注意：workflow 不查询 API 数据库，dispatch 不应包含完整 planning 大对象。
- **实现3**: `apps/workflow/tests/test_generation_state_references.py`
  - 模式：明确禁止 `chapter_plan`、`book_strategy` 等大对象进入 checkpoint。
  - 可复用：作为 Phase 3 防回归边界。
  - 需注意：Planning 持久化必须落 API DB 或 artifact，不能落 LangGraph checkpoint。

## 2. 项目约定

- **命名约定**: Python 使用 `snake_case`；pytest 测试函数使用 `test_`；Pydantic schema 类使用 PascalCase。
- **文件组织**: `apps/api/app/domains/blueprints` 负责 Blueprint；`apps/api/app/domains/book_runs` 负责 BookRun 调度；`apps/workflow` 只消费引用。
- **导入顺序**: Python 由 ruff `I` 规则管理。
- **代码风格**: 中文 docstring 和测试说明；直接 `assert`；错误提示使用简体中文。

## 3. 可复用组件清单

- `BookBlueprint.metadata_`: 存储 Blueprint JSON 输入与 Phase 3 派生 `planning_summary`。
- `Chapter.required_beats`: 存储每章轻量节拍，可追加“弧线推进”文本。
- `BookRunWorkflowChapter`: dispatch 每章轻量映射，可扩展 `planning_refs`。
- `test_blueprint_api.py`: Blueprint 创建、锁定、规划写回测试入口。
- `test_book_run_workflow_dispatch.py`: BookRun dispatch payload 测试入口。

## 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: TDD 红绿；先证明 `planning_summary` 与 `planning_refs` 缺失，再实现。
- **参考文件**:
  - `apps/api/tests/test_blueprint_api.py`
  - `apps/api/tests/test_book_run_workflow_dispatch.py`
  - `apps/workflow/tests/test_generation_state_references.py`
- **覆盖要求**:
  - 5 章中 4 章被 arc 覆盖时，`arc_completion_ratio` 为 `0.8`。
  - `trigger_chapter_plan()` 整体重赋值 `metadata_` 并持久化 `planning_summary`。
  - `Chapter.required_beats` 只保存轻量弧线推进文字。
  - dispatch 每章只输出 `planning_refs`，不能泄露完整 `planning_arcs`。

## 5. 依赖和集成点

- **外部依赖**: SQLAlchemy、Pydantic、pytest、ruff，均为既有依赖。
- **内部依赖**:
  - Blueprint → Chapter：API 写回规划事实。
  - Chapter → BookRun dispatch：API 输出 worker payload。
  - Dispatch → Workflow：workflow 只消费轻量引用。
- **集成方式**: 第一批不新增表和迁移；复用现有 JSON 字段。
- **配置来源**: 本批不新增配置。

## 6. 技术选型理由

- **为什么用现有 JSON 事实源**: 当前 `BookBlueprint.metadata_` 与 `Chapter.required_beats` 已承载规划输入和章节节拍，足以实现第一批可验证的 arc completion。
- **优势**: 无迁移分支，改动面小，能快速验证 Phase 3 收益。
- **劣势和风险**: JSON 结构长期查询能力有限；若后续需要跨书统计或复杂筛选，应升级为结构化 `planning_arcs` 表。

## 7. 关键风险点

- **并发问题**: 同一阶段只允许一个 worker 修改 API planning/dispatch 文件。
- **边界条件**: metadata 中非法 `planning_arcs` 必须防御式忽略，不能阻断既有 Blueprint 规划。
- **性能瓶颈**: 当前算法按章节数和 arc 数线性处理，目标上限 `target_chapter_count <= 200`，可接受。
- **安全考虑**: 不引入外部依赖，不改变鉴权和运行时安全边界。

## 8. 外部资料来源

- Context7 SQLAlchemy 文档：JSON ORM 字段原地修改不一定被追踪；整体重赋值会触发变更检测。
- Context7 Pydantic 文档：Pydantic v2 支持 `Field`、`validation_alias`、`model_dump` 与嵌套模型序列化。
- GitHub `github.search_code`：检索到多个 AI novel / plot pilot 项目以 outline/arc/pipeline 作为结构化规划输入，但本仓库选择复用现有 API 事实源，不复制外部实现。

