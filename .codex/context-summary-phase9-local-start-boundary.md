## 项目上下文摘要（Phase 9 local-start 本地验证手册同步）

生成时间：2026-06-04 07:20:43 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_phase9_fact_sources.py`
  - 模式：读取 Markdown 事实源并用普通 `assert` 锁定关键证据和禁止旧值。
  - 可复用：`Path.read_text(encoding="utf-8")`、中文测试 docstring、正向事实与负向旧值断言。
  - 需注意：本地启动手册是活文档，应纳入事实源漂移测试。
- **实现2**: `README.md`
  - 模式：提供当前本地验证入口、真实 LLM smoke 入口、远端 CI/E2E 状态和发布前门禁。
  - 可复用：`pnpm verify`、`pnpm e2e`、`pnpm test`、`pnpm openapi`，以及远端 `26915457170` 失败边界。
  - 需注意：不能把远端 CI 子集成功写成 E2E 成功。
- **实现3**: `TODO.md` 与 `PROJECT_SUMMARY.md`
  - 模式：入口文档记录当前 Phase 9 下一步优先级和剩余门禁。
  - 可复用：`20260604_0001`、`tests/test_alembic_heads.py`、真实 1 章/3 章 smoke、真实长程未完成。
  - 需注意：真实 LLM smoke 不能读取 `.env`，不能记录 provider token。

### 2. 项目约定

- **命名约定**: Python 测试常量使用大写 snake case，测试函数以 `test_` 开头。
- **文件组织**: 阶段事实源测试集中在 `apps/api/tests/test_phase9_fact_sources.py`。
- **导入顺序**: `from __future__ import annotations` 后空行，再导入标准库 `Path`。
- **代码风格**: 纯文本断言使用 pytest plain assert，文档和日志使用简体中文。

### 3. 可复用组件清单

- `docs/operations/local-start.md`: 本轮待同步的本地启动手册。
- `apps/api/tests/test_phase9_fact_sources.py`: 事实源漂移检测入口。
- `README.md`: 本地验证入口和远端门禁事实源。
- `current-phase.md`: 当前阶段与真实长程未完成事实源。
- `TODO.md`: 当前待办入口和下一步优先级事实源。
- `PROJECT_SUMMARY.md`: 项目高层验证状态事实源。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: TDD 红绿；先新增 local-start 事实源测试并观察红灯，再更新手册。
- **参考文件**: `apps/api/tests/test_phase9_fact_sources.py`。
- **覆盖要求**: 断言手册包含当前根路径、验证命令、远端 E2E 失败、Alembic 本地修复、真实 LLM smoke 安全边界和真实长程未完成；同时否定旧路径和旧 `pnpm run test:*` 命令。

### 5. 依赖和集成点

- **外部依赖**: 无新增依赖；Context7 查询确认 pytest 普通 `assert` 支持断言内省。
- **内部依赖**: local-start 依赖 README、current-phase、TODO 和 PROJECT_SUMMARY 的当前事实。
- **集成方式**: 通过 `uv run pytest tests/test_phase9_fact_sources.py -q` 纳入事实源验证。
- **配置来源**: 不读取 `.env`，不写入 provider token。

### 6. 技术选型理由

- **为什么用这个方案**: local-start 是使用者本地执行入口，文本守卫可防止旧路径和旧命令再次回流。
- **优势**: 改动小、可审计、直接改善后续本地验证和远端失败排查。
- **劣势和风险**: 旧归档文档仍含历史路径；本轮明确只治理活文档。

### 7. 关键风险点

- **并发问题**: 无运行时影响。
- **边界条件**: 不得把远端 E2E 或真实长程写成完成。
- **性能瓶颈**: 只读取 Markdown 文件，无性能风险。
- **安全考虑**: 本轮只处理脱敏事实，敏感扫描覆盖目标文件。
