# 项目上下文摘要（dev-plan Phase 9A）

生成时间：2026-05-27 09:00:00 +08:00

## 1. 相似实现分析

- `apps/api/app/domains/books/models.py`: 使用 SQLAlchemy 2.0 `Mapped`、`mapped_column`、`relationship`，实体继承 `IdMixin` 与 `TimestampMixin`。
- `apps/api/app/domains/studio/router.py`: 使用 `APIRouter(prefix="/api/studio")`、`response_model`、`SessionDependency` 和中文 summary/docstring。
- `apps/api/app/domains/studio/service.py`: 服务层负责查询、领域异常和 DTO 组装，路由层只做 HTTP 状态转换。
- `apps/api/app/domains/artifacts/service.py`: 创建服务先验证外键存在，提交后 `refresh`，并复用 `ArtifactCreate` 写入制品。
- `apps/api/tests/test_studio_book_list_api.py`: API 测试使用 FastAPI `TestClient`、SQLite 内存库、中文测试描述和夹具直接写入基础事实。

## 2. 项目约定

- Python 文件使用 `from __future__ import annotations`。
- ORM 模型使用 `Base`、`IdMixin`、`TimestampMixin`，JSON 字段以 `dict` 映射。
- Pydantic schema 使用 `BaseModel`、`Field`、`ConfigDict(from_attributes=True)`。
- 路由按领域目录拆分为 `models.py`、`schemas.py`、`service.py`、`router.py`。
- 所有注释、文档字符串、测试描述和错误信息使用简体中文。

## 3. 可复用组件清单

- `Book`、`Chapter`、`Scene`: 9A Blueprint、Chapter Planner 和导出链路的基础业务真相源。
- `JobRun`: 现有长任务状态与 progress JSON，可供后续 BookRun 或运行状态复用。
- `ModelRun`: 生成证据链的模型调用事实源。
- `ScenePacket`、`JudgeIssue`、`RepairPatch`: NovelLoop 的生成、评审和修复证据链接口。
- `create_artifact()`: Markdown 与 audit report 导出写入 artifacts 的既有入口。

## 4. 测试策略

- API 测试框架：pytest + FastAPI TestClient + SQLite 内存库。
- Workflow 测试框架：pytest，测试文件位于 `apps/workflow/tests/`。
- Web 测试框架：Node 内置 `node:test`，由 `apps/web/scripts/phase1-contract-test.mjs` 转译 TS/TSX。
- 本切片先覆盖 `apps/api/tests/test_blueprint_api.py`，后续阶段再补 Workflow 与 Web。

## 5. 依赖和集成点

- `app.models` 必须导入新增模型，确保 `Base.metadata.create_all()` 和 Alembic 元数据完整。
- `app.main` 必须 include 新增 blueprints router，确保 OpenAPI 与认证中间件路径生效。
- Alembic 迁移需要挂到当前 head `20260520_0001` 后。
- Blueprint API 依赖现有 `books` 表；章节规划触发只允许 locked blueprint。

## 6. 技术选型理由

- FastAPI `APIRouter + response_model + TestClient` 查询自 Context7 `/fastapi/fastapi` 官方文档，和项目现有路由一致。
- SQLAlchemy 2.0 `Mapped + mapped_column + relationship` 查询自 Context7 `/websites/sqlalchemy_en_20` 官方文档，和项目 ORM 风格一致。
- 当前没有可用 `github.search_code` 工具，已记录缺口，并用项目内相似实现与官方文档替代。

## 7. 关键风险点

- 9A 范围必须限制在最小全书闭环，避免提前做 EPUB、Style Guard、Timeline 和复杂审计 UI。
- Blueprint 锁定后必须避免被静默修改；本切片先提供锁定语义和状态门禁。
- 后续 Chapter Planner 写回要复用 `Chapter`，不要创建平行章节目标模型。
- 完成判定不能只靠新增测试，通过后还需执行计划指定的本地门禁并更新验证报告。

## 8. 充分性检查

