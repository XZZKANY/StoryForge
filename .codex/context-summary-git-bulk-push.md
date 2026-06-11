## 项目上下文摘要（批量提交推送）

生成时间：2026-06-04 18:11:25 +08:00

### 1. 相似实现分析

- **实现1**: `.codex/operations-log.md`
  - 模式：本地操作必须记录事实来源、验证命令、失败根因和修复结果。
  - 可复用：继续追加中文审计段落，不引入新的日志格式。
  - 需注意：文件较长且存在历史尾随空白，本轮只追加新段落，不清理历史内容。
- **实现2**: `.codex/verification-report.md`
  - 模式：按需求、交付物、本地验证、风险边界和评分记录结果。
  - 可复用：本轮完成推送后继续使用同一评分结构。
  - 需注意：不能用远端 CI 或人工检查替代本地验证。
- **实现3**: `.gitignore`
  - 模式：已忽略 `node_modules/`、`dist/`、`build/`、`.venv/`、`.pytest_cache/`、`coverage/`、`.codex/tmp/` 等本地缓存。
  - 可复用：推送前按忽略规则和未跟踪清单排查不应入库目录。
  - 需注意：`.codex` 大部分证据目录未被忽略，用户本轮明确要求推送大量未提交/未跟踪内容。

### 2. 项目约定

- **命名约定**: Python 文件与测试使用 snake_case；文档与 `.codex` 上下文摘要使用描述性短横线命名。
- **文件组织**: API 测试位于 `apps/api/tests/`，迁移位于 `apps/api/alembic/versions/`，本地审计产物位于项目内 `.codex/`。
- **导入顺序**: Python 测试遵循 `from __future__`、标准库、第三方库、本地模块顺序。
- **代码风格**: API 使用 `pyproject.toml` 中 ruff 配置，行宽 120；本轮 Git 操作不新增业务实现。

### 3. 可复用组件清单

- `package.json`: 项目测试入口，包含 `test:api`、`test:web`、`test:workflow`、`verify:ci`。
- `apps/api/pyproject.toml`: API pytest 与 ruff 配置。
- `.github/workflows/e2e.yml`: 远端 E2E 迁移门禁事实来源。
- `.codex/operations-log.md`: 操作留痕文件。
- `.codex/verification-report.md`: 审查评分与验证报告文件。

### 4. 测试策略

- **测试框架**: API 使用 pytest，前端使用 pnpm workspace 测试，项目总入口为 `pnpm run verify`。
- **测试模式**: 本轮优先执行与变更强相关的 API 测试和 Git 状态验证；如全量验证因耗时或环境不可行，将记录原因和补偿计划。
- **参考文件**: `apps/api/tests/test_alembic_heads.py`、`apps/api/tests/test_e2e_workflow_migration_gate.py`、`apps/api/tests/test_phase9_fact_sources.py`。
- **覆盖要求**: 至少覆盖 Git 分叉整合、敏感信息扫描、目标测试、提交后状态和推送后同步状态。

### 5. 依赖和集成点

- **外部依赖**: Git、GitHub 远端 `origin`、PowerShell、rg、uv、pytest。
- **内部依赖**: Alembic 迁移文件、E2E workflow、Phase 9 事实源文档与测试守卫。
- **集成方式**: 先提交本地工作树，再合并 `origin/master` 的 1 个远端提交，解决冲突后运行本地验证并推送。
- **配置来源**: `.gitignore`、`package.json`、`apps/api/pyproject.toml`、`.github/workflows/e2e.yml`。

### 6. 技术选型理由

- **为什么用这个方案**: 当前工作树存在大量未提交和未跟踪内容，且本地分支与远端分叉；先本地提交可保护用户改动，再合并远端提交可避免 pull 覆盖未跟踪文件。
- **优势**: 可审计、可回滚，避免强推，保留用户本地内容。
- **劣势和风险**: `.codex` 证据文件较多，会增加仓库体积和历史噪音；需通过敏感扫描和大文件扫描降低风险。

### 7. 关键风险点

- **并发问题**: 推送前远端可能再次更新；若 push 被拒绝，必须重新 fetch 并复查。
- **边界条件**: 中文文件名在 `git ls-files` 非 `-z` 输出中会转义，PowerShell 直接读取会报非法路径；后续路径处理使用 `-z`。
- **性能瓶颈**: 大量 `.codex` 文件会增加 commit 和 push 时间；当前未发现超过 50MB 的未跟踪文件。
- **安全考虑**: 高置信密钥扫描中 `sk-...` 命中为 `task-5...` 文件名误判；未发现 `.env`、私钥、GitHub token、AWS key 等高风险未跟踪文件。
