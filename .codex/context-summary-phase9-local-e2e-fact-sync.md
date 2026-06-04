## 项目上下文摘要（Phase9 本地 E2E 事实源同步）

生成时间：2026-06-04 07:18:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_phase9_fact_sources.py`
  - 模式：用 `Path.read_text(encoding="utf-8")` 读取 `.dev_plan.md`、`README.md` 和 `current-phase.md`，通过 pytest 普通 `assert` 锁定阶段事实源。
  - 可复用：直接扩展 `test_phase9_remote_ci_e2e_boundary_is_not_overclaimed`。
  - 需注意：该测试用于防止事实源夸大能力，不能替代远端 E2E。
- **实现2**: `README.md`
  - 模式：在“当前状态”和“最近验证证据”中说明远端 CI/E2E、真实 LLM smoke 和发布前门禁边界。
  - 可复用：继续在相关段落补充本地 `pnpm e2e` Alembic 预检事实。
  - 需注意：必须保留远端 E2E 尚未重新跑通的边界。
- **实现3**: `current-phase.md`
  - 模式：作为当前阶段事实源，列出已完成能力和未完成验收项。
  - 可复用：在远端 GitHub Actions 未完成项下补充本地预检进展。
  - 需注意：不能把本地预检写成远端通过。
- **实现4**: `scripts/run-e2e.mjs`
  - 模式：`httpPytestTargets` 已纳入 `tests/test_alembic_heads.py`。
  - 可复用：作为本轮事实源更新的代码证据。
  - 需注意：本地 runner 改动尚未证明远端 master E2E 已通过。

### 2. 项目约定

- **命名约定**: pytest 函数使用 `test_*`；文档段落使用简体中文和明确边界。
- **文件组织**: Phase9 事实源测试留在 `apps/api/tests/`；上下文和验证记录写入项目本地 `.codex/`。
- **导入顺序**: Python 测试保持 `from __future__ import annotations`、标准库导入、常量声明。
- **代码风格**: pytest 使用普通 `assert`；文档不写入敏感凭据或外部 provider 配置。

### 3. 可复用组件清单

- `apps/api/tests/test_phase9_fact_sources.py`: 本轮 TDD 入口。
- `README.md`: 面向公开读者的状态说明。
- `current-phase.md`: 当前阶段事实源。
- `scripts/run-e2e.mjs`: 本地 E2E Alembic 预检已补齐的代码证据。
- `.github/workflows/e2e.yml`: 本地 workflow 预检已补齐，但远端线上 workflow 仍需后续推送后验证。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 先扩展 `test_phase9_fact_sources.py` 并确认红灯，再更新 README/current-phase 达成绿灯。
- **参考文件**: `apps/api/tests/test_e2e_workflow_migration_gate.py`、`apps/api/tests/test_alembic_heads.py`、`tests/e2e/phase5-runtime-diagnostics.spec.ts`。
- **覆盖要求**: README/current-phase 必须同时说明本地 `pnpm e2e` 已纳入 Alembic 预检和远端 E2E 仍未重新跑通。

### 5. 依赖和集成点

- **外部依赖**: pytest；Context7 查询确认 pytest 支持普通 `assert` 并提供断言内省。
- **内部依赖**: `README.md`、`current-phase.md`、`test_phase9_fact_sources.py`。
- **集成方式**: 只更新事实源和契约测试，不改变运行时代码。
- **配置来源**: GitHub Actions 最新状态通过 `gh run list` 与 `gh workflow view` 复核；远端 E2E 最新仍为旧失败 run。

### 6. 技术选型理由

- **为什么用这个方案**: 当前缺口是事实源滞后，不是运行时代码缺陷；扩展既有事实源测试能防止后续文档再次漂移。
- **优势**: 改动小、可验证、与现有阶段治理模式一致。
- **劣势和风险**: 文档同步只能提升可审计性，不能替代远端 E2E 或真实长程验收。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 远端 master 尚未包含本地修复时，不应触发远端 E2E 并误读结果。
- **性能瓶颈**: 无性能影响。
- **安全考虑**: 不读取 `.env`；不记录外部 provider 地址、密钥、认证头或任何可还原凭据片段。
