## 项目上下文摘要（OpenAPI volume_progress）

生成时间：2026-06-02 20:22:32 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_model_runs.py`
  - 模式：直接读取 `app.openapi()["components"]["schemas"]` 断言响应模型字段。
  - 可复用：`schemas = app.openapi()["components"]["schemas"]` 的契约测试写法。
  - 需注意：断言应落在 schema 引用结构，而不是重复业务逻辑。
- **实现2**: `apps/api/tests/test_runtime_tools.py`
  - 模式：直接检查 OpenAPI path 与 response schema，供 Web 和 e2e 共享契约校验。
  - 可复用：以 OpenAPI 输出作为 API 契约事实源。
  - 需注意：测试只检查契约边界，不触发远程 provider。
- **实现3**: `apps/api/tests/test_book_runs.py`
  - 模式：BookRun 行为测试集中覆盖启动、进度回填、控制端点和卷级进度。
  - 可复用：`test_patch_book_run_volume_progress_is_controlled_by_volume_contract` 已覆盖 volume_progress 行为，适合追加 OpenAPI schema 断言。
  - 需注意：该文件已有其他代理改动，只做增量补丁。
- **实现4**: `scripts/generate-openapi.mjs`
  - 模式：从 `apps/api` 导入 `app.main.app`，调用 `app.openapi()` 写入共享契约快照。
  - 可复用：根命令 `pnpm openapi`。
  - 需注意：共享 JSON 由脚本生成，避免手工格式漂移。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_` 前缀和 snake_case；Pydantic schema 类使用 PascalCase。
- **文件组织**: API 领域 schema 位于 `apps/api/app/domains/book_runs/schemas.py`，API 测试位于 `apps/api/tests/test_book_runs.py`，共享契约位于 `packages/shared/src/contracts/storyforge.openapi.json`。
- **导入顺序**: `from __future__ import annotations` 后为第三方库导入，再导入项目模块。
- **代码风格**: 测试使用中文 docstring，断言直接、局部变量命名清晰。

### 3. 可复用组件清单

- `apps/api/app/main.py`: `app.openapi()` 的事实源。
- `apps/api/app/domains/book_runs/schemas.py`: `BookRunVolumeProgress`、`BookRunChapterRange`、`BookRunProgressUpdate` 的 Python schema。
- `scripts/generate-openapi.mjs`: OpenAPI 快照生成脚本。
- `package.json`: `openapi` 脚本入口。

### 4. 测试策略

- **测试框架**: pytest + FastAPI TestClient。
- **测试模式**: 在既有 BookRun volume_progress 行为测试末尾追加 OpenAPI schema 断言。
- **参考文件**: `apps/api/tests/test_model_runs.py`、`apps/api/tests/test_runtime_tools.py`、`apps/api/tests/test_book_runs.py`。
- **覆盖要求**: 正常流程验证 `volume_progress` 行为；契约验证 `BookRunProgressUpdate.properties.volume_progress` 引用 `BookRunVolumeProgress`。

### 5. 依赖和集成点

- **外部依赖**: FastAPI/Pydantic 生成 OpenAPI schema；Context7 查询确认 FastAPI 会自动生成 OpenAPI 并把模型放入 `components.schemas`。
- **内部依赖**: `BookRunProgressUpdate` 请求模型由 `apps/api/app/domains/book_runs/router.py` 的 progress PATCH 端点使用。
- **集成方式**: `pnpm openapi` 调用 `scripts/generate-openapi.mjs`，由 `app.openapi()` 刷新共享 JSON。
- **配置来源**: 无新增配置；测试 fixture 会清理远程 LLM 环境变量。

### 6. 技术选型理由

- **为什么用这个方案**: Python API schema 已是事实源，缺口在共享契约快照与测试护栏，复用项目生成命令最小化漂移。
- **优势**: 不改业务代码，不触碰禁止写集，契约测试可防止再次漏同步。
- **劣势和风险**: 工作树已有其他代理对 OpenAPI 和测试文件的改动，生成快照可能包含其他已存在的未提交差异；本任务只解释 `volume_progress` 相关差异。

### 7. 关键风险点

- **并发问题**: 多代理同时修改共享 OpenAPI，必须避免回滚或重排他人差异。
- **边界条件**: `volume_progress` 是可空字段，OpenAPI 应以 `anyOf` 表达 `$ref` 或 `null`。
- **性能瓶颈**: 新增测试只读取 OpenAPI schema，无运行时性能影响。
- **安全考虑**: 不读取 `.env`、API Key 或凭据；测试不打印敏感配置。
