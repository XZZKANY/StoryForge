## 项目上下文摘要（TimelineEvent 与 BookRun progress 同步）

生成时间：2026-06-02 20:55:00

### 1. 相似实现分析

- **BookRun progress 回填**: `apps/api/app/domains/book_runs/service.py`
  - 模式：服务层函数接收 `Session` 与 Pydantic payload，更新 ORM 记录后统一 `commit` 与 `refresh`。
  - 可复用：`apply_book_run_progress()`、`_checkpoint_from_progress()`、`_progress_with_controlled_summaries()`。
  - 需注意：当前文件已有并行 worker 改动，必须只做局部追加，不回滚 provider_resolution 与 volume_progress 逻辑。
- **TimelineEvent 创建契约**: `apps/api/app/domains/timeline/service.py`
  - 模式：`TimelineEventCreate` 校验输入，`TimelineEventRecord` 持久化，章节必须属于同一作品。
  - 可复用：`TimelineEventCreate` schema 与 `TimelineEventRecord` 模型字段。
  - 需注意：公开 `create_timeline_event()` 内部会 `commit`，BookRun 同步应留在同一 `apply_book_run_progress()` 事务中，因此只复用 schema 与模型。
- **TimelineEvent API 测试**: `apps/api/tests/test_timeline_events.py`
  - 模式：使用 `TestClient` + `session_factory` 创建作品/章节，POST 后 GET 列表断言字段。
  - 可复用：按 `book_id` 过滤 `/api/timeline-events` 验证事件。
  - 需注意：章节必须真实存在，测试中 BookRun 的 completed chapter 需要创建对应 `Chapter`。
- **BookRun API 测试**: `apps/api/tests/test_book_runs.py`
  - 模式：`seed_locked_blueprint()` 创建 locked Blueprint，PATCH `/api/book-runs/{id}/progress` 验证状态。
  - 可复用：现有 BookRun 创建和 progress 回填用例。
  - 需注意：默认 helper 当前不创建章节，TimelineEvent 同步测试需新增专用章节 helper。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case；ORM 模型类使用 PascalCase；测试函数以 `test_` 开头。
- **文件组织**: API 领域按 `apps/api/app/domains/<domain>/models.py|schemas.py|service.py|router.py` 分层。
- **导入顺序**: 标准库、第三方库、项目内模块分组；现有文件已使用 `from __future__ import annotations`。
- **代码风格**: pytest 测试使用中文 docstring 描述业务意图；服务层错误与注释使用简体中文。

### 3. 可复用组件清单

- `app.domains.book_runs.service.apply_book_run_progress`: BookRun progress 回填唯一接入点。
- `app.domains.timeline.schemas.TimelineEventCreate`: TimelineEvent 创建字段校验。
- `app.domains.timeline.models.TimelineEventRecord`: TimelineEvent ORM 持久化模型与去重查询目标。
- `app.domains.books.models.Chapter`: 通过 `book_id`、`blueprint_id`、`ordinal` 解析 completed chapter 对应章节。

### 4. 测试策略

- **测试框架**: pytest + FastAPI TestClient + SQLAlchemy SQLite 内存库。
- **测试模式**: 先新增 RED API 回归测试，再实现服务层最小逻辑。
- **参考文件**: `apps/api/tests/test_book_runs.py`、`apps/api/tests/test_timeline_events.py`。
- **覆盖要求**: 正常回填生成事件；重复回填不重复生成；awaiting_review/paused 只为已完成章节生成。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy ORM、Pydantic、FastAPI 测试客户端。
- **内部依赖**: BookRun service 依赖 BookRun、Chapter、TimelineEventRecord、TimelineEventCreate。
- **集成方式**: 在 `apply_book_run_progress()` 中计算受控 progress 后、提交前同步事件。
- **配置来源**: 无新增配置；不得读取 `.env` 或任何凭据。

### 6. 技术选型理由

- **为什么用这个方案**: API 侧拥有 Session、BookRun、Chapter 和 TimelineEventRecord，能在同一事务内完成同步；workflow adapter 不应写 API DB。
- **优势**: 最小改动、复用既有 schema/model、不会扩散到 workflow/web/shared OpenAPI。
- **劣势和风险**: `project_id` 当前无强事实源，只能受控默认 1；`volume_id` 缺失时默认 1，长篇多卷中需要后续接入真实 project/volume 映射。

### 7. 关键风险点

- **并发问题**: 并行重复回填同一章节时，当前无数据库唯一约束；本次通过查询去重覆盖单进程/顺序回填。
- **边界条件**: completed chapter 若缺少可解析的 `chapter_index` 或缺少对应 Chapter，则不会生成 TimelineEvent。
- **性能瓶颈**: 每次 progress 回填按章节级列表处理，数量与章节数线性相关，当前可接受。
- **安全考虑**: evidence_refs 只记录 id 引用，不读取或保存任何 API Key、`.env` 或凭据。

