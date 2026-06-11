## 项目上下文摘要（Phase9 verify 405 计数事实源同步）

生成时间：2026-06-04 08:12:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_phase9_fact_sources.py:89`
  - 模式：读取 `PROJECT_SUMMARY.md`，断言本地 `pnpm verify`、`pnpm e2e` 计数和远端边界。
  - 可复用：把 `API 399 passed` 更新为 `API 405 passed`，并加旧计数负向断言。
  - 需注意：只同步当前事实源，不修改历史验证报告中的旧过程记录。
- **实现2**: `apps/api/tests/test_phase9_fact_sources.py:156`
  - 模式：读取 `docs/operations/local-start.md`，断言本地验证命令、远端 E2E、真实长程未完成和安全边界。
  - 可复用：为 local-start 增加 `API 405 passed` 和旧 `API 399 passed` 负向断言。
  - 需注意：本地启动手册是活文档，应反映最新完整 `pnpm verify` 结果。
- **实现3**: `.codex/verification-report.md`
  - 模式：最近一轮 `Phase9 完整本地 verify 复验` 记录 `pnpm verify` 退出码 0，Web 209 passed、API 405 passed、Workflow 164 passed。
  - 可复用：作为本轮文档更新的事实来源。
  - 需注意：该记录不代表远端 E2E 或真实长程完成。

### 2. 项目约定

- **命名约定**：测试函数沿用现有名称，不新增测试文件。
- **文件组织**：Phase 9 文档事实源测试集中在 `apps/api/tests/test_phase9_fact_sources.py`；活文档同步到 `PROJECT_SUMMARY.md` 与 `docs/operations/local-start.md`。
- **导入顺序**：不新增导入。
- **代码风格**：pytest plain assert；文档使用简体中文 Markdown。

### 3. 可复用组件清单

- `apps/api/tests/test_phase9_fact_sources.py`: 文档事实源测试入口。
- `.codex/verification-report.md`: 最新 `pnpm verify` 证据源。
- `.codex/operations-log.md`: 操作过程证据源。
- `PROJECT_SUMMARY.md`: 当前项目总结活文档。
- `docs/operations/local-start.md`: 当前本地启动与验证手册。

### 4. 测试策略

- **测试框架**：pytest，经 `uv run pytest` 执行。
- **测试模式**：读取 Markdown 文本后用普通 assert 检查必含和禁含事实。
- **参考文件**：`apps/api/tests/test_phase9_fact_sources.py`。
- **覆盖要求**：PROJECT_SUMMARY 和 local-start 必须包含 `API 405 passed`，不得继续包含 `API 399 passed`；同时保留远端 E2E、真实长程和长程人工通读未完成边界。

### 5. 依赖和集成点

- **外部依赖**：pytest。Context7 `/pytest-dev/pytest` 文档确认普通 `assert` 支持断言 introspection。
- **内部依赖**：只读 Markdown 文档，不调用应用运行时。
- **集成方式**：先更新测试，再同步文档。
- **配置来源**：无运行时配置；不读取 `.env`，不记录 provider token 或真实密钥。

### 6. 技术选型理由

- **为什么用这个方案**：最新 `pnpm verify` 让 API 测试计数从 399 增至 405；活文档若继续写 399，会误导提交前状态判断。
- **优势**：用事实源测试防止本地门禁证据再次漂移。
- **劣势和风险**：测试计数会随新增测试变化，后续新增 API 测试后需同步更新。

### 7. 关键风险点

- **并发问题**：无运行时并发；只改文档和事实源测试。
- **边界条件**：不得把本地 verify 通过写成远端 E2E 通过；不得把 smoke 证据写成真实长程完成。
- **性能瓶颈**：单个 Markdown 文本读取，开销可忽略。
- **安全考虑**：不读取 `.env` 或真实凭据。

### 8. 充分性检查

- 能定义接口契约：是。输入为 `PROJECT_SUMMARY.md` 与 `docs/operations/local-start.md` 文本，输出为 pytest 断言结果。
- 理解技术选型理由：是。复用既有文档事实源测试入口。
- 识别主要风险点：是。本地计数漂移、远端 E2E 过度声明、真实长程过度声明。
- 知道如何验证实现：是。先跑目标测试观察红灯，再更新文档，最后跑 `uv run pytest tests/test_phase9_fact_sources.py -q`、Ruff、py_compile 和空白检查。

### 9. 外部检索记录

- Context7：查询 `/pytest-dev/pytest`，用途是确认 plain assert 的断言 introspection。
- GitHub search_code：搜索 `read_text(encoding="utf-8")` 与 pytest 断言模式，确认开源项目中同类文件内容断言常见。
- 工具降级：当前环境未暴露 `desktop-commander`，已使用 PowerShell、`rg`、Context7、GitHub search_code 与本地 pytest 替代并记录。
