# StoryForge 发布清单

更新时间：2026-09-28

## 1. 适用范围

本文用于 StoryForge 本地发布前检查。当前处于 Desktop IDE-first 收口阶段（事实源见 `docs/internal/current-phase.md`），本清单只覆盖仓库中已经落地的本地验证、OpenAPI、文档和回滚流程，不把未接入的真实 provider、embedding、reranker 作为发布通过条件。

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

已有环境先复用；不要用样例覆盖已有 `.env`，也不要为了跑门禁无条件重装依赖或启动 Docker。首次初始化按 `local-start.md`，包管理器必须与 `package.json` 的版本一致。

```powershell
pnpm --version                 # 当前锁定 9.15.4；不一致时先校准 PATH / Corepack
pnpm verify
```

通过条件：

- Node.js、指定版本 pnpm、Python 3.11+ 与 uv 可用；缺依赖时按锁文件安装，不临时改版本。
- `pnpm verify` 的 daily sidecar 使用隔离 SQLite，不要求 Docker。另做 PostgreSQL / Redis / MinIO 集成时才启动相应服务，未运行的集成项单独列出。
- `pnpm verify` 若失败，失败原因和下一步动作必须记录到 `.codex/verification-report.md`。

## 4. OpenAPI 契约门禁

```powershell
pnpm openapi
git diff -- packages/shared/src/contracts/storyforge.openapi.json
```

通过条件：

- `pnpm openapi` 退出码为 0。
- 契约变更只来自当前 API 代码，不允许静默沿用旧快照。
- 若契约有变更，必须能逐段解释 `packages/shared/src/contracts/storyforge.openapi.json` 的 diff 来源并补验证记录。

## 5. 本地测试门禁

推荐发布前执行完整本地验证：

```powershell
pnpm test
pnpm e2e
```

通过条件：

- `pnpm test` 中 Desktop、共享包、`project-core` 和 API pytest 全部通过。
- `pnpm e2e` 只做 OpenAPI 刷新/漂移检查与 Node 契约断言（秒级），不执行 pytest；独立 Workflow 的 `compileall`/pytest 已随组件退役移除。
- 若真实 FastAPI HTTP pytest 失败（由 `pnpm verify` / `pnpm test` 覆盖），发布门禁必须失败；不得用补偿验收替代。

## 6. Desktop Alpha 打包门禁

准备分发私测桌面包前，按「构建前单元层 → 完整构建 → 打包态 smoke → clean-install」分档执行，保证被测 sidecar 从当前源码重建：

```powershell
# 1. 构建前单元层
npm --prefix apps/desktop/frontend run typecheck
npm --prefix apps/desktop/frontend run test -- project-context.test.ts provider-config.test.ts editor.test.tsx
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

# 2. 完整构建（prepare:git + build:api-sidecar + tauri build）
pnpm.cmd desktop:build

# 3. 打包态 smoke（先从当前源码重建 release sidecar，再跑 --release 冒烟）
npm --prefix apps/desktop run verify:tauri-smoke:packaged

# 4. NSIS clean-install 验收（临时目录静默安装 + 启动 + 清理）
npm --prefix apps/desktop run verify:nsis-install
```

通过条件：

- `apps/desktop/src-tauri/binaries/storyforge-api-<target>.exe` 由当前源码重新生成。
- MSI 或 NSIS 安装包存在于 `apps/desktop/src-tauri/target/release/bundle/`。
- 打包态启动不依赖 Docker、PostgreSQL、Redis、MinIO、Vite 或仓库内 `.venv`。
- `verify:tauri-smoke:packaged` 在打包态能完成欢迎页、文件树/编辑器布局、API 配置读取、项目加载、建议补丁拒绝/冲突拦截/确认写回、版本快照和作者闭环记录校验。
- `verify:nsis-install` 完成临时目录 clean-install smoke：静默安装到临时目录，运行安装目录中的 `storyforge-desktop.exe`，确认其能启动同目录 `storyforge-api.exe` 并完成同一条 smoke 链路；测试后清理临时安装目录、快捷方式和 HKCU 卸载登记。
- 设置页保存的 provider 配置写入本机 `llm-provider.json`，API 在下一次调用时实时读取，无需重启子进程；若复用外部 API，按外部服务的配置生效规则验证。
- 生成的安装包、sidecar exe、PyInstaller 缓存和本机 LLM 配置不得误提交。
- clean-install 脚本只证明安装、启动、卸载和 shadow 数据保留，不包含升级验证；升级保留必须另取证，不能以安装冒烟代替。

私测 alpha 已知 caveat：

- Windows 本机 LLM key 保存在 Tauri app config JSON，已接入 Windows user-scoped DPAPI 保护（`windows-dpapi-user-v1`，CryptProtectData/CryptUnprotectData；旧格式配置由 `llm_config_store.rs` 自动迁移，API 侧 `llm_config_file.py` 可读取同一保护格式）；不进仓库、不进 localStorage。该保护是用户级加密而非签名/分发硬化，公开分发前仍需单独评审。
- Windows 安装包当前未签名，未接自动更新；熟人私测可接受，公开前必须补签名与 updater 策略。
- 本机桌面模式默认需要占用 `127.0.0.1:8000`。若该端口已有服务且未设置 `STORYFORGE_DESKTOP_REUSE_API=1`，启动会失败以避免 key 注入到错误后端。
- PyInstaller sidecar 已覆盖当前桌面审稿/修订/写回 smoke；BookRun 与导出能力若纳入打包态发布承诺，仍需补充对应 smoke。

## 7. 文档门禁

发布前至少检查：

- `README.md`：当前状态、常用命令、验证策略仍与实际脚本一致。
- `docs/internal/TODO.md`：任务状态和最近迭代记录已更新。
- `docs/internal/current-phase.md`：同步当前候选证据与限制；详细命令和结果留在验证报告，不引用不存在的旧流水账。
- `.codex/verification-report.md`：记录了本轮验证命令、结果、风险和结论。
- `docs/operations/local-start.md`：本地启动、单机桌面模式和桌面安装器构建流程仍有效。

## 8. 回滚门禁

发布或推送前必须能回答：

- 文档变更如何回滚：只逆向本任务的补丁（`git diff` 定位后逐文件还原），不在混合工作区执行 `git checkout -- <file>` 一类会覆盖他人未提交改动的命令。
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