- 能定义接口契约：是，`POST /api/blueprints`、`GET /api/blueprints/{id}`、`POST /api/blueprints/{id}/lock`、`POST /api/blueprints/{id}/chapter-plan`。
- 理解技术选型：是，沿用现有 FastAPI/SQLAlchemy/Pydantic 分层。
- 识别主要风险：是，锁定语义、外键校验、范围膨胀、后续章节写回集成。
- 知道如何验证：是，先写 `test_blueprint_api.py`，再运行专属 pytest 与后续门禁。


## 9. 本轮补充审计（2026-05-27 15:58:19 +08:00）

### 已验证实现

- 9A API 聚焦门禁：`uv run pytest tests/test_blueprint_api.py tests/test_book_runs.py tests/test_book_exporter.py -q`，14 passed。
- 9A Workflow 聚焦门禁：`uv run pytest tests/test_chapter_planner.py tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py -q`，10 passed。
- Phase 9 相关 API 扩展门禁：`uv run pytest tests/test_phase9a_deterministic_smoke.py tests/test_context_compiler_memory_injection.py tests/test_character_bible_api.py tests/test_judge_character_consistency.py tests/test_judge_timeline_consistency.py tests/test_judge_style_guard.py tests/test_scene_packet_pacing_directive.py -q`，12 passed。
- 9A Web BookRun 状态页：新增 `apps/web/app/book-runs/`，`pnpm --filter @storyforge/web test -- blueprints book-runs`，4 passed。

### 当前仍需强证据的计划项

- 9A Definition of Done 的全局门禁 `pnpm verify && pnpm test && pnpm e2e` 尚未在本轮完整执行。
- 9A 的 3000-6000 字 `book.md` 端到端产物尚未用真实运行样本核验，仅有 exporter 单元测试与 deterministic smoke。
- 9B 真实 LLM 1 章/3 章冒烟需要私有模型配置，当前未执行。
- 9C EPUB、全书审计页、真实 3-5 万字短篇和人工通读仍未完成。

## 10. 本轮继续审计（2026-05-27 19:42:45 +08:00）

### 当前计划勾选状态

- 使用 desktop-commander 搜索 `.dev_plan.md` 中 `- [ ]`，当前仅发现 2 个未勾选项。
- 未完成项均位于 `9B-4. 真实 LLM 小样本冒烟`：`9B-4a` 真实 LLM 1 章冒烟、`9B-4b` 真实 LLM 3 章短篇冒烟。
- `.dev_plan.md` 其他 Phase 9A、9B 本地控制面与 9C 本地增强项均已标记为 `[x]`，但完成判定中的真实 LLM、远端当前变更 CI/E2E、真实 3-5 万字与人工通读仍是整体缺口。

### 当前证据

- `current-phase.md` 与 `README.md` 已明确记录真实 LLM 冒烟命令和当前环境变量缺口。
- `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py` 已提供 1 章/3 章真实 LLM 冒烟入口。
- `apps/api/tests/test_phase9b_real_llm_smoke.py` 已覆盖缺 env 预检、本地 OpenAI 兼容协议替身、BookRun completed、ModelRun token 记录和 CLI 脱敏摘要。
- 当前环境复查：`STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL`、`STORYFORGE_LLM_MODEL`、`STORYFORGE_LLM_PROVIDER` 均未设置。

### 本轮验证

- `cd apps/api && uv run pytest tests/test_phase9b_real_llm_smoke.py -q`：通过，`3 passed in 0.73s`。
- `cd apps/api && uv run python -m app.domains.book_runs.phase9b_real_llm_smoke --chapter-count 1 --token-budget 8000`：失败，提示缺少真实 LLM 环境变量，未触发真实外部调用。

### 充分性结论

- 可本地实施的 9B-4 冒烟入口、预算参数和脱敏报告能力已存在并通过测试。
- 计划中剩余未完成项要求“真实 LLM 运行证据”，当前缺少私有环境配置，无法由本地代码继续推进到完成勾选。
