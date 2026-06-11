## 项目上下文摘要（Phase 9 TODO 边界同步）

生成时间：2026-06-04 07:10:13 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_phase9_fact_sources.py`
  - 模式：读取 Markdown 事实源并用普通 `assert` 锁定关键证据和禁止旧值。
  - 可复用：`Path.read_text(encoding="utf-8")`、中文测试 docstring、正向事实与负向旧值断言。
  - 需注意：TODO 只作为当前执行入口，不替代 `.dev_plan.md` 的总计划定义。
- **实现2**: `current-phase.md`
  - 模式：记录当前 Phase 9 状态、真实 LLM smoke 证据和仍未完成门禁。
  - 可复用：真实 1 章/3 章 smoke 证据、远端 CI/E2E 未完成、真实长程未完成。
  - 需注意：3 章 smoke 不能外推为真实 10 章或 3-5 万字长程完成。
- **实现3**: `README.md` 与 `PROJECT_SUMMARY.md`
  - 模式：面向入口读者区分本地通过、远端 CI 子集通过、远端 E2E 未完成。
  - 可复用：`26857864662`、`26915457170`、`Multiple head revisions`、`20260604_0001`、`tests/test_alembic_heads.py`。
  - 需注意：远端 E2E 必须等待包含本地修复后的 run 通过。

### 2. 项目约定

- **命名约定**: Python 测试常量使用大写 snake case，测试函数以 `test_` 开头。
- **文件组织**: 阶段事实源测试集中在 `apps/api/tests/test_phase9_fact_sources.py`。
- **导入顺序**: `from __future__ import annotations` 后空行，再导入标准库 `Path`。
- **代码风格**: 纯文本断言使用 pytest plain assert，文档和日志使用简体中文。

### 3. 可复用组件清单

- `apps/api/tests/test_phase9_fact_sources.py`: 事实源漂移检测入口。
- `TODO.md`: 本轮待同步的当前执行入口。
- `README.md`: 当前远端 CI/E2E 与本地修复事实源。
- `current-phase.md`: 当前阶段和真实 LLM 边界事实源。
- `.dev_plan.md`: Phase 9 总计划和完成判定事实源。
- `PROJECT_SUMMARY.md`: 项目高层状态摘要事实源。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: TDD 红绿；先新增 TODO 事实源测试并观察红灯，再更新 TODO。
- **参考文件**: `apps/api/tests/test_phase9_fact_sources.py`。
- **覆盖要求**: 断言 TODO 包含当前 Phase 9 状态、远端 run、Alembic 本地修复、真实 LLM smoke、真实长程未完成和下一步优先级；同时否定旧 Phase 7 记录和旧验证命令。

### 5. 依赖和集成点

- **外部依赖**: 无新增依赖；Context7 查询确认 pytest 普通 `assert` 支持断言内省。
- **内部依赖**: TODO 依赖 README、current-phase、.dev_plan 和 PROJECT_SUMMARY 的当前事实。
- **集成方式**: 通过 `uv run pytest tests/test_phase9_fact_sources.py -q` 纳入事实源验证。
- **配置来源**: 不读取 `.env`，不写入 provider token。

### 6. 技术选型理由

- **为什么用这个方案**: TODO 是入口级事实源，文本守卫足以防止旧阶段和旧命令再次回流。
- **优势**: 改动小、可审计、能直接减少后续执行误判。
- **劣势和风险**: 字符串断言依赖关键表达稳定；因此只锁定完成审计和下一步执行所需事实。

### 7. 关键风险点

- **并发问题**: 无运行时影响。
- **边界条件**: 不得把远端 E2E 或真实长程写成完成。
- **性能瓶颈**: 只读取 Markdown 文件，无性能风险。
- **安全考虑**: 本轮只处理脱敏事实，敏感扫描覆盖目标文件。
