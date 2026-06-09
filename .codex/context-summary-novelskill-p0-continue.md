## 项目上下文摘要（Novelskill P0 接续）

生成时间：2026-06-08 00:18:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`
  - 模式：从 dispatch 章节映射读取 `planning_refs`，自动构建 `ArcConsistencyBarrier`，再通过 `run_book_loop(..., consistency_barrier=...)` 接入主链路。
  - 可复用：`ConsistencyBarrier` 契约、`ArcConsistencyBarrier` 自动接线思路。
  - 需注意：无 planning_refs 时保持放行，不引入额外数据库查询。
- **实现2**: `apps/workflow/tests/test_book_loop_three_chapters.py`
  - 模式：用替身 `consistency_barrier` 验证并发窗口仍按章节顺序提交，并在冲突时阻断当前章。
  - 可复用：断言 `blocked_chapter.consistency_conflicts`、`progress.consistency_conflict` 的测试结构。
  - 需注意：并发执行可以预取，但屏障必须在 commit 阶段按序运行。
- **实现3**: `apps/api/tests/test_phase9b_parallel_ports.py`
  - 模式：API 侧用替身 session、barrier、monkeypatch 验证 workflow 胶水层行为。
  - 可复用：`_TrackedSession`、`NovelLoopResult`、并发线程和 session 独立性断言。
  - 需注意：真实 provider 凭据必须只使用测试假值，audit payload 不得泄露密钥。

### 2. 项目约定

- **命名约定**: pytest 测试函数使用 `test_...`，内部替身类以 `_` 前缀标识私有测试辅助。
- **文件组织**: API 胶水层测试集中在 `apps/api/tests/test_phase9b_parallel_ports.py`；workflow 编排测试在 `apps/workflow/tests/`。
- **导入顺序**: 标准库、第三方、项目模块分组；本次不触碰已有存量 ruff I001。
- **代码风格**: Python 类型注解、简短中文注释，锁只覆盖必要临界区。

### 3. 可复用组件清单

- `run_book_loop` / `ConsistencyBarrier`: workflow 侧屏障接口。
- `ArcConsistencyBarrier`: 基于章节 `planning_refs.arc_ids` 的弧线到期屏障。
- `run_book_loop_with_thread_sessions`: API 侧每章独立 session 并发胶水。
- `_SceneSelectQueryCounter`: 已按 SQLAlchemy 官方 `event.listen/remove` 生命周期实现查询计数。

### 4. 测试策略

- **测试框架**: pytest，API 测试通过 `cd apps/api; uv run pytest ...` 执行。
- **测试模式**: 先在 `test_phase9b_parallel_ports.py` 增加红灯测试。
- **覆盖要求**:
  - `run_book_loop_with_thread_sessions` 必须把 `consistency_barrier` 传给 workflow BookLoop。
  - `judge_scene` 的真实 LLM 评审不应在全局 `db_write_lock` 内执行，应允许多个章节重叠。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy 事件 listener 已通过 Context7 查询官方文档，`event.listen` 与 `event.remove` 可用于 `before_cursor_execute` 查询观测。
- **内部依赖**: `phase9b_parallel_ports.py` 动态加载 workflow `book_loop.py` / `novel_loop.py`，避免 API 侧安装 workflow 包。
- **集成方式**: 新增可选参数透传，不改变既有调用方默认行为。
- **配置来源**: 真实 runner 继续从传入 `env` 或 `os.environ` 读取 provider 配置。

### 6. 技术选型理由

- **为什么用这个方案**: P0 目标是止血接线，优先复用已有 `ConsistencyBarrier` 与 `ArcConsistencyBarrier`，不新增自研屏障。
- **优势**: 改动小、可测、与 workflow 生产 adapter 模式一致。
- **劣势和风险**: 并发真实 runner 当前仍是窗口预取模型，屏障只能在 commit 阶段阻断，不能彻底解决上下文依赖切断。

### 7. 关键风险点

- **并发问题**: 全局 `db_write_lock` 若包住 LLM judge 网络 IO，会把评审阶段串行化。
- **边界条件**: 冲突屏障触发后，BookLoop 可能已预取后续章节，必须依赖既有 pending shutdown 逻辑。
- **性能瓶颈**: 锁范围应只覆盖数据库写入和 session 状态准备，避免阻塞 provider 调用。
- **安全考虑**: 测试与日志不得写入真实 provider token。
