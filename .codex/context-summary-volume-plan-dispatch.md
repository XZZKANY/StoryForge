## 项目上下文摘要（BookRun volume_plan dispatch 接线）

生成时间：2026-06-02 20:40:00 +08:00

### 1. 相似实现分析

- **BookRun 分卷进度契约**：`apps/api/app/domains/book_runs/schemas.py`
  - 模式：`BookRunVolumeProgress` 作为 `BookRunProgressUpdate` 顶层字段，由 API 受控写入普通 `progress` 的卷摘要。
  - 可复用：`BookRunChapterRange`、`BookRunVolumeProgress`。
  - 需注意：普通 `progress` PATCH 不允许污染 `volume/current_volume/chapter_range/volume_checkpoint`。
- **BookRun workflow dispatch**：`apps/api/app/domains/book_runs/service.py`
  - 模式：API 侧读取 BookRun/Blueprint/Chapter 事实源，构造无 ORM 的 `BookRunWorkflowDispatch`。
  - 可复用：`build_book_run_workflow_dispatch()`、`BookRunWorkflowChapter`。
  - 需注意：workflow adapter 不应读取 API 数据库。
- **Workflow adapter**：`apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`
  - 模式：`BookRunAdapterRequest` 接收纯 payload，`progress_sink.emit()` 同级输出 `progress` 与 `volume_progress`。
  - 可复用：`CapturingProgressSink`、`CallableProgressSink`、`run_book_run_dispatch_payload()`。
  - 需注意：缺少 `volume_plan` 时必须兼容旧 payload，回退单卷。

### 2. 项目约定

- Python 使用 `snake_case`，Pydantic/dataclass 类型使用 `PascalCase`。
- API schema/service 负责输入契约和事实源派生，workflow 只消费 dispatch payload。
- 测试使用 pytest plain assert，先红灯后实现，文档与注释使用简体中文。

### 3. 可复用组件清单

- `BookBlueprint.metadata_`：承载 `volume_plan` 或 `volume_count` 的现有 JSON 元数据。
- `BookRunWorkflowDispatch`：API 到 workflow 的稳定边界。
- `BookRunAdapterRequest.volume_plan`：workflow 消费卷计划的输入。
- `BookRunVolumeProgress`：API 回填的受控卷进度摘要。

### 4. 测试策略

- API dispatch 测试覆盖默认单卷、显式 `metadata.volume_plan`、`metadata.volume_count` 均分和非法 metadata 回退。
- Workflow adapter 测试覆盖缺省单卷、跨卷当前卷识别、预算暂停时 `next_batch_start_chapter_index` 推进。
- dispatch payload 测试覆盖 `volume_plan` 从 payload 传到 adapter。

### 5. 依赖和集成点

- 外部依赖：无新增。
- 内部依赖：BookRun、BookBlueprint、Chapter、workflow BookRun adapter。
- 集成方式：API 生成 `volume_plan`，workflow 用该计划计算 `volume_progress.current_volume` 与整卷 `chapter_range`。
- 配置来源：不涉及 Provider 凭据或真实 LLM 环境变量。

### 6. 技术选型理由

- 将 `volume_plan` 放在 dispatch payload，是最小且边界清晰的方案；无需新增 ORM 表，也避免 workflow 直连 API DB。
- 显式 `volume_plan` 优先，`volume_count` 均分作为兼容当前 Assistant 意图 metadata 的过渡能力。
- 非法 metadata 回退单卷，符合现有自由 JSON metadata 的宽松读取风格，避免历史蓝图阻断运行。

### 7. 关键风险点

- `volume_plan` 仍来自 Blueprint metadata，尚不是强约束的独立卷计划表。
- 当前只按章节范围命中当前卷，未处理卷标题、卷目标、跨卷摘要等产品信息。
- OpenAPI 需要在当前 schema 变化后再次保持同步，避免共享契约漂移。
