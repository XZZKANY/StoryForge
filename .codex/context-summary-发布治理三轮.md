## 项目上下文摘要（发布治理三轮）

生成时间：2026-05-18 11:40:00 +08:00

### 1. 任务目标

- 按用户要求再次连续推进 3 轮，且本次不要自动提交。
- 每轮完成找问题、执行、测试、总结、更新 `TODO.md`、检查 Git 状态。
- 当前聚焦 Phase 7 发布与运维治理，不重新实现 Phase 1 到 Phase 4。

### 2. 相似实现分析

- `docs/operations/local-start.md`：已落地本地启动、环境文件、Docker 服务、验证顺序和常见失败处理，是运维文档风格参考。
- `README.md`：提供项目定位、架构边界、本地环境、常用命令、GitHub 同步门禁和验证策略。
- `docs/superpowers/plans/2026-05-17-storyforge-master-replan.md`：Phase 7 明确要求 `release-checklist.md`、`troubleshooting.md`、`verify-local.ps1` 增强和迁移/OpenAPI 治理。
- `scripts/verify-local.ps1`：当前检查 Node、pnpm、Python、Docker、关键路径、PostgreSQL、Redis；尚未检查 MinIO。

### 3. 项目约定

- 文档、日志、验证报告和 TODO 使用简体中文。
- 运维文档放在 `docs/operations/`。
- 过程记录写入 `.codex/operations-log.md` 与 `.codex/verification-report.md`。
- 本轮不执行 `git commit`。

### 4. 可复用组件清单

- `package.json`：根级命令 `pnpm verify`、`pnpm openapi`、`pnpm test`、`pnpm e2e`。
- `scripts/run-e2e.mjs`：OpenAPI 刷新、阶段契约、API 补偿验收、workflow 验证。
- `scripts/generate-openapi.ps1`：严格刷新 OpenAPI 契约。
- `docker-compose.yml`：PostgreSQL、Redis、MinIO 容器名称、端口和用途。

### 5. 测试策略

- 文档变更：`Test-Path` + `Select-String` 验证关键章节和命令。
- 脚本变更：PowerShell 解析检查、`pnpm verify` 真实运行。
- 回归验证：优先运行 `pnpm e2e`；最终运行 `pnpm test` 与 `pnpm e2e`。

### 6. 依赖与集成点

- 发布清单引用 Git、OpenAPI、测试、文档、回滚策略。
- 故障手册引用 Docker、FastAPI TestClient、OpenAPI 刷新、provider 未配置、验证脚本失败。
- `verify-local.ps1` 与 `docker-compose.yml` 的容器名必须保持一致。

### 7. 风险点

- 当前仓库本地已有未推送提交，最终只报告状态，不自动提交。
- FastAPI HTTP pytest 在当前环境可能不稳定，仍以 e2e 补偿验收作为本地证据。
- provider/embedding/reranker 尚未真实接入，文档只能说明当前限制，不能承诺可用能力。
