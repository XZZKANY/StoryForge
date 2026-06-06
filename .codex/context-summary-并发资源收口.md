## 项目上下文摘要（并发资源收口）

生成时间：2026-06-06 04:20:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`
  - 模式：adapter 将 API dispatch payload 转换为 `BookLoopRequest`，通过 progress sink 回填进度。
  - 可复用：`ChapterExecutionError`、`_failed_result_from_exception`、`CapturingProgressSink`。
  - 需注意：`run_chapter` 闭包中的 `active_chapter_index` 在并发章节下被多个 worker 共享写入。
- **实现2**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`
  - 模式：并发路径用 `Future -> chapter_index` 映射绑定章节号，再按章节顺序提交 checkpoint。
  - 可复用：`ChapterExecutionError(chapter_index, exc)` 已能表达真实失败章节号。
  - 需注意：并发路径只在无 token/time/chapter/fallback 预算约束时启用。
- **实现3**: `apps/workflow/storyforge_workflow/graph.py`
  - 模式：节点执行通过进程级 `ThreadPoolExecutor` 包装 timeout，显式 `close_workflow_node_executor()` 收尾。
  - 可复用：`WorkflowNodeTimeoutError`、`close_workflow_node_executor`、`_workflow_node_executor`。
  - 需注意：Python 线程不可中断，timeout 后立即重建 executor 会让旧任务继续跑。
- **实现4**: `apps/workflow/storyforge_workflow/provider_client.py`
  - 模式：线程本地 HTTP 连接缓存，提供 `close_provider_connections()` 供测试和 worker 收尾。
  - 可复用：关闭函数可接入 runtime 生命周期。
  - 需注意：当前 `WorkflowRuntime` 没有统一 `close()`。
- **实现5**: `apps/workflow/storyforge_workflow/runtime/checkpoints.py`
  - 模式：`RuntimeCheckpointStore` 复用 SQLite 连接，提供 `close()`。
  - 可复用：`close()` 已存在，测试中已有 finally 调用示例。
  - 需注意：生产路径按 runtime 实例持有 store，目前没有显式关闭入口。

### 2. 项目约定

- **命名约定**: Python 文件、函数和变量使用 snake_case；测试函数使用 `test_` 前缀。
- **文件组织**: workflow 运行时逻辑位于 `apps/workflow/storyforge_workflow`；测试位于 `apps/workflow/tests`。
- **导入顺序**: 标准库、第三方库、项目内模块；由 ruff 约束。
- **代码风格**: Python 3.11+ 类型标注，行宽 120，注释和测试说明使用简体中文。

### 3. 可复用组件清单

- `storyforge_workflow.orchestrators.book_loop.ChapterExecutionError`: 并发章节异常携带章节号。
- `storyforge_workflow.orchestrators.book_loop.BookLoopResult`: progress callback 与最终结果结构。
- `storyforge_workflow.graph.WorkflowNodeTimeoutError`: 节点 timeout 异常。
- `storyforge_workflow.graph.close_workflow_node_executor`: 进程和测试收尾入口。
- `storyforge_workflow.provider_client.close_provider_connections`: 当前线程 provider 连接释放入口。
- `storyforge_workflow.runtime.checkpoints.RuntimeCheckpointStore.close`: SQLite 连接释放入口。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: monkeypatch 替换局部函数，Event 控制并发时序，tmp_path 隔离 SQLite。
- **参考文件**:
  - `apps/workflow/tests/test_book_run_adapter.py`
  - `apps/workflow/tests/test_book_loop_three_chapters.py`
  - `apps/workflow/tests/test_generation_graph.py`
  - `apps/workflow/tests/test_llm_provider.py`
  - `apps/workflow/tests/test_workflow_lifecycle.py`
- **覆盖要求**: 失败章节号、连续 timeout executor 创建次数、资源 close 调用、预算差异记录。

### 5. 依赖和集成点

- **外部依赖**: pytest、LangGraph、标准库 `concurrent.futures`、SQLite。
- **内部依赖**: adapter 依赖 book_loop；runtime runner 依赖 graph、provider execution、checkpoint store。
- **集成方式**: adapter progress sink、graph executor 全局生命周期、runtime 持有 store。
- **配置来源**: `STORYFORGE_BOOK_RUN_CHAPTER_PARALLELISM`、`STORYFORGE_WORKFLOW_NODE_EXECUTOR_WORKERS`、`STORYFORGE_WORKFLOW_NODE_TIMEOUT_SECONDS`。

### 6. 技术选型理由

- **为什么用这个方案**: 复用已有 `ChapterExecutionError` 和 executor close 边界，避免新增线程中断或状态同步框架。
- **优势**: 改动小、行为可测试、线程数量受现有 executor 上限约束。
- **劣势和风险**: timeout 中的 Python 线程仍不可强杀；后续任务可能受正在运行的旧任务占用 worker 影响。

### 7. 关键风险点

- **并发问题**: adapter 共享 `active_chapter_index` 是无锁共享写；应删除。
- **边界条件**: progress sink 在章节完成回调中失败时，失败 payload 应指向稳定的 latest progress 章节。
- **性能瓶颈**: 持续 timeout 不应创建无限 executor；线程数量必须受配置上限约束。
- **安全考虑**: 不改认证、鉴权、网络 provider 默认安全行为。
