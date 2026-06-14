# StoryForge 当前阶段事实源

生成时间：2026-06-04 17:50:00 +08:00

## 事实源职责矩阵

| 文件 | 职责 | 更新规则 |
| --- | --- | --- |
| `docs/internal/current-phase.md` | 当前阶段唯一事实源，记录最新状态、已完成能力、未完成门禁和禁止宣称范围。 | 远端 E2E、真实 LLM 长程、人工通读或发布门禁状态变化时必须先更新。 |
| `README.md` | 面向使用者的入口摘要，保留能力边界、本地运行入口和关键证据指针。 | 只摘要当前状态，不复制完整门禁细节；当前事实以 `docs/internal/current-phase.md` 为准。 |
| `docs/internal/TODO.md` | 当前下一步执行入口，记录剩余门禁、优先级和本地验证命令。 | 只保留下一步动作，不承载完整项目总览。 |
| `docs/internal/PROJECT_SUMMARY.md` | 项目总览和验证状态摘要，面向交接和健康概览。 | 同步关键验证状态，但不替代当前阶段判定。 |
| `docs/internal/dev-plan.md` | 历史计划和阶段 DoD，保留 Phase 9 任务拆解与完成条件。 | 可记录阶段完成证据，但不能单独作为最新状态来源。 |
| `docs/superpowers/plans/*` | 历史实施计划归档，保留设计和执行语境。 | 只作追溯参考，不参与当前状态判定。 |

推荐读取顺序：先读 `docs/internal/current-phase.md`，再读 `docs/internal/TODO.md` 获取下一步，按需读 `docs/internal/PROJECT_SUMMARY.md`、`README.md` 和 `docs/internal/dev-plan.md`。

## 当前阶段

StoryForge 当前处于 Phase 9 真实 LLM 长程验收准备阶段。Phase 9A、Phase 9B 本地控制面、Phase 9C 本地增强项已有本地验证证据；真实 LLM 1 章、3 章与 10 章 smoke 已完成脱敏验证，10 章 smoke 已通过最终验收；远端 `master` E2E 已在 head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f` 上通过，真实 3-5 万字长程仍未完成。

## 已完成的本地能力边界

- **BookRun 最小全书闭环**：本地 deterministic/mock provider 可从 Blueprint 章节计划驱动 3 章 BookRun，并导出 `book.md` 与 `audit_report.json`。
- **BookRun 控制面**：已具备 checkpoint resume、token/时间/章节预算暂停、provider 连续降级暂停和成本摘要。
- **长程质量增强**：Story Memory 注入/抽取、Character Bible、Timeline Guard、Style Guard、章节 pacing 和审计页已纳入本地测试。
- **出版制品**：BookRun 可生成 Markdown、EPUB 与审计报告制品索引。

## 真实 LLM 冒烟入口

设置私有环境变量后，可执行以下命令验证 9B-4a 与 9B-4b：

```powershell
cd apps/api
uv run python -m app.domains.book_runs.book_generation --chapter-count 1 --token-budget 8000
uv run python -m app.domains.book_runs.book_generation --chapter-count 3 --token-budget 24000
```

最新脱敏证据目录：

- 1 章真实 smoke：`.codex/real-llm-1ch-20260603-142925`，BookRun completed，已补人工通读。
- 3 章真实 smoke：`.codex/real-llm-3ch-20260603-173932`，BookRun completed，实际 3 章，tokens_used=14158，`book.md` 与 `audit_report.json` 已落盘，`quality_summary.status=ok`，人工通读完成记录已补齐。
- 10 章真实 smoke：`.codex/real-llm-10ch-20260604-110831`，BookRun completed，实际 10 章，tokens_used=145668，`book.md` 与 `audit_report.json` 已落盘，`quality_summary.status=ok`，10 章 smoke 人工通读完成，最终门禁 `gate: pass_for_real_10ch_final_acceptance`。

历史限制：旧 3 章目录 `.codex/real-llm-3ch-20260603-163715` 曾出现语义 Judge 降级，只能证明真实生成与导出链路。最新 10 章 smoke 已完成最终验收，但仍不能外推为 3-5 万字长程完成。

## 已完成的远端门禁

- 最新远端 `CI` run `26857864662` 已成功，只覆盖 `CI / Core verification` 子集。
- 历史远端 `master` 定时 `E2E` run `26915457170`（2026-06-03T21:55:39Z）曾失败，失败点为 `uv run alembic upgrade head`，原因是 Alembic 多 head（`Multiple head revisions`）。
- 修复分支 `codex/phase9-e2e-alembic` 的远端 `E2E` run `26941784868`（2026-06-04T08:59:00Z，`workflow_dispatch`，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`）已成功，且 `执行 Alembic 迁移预检`、`执行数据库迁移`、`运行 E2E` 三个关键步骤均为 success。
- 修复分支已非强制快进合入远端 `master`；远端 `master` 与 `origin/codex/phase9-e2e-alembic` 均指向 `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`。
- 最新远端 `master` E2E run `26944063055`（2026-06-04T09:45:05Z，`workflow_dispatch`，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`）已成功；`执行 Alembic 迁移预检`、`执行数据库迁移`、`运行 E2E` 三个关键步骤均为 success。
- 修复内容包括 Alembic merge revision `20260604_0001`，将 `20260514_phase2` 与 `20260602_0003` 收敛为单一 head；本地 `pnpm e2e` 的 `API verification` 已纳入 `tests/test_alembic_heads.py`，会先验证单 head 与离线 SQL smoke；在线 PostgreSQL 迁移已在隔离分支复验，临时库 `storyforge_phase9_e2e_submit_verify` 执行 `uv run alembic upgrade head` 与 `uv run alembic current --check-heads` 均退出码为 0。

## 仍未完成的验收项

- 真实 LLM 跑完 3-5 万字短篇。
- 3-5 万字长程人工通读记录写入 `.codex/verification-report.md`，且无明显人物、世界观或时间线矛盾。

## 禁止宣称范围

在上述未完成项补齐前，只能宣称 StoryForge 已具备本地可验证的最小整书闭环、审计增强、真实 LLM 10 章 smoke 最终验收证据，以及 `master` 远端 E2E 通过证据；不能宣称真实模型下已完成 3-5 万字长程，也不能宣称具备稳定生产级长篇生产闭环。

## 证据源

- `docs/internal/dev-plan.md`：Phase 9 计划、勾选状态和完成判定。
- `.codex/verification-report.md`：本地测试、红绿记录、真实 LLM 环境缺口和质量评分。
- `README.md`：面向使用者的能力边界摘要。
