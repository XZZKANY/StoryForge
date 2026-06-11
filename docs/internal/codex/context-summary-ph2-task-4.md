# 项目上下文摘要（PH2 Task 4：批量精修 API 与服务）

生成时间：2026-05-14 00:00:00 +08:00

## 1. 相似实现分析

- `apps/api/app/domains/judge/service.py`
  - 模式：服务层接收显式正文、必含事实和风格规则，使用本地确定性规则创建 `JudgeIssue`。
  - 可复用：批量精修逐场景调用 `create_judge_issues()`，保持 Judge 行为唯一来源。
  - 需注意：`JudgeIssueCreate.content` 不能为空，批量服务需校验场景正文。
- `apps/api/app/domains/repair/service.py`
  - 模式：根据 `JudgeIssue` 的 span 和 payload 创建 `RepairPatch`，同时把问题单状态改为 `requires_rejudge`。
  - 可复用：批量精修只对 open issue 生成补丁，补丁逻辑复用 `create_repair_patch()`。
  - 需注意：正文必须仍能匹配问题单记录的命中片段，否则修复服务会拒绝。
- `apps/api/app/domains/jobs/models.py`
  - 模式：长任务统一通过 `JobRun` 保存 `job_type`、`status`、`progress` 和 `error_message`。
  - 可复用：批量精修创建 `JobRun(job_type="batch_refinement")`，进度写入 JSON，不新增状态表。
- `apps/api/app/domains/continuity/models.py`
  - 模式：`ScenePacket` 是场景上下文快照，支持 `job_run_id` 追溯。
  - 可复用：批量精修为每个场景创建或读取最新 `ScenePacket`，并把本次任务号写入上下文包。

## 2. 项目约定

- 路由文件使用 `APIRouter(prefix="/api/...", tags=["中文标签"])`。
- 服务层抛出领域 `ValueError` 子类，路由层转换为 HTTP 404 或 422。
- Pydantic 契约集中在 `schemas.py`，响应模型通过类方法展开 ORM 字段和 JSON payload。
- 测试使用 FastAPI `TestClient` + SQLite 内存库 + `StaticPool`，真实写入 SQLAlchemy 模型。

## 3. 可复用组件清单

- `JobRun`：记录批量精修任务状态、进度和失败原因。
- `ScenePacket`：保存逐场景评审上下文，`packet` 写入模式、事实和风格规则。
- `JudgeIssueCreate`、`create_judge_issues()`：批量生成结构化问题单。
- `RepairPatchCreate`、`create_repair_patch()`：批量生成定向修复补丁。
- `Book`、`Chapter`、`Scene`：校验作品和场景归属，读取场景正文。

## 4. 测试策略

- 红灯：新增 `apps/api/tests/test_batch_refinement_api.py` 后运行 `uv run pytest tests/test_batch_refinement_api.py -q`，预期 `/api/batch-refinement/jobs` 返回 404。
- 绿灯：实现路由后运行 `uv run pytest tests/test_batch_refinement_api.py tests/test_judge_repair.py -q`。
- 契约：运行 `pnpm openapi`，确认 OpenAPI 出现 `/api/batch-refinement/jobs` 和 `/api/batch-refinement/jobs/{job_run_id}`。

## 5. 依赖和集成点

- 外部依赖：仅使用 FastAPI、Pydantic、SQLAlchemy，未新增依赖。
- 内部依赖：`batch_refinement.service` 调用 `judge.service` 与 `repair.service`；路由注册到 `apps/api/app/main.py`。
- 配置来源：沿用 `get_session` 数据库依赖，无新增配置。

## 6. 技术选型理由

- 批量精修属于长任务编排，不应新增独立指标或补丁表；复用 `JobRun` 可保持任务中心统一。
- 精修判断和补丁生成复用现有 Judge/Repair 服务，避免重复维护规则。
- 本阶段使用同步本地 API，满足 PH2 本地可验证目标，后续可由 Task 5 工作流替换执行器。

## 7. 关键风险点

- 边界条件：空场景列表、场景不属于作品、场景正文为空时必须明确失败。
- 一致性：创建补丁后问题单状态会变为 `requires_rejudge`，统计 open issue 时应在补丁创建前记录。
- 性能：批量 API 按场景循环，PH2 测试数据量小；后续真实长任务可迁移到工作流执行。
- 安全考虑：本任务不新增认证鉴权，遵循项目当前本地闭环边界。
