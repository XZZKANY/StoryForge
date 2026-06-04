## 项目上下文摘要（Phase9 operations README 运维索引边界同步）

生成时间：2026-06-04 07:58:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_phase9_fact_sources.py:156`
  - 模式：用 `LOCAL_START_PATH.read_text(encoding="utf-8")` 读取运维文档，断言当前路径、验证命令、远端 E2E、Alembic 和真实长程边界。
  - 可复用：新增 `*_PATH` 常量后追加文档事实源测试。
  - 需注意：运维文档不得保留旧路径 `D:/StoryForge/1-renovel-ai-ai-rag-tavern`。
- **实现2**: `apps/api/tests/test_phase9_fact_sources.py:187`
  - 模式：用 `TROUBLESHOOTING_PATH` 约束故障手册必须包含远端 `E2E` run `26915457170`、`Multiple head revisions`、`20260604_0001` 和 `tests/test_alembic_heads.py`。
  - 可复用：当前运维索引应指向同一排障事实，防止入口页低估当前故障范围。
  - 需注意：只能写“远端 E2E 仍未完成”，不能写成远端 E2E 已通过。
- **实现3**: `apps/api/tests/test_phase9_fact_sources.py:89`
  - 模式：用事实源测试锁定项目总结中的当前阶段边界、本地验证入口和旧状态负向断言。
  - 可复用：正向断言当前事实，负向断言旧路径或旧阶段表述。
  - 需注意：测试只验证文档事实，不替代完整远端门禁。

### 2. 项目约定

- **命名约定**：路径常量使用全大写 `OPERATIONS_README_PATH`；测试函数使用 `test_operations_readme_records_current_phase9_runbook_index`。
- **文件组织**：Phase 9 文档事实源测试集中在 `apps/api/tests/test_phase9_fact_sources.py`；运维文档索引位于 `docs/operations/README.md`。
- **导入顺序**：不新增导入，保留 `from pathlib import Path`。
- **代码风格**：pytest plain assert；Markdown 使用简体中文、表格和 PowerShell 命令块。

### 3. 可复用组件清单

- `apps/api/tests/test_phase9_fact_sources.py`: 文档事实源守卫入口。
- `docs/operations/local-start.md`: 当前本地启动和验证命令事实来源。
- `docs/operations/troubleshooting.md`: 当前远端 E2E/Alembic 多 head 排障事实来源。
- `TODO.md`、`current-phase.md`、`README.md`、`PROJECT_SUMMARY.md`: 当前 Phase 9 总体边界事实来源。

### 4. 测试策略

- **测试框架**：pytest，经 `uv run pytest` 执行。
- **测试模式**：读取 Markdown 文本后用普通 assert 检查必含和禁含事实。
- **参考文件**：`apps/api/tests/test_phase9_fact_sources.py`。
- **覆盖要求**：运维索引必须包含当前更新时间、`D:/StoryForge`、`local-start.md`、`troubleshooting.md`、`pnpm verify`、`pnpm e2e`、远端 E2E run、失败时间、Alembic 多 head、本地 merge revision、预检测试、API verification、远端 E2E 仍未完成和真实长程未完成；不得包含旧路径。

### 5. 依赖和集成点

- **外部依赖**：pytest。Context7 `/pytest-dev/pytest` 文档确认普通 `assert` 支持断言 introspection，适合小型文档事实测试。
- **内部依赖**：只读 Markdown 文档，不调用应用运行时。
- **集成方式**：新增路径常量和测试，随后更新 `docs/operations/README.md`。
- **配置来源**：无运行时配置；不读取 `.env`，不记录 provider token 或其他真实密钥。

### 6. 技术选型理由

- **为什么用这个方案**：项目已用 `test_phase9_fact_sources.py` 管理 Phase 9 文档漂移；运维索引属于同类活跃入口，直接纳入同一测试文件最符合现有模式。
- **优势**：验证成本低、覆盖入口文档、能防止旧 2026-05-18 索引继续误导后续执行。
- **劣势和风险**：文档同步不能改变远端 Actions 状态；如果远端 E2E 后续重新跑通，测试和文档必须再次更新。

### 7. 关键风险点

- **并发问题**：无运行时并发；工作树已有大量未提交改动，本轮只触碰相关文件。
- **边界条件**：不得把 `CI` 子集成功写成 E2E 总门禁成功；不得把真实 1 章/3 章 smoke 写成真实 10 章或 3-5 万字长程完成。
- **性能瓶颈**：单个 Markdown 文本读取，开销可忽略。
- **安全考虑**：文档可说明不记录 provider 配置，但不得读取或输出真实凭据。

### 8. 充分性检查

- 能定义接口契约：是。输入为 `docs/operations/README.md` 文本，输出为 pytest 断言通过或失败。
- 理解技术选型理由：是。复用既有文档事实源测试入口和 pytest plain assert。
- 识别主要风险点：是。远端 E2E 未完成、旧运维索引误导、真实长程过度声明。
- 知道如何验证实现：是。先跑新增单测观察失败，再更新文档，最后跑 `uv run pytest tests/test_phase9_fact_sources.py -q`、Ruff、py_compile 和空白检查。

### 9. 外部检索记录

- Context7：查询 `/pytest-dev/pytest`，用途是确认 plain assert 的断言 introspection。
- GitHub search_code：搜索 `read_text(encoding="utf-8")` 与 pytest 断言模式，确认开源项目中同类文件内容断言常见。
- GitHub Actions：`gh run list --workflow E2E` 确认最新远端 E2E run `26915457170` 仍失败；`gh run list --workflow CI` 确认最新 CI run `26857864662` 成功。
- 工具降级：当前环境未暴露 `desktop-commander`，已使用 PowerShell、`rg`、Context7、GitHub search_code 与 GitHub CLI 替代并记录。
