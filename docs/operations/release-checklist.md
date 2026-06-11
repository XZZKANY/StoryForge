# StoryForge 发布清单

更新时间：2026-05-18 11:45:00 +08:00

## 1. 适用范围

本文用于 StoryForge 本地发布前检查。当前项目仍处于 Phase 0/5/6/7 推进阶段，本清单只覆盖仓库中已经落地的本地验证、OpenAPI、文档和回滚流程，不把未接入的真实 provider、embedding、reranker 作为发布通过条件。

## 2. 发布前 Git 门禁

在准备发布、推送或交接前执行：

```powershell
git fetch origin --prune
git status --short --branch
git log --oneline --decorate -5
git diff --stat
```

通过条件：

- 当前分支、ahead/behind 状态清楚。
- 所有未提交文件都能对应到本轮任务。
- 不存在临时调试文件、私有环境变量、大型缓存或未解释生成物。
- 若存在 OpenAPI 契约变更，必须能说明对应 API 代码来源和验证命令。

## 3. 环境与服务门禁

先按本地启动手册准备环境：

```powershell
Copy-Item .env.example .env
pnpm install
docker compose up -d postgres redis minio
pnpm verify
```

通过条件：

- Node.js、pnpm、Python 3.11+、Docker 可用。
- PostgreSQL、Redis、MinIO 容器状态明确。
- `pnpm verify` 若失败，失败原因和下一步动作必须记录到 `.codex/verification-report.md`。

## 4. OpenAPI 契约门禁

```powershell
pnpm openapi
git diff -- packages/shared/src/contracts/storyforge.openapi.json
```

通过条件：

- `pnpm openapi` 退出码为 0。
- 契约变更只来自当前 API 代码，不允许静默沿用旧快照。
- 若契约有变更，同步检查 `docs/api/` 中对应阶段审查文档是否需要更新。

## 5. 本地测试门禁

推荐发布前执行完整本地验证：

```powershell
pnpm test
pnpm e2e
```

通过条件：

- `pnpm test` 中 Web 契约、共享包检查、API pytest、workflow pytest 全部通过。
- `pnpm e2e` 先刷新 OpenAPI，再完成阶段契约、API `compileall`、真实 FastAPI HTTP pytest、workflow `compileall` 和 workflow pytest。
- 若真实 FastAPI HTTP pytest 失败，发布门禁必须失败；不得用补偿验收替代。

## 6. 文档门禁

发布前至少检查：

- `README.md`：当前状态、常用命令、验证策略仍与实际脚本一致。
- `docs/internal/TODO.md`：任务状态和最近迭代记录已更新。
- `.codex/operations-log.md`：记录了本轮问题、计划、执行和验证。
- `.codex/verification-report.md`：记录了本轮验证命令、结果、风险和结论。
- `docs/operations/local-start.md`：本地启动流程仍有效。

## 7. 回滚门禁

发布或推送前必须能回答：

- 文档变更如何回滚：使用 `git checkout -- <file>` 或还原当前任务补丁。
- 脚本变更如何回滚：只回退当前任务涉及脚本，不影响业务代码。
- OpenAPI 变更如何回滚：还原 `packages/shared/src/contracts/storyforge.openapi.json` 并记录原因。
- 数据迁移如何回滚：若涉及 Alembic，必须说明 downgrade 或清库重建路径。

## 8. 不得发布的情况

- 本地验证未运行，或失败但未记录原因。
- `docs/internal/TODO.md` 未更新。
- `.codex/verification-report.md` 缺少本轮结论。
- Git 工作区混入无关文件。
- OpenAPI 生成失败却继续使用旧契约。
- 文档承诺了当前代码尚未实现的真实 AI/RAG 能力。
