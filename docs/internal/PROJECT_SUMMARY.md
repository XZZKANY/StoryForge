# StoryForge 项目总结

生成时间：2026-06-04 17:50:00 +08:00

## 1. 项目定位

StoryForge 是面向长篇小说生产的可验证创作流水线。它把生成、检索、评审、修复、批准、回写、运行日志、制品和评测摘要串成可追溯证据链，目标是支撑可审计、可恢复、可验证的长篇创作流程，而不是只输出孤立文本。

## 2. 当前验证状态

| 验证项 | 当前结果 | 说明 |
| ------ | -------- | ---- |
| 本地核心门禁 | 通过 | `pnpm verify` 已重新跑通；Web 209 passed，API 405 passed，Workflow 164 passed，Ruff 与 OpenAPI drift 检查通过；API pytest 仍有 7 个非阻塞 warning。 |
| 本地端到端契约 | 通过 | `pnpm e2e` 已重新跑通；Node 29 passed，API verification 61 passed，workflow verification 37 passed，OpenAPI refresh/drift 检查通过。 |
| 远端 CI 子集 | 通过 | GitHub Actions `CI / Core verification` run `26857864662` 已成功；该结果只覆盖 CI 子集，远端 E2E 证据见下一行。 |
| 远端 E2E | 主分支通过 | 历史远端 `master` 定时 E2E run `26915457170`（2026-06-03T21:55:39Z）曾失败于 Alembic `Multiple head revisions`；修复分支 `codex/phase9-e2e-alembic` 的远端 E2E run `26941784868` 已成功；修复已非强制快进合入 `master`，本轮 Alembic merge revision 为 `20260604_0001`，最新远端 `master` E2E run `26944063055`（2026-06-04T09:45:05Z，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`）已成功，关键步骤 `执行 Alembic 迁移预检`、`执行数据库迁移`、`运行 E2E` 均通过。 |
| 真实 LLM smoke | 通过 | 1 章 smoke 证据位于 `docs/internal/codex/real-llm-1ch-20260603-142925`；3 章 smoke 证据位于 `docs/internal/codex/real-llm-3ch-20260603-173932`；10 章 smoke 证据位于 `docs/internal/codex/real-llm-10ch-20260604-110831`，最终门禁为 `gate: pass_for_real_10ch_final_acceptance`，10 章 smoke 人工通读完成。 |
| 真实长程验收 | 未完成 | 真实 3-5 万字长程仍未完成，不能据此宣称稳定生产级长篇闭环。 |
| 空白与编码检查 | 本地通过 | 本轮只对目标文件和新增上下文摘要执行窄范围 `git diff --check`、UTF-8 文本读取、敏感扫描和尾随空白检查。 |

## 3. 技术栈与仓库结构

- 仓库：`https://github.com/XZZKANY/StoryForge.git`，主分支 `master`。
- 包管理器：`pnpm@9.15.4`。
- API：FastAPI、Pydantic、SQLAlchemy、Alembic、PostgreSQL/pgvector、Redis。
- Web：Next.js App Router、React、TypeScript。
- Workflow：LangGraph 或本地兼容运行时，负责长任务、checkpoint、运行态记录和模型调用边界。
- 共享契约：`packages/shared/src/contracts/storyforge.openapi.json`。

## 4. 当前页面边界

| 页面 | 当前对象 | 当前证据 | 当前动作 |
| ---- | -------- | -------- | -------- |
| Studio | 作品、章节、Scene Packet、Repair Patch | Judge 评审、批准摘要、失败恢复摘要 | 批准写回、刷新后复核 |
| Retrieval | 资料源、刷新任务、搜索请求 | Retrieval Hit、证据锚点 | 跳转锚点、核对检索来源 |
| Runs | JobRun | Checkpoint、ModelRun 摘要 | 查看恢复边界 |
| Artifacts | Artifact | 详情、payload 下载摘要 | 下载摘要核对 |
| Evaluations | Evaluation Run | 趋势摘要、失败样例 | 反馈入口核对 |
| Providers | Provider 配置 | 解析来源、凭据状态、缓存边界 | 诊断真实模型配置 |

## 5. 当前不能承诺的能力

- 不能宣称真实 3-5 万字长程完成；当前真实证据只覆盖 1 章、3 章与 10 章 smoke。
- 不能宣称 3-5 万字长程人工通读完成；现有人工通读只覆盖 smoke 范围。
- Studio 还不是全步骤交互编排器。
- Retrieval 还没有独立证据详情路由和重排状态详情。
- Runs retry 只代表创建恢复任务，不代表立即续跑 workflow。
- Artifacts 还没有对象存储签名 URL、上传资料执行、快照 diff 和报告详情。
- Evaluations 还没有复杂图表、评测集管理和失败样例自动反馈执行。

## 6. 发布前验证入口

```powershell
cd D:/StoryForge
docker compose up -d postgres redis minio
pnpm verify
pnpm e2e
pnpm test
pnpm openapi
```

验证报告必须写入 `docs/internal/codex/verification-report.md`，并单独列出页面级读取、API Key 注入、Studio 批准写回、Artifacts/Evaluations 读取、真实 API e2e、远程 LLM smoke、真实长程验收、远端 CI/E2E 状态、未联通能力和 OpenAPI 变化说明。

## 7. 事实来源

- 当前阶段事实以 `docs/internal/current-phase.md` 为准；PROJECT_SUMMARY 只保留项目总览、验证状态摘要和交接视角。
- `README.md`
- `docs/internal/current-phase.md`
- `docs/internal/dev-plan.md`
- `docs/architecture/phase6-workbench-contract.md`
- `docs/internal/TODO.md`
- `docs/internal/codex/operations-log.md`
- `docs/internal/codex/verification-report.md`
