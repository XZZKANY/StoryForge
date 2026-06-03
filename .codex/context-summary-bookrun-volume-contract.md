## 项目上下文摘要（BookRun 分卷章节范围契约）

生成时间：2026-06-02 18:31:55 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/schemas.py:23`
  - 模式：Pydantic v2 schema 负责 API 输入输出契约，`BookRunProgressUpdate.progress` 当前仍是 `dict[str, Any]`。
  - 可复用：`Field` 约束、`ConfigDict(extra="forbid")` 的控制请求模式。
  - 需注意：当前没有 `volume/current_volume/chapter_range/volume_checkpoint` 字段或嵌套模型。
- **实现2**: `apps/api/app/domains/book_runs/service.py:117`
  - 模式：`apply_book_run_progress()` 统一接收 workflow 回填，更新状态、当前章节、progress、checkpoint 与预算。
  - 可复用：`_progress_with_existing_provider_resolution()` 已保护创建期 provider 摘要，防止普通 progress PATCH 污染受控字段。
  - 需注意：普通 PATCH 当前会整体替换 progress，并只保护 `provider_resolution`。
- **实现3**: `apps/api/tests/test_book_runs.py:346`
  - 模式：API 级 PATCH 测试先创建 BookRun，再通过 `/api/book-runs/{id}/progress` 回填进度并断言响应。
  - 可复用：`seed_locked_blueprint()`、provider 防污染断言、checkpoint/budget 持久化断言。
  - 需注意：现有测试只覆盖 `provider_resolution` 防污染，没有卷级摘要保护。
- **实现4**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py:35`
  - 模式：workflow 产出 `completed_chapters`、`checkpoint`、`budget`，API 侧再派生 BookRun 持久化字段。
  - 可复用：以章节完成列表计算进度摘要的思路。
  - 需注意：workflow 侧也未产出分卷字段，本轮写集不包含 workflow，因此只在 API 回填契约层承接。

### 2. 项目约定

- **命名约定**: Python 文件、函数、字段使用 snake_case；Pydantic/ORM 类使用 PascalCase；测试函数以 `test_` 开头。
- **文件组织**: BookRun 领域保持 `models.py`、`schemas.py`、`service.py`、`router.py` 分层；测试集中在 `apps/api/tests/test_book_runs.py` 及相邻专门测试文件。
- **导入顺序**: `from __future__ import annotations` 在首行，标准库、第三方库、项目内导入分组。
- **代码风格**: pytest plain `assert`，中文 docstring 描述行为意图；服务层 helper 使用小函数封装。

### 3. 可复用组件清单

- `apps/api/tests/test_book_runs.py:14`: `seed_locked_blueprint()`，创建 locked Blueprint 和 BookRun API 测试基础数据。
- `apps/api/app/domains/book_runs/service.py:117`: `apply_book_run_progress()`，唯一 progress PATCH 服务入口。
- `apps/api/app/domains/book_runs/service.py:264`: `_progress_with_existing_provider_resolution()`，受控 progress 字段防污染模式。
- `apps/api/app/domains/book_runs/service.py:223`: `_checkpoint_from_progress()`，从 progress 摘要派生持久化 checkpoint 的模式。
- `apps/api/app/domains/book_runs/schemas.py:23`: `BookRunProgressUpdate`，本轮可扩展结构化卷级输入。

### 4. 测试策略

- **测试框架**: pytest + FastAPI `TestClient`，工作目录为 `apps/api` 时使用 `uv run pytest`。
- **测试模式**: API 级回填测试优先，必要时辅以 service 级断言。
- **参考文件**: `apps/api/tests/test_book_runs.py`、`apps/api/tests/test_book_run_resume.py`、`apps/api/tests/test_book_run_workflow_dispatch.py`。
- **覆盖要求**: 先写失败测试；覆盖卷号、当前卷、卷内章节范围、当前卷完成数、下一批起点、`volume_checkpoint`；覆盖普通 `progress` PATCH 不能覆盖受控卷级摘要。

### 5. 依赖和集成点

- **外部依赖**: Pydantic v2 `BaseModel`、`Field`、`ConfigDict`；Context7 确认嵌套模型与字段约束是官方支持用法。
- **内部依赖**: `BookBlueprint.target_chapter_count` 提供总章节数；`BookRun.total_chapters/current_chapter_index/progress/checkpoint` 承载运行状态。
- **集成方式**: `/api/book-runs/{id}/progress` 接收 `BookRunProgressUpdate`；router 已统一调用 `apply_book_run_progress()`。
- **配置来源**: 无新增配置；provider 摘要仍由 `resolve_provider(session, "llm")` 在创建期写入。

### 6. 技术选型理由

- **为什么用这个方案**: 当前数据库以 JSON progress 承载运行摘要，最小真实契约应扩展 PATCH 输入 schema 和服务层合并逻辑，不新增表或框架。
- **优势**: 保持现有 API、ORM、workflow 边界稳定；卷级摘要可由受控字段单独更新，普通 progress 字典不能伪造。
- **劣势和风险**: workflow 侧尚未产出卷级字段，本轮只建立 API 持久化契约；后续 worker 需要在 workflow dispatch/BookLoop 中按该契约回填。

### 7. 关键风险点

- **并发问题**: 本轮仍是单次 PATCH 覆盖 progress，未引入并发锁；与现有 BookRun 行为一致。
- **边界条件**: 需要校验章节范围起止为正、起点不大于终点、当前卷完成数非负、下一批起点为正。
- **性能瓶颈**: 仅进行小字典合并和 Pydantic 校验，时间和内存影响可忽略。
- **安全考虑**: 防污染逻辑必须继续保护 `provider_resolution`，并新增卷级受控字段保护，避免 workflow 或普通 PATCH 写入伪摘要。

### 8. 上下文充分性验证

- 能说出至少 3 个相似实现路径：是，见 `schemas.py`、`service.py`、`test_book_runs.py`、`book_loop.py`。
- 理解实现模式：是，API schema 接收 payload，service 层合并受控 progress 字段并派生 checkpoint/budget。
- 知道可复用工具：是，复用 `BookRunProgressUpdate`、`apply_book_run_progress()`、`_progress_with_existing_provider_resolution()` 和 `seed_locked_blueprint()`。
- 理解命名与风格：是，Python snake_case、Pydantic schema、pytest plain assert、中文 docstring。
- 知道如何测试：是，先新增 `test_book_run_volume_progress_contract...`，运行定向 pytest 观察红灯，再实现。
- 确认没有重复造轮子：是，`rg` 搜索 `volume/current_volume/chapter_range/volume_checkpoint` 未发现 BookRun 内完整实现。
- 理解依赖与集成点：是，集成点为 `/api/book-runs/{id}/progress` 与 `apply_book_run_progress()`。
