## 项目上下文摘要（workflow volume_progress 接线）

生成时间：2026-06-02 20:05:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`
  - 模式：BookLoop 组装 `completed_chapters`、`checkpoint`、`budget`。
  - 可复用：已完成章节数量和当前章节索引。
  - 需注意：BookLoop 不知道 API 受控字段，避免在普通 `progress` 混入卷字段。
- **实现2**: `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`
  - 模式：adapter 把 BookLoopResult 转交给 `BookRunProgressSink`。
  - 可复用：sink 边界正是 workflow 到 API 的契约转换点。
  - 需注意：同级输出 `volume_progress`，不要塞入 `progress`。
- **实现3**: `apps/api/app/domains/book_runs/schemas.py`、`service.py`
  - 模式：API 只通过顶层 `BookRunProgressUpdate.volume_progress` 接受卷级受控摘要。
  - 可复用：`current_volume`、`chapter_range`、`completed_chapter_count`、`next_batch_start_chapter_index` 字段契约。
  - 需注意：普通 progress PATCH 会过滤 `volume/current_volume/chapter_range/volume_checkpoint`。

### 2. 项目约定

- workflow 不直接依赖 API ORM。
- adapter 负责把 workflow 结果变成外部 sink 可提交 payload。
- 测试使用 `CapturingProgressSink` 和 `CallableProgressSink` 验证契约。

### 3. 可复用组件清单

- `BookRunAdapterRequest`: 提供 total/start/chapter_budget。
- `BookLoopResult`: 提供 status/current/progress。
- `CapturingProgressSink`: 记录测试 payload。
- `CallableProgressSink`: 生产 HTTP/service adapter 的外层包装。

### 4. 测试策略

- 先修改 workflow adapter/dispatch 测试为红灯。
- 验证 sink payload 出现同级 `volume_progress`。
- 验证普通 `progress` 不含受控卷字段。
- 回归 API 端受控字段测试。

### 5. 依赖和集成点

- workflow `book_run_adapter.py` 输出 payload。
- API `BookRunProgressUpdate.volume_progress` 接收 payload。
- 后续真实 HTTP/service adapter 需要把该同级字段提交给 API。

### 6. 技术选型理由

- **为什么用这个方案**: API 已明确把卷级摘要设计为受控顶层字段；workflow adapter 是最小边界转换点。
- **优势**: 不污染 progress；测试和生产 sink 共用同一 payload 形状。
- **风险**: 目前仍默认 `current_volume=1`，后续多卷真表落地后需由 dispatch payload 提供卷号和卷范围。

### 7. 关键风险点

- awaiting_review 也会生成 volume_progress，但 completed 数可能小于范围。
- existing_checkpoint 的历史批次卷信息还没有来源，当前按本批 start/chapter_budget 计算。
- 多卷产品化需要后续引入真实 volume 元数据。
