## 项目上下文摘要（P2 API 恢复 dispatch 契约）

生成时间：2026-06-03 01:31:11 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/service.py`
  - 模式：BookRun 的 resume/retry 和 workflow dispatch 均集中在 service 层。
  - 可复用：`resume_book_run()`、`retry_book_run_from_checkpoint()`、`build_book_run_workflow_dispatch()`、`_dispatch_start_chapter_index()`。
  - 需注意：dispatch 起点不能被 progress 中的陈旧字段误导。
- **实现2**: `apps/api/tests/test_book_run_workflow_dispatch.py`
  - 模式：直接 seed 可 dispatch 的 BookRun，验证 payload 是 workflow worker 可消费的稳定契约。
  - 可复用：`seed_dispatchable_book_run()`、volume_plan 断言模式。
  - 需注意：恢复/重试后需要同时断言 `start_chapter_index`、`existing_checkpoint` 和 `chapters` 列表。
- **实现3**: `apps/api/tests/test_book_runs.py`
  - 模式：HTTP control endpoint 覆盖 pause/resume/retry 的用户可见状态。
  - 可复用：completed_chapters progress、checkpoint 恢复断言。
  - 需注意：endpoint 测试只证明状态变更，不等价于 dispatch payload 正确。

### 2. 项目约定

- **命名约定**: Python 函数使用 snake_case，测试名使用 `test_*`。
- **文件组织**: API dispatch 契约测试放在 `test_book_run_workflow_dispatch.py`，控制端点测试留在 `test_book_runs.py`。
- **导入顺序**: 标准库、第三方、项目内部依次排列。
- **代码风格**: 中文 docstring 描述业务意图，pytest plain assert。

### 3. 可复用组件清单

- `BookRunProgressUpdate`: 构造 progress 回填。
- `apply_book_run_progress()`: 生成 checkpoint 和 paused 状态。
- `resume_book_run()`: 设置 `resume_from_chapter_index`。
- `retry_book_run_from_checkpoint()`: 设置 `retry_from_chapter_index`。
- `build_book_run_workflow_dispatch()`: 生成 worker dispatch payload。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: service 级契约测试 + API 控制端点回归。
- **参考文件**: `apps/api/tests/test_book_run_workflow_dispatch.py`、`apps/api/tests/test_book_runs.py`、`apps/api/tests/test_book_run_resume.py`。
- **覆盖要求**: resume 后 dispatch 从最新 checkpoint 下一章开始；retry 后 dispatch 优先 retry 起点，不被陈旧 resume 字段带回旧章节。

### 5. 依赖和集成点

- **外部依赖**: 无新增依赖。
- **内部依赖**: BookRun progress、checkpoint、Blueprint metadata.volume_count、workflow dispatch schema。
- **集成方式**: API progress 回填生成 checkpoint；resume/retry 写入 progress 起点；dispatch 读取起点并返回 worker payload。
- **配置来源**: 无环境变量读取。

### 6. 技术选型理由

- **为什么用这个方案**: 修复点在起点选择和旧字段清理，能保持 API 层契约单一，不影响 workflow adapter。
- **优势**: 测试直接复现 stale resume bug；修复局部且可验证。
- **劣势和风险**: Workflow 预算延续仍由独立 worker 处理，本任务不跨层修改 workflow。

### 7. 关键风险点

- **边界条件**: 同一 progress 同时存在 resume 和 retry 起点时，retry 必须优先。
- **性能瓶颈**: 起点选择为常数时间。
- **安全考虑**: 未读取或写入任何凭据。

