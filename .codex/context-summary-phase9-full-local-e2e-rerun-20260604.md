## 项目上下文摘要（Phase9 完整本地 e2e 复验）

生成时间：2026-06-04 08:18:00 +08:00

### 1. 相似实现分析

- **实现1**: `scripts/run-e2e.mjs`
  - 模式：根级 `pnpm e2e` 入口会依次执行 OpenAPI refresh、OpenAPI drift check、Node 契约测试、API verification 和 workflow verification。
  - 可复用：直接运行 `pnpm e2e`，不绕过任何阶段。
  - 需注意：API verification 目标列表包含 `tests/test_alembic_heads.py`，可验证 Alembic 单 head 与离线 SQL smoke。
- **实现2**: `.codex/verification-report.md`
  - 模式：每轮验证报告记录红绿过程、命令、结果、评分和未完成边界。
  - 可复用：本轮只追加完整本地 E2E 复验结果，不覆盖历史报告。
  - 需注意：本地通过不代表远端 E2E 通过。
- **实现3**: `docs/operations/local-start.md`
  - 模式：本地启动手册把 `pnpm e2e` 定义为当前本地端到端契约门禁，并说明 API verification 已纳入 `tests/test_alembic_heads.py`。
  - 可复用：验证命令和边界描述按该手册执行。
  - 需注意：不得读取 `.env` 或输出 provider token。

### 2. 项目约定

- **命名约定**：验证记录使用 `Phase9 完整本地 e2e 复验` 作为标题。
- **文件组织**：上下文、操作日志和验证报告写入项目本地 `.codex/`。
- **导入顺序**：本轮不修改代码导入。
- **代码风格**：本轮不改业务代码；记录使用简体中文。

### 3. 可复用组件清单

- `package.json`: `e2e` 脚本定义为 `node scripts/run-e2e.mjs`。
- `scripts/run-e2e.mjs`: 本地 E2E 编排入口。
- `tests/test_alembic_heads.py`: Alembic 单 head 与离线 SQL smoke 预检。
- `.codex/verification-report.md`: 验证报告事实源。
- `.codex/operations-log.md`: 操作日志事实源。

### 4. 测试策略

- **测试框架**：Node 内置 test runner、pytest、项目自定义 OpenAPI refresh/drift 检查。
- **测试模式**：运行完整 `pnpm e2e`，读取退出码和输出。
- **参考文件**：`scripts/run-e2e.mjs`。
- **覆盖要求**：OpenAPI refresh/drift、Node 契约、API verification、workflow verification 均需通过才可记录为完整本地 E2E 通过。

### 5. 依赖和集成点

- **外部依赖**：pnpm、Node.js、uv/Python。
- **内部依赖**：`apps/api`、`apps/workflow`、`tests/e2e`、`packages/shared/src/contracts/storyforge.openapi.json`。
- **集成方式**：只运行现有脚本，不新增脚本或业务代码。
- **配置来源**：不读取 `.env`；当前验证只覆盖本地 deterministic/mock/测试夹具路径。

### 6. 技术选型理由

- **为什么用这个方案**：总计划下一步要求远端 E2E 重新跑通，但当前本地修复尚未形成本轮完整 E2E 证据；先跑本地 `pnpm e2e` 是提交和远端重跑前的必要证据。
- **优势**：直接覆盖当前工作树最关键发布门禁，能发现 Alembic/OpenAPI/API/workflow 的真实阻塞。
- **劣势和风险**：本地通过不等于远端通过；如果本地环境工具缺失，需记录为环境阻塞。

### 7. 关键风险点

- **并发问题**：无业务并发改动；验证期间不启动真实外部 LLM。
- **边界条件**：不得将本地 `pnpm e2e` 通过写成远端 E2E 完成；不得将真实 1 章/3 章 smoke 写成真实长程完成。
- **性能瓶颈**：完整 E2E 会运行多组测试，耗时高于单元测试但仍是当前门禁必要成本。
- **安全考虑**：不读取 `.env`，不输出 provider token、API key、secret 或 password。

### 8. 当前状态证据

- `gh run list --repo XZZKANY/StoryForge --workflow E2E --limit 3`: 最新远端 `E2E` run `26915457170` 仍为 failure。
- `gh run list --repo XZZKANY/StoryForge --workflow CI --limit 3`: 最新远端 `CI` run `26857864662` 为 success。
- `TODO.md`: 下一步优先级仍是重新运行远端 E2E；远端 E2E、真实长程和长程人工通读仍未完成。
