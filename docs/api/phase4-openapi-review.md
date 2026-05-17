# Phase 4 OpenAPI 审查

生成时间：2026-05-17 00:00:00 +08:00

## 审查范围

本审查基于 `packages/shared/src/contracts/storyforge.openapi.json`、`tests/e2e/phase4-contract.spec.ts`，以及 `apps/api/tests/test_retrieval_index.py`、`test_scene_packet_retrieval_upgrade.py`、`test_prompt_packs.py`、`test_model_runs.py`、`test_artifacts.py`、`test_evaluations.py`、`test_job_runtime_bridge.py`、`test_phase4_service_acceptance.py`。

## 关键端点与用途

| 能力 | 端点 | 用途 |
| --- | --- | --- |
| 检索中心 | `POST /api/retrieval/sources` | 创建资料源并立即生成分块。 |
| 检索中心 | `GET /api/retrieval/sources` | 按作品/系列列出资料源。 |
| 检索中心 | `POST /api/retrieval/refresh-runs` | 刷新资料源分块与 embedding 占位结果。 |
| 检索中心 | `POST /api/retrieval/search` | 在作品/系列边界内返回稳定排序的检索命中。 |
| Prompt Packs | `POST /api/prompt-packs` | 创建可版本化 Prompt Pack。 |
| Prompt Packs | `GET /api/prompt-packs` | 查询当前作用域下的最新版本 Prompt Pack。 |
| Prompt Packs | `PATCH /api/prompt-packs/{pack_id}` | 基于历史版本生成新版 Prompt Pack。 |
| Prompt Packs | `GET /api/prompt-packs/{pack_id}/history` | 读取同一谱系下的版本历史。 |
| 模型运行日志 | `POST /api/model-runs` | 记录 provider、模型、延迟、Token、输入输出摘要。 |
| 模型运行日志 | `GET /api/model-runs` | 按工作区/作品/任务聚合运行日志。 |
| 制品中心 | `POST /api/artifacts` | 创建 export、upload、workflow_snapshot、evaluation_report 等制品元数据。 |
| 制品中心 | `GET /api/artifacts` | 查询最新版本制品清单。 |
| 评测系统 | `POST /api/evaluations/cases` | 创建评测基准用例。 |
| 评测系统 | `POST /api/evaluations/runs` | 运行评测并沉淀稳定指标。 |
| 评测系统 | `GET /api/evaluations/runs` | 查询工作区或作品范围内的评测运行记录。 |

## Phase 4 覆盖结论

- `test_retrieval_index.py` 覆盖资料源创建、刷新任务和稳定排序检索结果，并校验 `book_id`/`series_id` 边界回传。
- `test_scene_packet_retrieval_upgrade.py` 覆盖 Scene Packet 自动触发检索、记录检索命中与证据链路。
- `test_prompt_packs.py` 覆盖 Prompt Pack 创建、升级与历史版本查询。
- `test_model_runs.py` 覆盖 provider、model、latency、token usage、Prompt Pack 关联和任务归属。
- `test_artifacts.py` 覆盖 Markdown/EPUB 导出自动登记，以及手工上传资料进入制品中心。
- `test_evaluations.py` 覆盖评测用例、评测运行与一致性/修复/接受率指标计算。
- `test_job_runtime_bridge.py` 覆盖 JobRun 与运行时检查点的进度同步。
- `test_phase4_service_acceptance.py` 作为当前沙箱的补偿验收链，串联检索、Scene Packet、Prompt Pack、模型运行日志、制品中心、评测系统与任务桥接。

## 风险与后续

- 当前检索实现使用确定性关键词重叠与假 embedding 占位，适合 Phase 4 工程验收；后续接入真实向量索引时，仍应保持“索引只存引用，不替代真相源”的边界。
- Prompt Pack 当前通过通用 `payload` 承载 system/user 模板槽位、禁用表达与场景标签；若后续需要更强约束，可在不破坏版本谱系的前提下逐步结构化字段。
- Workflow Runtime 与 Job Center 的数据库级强绑定仍由 API 服务层桥接，当前 OpenAPI 只暴露控制面能力；未来若提供恢复/重放 API，应保持与现有 JobRun / ModelRun / Artifact 谱系兼容。
