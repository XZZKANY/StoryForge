## 项目上下文摘要（Phase 9B 恢复、预算与 Provider 降级）

生成时间：2026-05-27 11:08:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/service.py`
  - 模式：服务层负责状态转移，router 只做 HTTP 异常映射。
  - 可复用：`create_book_run()`、`get_book_run()`、`apply_book_run_progress()`。
  - 需注意：BookRun 当前以 `progress` JSON 保存运行证据，9B 可在此基础上添加 checkpoint 与预算摘要。
- **实现2**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`
  - 模式：纯函数 `run_book_loop()` 接收 request 与 `run_chapter` 回调，返回可直接回填 API 的 `BookLoopResult`。
  - 可复用：`BookLoopRequest`、`BookLoopResult`、`_chapter_progress()`。
  - 需注意：恢复语义应从 `start_chapter_index` 和既有 progress 推导，不重复 approve 已完成章节。
- **实现3**: `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`
  - 模式：`FallbackProviderAdapter` 在主 provider 失败时给响应附加 `fallback_metadata`。
  - 可复用：`ProviderResponse.fallback_metadata`、`last_fallback_metadata`。
  - 需注意：BookLoop 可通过章节结果中的 fallback 信息累计连续降级次数。
- **实现4**: `apps/api/app/domains/model_runs/models.py` 与 `apps/workflow/tests/test_model_run_token_tracking.py`
  - 模式：token 和 cost 进入 `ModelRun.payload`，API 侧 `ModelRun.token_usage` 是可聚合事实源。
  - 可复用：`payload.total_tokens`、`payload.cost_estimate`、`token_usage`。
  - 需注意：9B 成本摘要先保持在 BookRun 字段与 progress，不新增平行成本表。

### 2. 项目约定

- **命名约定**: Python 服务函数使用 snake_case，Pydantic schema 使用 PascalCase，TS helper 使用 camelCase。
- **文件组织**: API domain 内保持 `models.py`、`schemas.py`、`service.py`、`router.py` 分层；workflow 编排放在 `orchestrators/`。
- **导入顺序**: `from __future__ import annotations` 后标准库、第三方、本地模块；ruff 管理排序。
- **代码风格**: 测试描述与注释使用简体中文，行为测试优先服务层和纯函数。

### 3. 可复用组件清单

- `BookRun.progress`: 保存 completed_chapters、blocked_chapter、checkpoint 等运行证据。
- `BookRunProgressUpdate`: workflow 回填 BookRun 状态的现有入口，可扩展预算字段。
- `run_book_loop()`: 继续承担顺序章节驱动、暂停和恢复规则。
- `ProviderResponse.fallback_metadata`: provider 降级事实来源。
- `ModelRun.payload`: token 与 cost 事实来源。

### 4. 测试策略

- **测试框架**: API 使用 pytest + FastAPI TestClient；workflow 使用 pytest；Web 使用 node:test + React 静态渲染。
- **测试模式**: 先写失败测试，再实现最小代码，最后局部回归。
- **参考文件**: `apps/api/tests/test_book_runs.py`、`apps/workflow/tests/test_book_loop_three_chapters.py`、`apps/workflow/tests/test_provider_fallback.py`、`apps/web/tests/blueprints.test.tsx`。
- **覆盖要求**: checkpoint 数量与体积、resume 不重复章节、预算硬暂停、连续 fallback 暂停、Web 成本摘要展示。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy 2.0、Pydantic、FastAPI、Alembic、React。
- **内部依赖**: BookRun API 是状态真相源；workflow BookLoop 输出 progress；Web 只展示状态和成本摘要。
- **集成方式**: API 通过 `PATCH /api/book-runs/{id}/progress` 回填状态，新增 `POST /api/book-runs/{id}/resume` 只改变 BookRun 运行状态与起点。
- **配置来源**: 真实 LLM 冒烟依赖私有 `.env`，本轮不提交密钥。

### 6. 技术选型理由

- **为什么用这个方案**: 延续 9A 的 BookRun 单事实源，避免新建平行运行表。
- **优势**: 改动集中、可本地验证、与现有 OpenAPI/e2e 门禁兼容。
- **劣势和风险**: 真实 LLM 冒烟缺少密钥时只能验证本地预算和降级逻辑，需在报告中记录。

### 7. 关键风险点

- **并发问题**: resume 与 progress patch 同时发生可能覆盖 progress，9B 先通过服务层状态约束降低风险。
- **边界条件**: checkpoint 必须只保存引用 id，不能保存完整正文；预算触顶不能继续下一章。
- **性能瓶颈**: checkpoint JSON 体积需限制在 5MB 以下。
- **安全考虑**: 本任务不新增认证或密钥逻辑，真实 LLM 密钥仅来自本地环境且不写入仓库。
