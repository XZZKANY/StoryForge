## 项目上下文摘要（三轮连续推进）

生成时间：2026-05-18 10:53:38 +08:00

### 1. 任务目标

- 按 `D:/StoryForge/AGENTS.md`、`D:/StoryForge/1-renovel-ai-ai-rag-tavern/AI_ITERATION_GUIDE.md` 和 `D:/StoryForge/1-renovel-ai-ai-rag-tavern/TODO.md` 连续推进 3 轮。
- 每轮必须找问题、执行、测试、总结、更新 `TODO.md`、检查 Git 状态，并可自行提交。

### 2. 相似实现分析

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/run-e2e.mjs`：根级契约、API 补偿验收、workflow 验证编排；需注意 OpenAPI 刷新失败当前只警告并沿用旧快照。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/verify-local.ps1`：本地环境与 Docker 依赖检查；输出中文状态并用 `$Failed` 聚合失败。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/generate-openapi.ps1`：专用 OpenAPI 生成脚本；失败时 PowerShell `Stop` 退出，适合作为生成契约的严格参考。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/scripts/phase1-contract-test.mjs`：轻量 Node 测试运行器，使用临时目录转译测试文件。

### 3. 项目约定

- Monorepo 使用 `pnpm@9.15.4`，工作区为 `apps/*` 与 `packages/*`。
- 用户可见文档、日志、测试描述和提交信息必须使用简体中文。
- Python 代码采用 `snake_case`，TypeScript/React 组件采用 `PascalCase`，脚本保留生态命令名。
- 验证优先使用根级 `pnpm e2e`、`pnpm run test:web`、`pnpm run test:api`、`pnpm run test:workflow`。

### 4. 可复用组件清单

- `scripts/run-e2e.mjs`：根级 e2e 与补偿验收编排。
- `scripts/verify-local.ps1`：环境验证和基础服务检查。
- `scripts/generate-openapi.ps1`：严格 OpenAPI 契约生成。
- `packages/shared/src/contracts/storyforge.openapi.json`：共享契约快照。
- `.codex/operations-log.md` 与 `.codex/verification-report.md`：审计留痕。

### 5. 测试策略

- 前端与共享包：`pnpm run test:web`。
- API 语法验证：`pnpm run test:api`。
- Workflow 语法验证：`pnpm run test:workflow`。
- 阶段契约与补偿验收：`pnpm e2e`，当前环境会在 FastAPI HTTP pytest 不稳定时使用服务层补偿验收。

### 6. 依赖与集成点

- `apps/api` 是业务真相源，OpenAPI 契约由 FastAPI app 生成并进入 `packages/shared`。
- `apps/workflow` 通过 runtime、checkpoint、JobRun 和模型运行日志接入长任务链路。
- `apps/web` 通过中文契约测试确保页面入口与核心能力说明存在。

### 7. 风险点与验证方式

- 风险：根级 `run-e2e.mjs` 当前 OpenAPI 刷新失败时仍继续执行，可能掩盖契约快照陈旧问题。
- 风险：Docker 未运行时 `pnpm verify` 可能失败，需要记录为环境状态而非功能完成证据。
- 验证方式：每轮运行对应本地命令，更新 `TODO.md`、操作日志、验证报告并检查 `git status --short --branch`。
