## 项目上下文摘要（Phase9 远端 E2E 重跑提交）

生成时间：2026-06-04 16:18:43 +08:00

### 1. 相似实现分析

- **实现1**: `current-phase.md`
  - 模式：当前阶段唯一事实源，先记录远端 E2E 失败事实，再记录本地补救证据。
  - 可复用：远端 run id、失败时间、失败步骤、未完成边界写法。
  - 需注意：远端 E2E 未通过前，不得宣称远端 CI/E2E 总门禁完成。
- **实现2**: `TODO.md`
  - 模式：只保留下一步执行入口，当前最高优先级是重新运行远端 E2E。
  - 可复用：下一步优先级和本地验证入口。
  - 需注意：真实 3-5 万字长程必须排在远端 E2E 重新确认之后。
- **实现3**: `apps/api/tests/test_alembic_heads.py`
  - 模式：使用 `ScriptDirectory.from_config(...).get_heads()` 守卫 Alembic 单 head，并用 `alembic upgrade head --sql` 做无数据库补偿验证。
  - 可复用：单 head 断言、离线 SQL 退出码断言、在线/离线 helper 边界测试。
  - 需注意：该文件目前未跟踪，若远端 workflow 引用它，必须纳入最小提交。
- **实现4**: `.github/workflows/e2e.yml`
  - 模式：在 `uv run alembic upgrade head` 前增加 Alembic 迁移预检。
  - 可复用：`workflow_dispatch` 和 `执行 Alembic 迁移预检` 步骤。
  - 需注意：远端 run 必须确认 head sha 已包含本地修复。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `snake_case`，Alembic revision 使用时间戳和语义名。
- **文件组织**: 迁移脚本位于 `apps/api/alembic/versions/`，API 测试位于 `apps/api/tests/`，E2E workflow 位于 `.github/workflows/e2e.yml`。
- **导入顺序**: Python 文件保持 `from __future__`、标准库、第三方库、本地对象的顺序；现有 Ruff 配置忽略 E501。
- **代码风格**: pytest 使用 plain assert，Markdown 和日志全部使用简体中文。

### 3. 可复用组件清单

- `apps/api/tests/test_alembic_heads.py`: Alembic 单 head 与离线 SQL smoke 门禁。
- `apps/api/tests/test_e2e_workflow_migration_gate.py`: 远端 E2E workflow 必须先跑 Alembic 预检的守卫。
- `scripts/run-e2e.mjs`: 本地 `pnpm e2e` 的 API verification 目标列表。
- `.github/workflows/e2e.yml`: 远端 E2E 执行入口。
- `docs/operations/alembic-validation.md`: 在线 PostgreSQL 迁移复验证据来源。

### 4. 测试策略

- **测试框架**: pytest、Ruff、Python 编译检查、`git diff --check`。
- **测试模式**: 先跑目标迁移门禁，再按需跑完整 API pytest 或 `pnpm e2e`。
- **参考文件**: `apps/api/tests/test_alembic_heads.py`、`apps/api/tests/test_e2e_workflow_migration_gate.py`。
- **覆盖要求**: 覆盖 Alembic 单 head、离线 SQL、在线 helper 判断、workflow 预检顺序和候选文件空白检查。

### 5. 依赖和集成点

- **外部依赖**: Alembic、SQLAlchemy、pytest、GitHub Actions。
- **内部依赖**: `apps/api/alembic.ini`、`apps/api/alembic/env.py`、`apps/api/alembic/versions/`。
- **集成方式**: 远端 E2E 在数据库迁移前运行 `uv run pytest tests/test_alembic_heads.py -q`，随后运行 `uv run alembic upgrade head`。
- **配置来源**: 远端 workflow 使用 GitHub Actions service postgres 和 `DATABASE_URL` 环境变量；本轮不读取 `.env`。

### 6. 技术选型理由

- **为什么用这个方案**: Alembic 官方文档说明多 head 下 `alembic upgrade head` 会失败，创建 merge revision 后 `upgrade head` 会应用 mergepoint 并恢复单一 head。
- **优势**: 不新增迁移框架，沿用 Alembic 官方机制和现有 GitHub Actions 工作流。
- **劣势和风险**: 当前主工作区 `master` 本地领先 `origin/master` 12 个提交，直接推送会把仓库瘦身历史一起带入远端；应从 `origin/master` 创建隔离分支承载最小 Alembic 修复。

### 7. 关键风险点

- **远端状态**: 最新远端 `E2E` run `26915457170`，时间 `2026-06-03T21:55:39Z`，head sha `131c3eb9dff7767bf82a41780bd64ebd9aeaae69`，失败于 `uv run alembic upgrade head` 的 `Multiple head revisions`。
- **本地分支状态**: 当前 `master` 为 `18d2f9a10731e0b0ca33aba5b72e70fb6bb59e5a`，领先 `origin/master` 12 个提交；`origin/master` 为 `131c3eb9dff7767bf82a41780bd64ebd9aeaae69`。
- **最小提交候选**: `.github/workflows/e2e.yml`、`scripts/run-e2e.mjs`、`apps/api/alembic/versions/20260514_phase2_创建_phase_2_领域模型.py`、`apps/api/alembic/versions/20260528_0001_backfill_current_orm_schema.py`、`apps/api/alembic/versions/20260604_0001_merge_phase2_and_current_heads.py`、`apps/api/tests/test_alembic_heads.py`、`apps/api/tests/test_e2e_workflow_migration_gate.py`。
- **明确排除项**: `.codex/real-llm-*` 真实运行产物、UI 截图、浏览器 profile/cache、临时日志、引用本地 `.codex` 证据目录的 `apps/api/tests/test_phase9_fact_sources.py`。
- **外部参考**: Context7 查询 Alembic 官方文档，确认多 head 会导致 `upgrade head` 失败，merge revision 后可恢复 `upgrade head`；GitHub `search_code` 查询到 MLflow、Airflow 等项目使用 Alembic script directory/head 检查作为迁移治理参考。

### 8. 上下文充分性检查

- 能说出至少 3 个相似实现：是，见 `current-phase.md`、`TODO.md`、`apps/api/tests/test_alembic_heads.py`、`.github/workflows/e2e.yml`。
- 理解项目实现模式：是，远端 E2E 通过 GitHub Actions 调用 `uv run alembic upgrade head` 和 `pnpm e2e`，本地通过 pytest 预检迁移图。
- 知道可复用组件：是，复用 Alembic、pytest、`scripts/run-e2e.mjs` 和 `.github/workflows/e2e.yml`。
- 理解命名和风格：是，Python snake_case、plain assert、简体中文文档与注释。
- 知道如何测试：是，运行目标 pytest、Ruff、py_compile、diff 空白检查，并在隔离分支上触发远端 E2E。
- 确认不重复造轮子：是，使用 Alembic 官方 merge revision，不新增自研迁移分支处理器。
- 理解依赖和集成点：是，关键集成点为 GitHub Actions E2E 的迁移预检和在线 `alembic upgrade head`。
