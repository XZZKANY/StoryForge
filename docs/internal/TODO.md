# StoryForge 待办清单

生成时间：2026-06-04 17:50:00 +08:00

## Phase 9 当前执行入口

StoryForge 当前处于 Phase 9 真实 LLM 长程验收准备阶段。Phase 9A、Phase 9B 本地控制面和 Phase 9C 本地增强项已有本地验证证据；真实 LLM 1 章、3 章与 10 章 smoke 已完成脱敏验证，10 章 smoke 已通过最终验收；远端 `master` E2E 已通过，真实 3-5 万字长程仍未完成。

## 当前事实边界

- 远端 `CI` run `26857864662` 已成功，但只覆盖 `CI / Core verification` 子集。
- 历史远端 `master` 定时 `E2E` run `26915457170`（2026-06-03T21:55:39Z）曾失败于 Alembic `Multiple head revisions`。
- 修复分支 `codex/phase9-e2e-alembic` 的远端 `E2E` run `26941784868`（2026-06-04T08:59:00Z，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`）已成功；`执行 Alembic 迁移预检`、`执行数据库迁移`、`运行 E2E` 均为 success。
- 修复分支已非强制快进合入远端 `master`；最新远端 `master` E2E run `26944063055`（2026-06-04T09:45:05Z，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`）已成功；`执行 Alembic 迁移预检`、`执行数据库迁移`、`运行 E2E` 均为 success。
- 本地已新增 Alembic merge revision `20260604_0001`，并将 `tests/test_alembic_heads.py` 纳入本地 E2E 的 API verification 预检；在线 PostgreSQL 迁移已在隔离分支复验，临时库 `storyforge_phase9_e2e_submit_verify` 执行 `uv run alembic upgrade head` 与 `uv run alembic current --check-heads` 均退出码为 0。
- 真实 LLM 1 章 smoke 证据：`docs/internal/codex/real-llm-1ch-20260603-142925`。
- 真实 LLM 3 章 smoke 证据：`docs/internal/codex/real-llm-3ch-20260603-173932`。
- 真实 LLM 10 章 smoke 证据：`docs/internal/codex/real-llm-10ch-20260604-110831`，最终门禁 `gate: pass_for_real_10ch_final_acceptance`，10 章 smoke 人工通读完成。
- 真实 3-5 万字长程仍未完成。

## 下一步优先级

1. 推进真实 3-5 万字短篇长程运行，沿用真实 LLM 长程包装脚本和脱敏证据校验边界。
2. 对 3-5 万字长程产物执行 Markdown、EPUB、`audit_report.json` 登记核对和人工通读。
3. 长程通过后，同步 `README.md`、`docs/internal/current-phase.md`、`docs/internal/PROJECT_SUMMARY.md` 和 `docs/internal/dev-plan.md` 的完成边界。

## 本地验证入口

常用本地门禁：`pnpm verify`、`pnpm e2e`、`pnpm test`、`pnpm openapi`。

```powershell
cd D:/StoryForge
pnpm verify
pnpm e2e
pnpm test
pnpm openapi
```

真实 LLM smoke 入口只在私有运行时变量已设置时执行，不读取 `.env`，不把 provider 配置或 token 写入仓库：

```powershell
cd D:/StoryForge/apps/api
uv run python -m app.domains.book_runs.phase9b_real_llm_smoke --chapter-count 1 --token-budget 8000
uv run python -m app.domains.book_runs.phase9b_real_llm_smoke --chapter-count 3 --token-budget 24000
```

## 事实来源

- 当前状态以 `docs/internal/current-phase.md` 为准；TODO 只保留下一步执行入口，不作为完整项目总览或历史计划来源。
- `README.md`
- `docs/internal/current-phase.md`
- `docs/internal/dev-plan.md`
- `docs/internal/PROJECT_SUMMARY.md`
- `docs/internal/codex/operations-log.md`
- `docs/internal/codex/verification-report.md`
