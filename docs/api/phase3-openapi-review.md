# Phase 3 OpenAPI 审查

生成时间：2026-05-16 00:00:00 +08:00

## 审查范围

本审查基于 `packages/shared/src/contracts/storyforge.openapi.json`、`tests/e2e/phase3-contract.spec.ts` 与 `apps/api/tests/test_workspaces_api.py`、`test_collaboration.py`、`test_commercial_controls.py`、`test_provider_gateway.py`、`test_phase3_analytics.py`。

## 关键端点与用途

| 能力 | 端点 | 用途 |
| --- | --- | --- |
| 团队工作区 | `POST /api/workspaces` | 创建工作区，沉淀团队外壳、席位上限和描述信息。 |
| 团队工作区 | `GET /api/workspaces` | 列出工作区，供前端工作区中心展示。 |
| 团队工作区 | `POST /api/workspaces/{workspace_id}/members` | 添加成员并校验席位上限。 |
| 团队工作区 | `GET /api/workspaces/{workspace_id}/members` | 读取工作区成员列表。 |
| 协作审批 | `POST /api/collaboration/comments` | 写入场景评论，记录协作反馈。 |
| 协作审批 | `POST /api/collaboration/approvals` | 发起审批请求，指定申请人与审批人。 |
| 协作审批 | `POST /api/collaboration/approvals/{approval_request_id}/decisions` | 提交审批决策并回写请求状态。 |
| 协作审批 | `GET /api/collaboration/scenes/{scene_id}/timeline` | 聚合同一场景的评论和审批时间线。 |
| 事件流 | `GET /api/events/workspaces/{workspace_id}` | 按倒序查看工作区事件流，供协作审计与分析层复用。 |
| 商业化控制 | `POST /api/commercial/workspaces/{workspace_id}/policy` | 写入或更新套餐限额。 |
| 商业化控制 | `GET /api/commercial/workspaces/{workspace_id}/summary` | 聚合席位、任务数与 Token 估算，判断是否超限。 |
| 模型接入层 | `POST /api/provider-gateway/providers` | 保存全局或工作区级 provider 配置。 |
| 模型接入层 | `GET /api/provider-gateway/providers` | 列出当前作用域可见的 provider 配置。 |
| 模型接入层 | `GET /api/provider-gateway/resolve` | 根据能力解析最终 provider。 |
| 分析扩展 | `GET /api/analytics/workspaces/{workspace_id}/dashboard` | 聚合成员、审批、修复、任务、事件与 provider 指标。 |

## Phase 3 覆盖结论

- `tests/e2e/phase3-contract.spec.ts` 负责检查 OpenAPI 是否暴露 Phase 3 端点，并校验后端测试源码与前端页面是否保留中文能力证据。
- `apps/api/tests/test_workspaces_api.py` 验证工作区创建、成员写入和席位上限控制。
- `apps/api/tests/test_collaboration.py` 验证评论、审批请求、审批决策、时间线和事件流联动。
- `apps/api/tests/test_commercial_controls.py` 验证套餐限额写入及当前使用量聚合。
- `apps/api/tests/test_provider_gateway.py` 验证全局与工作区 provider 的注册、列表和能力解析。
- `apps/api/tests/test_phase3_analytics.py` 验证分析看板聚合成员、审批、修复、任务、事件和 provider 指标。

## 风险与后续

- 当前商业化控制的 Token 估算使用 `JobRun.progress["token_usage"]` 聚合，只适合作为控制面板近似值；后续如需账单级精度，应拆分更细的计量真相源。
- 协作时间线当前聚合评论和审批请求；若后续需要展示审批决策细项，可在不破坏现有时间线契约的前提下新增 item_type。
- Provider Gateway 目前只解析优先级和能力，不处理配额、熔断和动态健康检查；这些能力适合在更后续的平台阶段扩展。
