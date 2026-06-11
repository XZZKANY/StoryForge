## 项目上下文摘要（Phase9 远端 E2E 就绪清单纳入在线迁移证据）

生成时间：2026-06-04 09:33:37 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_phase9_fact_sources.py`
  - 模式：使用 `Path.read_text(encoding="utf-8")` 读取 Markdown，并用 pytest plain assert 锁定当前阶段事实。
  - 可复用：`test_remote_e2e_rerun_readiness_records_required_gate_evidence` 已负责守卫 `.codex/remote-e2e-rerun-readiness.md`。
  - 需注意：测试应只锁定已验证事实，不能把远端 E2E 写成通过。
- **实现2**: `.codex/remote-e2e-rerun-readiness.md`
  - 模式：列出最新远端失败、已有本地修复、重跑前检查、提交推送后的触发命令和禁止宣称范围。
  - 可复用：已有 workflow、merge revision、`tests/test_alembic_heads.py`、`scripts/run-e2e.mjs` 和本地 `pnpm e2e`/`pnpm verify` 证据结构。
  - 需注意：旧版本缺少在线 PostgreSQL 迁移复验退出码证据。
- **实现3**: `docs/operations/alembic-validation.md`
  - 模式：集中记录 Alembic 单 head、离线 SQL、在线 PostgreSQL 临时库和远端 E2E 边界。
  - 可复用：`storyforge_phase9_online_verify`、`ALEMBIC_UPGRADE_EXIT=0`、`ALEMBIC_CURRENT_EXIT=0`、`TEMP_DB_DROP_EXIT=0`。
  - 需注意：远端 E2E 仍必须等待包含本地修复的新 run。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 snake_case；Markdown 文件使用小写连字符。
- **文件组织**: Phase 9 文档事实源统一由 `apps/api/tests/test_phase9_fact_sources.py` 守卫；本地审计文件写入 `.codex/`。
- **导入顺序**: 本轮不新增导入。
- **代码风格**: pytest plain assert；文档和日志使用简体中文。

### 3. 可复用组件清单

- `test_remote_e2e_rerun_readiness_records_required_gate_evidence`: 远端 E2E 重跑清单事实源守卫。
- `.codex/remote-e2e-rerun-readiness.md`: 重跑前审计清单。
- `docs/operations/alembic-validation.md`: 在线迁移证据来源。

### 4. 测试策略

- **测试框架**: pytest、Ruff、Python `py_compile`、Git diff 空白检查。
- **测试模式**: 先扩展事实源断言并确认红灯，再更新清单后绿灯。
- **参考文件**: `apps/api/tests/test_phase9_fact_sources.py`。
- **覆盖要求**: 守卫在线迁移复验短语、临时库名、upgrade/current 退出码和临时库删除退出码。

### 5. 依赖和集成点

- **外部依赖**: 无新增外部依赖；本轮不启动 Docker，不触发远端 E2E。
- **内部依赖**: Alembic 在线迁移复验证据来自 `docs/operations/alembic-validation.md` 与上轮 `.codex` 审计记录。
- **集成方式**: 在远端 E2E 重跑清单中加入关键证据，供提交/推送前核对。
- **配置来源**: 不读取 `.env`，不写入 token-plan 令牌或 provider 凭据。

### 6. 技术选型理由

- **为什么用这个方案**: 远端 E2E 失败点是数据库迁移；将在线 PostgreSQL 迁移证据纳入重跑清单，可以防止只凭离线 SQL 或本地 verify 误判远端准备充分。
- **优势**: 小范围文档和测试守卫，不改变运行时代码，验证成本低。
- **劣势和风险**: 仍不能替代真正的远端 E2E；后续必须提交推送后触发新 run。

### 7. 关键风险点

- **并发问题**: 本轮不操作 Docker 容器和数据库，避免引入新的环境状态。
- **边界条件**: 清单必须写“远端 E2E 仍未完成”，不能写成远端通过。
- **性能瓶颈**: 文本测试开销极低。
- **安全考虑**: 令牌形态扫描必须为 0，不读取 `.env`。

### 8. 充分性检查

- 能定义接口契约：是。清单必须包含在线迁移复验短语、临时库名和三个退出码。
- 理解技术选型：是。复用既有事实源测试，不新增工具。
- 识别主要风险：是。远端 E2E、真实长程和人工通读仍未完成。
- 知道如何验证：是。目标 pytest、完整事实源、Ruff、py_compile、diff 和令牌扫描。
