## 项目上下文摘要（Phase9 本地 E2E Alembic 预检）

生成时间：2026-06-04 06:42:00 +08:00

### 1. 相似实现分析

- **实现1**: `tests/e2e/phase5-runtime-diagnostics.spec.ts`
  - 模式：Node `node:test` + `node:assert/strict` 读取源码并断言门禁目标。
  - 可复用：`assertSourceEvidence(source, markers)` 的源码证据契约思路。
  - 需注意：该测试只证明脚本声明了目标，不替代真实 `pnpm e2e` 全量运行。
- **实现2**: `apps/web/tests/phase1-navigation.test.tsx`
  - 模式：读取 `scripts/run-e2e.mjs` 和 `scripts/verify-ci.mjs`，用字符串契约防止验证脚本漂移。
  - 可复用：`read(path)` helper 与明确中文断言信息。
  - 需注意：Web 测试需要 TSX 编译链；本轮更适合放在顶层 `tests/e2e` 的 Node 契约测试中。
- **实现3**: `apps/api/tests/test_e2e_workflow_migration_gate.py`
  - 模式：读取 workflow 文件，断言 Alembic 预检步骤存在且先于在线迁移。
  - 可复用：迁移预检目标 `tests/test_alembic_heads.py` 和顺序约束表达。
  - 需注意：它覆盖远端 workflow，不覆盖本地 `scripts/run-e2e.mjs`。
- **实现4**: `scripts/verify-ci.mjs`
  - 模式：根级 CI 核心门禁执行 `uv run pytest`，工作目录为 `apps/api`。
  - 可复用：无需改动，已覆盖全量 API pytest。
  - 需注意：`verify:ci` 与 `pnpm e2e` 职责不同，后者使用精选 API pytest 目标。

### 2. 项目约定

- **命名约定**: Node 契约测试使用 `test('中文行为描述', () => ...)`；Python 测试使用 `test_*`。
- **文件组织**: 顶层 `tests/e2e/` 放阶段契约与脚本门禁证据；`apps/api/tests/` 放 API 与迁移测试。
- **导入顺序**: Node 测试先导入 `node:test`、`node:assert/strict`、`node:fs` 等内置模块。
- **代码风格**: 简体中文断言消息；不新增自研 runner；通过字符串契约锁定发布门禁目标。

### 3. 可复用组件清单

- `scripts/run-e2e.mjs`: 本地 `pnpm e2e` runner，`httpPytestTargets` 控制 API verification pytest 目标。
- `apps/api/tests/test_alembic_heads.py`: Alembic 单 head 与离线 SQL smoke，是本轮应纳入本地 e2e 的预检。
- `scripts/verify-ci.mjs`: CI 核心门禁已全量运行 API pytest，作为“无需修改 CI”的证据。
- `.github/workflows/e2e.yml`: 远端 E2E 已接入 Alembic 预检，作为本地对齐目标。

### 4. 测试策略

- **测试框架**: Node.js 内置 `node:test` 与 Python `pytest`。
- **测试模式**: 先新增源码契约测试并确认红灯，再修改 `scripts/run-e2e.mjs` 目标数组达成绿灯。
- **参考文件**: `tests/e2e/phase5-runtime-diagnostics.spec.ts`、`apps/web/tests/phase1-navigation.test.tsx`、`apps/api/tests/test_e2e_workflow_migration_gate.py`。
- **覆盖要求**: 契约测试覆盖本地 e2e API verification 目标；API pytest 覆盖 Alembic heads、远端 workflow 预检和 Phase9 事实边界。

### 5. 依赖和集成点

- **外部依赖**: Node.js 官方 `node:test` 与 `node:assert/strict`；Context7 查询确认 `node --test` 可指定测试文件。
- **内部依赖**: `run-e2e.mjs` 调用 `runApiVerification()`，该函数执行 `python -m pytest ...httpPytestTargets -q`。
- **集成方式**: 仅向 `httpPytestTargets` 增加 `tests/test_alembic_heads.py`，不改变 OpenAPI 刷新、契约测试或 workflow verification。
- **配置来源**: `package.json` 的 `e2e` 指向 `node scripts/run-e2e.mjs`；`verify:ci` 指向 `node scripts/verify-ci.mjs`。

### 6. 技术选型理由

- **为什么用这个方案**: 本地 e2e 已有精选 API pytest 清单，补入现有 Alembic smoke 是最小一致性改动。
- **优势**: 无新增依赖；能在本地 `pnpm e2e` API verification 阶段提前发现 Alembic 多 head 或离线 SQL 失败。
- **劣势和风险**: 源码契约不等同全量远端 E2E 成功；仍需远端 workflow 重新运行确认在线 PostgreSQL 迁移。

### 7. 关键风险点

- **并发问题**: 无并发运行时改动。
- **边界条件**: 本机 Docker daemon 不可用时，离线 SQL smoke 仍可提供补偿验证，但不能替代在线迁移。
- **性能瓶颈**: `test_alembic_heads.py` 轻量，增加的本地 e2e 时间可接受。
- **安全考虑**: 不读取 `.env`；不记录外部 provider 地址、密钥、认证头或任何可还原凭据片段。
