# 项目上下文摘要（Phase 2 Task 4：批量精修任务编排）

生成时间：2026-05-16 00:00:00 +08:00

## 1. 相似实现分析

- `apps/api/tests/test_judge_repair.py`：使用 SQLite 内存库、`get_session` 依赖覆盖和真实 `TestClient` 请求验证 Judge/Repair 闭环。
- `apps/api/app/domains/judge/service.py`：`create_judge_issues` 负责确定性规则评审，缺失场景或上下文包时抛 `JudgeInputError`。
- `apps/api/app/domains/repair/service.py`：`create_repair_patch` 基于问题单 span 生成局部补丁，并把问题单状态改为 `requires_rejudge`。
- `apps/api/app/domains/jobs/models.py`：`JobRun.progress` 是长任务进度、错误和可恢复状态的 JSON 真相源。

## 2. 项目约定

- 后端领域按 `models.py`、`schemas.py`、`service.py`、`router.py` 分层，路由只做协议转换。
- Python 函数和字段使用 snake_case，Pydantic/ORM 类使用 PascalCase。
- API 错误提示、测试描述、注释和文档使用简体中文。
- 新路由需要在 `apps/api/app/main.py` 中 `include_router`。

## 3. 可复用组件清单

- `JudgeIssueCreate` 与 `create_judge_issues`：批量逐项生成结构化问题单。
- `RepairPatchCreate` 与 `create_repair_patch`：为每个问题单生成定向补丁。
- `JobRun`：保存 `total/succeeded/failed/items` 明细和部分失败原因。
- `BatchRefineryRunCreate` 与 `BatchRefineryRunRead`：已存在批量请求和响应 schema，可直接复用。

## 4. 测试策略

- 红灯测试：`cd apps/api; uv run pytest tests/test_batch_refinery.py -q` 当前因 `/api/batch-refinery/runs` 404 失败，说明路由尚未注册。
- 绿灯目标：补齐 router、主应用注册和单项执行函数，验证批量成功、部分失败与明细查询。
- 回归命令：局部 pytest、`uv run python -m compileall app tests`、必要时 `pnpm openapi`。

## 5. 依赖和集成点

- 外部依赖：FastAPI、Pydantic、SQLAlchemy、pytest，均为项目已有依赖。
- 内部依赖：Book/Scene 归属校验、Judge/Repair 服务、JobRun 进度记录。
- Context7 来源：`/fastapi/fastapi` 确认 `APIRouter`、`response_model`、`include_router` 与 `dependency_overrides` 测试模式。

## 6. 风险点

- 单项失败不得回滚整个批次，成功项的问题单和补丁必须保留。
- `JobRun.progress` 必须包含可恢复重试所需的 scene、正文和约束输入。
- 批量任务当前同步执行，必须保持确定性规则，不接真实 LLM。

## 7. 充分性检查

- 能定义接口契约：是，`POST /api/batch-refinery/runs` 与 `GET /api/batch-refinery/runs/{job_id}`。
- 理解技术选型：是，复用现有 FastAPI 分层和 JobRun JSON 进度。
- 识别主要风险：是，部分失败、重试输入、成功项持久化。
- 知道验证方式：是，局部 pytest、compileall、OpenAPI 生成和编码扫描。
