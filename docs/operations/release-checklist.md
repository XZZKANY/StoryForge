# StoryForge 发布清单

更新时间：2026-07-01 00:00:00 +08:00

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

## 6. Desktop Alpha 打包门禁

准备分发私测桌面包前，至少执行：

```powershell
npm --prefix apps/desktop/frontend run typecheck
npm --prefix apps/desktop/frontend run test -- project-context.test.ts provider-config.test.ts editor.test.tsx
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
$env:STORYFORGE_DESKTOP_USE_API_SIDECAR = "1"
npm --prefix apps/desktop run verify:tauri-smoke
npm --prefix apps/desktop run build
```

通过条件：

- `apps/desktop/src-tauri/binaries/storyforge-api-<target>.exe` 由当前源码重新生成。
- MSI 或 NSIS 安装包存在于 `apps/desktop/src-tauri/target/release/bundle/`。
- 打包态启动不依赖 Docker、PostgreSQL、Redis、MinIO、Vite 或仓库内 `.venv`。
- `verify:tauri-smoke` 在 sidecar 模式下能完成欢迎页、文件树/编辑器布局、API 配置读取、项目加载、建议补丁拒绝/冲突拦截/确认写回、版本快照和作者闭环记录校验。
- 安装包至少做一次临时目录 clean-install smoke：静默安装到临时目录，运行安装目录中的 `storyforge-desktop.exe`，确认其能启动同目录 `storyforge-api.exe` 并完成同一条 smoke 链路；测试后清理临时安装目录、快捷方式和 HKCU 卸载登记。
- 设置页保存的 provider 配置会由桌面主进程重启其托管的 API 子进程后生效；若复用外部 API，需要说明外部 API 也要重启。
- 生成的安装包、sidecar exe、PyInstaller 缓存和本机 LLM 配置不得误提交。

私测 alpha 已知 caveat：

- Windows 本机 LLM key 当前保存在 Tauri app config JSON；不进仓库、不进 localStorage，但尚未接入 OS keychain/DPAPI，公开分发前必须硬化。
- Windows 安装包当前未签名，未接自动更新；熟人私测可接受，公开前必须补签名与 updater 策略。
- 本机桌面模式默认需要占用 `127.0.0.1:8000`。若该端口已有服务且未设置 `STORYFORGE_DESKTOP_REUSE_API=1`，启动会失败以避免 key 注入到错误后端。
- PyInstaller sidecar 已覆盖当前桌面审稿/修订/写回 smoke；BookRun、导出和按路径动态加载的 workflow 模块在纳入打包态承诺前需要额外 smoke。

## 7. 文档门禁

发布前至少检查：

- `README.md`：当前状态、常用命令、验证策略仍与实际脚本一致。
- `docs/internal/TODO.md`：任务状态和最近迭代记录已更新。
- `.codex/operations-log.md`：记录了本轮问题、计划、执行和验证。
- `.codex/verification-report.md`：记录了本轮验证命令、结果、风险和结论。
- `docs/operations/local-start.md`：本地启动、单机桌面模式和桌面安装器构建流程仍有效。

## 8. 回滚门禁

发布或推送前必须能回答：

- 文档变更如何回滚：使用 `git checkout -- <file>` 或还原当前任务补丁。
- 脚本变更如何回滚：只回退当前任务涉及脚本，不影响业务代码。
- OpenAPI 变更如何回滚：还原 `packages/shared/src/contracts/storyforge.openapi.json` 并记录原因。
- 数据迁移如何回滚：若涉及 Alembic，必须说明 downgrade 或清库重建路径。

## 9. 不得发布的情况

- 本地验证未运行，或失败但未记录原因。
- `docs/internal/TODO.md` 未更新。
- `.codex/verification-report.md` 缺少本轮结论。
- Git 工作区混入无关文件。
- OpenAPI 生成失败却继续使用旧契约。
- 文档承诺了当前代码尚未实现的真实 AI/RAG 能力。
