## 项目上下文摘要（manual-read-gate）

生成时间：2026-06-02 21:07:43 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_book_runs.py`
  - 模式：通过 `PATCH /api/book-runs/{id}/progress` 回填 `status`、`current_chapter_index` 与宽松 `progress` 字典。
  - 可复用：`seed_locked_blueprint`、`BookRunProgressUpdate`、`apply_book_run_progress`。
  - 需注意：`provider_resolution`、`volume` 等受控字段会由 service 保留既有事实源，普通 progress 字段不应污染这些摘要。
- **实现2**: `apps/api/app/domains/book_runs/service.py`
  - 模式：`_progress_with_controlled_summaries` 过滤受控字段，其余 progress key 原样保存。
  - 可复用：现有宽松 dict 合并策略已经支持 `manual_read_gate`，无需新增 ORM 表。
  - 需注意：`manual_read_gate` 不应加入 `CONTROLLED_PROGRESS_KEYS`，否则会失去 workflow 回填能力。
- **实现3**: `apps/api/app/domains/exports/book_markdown_exporter.py`
  - 模式：`export_book_run_audit_report` 仅允许 completed BookRun 导出，并从 `book_run.progress` 构造可追溯 JSON。
  - 可复用：`chapters`、`quality_summary`、`skill_chain` 的投影模式。
  - 需注意：audit_report 是 completed 后制品，不作为阻断事实源，只投影 `manual_read_gate` 结论。
- **实现4**: `apps/api/tests/test_book_exporter.py`
  - 模式：通过 `_seed_completed_book_run` 构造 completed BookRun 与 `progress.completed_chapters`，直接调用导出函数断言 artifact payload。
  - 可复用：同一 fixture 可补充 `progress.manual_read_gate` 以验证导出投影。

### 2. 项目约定

- **命名约定**: Python 函数与字段使用 `snake_case`；测试函数使用 `test_` 前缀；schema 类使用 PascalCase。
- **文件组织**: BookRun 请求/响应模型位于 `schemas.py`，状态写入位于 `service.py`，导出投影位于 `book_markdown_exporter.py`。
- **导入顺序**: 标准库、第三方库、项目模块分组；本切片不需要新增导入。
- **代码风格**: pytest 使用 plain `assert`；测试 docstring 和注释使用简体中文；业务逻辑以小函数隔离投影。

### 3. 可复用组件清单

- `apps/api/app/domains/book_runs/service.py::_progress_with_controlled_summaries`: 保留非受控 progress key。
- `apps/api/app/domains/book_runs/service.py::apply_book_run_progress`: 回填 BookRun 状态、progress、checkpoint 与预算。
- `apps/api/app/domains/exports/book_markdown_exporter.py::export_book_run_audit_report`: 生成 `audit_report.json` artifact。
- `apps/api/tests/test_book_runs.py::seed_locked_blueprint`: 构造可启动 BookRun 的 locked Blueprint。
- `apps/api/tests/test_book_exporter.py::_seed_completed_book_run`: 构造可导出的 completed BookRun。

### 4. 测试策略

- **测试框架**: pytest，FastAPI `TestClient`，SQLAlchemy 内存会话 fixture。
- **测试模式**: API 回填测试 + exporter 单元/集成式导出测试。
- **参考文件**: `apps/api/tests/test_book_runs.py`、`apps/api/tests/test_book_exporter.py`。
- **覆盖要求**: 正常流程覆盖 `manual_read_gate` 保存；阻断流程覆盖 `status='awaiting_review'`；导出流程覆盖 `audit_report.json` 投影。

### 5. 依赖和集成点

- **外部依赖**: Pydantic v2、FastAPI、SQLAlchemy、pytest。
- **内部依赖**: `BookRun.progress` JSON 字段、`BookRunProgressUpdate.progress`、`export_book_run_audit_report`。
- **集成方式**: workflow 或 API 回填 `progress.manual_read_gate`，BookRun `status='awaiting_review'` 表达阻断，completed 后 audit_report 投影该结论。
- **配置来源**: 本切片不读取 `.env` 或凭据；测试中沿用现有 provider resolution 行为。

### 6. 技术选型理由

- **为什么用这个方案**: 用户要求最小可验证切片并保留 progress 宽松 dict，因此直接复用现有 JSON progress 字段。
- **优势**: 无迁移、无新表、低耦合，可与并行 worker 的 TimelineEvent、Story Memory、OpenAPI 工作隔离。
- **劣势和风险**: `manual_read_gate` 暂无强 schema，字段语义依赖生产者约定；audit_report 只投影 completed 后结论，不负责运行时阻断。

### 7. 关键风险点

- **并发问题**: 当前工作树存在大量其他代理改动，本轮只触碰允许写集，避免格式化和回滚。
- **边界条件**: 非 dict 形态 `manual_read_gate` 不投影为事实结论，避免把脏数据写入审计报告。
- **性能瓶颈**: 新增浅拷贝为 O(1) 字典操作，相比章节导出可忽略。
- **安全考虑**: 不读取、不打印、不复述 API Key、`.env` 或凭据；导出只复制 progress 中已有人工门禁摘要。
