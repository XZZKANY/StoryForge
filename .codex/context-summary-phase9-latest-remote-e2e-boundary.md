## 项目上下文摘要（Phase9 远端 E2E 最新失败事实源同步）

生成时间：2026-06-04 06:28:48 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_phase9_fact_sources.py`
  - 模式：使用 `Path.read_text(encoding="utf-8")` 读取 README/current-phase，并用 pytest plain assert 锁定阶段事实源。
  - 可复用：直接扩展 `test_phase9_remote_ci_e2e_boundary_is_not_overclaimed`。
  - 需注意：测试只锁定事实源，不代表远端 E2E 修复。
- **实现2**: `README.md`
  - 模式：面向公开读者说明当前状态、最近验证证据和发布前门禁。
  - 可复用：更新当前状态与最近验证证据中的最新 E2E run。
  - 需注意：必须保留“本地通过不等于远端 E2E 通过”的边界。
- **实现3**: `current-phase.md`
  - 模式：作为当前阶段事实源，集中列出已完成能力与仍未完成验收项。
  - 可复用：更新远端 E2E 最新失败 run，继续声明等待包含本地修复的远端 E2E 重新运行。
  - 需注意：不能把本地 Alembic merge 修复外推为远端已通过。
- **实现4**: `.codex/verification-report.md`
  - 模式：按任务追加需求、验证、评分和边界说明。
  - 可复用：本轮追加审查报告，避免改动历史噪音。
  - 需注意：只检查本轮新增段落和目标文件。

### 2. 项目约定

- **命名约定**: pytest 测试函数使用 `test_*`，文档任务名使用 “Phase9 远端 E2E 最新失败事实源同步”。
- **文件组织**: 阶段事实源由 README/current-phase 承载，契约测试放在 `apps/api/tests/test_phase9_fact_sources.py`。
- **导入顺序**: Python 测试保持 `from __future__`、标准库导入顺序。
- **代码风格**: 中文 docstring，pytest plain assert，UTF-8 文本读取。

### 3. 可复用组件清单

- `README.md`: 公开状态和最近验证证据。
- `current-phase.md`: 当前阶段事实源。
- `apps/api/tests/test_phase9_fact_sources.py`: 阶段事实源契约测试。
- `gh run list/view`: 远端 GitHub Actions 当前状态证据。

### 4. 测试策略

- **测试框架**: pytest 与 ruff。
- **测试模式**: 先改断言制造红灯，再更新文档转绿。
- **参考文件**: `apps/api/tests/test_phase9_fact_sources.py`。
- **覆盖要求**: README/current-phase 必须包含最新 E2E run `26915457170`、失败点、错误原因、本地 Alembic 预检和远端仍未完成边界。

### 5. 依赖和集成点

- **外部依赖**: GitHub Actions 查询使用 `gh run list` 与 `gh run view`。
- **内部依赖**: README/current-phase 与阶段事实源测试。
- **集成方式**: 文档契约测试防止事实源漂移。
- **配置来源**: 使用当前 shell 与 GitHub CLI；不读取 `.env`。

### 6. 技术选型理由

- **为什么用这个方案**: 远端 E2E 状态已经变化，事实源必须同步；现有文档契约测试正是防止能力边界夸大的入口。
- **优势**: 改动范围小、可本地验证、不会触发真实外部调用。
- **劣势和风险**: 只能同步远端失败事实，不能关闭远端 E2E 或真实长程验收。

### 7. 关键风险点

- **边界条件**: 最新远端 E2E run `26915457170` 仍失败，失败点仍为 `uv run alembic upgrade head` 的 `Multiple head revisions`。
- **安全考虑**: 不读取 `.env`；不记录外部 provider 地址、密钥、认证头或任何可还原凭据片段。
- **事实源风险**: 若本地修复提交后远端 E2E 状态再次变化，需要再次更新 run id 和结论。

### 8. 外部资料来源与用途

- GitHub CLI：`gh run list --workflow E2E`、`gh run view 26915457170 --log-failed`，用于确认最新远端 E2E run 和失败原因。
- GitHub CLI：`gh run list --workflow CI`，用于确认最新远端 CI run `26857864662` 仍成功。
- Context7 `/pytest-dev/pytest`：确认 pytest plain assert 是推荐的简单断言方式。
- GitHub search_code：检索开源文本事实源测试写法；最终采用本项目已有 `Path.read_text` + plain assert 模式。

### 9. 充分性检查

- 能定义清晰接口契约：是，README/current-phase 必须包含最新 E2E run、失败原因和未完成边界。
- 理解技术选型理由：是，复用现有文档契约测试，避免新增事实源层级。
- 识别主要风险点：是，远端 E2E 仍失败且本地修复未进入远端。
- 知道如何验证：是，运行定向 pytest、ruff、py_compile、diff check、敏感扫描和新增段落尾随空白检查。
