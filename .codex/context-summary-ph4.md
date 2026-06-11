## 项目上下文摘要（PH4 并发层重构）

生成时间：2026-06-07 01:40:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`
  - 模式：`ThreadPoolExecutor` + `FIRST_COMPLETED` + `pending_results`，允许章节结果并发完成，但只按章节序号提交 `checkpoint` 和 `progress_callback`。
  - 可复用：`_run_book_loop_parallel`、`_fill_chapter_window`、`_shutdown_pending_chapters`、`_budget_pause_reason`、`_fallback_limit_reached`。
  - 需注意：当前 `_parallelism_enabled` 在 `token_budget`、`time_budget_sec`、`chapter_budget` 或 `provider_fallback_pause_threshold` 存在时禁用并发，这是 PH4 的主要缺口。
- **实现2**: `apps/workflow/storyforge_workflow/runtime/checkpoints.py`
  - 模式：SQLite 持久化 checkpoint，`STORYFORGE_CHECKPOINT_WRITE_BEHIND` 开启后把最新状态写入内存缓冲，由后台线程批量 flush。
  - 可复用：`RuntimeCheckpointStore.save_state`、`flush`、`close`、`load_state`、`list_state_snapshots`。
  - 需注意：读操作已先 `flush`，适合补充 PH4 AsyncCheckpointWriter 验证，不需要重写已有实现。
- **实现3**: `apps/workflow/storyforge_workflow/graph.py`
  - 模式：LangGraph 线性节点图，`book_director -> chapter_planner -> scene_beats -> draft_writer`，每个节点通过 `_audited_node` 进入线程池并记录审计。
  - 可复用：`_run_node_with_timeout`、`close_workflow_node_executor`、节点级 timeout 与审计记录模式。
  - 需注意：章节内 director/planner/beats 并发会改变 LangGraph 拓扑和 checkpoint 节点序，属于高风险后续任务，本轮不伪装完成。
- **实现4**: `apps/workflow/tests/test_book_loop_three_chapters.py`
  - 模式：pytest plain `assert`、同步端口替身、`threading.Event` 验证并发启动与按序提交。
  - 可复用：`test_book_loop_can_prefetch_chapters_but_commit_progress_in_order` 的并发窗口验证方法。
  - 需注意：新增预算并发测试应先红灯，证明预算存在时当前实现仍串行。

### 2. 项目约定

- **命名约定**: Python 函数与变量使用 `snake_case`，数据类使用 `PascalCase`，状态字符串使用小写下划线。
- **文件组织**: workflow 编排位于 `apps/workflow/storyforge_workflow/orchestrators/`，运行时持久化位于 `apps/workflow/storyforge_workflow/runtime/`，测试位于 `apps/workflow/tests/`。
- **导入顺序**: `from __future__ import annotations` 在首行，标准库、第三方、项目内导入分组。
- **代码风格**: Python 3.11+，行宽 120，中文 docstring 描述意图和约束，pytest 使用 plain `assert`。

### 3. 可复用组件清单

- `BookLoopRequest`: BookRun 到 workflow 的章节并发和预算输入契约。
- `BookLoopResult`: workflow 回填 API progress 的统一结果结构。
- `_run_book_loop_parallel`: 已存在的章节并发执行与按序提交主路径。
- `_budget_pause_reason`: token/time 预算暂停判定。
- `_fallback_limit_reached`: provider fallback 连续降级暂停判定。
- `RuntimeCheckpointStore.flush`: write-behind 与读路径一致性的本地验证入口。

### 4. 测试策略

- **测试框架**: pytest，项目入口为 `cd apps/workflow; uv run pytest`。
- **测试模式**: 先在 `test_book_loop_three_chapters.py` 写预算并发红灯测试；再改 `book_loop.py` 使其绿灯；补 `RuntimeCheckpointStore` write-behind 测试。
- **参考文件**: `apps/workflow/tests/test_book_loop_three_chapters.py`、`apps/workflow/tests/test_book_loop_resume.py`、`apps/workflow/tests/test_runtime_runner.py`。
- **覆盖要求**: 正常并发、预算暂停、provider fallback 暂停、按序 checkpoint、write-behind flush/close 后可读取。

### 5. 依赖和集成点

- **外部依赖**: Python 标准库 `concurrent.futures`、`threading`、`sqlite3`；LangGraph 运行图仍按既有依赖使用。
- **内部依赖**: BookRun adapter 调用 `run_book_loop`；Runtime runner 调用 `RuntimeCheckpointStore.save_state`。
- **集成方式**: BookLoop 只接收同步 `run_chapter` 端口，不直接依赖 API 数据库；checkpoint store 通过 SQLite 路径和环境变量控制。
- **配置来源**: `BookLoopRequest.chapter_parallelism/token_budget/time_budget_sec/provider_fallback_pause_threshold`；`STORYFORGE_CHECKPOINT_WRITE_BEHIND` 与 `STORYFORGE_CHECKPOINT_WRITE_BEHIND_FLUSH_INTERVAL_SECONDS`。

### 6. 技术选型理由

- **为什么用这个方案**: 现有 BookLoop 已具备并发窗口和按序提交能力，PH4 应复用该路径并补预算停止逻辑，而不是新增调度框架。
- **优势**: 改动集中、可测试、能保持 checkpoint 顺序确定性，并解除生产预算场景的强制串行锁。
- **劣势和风险**: token/time 预算只能在章节完成后准确累计，并发窗口内可能已有在途章节；本轮策略是在预算触发后停止补充新章节并关闭 pending，属于可控降级。

### 7. 关键风险点

- **并发问题**: 后完成的前序章节会阻塞后续提交，必须继续使用 `pending_results` 和 `next_commit_index`。
- **边界条件**: awaiting_review、provider fallback、consistency_barrier、ChapterExecutionError 必须在并发路径中保留现有语义。
- **性能瓶颈**: 预算触发前的窗口大小由 `chapter_parallelism` 控制，不能无限启动章节。
- **安全考虑**: 本轮不接触认证、密钥、Provider 配置和 API 权限；验证报告不得记录敏感环境变量值。

### 8. 外部资料与工具记录

- Context7 查询 LangGraph 文档：并行 superstep 的写入会汇总后应用到 checkpoint；该结论支持“并发执行但集中提交”的现有项目模式。
- GitHub `search_code` 查询 `ThreadPoolExecutor FIRST_COMPLETED futures pending_results commit in order Python`：命中少量通用代码，无可直接复用的高质量同域实现；本轮以项目内既有实现为主。
- `desktop-commander` 当前会话未暴露；已按仓库要求记录工具缺口，并使用 PowerShell、`rg`、Context7、GitHub MCP 作为替代。

### 9. PH4B 章节内规划并发补充

- **仓库事实**：当前生产图在 `apps/workflow/storyforge_workflow/graph.py` 中线性执行 `book_director -> chapter_planner -> scene_beats -> draft_writer`。
- **依赖事实**：`create_chapter_plan` 与 `create_scene_beats` 均位于 `apps/workflow/storyforge_workflow/nodes/scene_architect.py`，分别调用 planning provider；`scene_beats` 可从初始 `scene_packet` 的章节目标与场景目标构造 prompt，不必直接读取 `chapter_plan` 的返回值。
- **LangGraph API 事实**：本地 `StateGraph.add_edge` 支持 `start_key: str | list[str]`，多起点边会等待全部上游完成；但两个节点若同一 superstep 同时写 `current_status/status_history/current_node`，会引入共享 key 合并风险。
- **实施选择**：新增 `scene_architect.parallel_plan` 合并节点，在节点内部并发复用 `create_chapter_plan` 与 `create_scene_beats`，再一次性写入合并状态；避免两个 LangGraph 节点并发写同一 state key。
- **测试策略**：先写红灯测试，用 `Event` 卡住 chapter plan 并观察 scene beats 是否能在等待期间启动；旧线性图应失败，新合并节点应通过。
