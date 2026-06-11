## 项目上下文摘要（Novelskill P1.5 两段式并发校正）

生成时间：2026-06-08 04:20:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`
  - 模式：并发路径预取章节结果，按 `next_commit_index` 顺序提交 checkpoint/progress。
  - 可复用：提交点、`_parallel_integration_metrics()`、`progress_callback`、一致性屏障。
  - 需注意：P1 的 `require_prior_chapter_commit_before_start` 会把窗口降为 1，保证前文但牺牲并发。
- **实现2**: `apps/api/app/domains/book_runs/phase9b_parallel_ports.py`
  - 模式：每章独立 session 跑单章 NovelLoop，主线程最后把 BookLoop progress 写入 BookRun。
  - 可复用：`run_book_loop_with_thread_sessions()`、`chapter_extras`、BookContext cache 观测、真实 smoke helper。
  - 需注意：当前 Phase9B 默认 prior commit，`_generate_chapter()` 启动时能看前文但并发低。

- **实现3**: `apps/workflow/tests/test_book_loop_three_chapters.py`
  - 模式：使用 `Event`、`Lock`、`Barrier` 验证并发启动、按序提交、快速取消。
  - 可复用：用 start/commit/revision 观察数组证明两段式顺序。
  - 需注意：必须保留默认并发预取测试和 P1 prior commit 测试。
- **实现4**: `apps/api/tests/test_phase9b_parallel_ports.py`
  - 模式：monkeypatch `_generate_chapter` 和 `_judge_and_repair_loop`，验证真实 runner 证据链。
  - 可复用：记录生成前 ModelRun 数、线程数、audit metrics。
  - 需注意：P1.5 应更新默认 Phase9B 语义，不再要求 generate 前已有前序 ModelRun。

### 2. 项目约定

- Python 使用 snake_case，测试函数 `test_...`，中文 docstring 描述业务意图。
- workflow 纯编排不依赖 API ORM；API 胶水负责数据库和真实 smoke helper。
- integration metrics 统一挂在 `BookRun.progress["integration_metrics"]`。
- 不新增外部依赖，不新增平行调度器。

### 3. 可复用组件清单

- `BookLoopRequest`: 增加可选策略字段表达 precommit 校正模式。
- `run_book_loop()`: 增加可选 `precommit_chapter` hook，保持唯一 BookLoop 入口。
- `NovelLoopResult`: 作为 hook 输入输出，校正后返回新的结果。
- `run_book_loop_with_thread_sessions()`: 透传 precommit hook，并为 hook 创建独立 session。
- `smoke._approve_scene()`、`smoke._record_model_run()`、`smoke._record_scene_packet()`、`smoke._judge_and_repair_loop()`: API 侧校正证据链复用点。

### 4. 测试策略

- workflow 红灯：章节 2/3 可在前序提交前启动，但 `precommit_chapter` 必须在前序提交后执行，提交内容使用校正后的 `NovelLoopResult`。
- API 红灯：Phase9B 默认改为 precommit revision，生成阶段可并发启动，校正阶段按提交顺序发生并写入 `dependency_mode=precommit_revision`。
- 回归：BookLoop 并发、resume、provider pause、Phase9B parallel ports、wrapper/export 相关测试。

### 5. 依赖和集成点

- 外部依赖：Python `concurrent.futures.ThreadPoolExecutor`、`wait(FIRST_COMPLETED)`、`shutdown(cancel_futures=True)`；Context7 已查询 CPython 文档确认行为。
- 内部依赖：BookLoop 并发提交点、Phase9B 单章生成/审批证据链、BookContext append/cache 事实源、audit exporter metrics 投影。
- 集成方式：默认行为保持不变；Phase9B runner 使用 `precommit_revision` 模式恢复预取，并在提交前刷新章节证据。

### 6. 技术选型理由

- 选择提交前 hook 而不是新调度器：提交点天然知道已提交章节快照，能在不破坏默认并发的前提下插入校正。
- 选择 API 侧实现校正：workflow 不接触数据库，API 胶水已有真实 LLM smoke helper 和 session_factory。
- 不做非相邻 DAG：当前审计目标是 P1.5 两段式恢复高并发，DAG 调度可后续独立设计。

### 7. 关键风险点

- 校正可能增加额外模型调用成本；本轮先记录 `chapter_correction_count` 与 `dependency_mode`。
- 真实 provider 未重跑；凭据安全确认前只跑替身测试。
- 若校正阶段再次写 Scene/ModelRun，会增加审计证据数量；测试需确认最终 progress 指向校正后的证据。
