# 项目上下文摘要（Phase9 master 远端 E2E 合并）

生成时间：2026-06-04 17:39:05 +08:00

## 1. 相似实现分析

- **实现1**: `current-phase.md`
  - 模式：当前阶段唯一事实源，集中记录 Phase 9 已完成能力、未完成门禁和禁止宣称范围。
  - 可复用：继续以该文件作为 master 远端 E2E 状态变化的首要同步目标。
  - 需注意：真实 3-5 万字长程仍未完成，不能因 master E2E 通过而外推为生产级长篇闭环。
- **实现2**: `TODO.md`
  - 模式：只保留当前下一步执行入口，不承载完整项目总览。
  - 可复用：master 远端 E2E 通过后，将下一步入口移动到真实 3-5 万字长程运行。
  - 需注意：仍需保留远端 E2E run id、head sha 和关键步骤证据。
- **实现3**: `.codex/operations-log.md`
  - 模式：按任务追加上下文检索、编码前检查、验证命令和风险边界。
  - 可复用：本轮继续追加合并前检查、远端触发和观察结论。
  - 需注意：该文件已有历史长日志和未提交修改，本轮只追加，不回滚历史内容。
- **实现4**: `.codex/verification-report.md`
  - 模式：按任务生成评分、审查结论和可重复验证证据。
  - 可复用：master 远端 E2E 观察完成后追加本轮审查报告。
  - 需注意：若远端 E2E 失败，只记录失败证据，不宣称门禁关闭。

## 2. 项目约定

- **命名约定**：Python 测试使用 `snake_case`；Alembic revision 使用时间戳和语义名；文档标题使用中文任务名。
- **文件组织**：当前事实写入 `current-phase.md`；下一步写入 `TODO.md`；总览写入 `PROJECT_SUMMARY.md`；审计材料写入项目本地 `.codex/`。
- **导入顺序**：本轮不新增代码导入。
- **代码风格**：简体中文文档，UTF-8 文本，最小范围修改，不读取 `.env` 和 provider 凭据。

## 3. 可复用组件清单

- `.github/workflows/e2e.yml`：远端 E2E workflow，合并后以 `master` ref 触发。
- `scripts/run-e2e.mjs`：本地 `pnpm e2e` API verification 入口，已在修复分支纳入 Alembic head 预检。
- `apps/api/tests/test_alembic_heads.py`：Alembic 单 head 与离线 SQL smoke 守卫。
- `apps/api/tests/test_e2e_workflow_migration_gate.py`：远端 E2E 迁移预检顺序守卫。
- `apps/api/tests/test_phase9_fact_sources.py`：Phase 9 文档事实源一致性守卫。

## 4. 测试策略

- **测试框架**：API 使用 pytest 与 Ruff；仓库级 E2E 使用 `pnpm e2e`；远端验证使用 GitHub Actions `E2E`。
- **测试模式**：先复核提交边界和 `git diff --check`，再快进远端 `master`，触发 `master` E2E，最后运行事实源测试和目标静态检查。
- **参考文件**：`apps/api/tests/test_phase9_fact_sources.py`、`apps/api/tests/test_alembic_heads.py`、`.github/workflows/e2e.yml`。
- **覆盖要求**：远端 run 必须匹配 `master`、目标 head sha 和关键步骤；本地事实源同步必须通过 pytest、Ruff、py_compile 与目标 diff 检查。

## 5. 依赖和集成点

- **外部依赖**：GitHub Actions、GitHub CLI、远端 `origin/master` 与 `origin/codex/phase9-e2e-alembic`。
- **内部依赖**：Alembic 迁移图、E2E workflow、Phase 9 事实源文档。
- **集成方式**：通过非强制 `git push origin origin/codex/phase9-e2e-alembic:master` 快进远端 `master`；若被拒绝则停止并记录，改用 PR 路径。
- **配置来源**：本轮不读取 `.env`；真实 LLM provider 配置不参与 master E2E 合并验证。

## 6. 技术选型理由

- **为什么用这个方案**：主工作区 `master` 当前 dirty 且本地领先 `origin/master` 12 个提交；直接在主工作区合并会污染用户改动。远端审计已确认 `origin/master` 是修复分支祖先，适合非强制快进推送。
- **优势**：不触碰本地脏工作区；只移动远端引用；保留已验证修复分支的提交完整性。
- **劣势和风险**：若远端分支保护或新的远端提交出现，推送会失败；必须停止并改为 PR 或重新审计。

## 7. 关键风险点

- **并发问题**：合并前后若 `origin/master` 被他人推进，必须重新 fetch 与 merge-base 审计。
- **边界条件**：远端 E2E 失败时只记录失败，不更新为通过状态。
- **性能瓶颈**：远端 E2E 由 GitHub Actions 执行，耗时不可本地加速。
- **安全考虑**：不读取 `.env`、不输出 API key、provider URL 或 Authorization；候选提交敏感扫描不得命中真实凭据。

## 8. 合并前审计事实

- `origin/master`：`131c3eb9dff7767bf82a41780bd64ebd9aeaae69`。
- `origin/codex/phase9-e2e-alembic`：`590333f1ccc99234f4244bc7bf4556fd7dee3f4f`。
- 提交范围：`origin/master..origin/codex/phase9-e2e-alembic` 只有 1 个提交：`590333f 修复 Phase9 远端 E2E Alembic 迁移门禁`。
- 差异文件：`.github/workflows/e2e.yml`、两个既有 Alembic migration、`20260604_0001_merge_phase2_and_current_heads.py`、`tests/test_alembic_heads.py`、`tests/test_e2e_workflow_migration_gate.py`、`scripts/run-e2e.mjs`。
- 空白检查：`git diff --check origin/master..origin/codex/phase9-e2e-alembic` 通过。
- 工具限制：本轮没有可调用的 `desktop-commander`，已记录并使用 PowerShell、`rg`、GitHub CLI、sequential-thinking 与 shrimp-task-manager 替代。
