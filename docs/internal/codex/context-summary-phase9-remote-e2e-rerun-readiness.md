## 项目上下文摘要（Phase9 远端 E2E 重跑就绪清单）

生成时间：2026-06-04 08:28:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_phase9_fact_sources.py`
  - 模式：用 pytest 读取 Markdown 事实源，使用 plain assert 锁定关键事实与禁止过度宣称。
  - 可复用：`Path.read_text(encoding="utf-8")`、仓库根路径常量、阶段事实源断言。
  - 需注意：新增断言必须区分远端 E2E 未完成与本地修复已完成，避免把准备状态写成通过状态。
- **实现2**: `docs/operations/troubleshooting.md`
  - 模式：按故障现象、快速确认、修复边界和后续动作组织远端 E2E 排障说明。
  - 可复用：最新 run `26915457170`、失败时间 `2026-06-03T21:55:39Z`、Alembic `Multiple head revisions`、`gh run view` 命令。
  - 需注意：故障手册是排障入口，本轮清单应聚焦提交/推送后的重跑就绪核对。
- **实现3**: `.github/workflows/e2e.yml`
  - 模式：E2E workflow 同时包含 `workflow_dispatch` 与 `schedule`，并在在线迁移前执行 Alembic 预检。
  - 可复用：`workflow_dispatch` 手动触发入口、`uv run pytest tests/test_alembic_heads.py -q` 预检步骤。
  - 需注意：远端 workflow 只能验证远端分支内容；本地未提交或未推送的修复不能被远端 run 覆盖。
- **实现4**: `scripts/run-e2e.mjs`
  - 模式：本地 `pnpm e2e` 的 API verification 目标列表集中维护。
  - 可复用：`tests/test_alembic_heads.py` 已加入 API verification 首位，用于本地提前发现迁移图问题。
  - 需注意：本地通过是远端重跑前置证据，不等于远端通过。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_` 前缀与 snake_case；Markdown 文件名使用小写连字符。
- **文件组织**: 阶段事实源守卫位于 `apps/api/tests/test_phase9_fact_sources.py`；本轮工作文档写入项目本地 `.codex/`。
- **导入顺序**: Python 文件保持 `from __future__ import annotations`、标准库导入、路径常量。
- **代码风格**: pytest plain assert；文档与注释均使用简体中文；凭据、`.env` 和 provider 敏感令牌不写入文档。

### 3. 可复用组件清单

- `apps/api/tests/test_phase9_fact_sources.py`: 阶段事实源契约测试入口。
- `.github/workflows/e2e.yml`: 远端 E2E 工作流，已有 `workflow_dispatch` 与 Alembic 预检步骤。
- `apps/api/tests/test_alembic_heads.py`: Alembic 单 head 与离线 SQL smoke 预检。
- `scripts/run-e2e.mjs`: 本地 `pnpm e2e` API verification 目标列表。
- `docs/operations/troubleshooting.md`: 远端 E2E 失败排障命令与边界。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 文档契约测试；先新增断言并确认清单缺失导致红灯，再创建清单绿灯。
- **参考文件**: `apps/api/tests/test_phase9_fact_sources.py`。
- **覆盖要求**: 断言重跑清单包含失败 run、失败原因、本地修复文件、手动触发入口、提交/推送后重跑命令、禁止直接重跑旧远端分支、远端 E2E 未完成和真实长程未完成边界。

### 5. 依赖和集成点

- **外部依赖**: GitHub Actions、GitHub CLI。
- **内部依赖**: Alembic migrations、API pytest、根级 `pnpm e2e`。
- **集成方式**: 新增 `.codex/remote-e2e-rerun-readiness.md` 作为重跑前审计清单，由 `test_phase9_fact_sources.py` 读取守卫。
- **配置来源**: 不读取 `.env`；不记录用户提供的 token-plan 令牌；外部 token-plan 当前返回 404，仅作为暂不可读计划源记录。

### 6. 技术选型理由

- **为什么用这个方案**: 当前缺口不是 workflow 入口缺失，而是缺少提交/推送前的机器可守卫重跑清单；复用现有事实源测试可防止后续误删或误写边界。
- **优势**: 低风险、可自动验证、不会触发远端旧状态失败、不泄露敏感配置。
- **劣势和风险**: 该清单只能推进远端重跑准备，不能替代实际提交、推送和远端 E2E 通过证据。

### 7. 关键风险点

- **并发问题**: 远端 schedule 可能在本地修复推送前再次失败；清单必须要求确认 run 包含修复后的提交。
- **边界条件**: 本地 `master` ahead 且有未提交文件时，直接重跑远端默认分支不能验证本地修复。
- **性能瓶颈**: 新增测试只读取文本文件，无明显性能影响。
- **安全考虑**: 不读取 `.env`，不落盘 provider 敏感令牌，不把 token-plan 令牌写入文档。
