## 项目上下文摘要（Task 9 端到端闭环验收）

生成时间：2026-05-13 11:14:29

### 1. 相似实现分析

- `package.json`: 根脚本已有 `verify`、`test`、`e2e`、`openapi` 入口，当前 `e2e` 指向 `pnpm run verify`。
- `apps/web/scripts/phase1-contract-test.mjs`: 使用 TypeScript 转译和 Node 内置测试 runner 执行前端契约测试，说明项目当前偏向轻量本地契约测试而非浏览器重依赖。
- `scripts/generate-openapi.ps1`: 从 `app.main` 生成 `packages/shared/src/contracts/storyforge.openapi.json`，可复用为 Task 9 OpenAPI 审查输入。
- `scripts/verify-local.ps1`: 检查 Node、pnpm、Python、Docker、关键目录和 PostgreSQL/Redis 容器状态，是最终本地验证入口。
- `apps/api/tests/test_scene_packet.py`、`test_judge_repair.py`、`test_approval_writeback.py`、`test_exports.py`: 分别覆盖闭环中的上下文包、评审、修复、批准回写和导出能力。

### 2. 项目约定

- 根级脚本通过 pnpm 串联；Python API 与 workflow 以 `compileall` 和 pytest 组合验证。
- 前端测试使用 Node 原生测试和源码契约检查，不新增 Playwright 依赖。
- 文档与日志必须写入项目 `.codex/` 或 `docs/`，简体中文留痕。

### 3. 可复用组件清单

- `scripts/generate-openapi.ps1`: 生成 OpenAPI。
- `packages/shared/src/contracts/storyforge.openapi.json`: 前后端共享契约产物。
- `apps/web/scripts/phase1-contract-test.mjs`: 可作为根 e2e runner 的实现参考。
- API 服务：资产、Scene Packet、Judge、Repair、Lineage、Exports 已各自有测试覆盖。

### 4. 测试策略

- Task 9 新增根级 `tests/e2e/phase1-closed-loop.spec.ts`，作为闭环验收契约。
- 若项目仍无 Playwright 依赖，采用 Node/TypeScript runner 执行契约式 e2e，文档说明取舍。
- 最终必须运行 `pnpm verify`、`pnpm test`、`pnpm e2e`。

### 5. 依赖和集成点

- `package.json` 可能需要将 `e2e` 改为执行闭环测试，而不是仅转发 `verify`。
- `docs/api/phase1-openapi-review.md` 需审查 OpenAPI 是否包含 Phase 1 关键端点。
- `.codex/verification-report.md` 需记录最终评分和本地命令结果。

### 6. 技术选型理由

- 复用 Node 内置测试减少依赖，符合项目现有测试架构。
- OpenAPI 审查基于生成文件，避免凭源码猜测。
- 最终验证以根脚本为准，保持与计划统一。

### 7. 关键风险点

- `pnpm verify` 依赖 Docker 容器运行；必须真实执行，不得伪造通过。
- 若新增 e2e runner，需要保证 Windows PowerShell 与 pnpm 可重复运行。
- 不得提交无关 `.superpowers/`、`docs/superpowers/specs/` 或历史 context-summary 草稿。
