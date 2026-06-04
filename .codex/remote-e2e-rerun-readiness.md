# Phase 9 远端 E2E 重跑与通过记录

生成时间：2026-06-04 09:33:37 +08:00

## 当前远端失败事实

- 历史远端 `E2E` run `26915457170`，触发时间 `2026-06-03T21:55:39Z`，状态为失败。
- 失败步骤：`执行数据库迁移`。
- 失败命令：`uv run alembic upgrade head`。
- 失败原因：Alembic `Multiple head revisions`。
- 该 run 仍来自旧远端状态，不能证明本地 Alembic 修复无效。

## 当前远端通过事实

- 修复分支 `codex/phase9-e2e-alembic` 的远端 `E2E` run `26941784868` 已通过。
- 修复分支已非强制快进合入远端 `master`。
- 最新远端 `master` E2E run `26944063055`，触发时间 `2026-06-04T09:45:05Z`，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`，状态为 success。
- 关键步骤 `执行 Alembic 迁移预检`、`执行数据库迁移`、`运行 E2E` 均为 success。

## 本地已具备的修复证据

- `.codex/real-llm-10ch-20260604-110831`
  - 真实 10 章 smoke 已完成最终验收。
  - BookRun completed，实际 10 章，tokens_used=145668。
  - 最终门禁为 `gate: pass_for_real_10ch_final_acceptance`。
  - 该证据不能替代远端 E2E，也不能声明真实 3-5 万字长程完成。
- `.github/workflows/e2e.yml`
  - 已包含 `workflow_dispatch`，支持通过 GitHub UI、API 或 CLI 手动触发。
  - 已在 `执行数据库迁移` 前加入 `执行 Alembic 迁移预检`。
- `apps/api/alembic/versions/20260604_0001_merge_phase2_and_current_heads.py`
  - 合并 `20260514_phase2` 与 `20260602_0003`，使迁移图收敛为单一 head。
- `apps/api/tests/test_alembic_heads.py`
  - 验证 Alembic 迁移图只有 `20260604_0001` 一个 head。
  - 验证 `alembic upgrade head --sql` 可在无数据库环境生成离线 SQL。
- `docs/operations/alembic-validation.md`
  - 记录 Docker daemon 已启动，server `29.2.1`。
  - 记录在线 PostgreSQL 迁移已在本轮复验。
  - 记录独立临时库 `storyforge_phase9_online_verify`。
  - 记录 `ALEMBIC_UPGRADE_EXIT=0`、`ALEMBIC_CURRENT_EXIT=0`、`TEMP_DB_DROP_EXIT=0`。
- `scripts/run-e2e.mjs`
  - 已将 `tests/test_alembic_heads.py` 纳入本地 `pnpm e2e` 的 API verification。
- 最新本地门禁证据：
  - `pnpm e2e` 已通过。
  - `pnpm verify` 已通过。
  - 在线 PostgreSQL 迁移已在本轮复验，临时库验证后已删除。

## 重跑前必须完成的本地检查

```powershell
cd D:/StoryForge
git status -sb
pnpm e2e
pnpm verify
```

重跑前必须确认：

- `git status -sb` 显示待提交内容中包含上述 Alembic merge revision、Alembic 预检测试、E2E workflow 预检步骤和本地 `pnpm e2e` 预检入口。
- 待提交内容包含在线 PostgreSQL 迁移复验证据：`storyforge_phase9_online_verify`、`ALEMBIC_UPGRADE_EXIT=0`、`ALEMBIC_CURRENT_EXIT=0`、`TEMP_DB_DROP_EXIT=0`。
- 不得直接重跑旧远端 `master`；旧远端 `master` 不包含本地未提交或未推送的修复。
- 只有包含本地修复的提交进入远端分支后，远端 E2E 重跑才有判定意义。

## 已执行的提交、推送与触发命令

本轮已完成远端快进和手动触发：

```powershell
git push origin origin/codex/phase9-e2e-alembic:master
gh workflow run E2E --ref master
gh run list --workflow E2E --limit 5
```

拿到新 run 后，必须确认：

- run 的分支为 `master`。
- run 的提交包含 `20260604_0001`。
- 日志中先执行 `uv run pytest tests/test_alembic_heads.py -q`。
- 随后 `uv run alembic upgrade head` 不再报 `Multiple head revisions`。
- 最终 `pnpm e2e` 成功完成。

## 禁止宣称范围

- 远端 E2E 已通过，证据为 `master` run `26944063055`。
- 真实 10 章 smoke 已完成最终验收。
- 真实 3-5 万字长程仍未完成。
- 本清单不得包含 `.env` 内容、provider 敏感令牌、用户私有 token-plan 令牌或任何外部 LLM 凭据。
