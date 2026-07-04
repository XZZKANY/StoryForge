# CLAUDE.md — StoryForge 项目上下文

> 本文件帮助新一轮 Claude Code 会话快速理解 StoryForge 仓库。
> 上位规范见 `docs/internal/AGENTS.md`、日常执行版见 `docs/internal/AI_ITERATION_GUIDE.md`。
> 当前阶段事实以 `docs/internal/current-phase.md` 为准；下一步入口见 `docs/internal/TODO.md`。

## 1. 项目定位

StoryForge 是面向**长篇小说生产**的可验证创作流水线：
每一次生成、检索、评审、修复、批准与回写，都必须留下可追溯证据，而不是只产出一段孤立文本。

设计立场：**先做诊断控制台，再做生成器**。任何生成路径都先有读取证据 → 评审 → 修复 → 批准的闭环，再考虑接真实模型。

## 1.1 当前项目真相（2026-07-02）

- StoryForge 当前处于**Desktop 对话式 Agent 与私测 Alpha 收口阶段**。
- 产品定位（2026-06-24 拍板）：**Cursor for Fiction 作者辅助 IDE**，不是自动长篇生产器；`apps/desktop` 是唯一主产品体验；`apps/web` 已退场（2026-06-21 完成收口），不再作为维护、调试、兼容或契约验证入口。
- 交互中枢（2026-06-30 拍板）：Claude Code/Codex 式**对话式 agent**；批量自动整书不再是主线，BookRun 降级为 managed Writing Run 的内部兼容实现与后台工具。
- 2026-07-01 已合并：单色调明暗双主题 UI 改版（PR #42）；私测 Alpha 单机后端——PyInstaller sidecar exe 独立起服、BYO-key、`llm-provider.json` 写盘换模型即生效、NSIS 安装包内嵌 sidecar（PR #43/#44）；中间交互区收口为对话式 Agent，`chat.explain` 接真·LLM，对话从文件级解绑为项目级（PR #46）。
- 2026-07-02 已合并：左栏会话历史列表接真后端 + 欢迎页输入框接真发送（PR #48）；Agent loop 三步落地——path-scoped 只读 `fs.list` / `fs.read` / `fs.search`（PR #49）、chat 自由文本走 LLM 工具循环（最多 8 轮、失败回落单轮，PR #50）、前端流程树全事件驱动删预制骨架步骤（PR #51）。
- Agent loop 边界：工具循环入口是 chat 自由文本；审稿 / 修订 / 新文件起草 / 一致性观察 / 深度一致性已作为循环内工具并入（`file.review` / `file.revise` / `file.create` / `project.consistency` / `project.deep_consistency`，一次对话最多一个待确认补丁，机械观察工具不下结论、语义评审工具只出 advisory 信号），显式按钮路径仍走固定管线；chapter.review / bookrun.* 绑定 DB 实体、BookRun 定位后台工具，不并入循环（已记为决定）；语义 judge 已从 `os.getenv` 迁 `resolved_llm_env`（下沉 `app/common/llm_env.py`，吃 `llm-provider.json` 覆盖链）；真·LLM tool-calling headless 实跑已通过（2026-07-02，deepseek-v4-flash，证据 `.codex/real-llm-agent-loop-*` 五个目录，深度一致性 6 处埋雷全中），真机 GUI 渲染观感未验；写回红线不变，后端不写项目文件，修订 / 起草走 proposed patch 前端确认。
- 2026-07-04 已合并（蓝图 W1「live 循环语义收口」，PR #70，schema 冻结下零 ORM 变更）：**F09** live 工具循环每轮开头读 `run.status`，作者点暂停 / 停止即收尾不再烧新一轮 BYO-key（不 append / 不 complete，status 保持控制通道写入的 stopped/paused），起服收尸非终态 run（`reap_non_terminal_agent_runs`，failed + reason=process_restart，**仅 sqlite 单进程 sidecar 收尸**）；**F10** 完成 / 失败事件 payload 富化 + 终态流事件，前端超时改「close socket → 后台轮询事件表重建终态」（不再硬 reject，纯函数 `reconstructAgentResultFromEvents`）；**F11** `intent._detect_intent` 中文关键词表下线，固定管线只认显式 intent + 结构化参数，自由文本一律落 chat.explain 循环；**sidecar 版本握手**（taskkill+respawn）：`/health/ready` 暴露 `app_version`，Tauri 起服比对版本不符即强杀旧孤儿 sidecar 重启。真机 GUI 多轮渲染 / 点停止桌面观感 / 超时转轮询实取回 / 版本握手实机验证均归 E2E-1 真机清单未验。
- 2026-07-04 已合并（蓝图 W2「sqlite schema 单一事实源」，唯一定时炸弹 F01 拆除）：sidecar 起服由 `bootstrap_sqlite_database` 跑 alembic 收口——已纳管库 `upgrade head`、存量 create_all 库（无 alembic_version）走「SQLite backup API 备份（`*.pre-alembic-<版本>.bak`，保留 3 份）+ `PRAGMA quick_check` 失败即中止 + create_all 补表 + 补 agent_run_events 唯一索引 + `stamp head`」纳管、全新库 create_all + `stamp head`；`alembic/env.py` 支持注入连接 + SQLite `render_as_batch`；alembic 脚本经 `--add-data` 打进冻结 exe（`app/db/migrations.py` 兼顾源码 / `_MEIPASS` 定位）；`create_all` 保留为 SQLite 建表器与收口失败回退。**F01 定时炸弹拆除实证**：已纳管库缺列时起服 `upgrade head` 把列补回（fixture `test_managed_db_applies_pending_migration` 绿）。此后 ORM 列变更走 batch 安全迁移，schema 冻结解除（见 §6 新规矩）。真机「旧版 NSIS 存量库换新 exe 起服 + 会话史完整」归 E2E-1 未验。
- 2026-07-04 已合并（蓝图 W3 首刀「LLM 单一 chat 通道」，拆 high 级 F16 核心）：chat/completions 出网收敛到唯一模块 `app/common/llm_client.py`（自 book_runs 原样下沉带重试 urllib 客户端 + 双鉴权 + 记账；errors 改由该模块定义 `LLMError`/`LLMConfigError`，`book_runs/errors.py` 别名同一类对象、`except`/`isinstance`/502·422 零改动）；**F16 靶心**——`agent_runs/loop_runtime.py` live 循环改吃 common 通道、不再 import book_runs；**真 bug 修复**——`story_state/semantic.py` grounding 配置从裸 `os.getenv` 改吃 `resolved_llm_env` 覆盖链（此前漏迁，sidecar 下读不到 `llm-provider.json` → grounding 静默失活）；密钥脱敏 `redact_secrets` 落 judge/story_state 失败日志；ruff `TID` banned-api 禁裸 `urllib.request` 另起碎片化 chat 客户端。本刀不动：judge/story_state 仍走 httpx（只统一配置源 + 脱敏，未统一传输）、retrieval embedding/reranker、workflow 第 7 客户端（W5 将删）、usage 记账 + 三客户端一致性矩阵（F16 后续）。真 key headless 复跑归真跑轨未验。
- 真实 LLM 1 章、3 章和 10 章 smoke 已完成脱敏验证，其中 10 章 smoke 已通过人工通读，最终门禁为 `gate: pass_for_real_10ch_final_acceptance`。
- 一次 30 章真实长程已经跑完并导出 Markdown、EPUB 和审计报告，证据目录为 `.codex/real-llm-30ch-mimo25pro-20260611-192356`；但人工通读结论是**退回重跑**。2026-06-30 Q9 16 章真实跑修复门禁丢章四根因并抢救为完整 16 章、人工通读通过（PR #40/#41）。
- 因此当前只能宣称“真实长程运行链路可达、制品导出成立”，不能宣称真实 3-5 万字长程质量验收通过，也不能宣称稳定生产级长篇生产闭环。

## 2. 技术栈

- **API（后端事实源）：** FastAPI（Python 3.11+） + SQLAlchemy + Alembic + Pydantic v2，依赖管理走 `uv`。
- **Desktop IDE（主产品入口）：** Tauri 2 + Vite + React 18 + Monaco Editor + 本地文件系统集成。
- **Workflow（编排）：** LangGraph，承载长任务、checkpoint、真实模型调用边界。
- **共享契约：** `packages/shared`（TypeScript 包），其中 `src/contracts/storyforge.openapi.json` 是后端 OpenAPI 快照，必须随后端变化同步刷新。
- **基础设施：** PostgreSQL（+ pgvector） + Redis + MinIO（对象存储） + Sentry（错误追踪） + Prometheus 指标。
- **包管理：** pnpm 9.x（workspace），Python 侧 `uv sync`。

## 3. 仓库布局

```
apps/
  api/           FastAPI 业务真相源（领域驱动，每个子目录是一个 domain）
    app/
      common/    auth、config、logging_config、middleware、pagination、redis_cache、metrics、sentry_config
      db/        SQLAlchemy session、deps
      domains/   ~25 个业务域，每个含 router.py / service.py / schemas.py / models.py
      main.py    FastAPI 应用装配 + 全局中间件
    alembic/     数据库迁移
  desktop/      Tauri 桌面 IDE（当前主产品体验）
  workflow/      LangGraph 编排器（generation_graph、provider_adapter、creative_tool_registry）
packages/
  shared/        TS 共享契约 + 类型，src/contracts/storyforge.openapi.json 为后端契约快照
deploy/          Nginx、部署相关配置
scripts/         dev-start.mjs / generate-openapi.mjs / run-e2e.mjs / verify-local.ps1 / migrate.sh
tests/           顶层 e2e 契约测试（Node --test 风格）
docs/            架构与工作台契约文档
.codex/  验证报告（verification-report.md），所有变更必须留痕
```

## 4. 常用命令

### 一键开发环境

```bash
pnpm dev               # 桌面 IDE 主体验（含桌面 Vite、Docker、迁移、API、Tauri 窗口）
pnpm desktop:dev       # 同上，显式桌面端入口
pnpm dev:maintenance   # docker compose + alembic + API
pnpm dev:api           # 只启基础服务 + API
node scripts/dev-start.mjs --skip-docker --skip-migrate    # 已有服务时快速重启
```

### 验证门禁（2026-07-03 W0 收敛，依据 `docs/internal/arch-review-blueprint-2026-07-03.md`）

```bash
pnpm verify            # 提交前必跑：lint + typecheck + 各栈测试各一遍 + sidecar-smoke(daily 档) + OpenAPI 漂移
pnpm e2e               # 契约门禁（秒级）：OpenAPI drift + tests/e2e 契约断言；不再重跑任何 pytest
pnpm openapi           # 重新生成 packages/shared/src/contracts/storyforge.openapi.json
pnpm smoke:sidecar:packaged   # 冻结 exe 冒烟：每波蓝图收口合并前 / 发版前必跑
```

- pre-push hook（`pnpm hooks:install` 启用）= lint + drift + 活路径快测集（约 3 分钟，修 F12）；绕过用 `git push --no-verify`，但绕过即自担风险。
- `pnpm test` 仍可单独全量跑测试，但 `pnpm verify` 已覆盖，提交前不必重复。
- 门禁去重原则：同一批用例只在 verify 跑一遍；e2e 只做契约断言；drift 校验只有 `scripts/check-openapi-drift.mjs` 一份实现。

P0 复位时已通过的关键命令：

```bash
pnpm.cmd lint
npm --prefix apps/desktop/frontend run typecheck
npm --prefix apps/desktop/frontend run test
pnpm.cmd --filter @storyforge/shared test
pnpm.cmd test
cd apps/api && uv run pytest
cd apps/workflow && uv run pytest
cd apps/api && uv run pytest tests/test_phase9_fact_sources.py -q
cd apps/api && uv run ruff check tests/test_phase9_fact_sources.py
```

非 Windows 环境：直接跑 `node scripts/verify-local.mjs`、`node scripts/run-e2e.mjs`、`npm --prefix apps/desktop/frontend run test`、`cd apps/api && uv run pytest`、`cd apps/workflow && uv run pytest`。

### 代码风格

```bash
pnpm.cmd lint          # eslint + prettier --check（Windows 下优先用 pnpm.cmd）
pnpm lint:fix          # 自动修复
cd apps/api && uv run ruff check .     # Python 侧 ruff
```

### 单独跑某个测试

```bash
cd apps/api && uv run pytest tests/test_artifacts.py -q
cd apps/workflow && uv run pytest tests/test_generation_graph.py -q
npm --prefix apps/desktop/frontend run test
```

## 5. 架构事实源

- **API 是业务真相源。** 任何流程的判定都在 FastAPI 路由 + service 层完成；前端不允许私自计算业务结论。
- **Desktop IDE 是主体验。** 新的用户工作流默认落在 `apps/desktop`；Tauri 主进程负责本地文件系统、服务启动和 API 配置注入。
- **Web 已退场。** 不新增 `apps/web` 代码、脚本、容器或测试；需要前端能力时优先落在 `apps/desktop`。
- **域分档看 `apps/api/app/domains/DOMAINS.md`（新会话第一入口）。** live 产品面很小；大量域是 web / 多租户 / 自动整书遗产，已 **frozen**（router 卸载或可卸载）。判断某域是否值得读、能否改先查该清单。2026-07-04 W4 已卸载 `analytics` / `batch_refinery` / `collaboration` / `commercial` 四个 frozen router（护栏 `tests/test_api_surface.py`，回滚 = 加回一行 `include_router`）；冻结只卸 router 不删 `models.py`（打碎 `app/models.py` 建表会连累 live）。
- **Workflow 负责长任务边界。** 真实模型调用、checkpoint、ModelRun 记录都在 workflow，确保 API 始终保持事务边界清晰。
- **OpenAPI 是后端对客户端的硬契约。** 任何路由签名变化都必须 `pnpm openapi` 刷新快照，并解释 diff 来源。

## 6. 协作约定

- **✅ schema 冻结已解除（2026-07-04 W2 落地，PR 见下）；改 schema 的新规矩：** 起服由 sidecar 跑 alembic 收口（存量 create_all 库备份 + quick_check + stamp head 纳管，已纳管库 `upgrade head`，见 `apps/api/app/db/migrations.py`），alembic 是 schema **前向演进**的单一事实源。新增/改列必须写一条 alembic 迁移：SQLite 侧 `op.add_column` / `create_index` / `create_table` 可直用，`alter_column` / `drop_column` / 加约束等 ALTER 操作必须包在 `with op.batch_alter_table(...)` 里，pg 专属 DDL（pgvector 等）用 `dialect.name` 守卫，且**必须提供可用的 downgrade**（本波起要求）。注意历史迁移链无法在 SQLite 上从 base 重放，故建表仍靠 `create_all`——**别删 create_all**，它是 SQLite 建表器与 alembic 收口失败时的回退。原始约束背景见 `docs/internal/arch-review-blueprint-2026-07-03.md` §7（F01）。
- **语言：** 所有回复、文档、注释、日志、提交信息默认简体中文；代码标识符、包名、API 名称保留英文。
- **证据链：** 所有变更必须在 `.codex/verification-report.md` 留下验证记录（命令、输出摘要、未联通能力）。
- **小步推进：** 一次只解决一个明确问题，禁止顺手重构无关代码。
- **不写多余注释：** 只在 WHY 不明显时加一行；不要描述代码做了什么。
- **不写无关 README：** 除非用户明确要求。
- **不创建假数据兜底：** 数据缺失就明确返回错误，不要伪造空对象误导前端。
- **rate limit：** API 默认 per-API-Key 分层限流（读 120/min、写 60/min、批量 10/min）；调试时不要去关它。
- **认证：** `X-StoryForge-API-Key`（服务间）或 `Authorization: Bearer <jwt>`（用户）。
- **数据库迁移：** 用 alembic；新增列要带 server_default 否则会卡线上数据。

## 7. 可观测性

- **结构化日志：** Python 侧用 `structlog`，开发模式彩色终端、生产模式 JSON。
- **Request ID：** 每个请求注入 UUID，响应头返回 `X-Request-Id`，日志全链路携带。
- **Sentry：** `SENTRY_DSN` 配置即启用；API、Web、Workflow 三侧统一。
- **指标：** `/metrics` 端点暴露 Prometheus 格式，含 `judge_calls_total`、`repair_patches_total`、`batch_refinery_jobs_total` 等业务计数器。
- **健康检查：** `/health/live`（仅进程） + `/health/ready`（DB + Redis + 核心表）。

## 8. 当前能做与不能做

**能做：**

- Desktop IDE：打开本地项目、文件树浏览、Monaco 编辑、版本记录、命令面板、保存快照和 API 配置注入；单色语义 token + 明暗双主题。
- Desktop 对话式 Agent：项目级对话会话（切文件不丢，消息持久化于 `assistant_sessions`，左栏会话历史列表可切换 / 新建）、`chat.explain` 真·LLM 回话、chat 自由文本 LLM 工具循环（path-scoped 只读 `fs.list` / `fs.read` / `fs.search` + 一致性观察 `project.consistency` + 深度一致性语义评审 `project.deep_consistency`（本地人物 / 设定文件作 Character Bible 喂语义 judge，advisory issue 信号）+ 新文件起草 `file.create`，逐调用证据链，流程树全事件驱动）、真实文件修订、多视角 file.review、稳定 issue id、范围控制、待确认 proposed patch（含新文件补丁自动打开目标文件）和确认写回防重复生成已有本地验证证据。注意：工具循环入口是 chat 自由文本，审稿 / 修订 / 起草 / 一致性观察 / 深度一致性已并入循环（一次对话最多一个待确认补丁），chapter.review / bookrun.* 不并入循环（后台定位，已记为决定）；真·LLM tool-calling headless 实跑已通过，真机 GUI 观感未验。
- 私测 Alpha 单机后端：sidecar exe 独立起服（sqlite 自建表）、BYO-key、`llm-provider.json` 写盘换模型即生效、NSIS 安装包内嵌 sidecar，均已本机验证。
- BookRun（后台工具）：deterministic/mock provider 下可跑最小整书闭环，支持 checkpoint、预算暂停、provider 降级、Markdown/EPUB/审计报告导出；不作为主产品控制台。
- 真实 LLM：1/3/10 章 smoke 有脱敏证据；30 章真实长程有链路和制品导出证据，但质量未通过；Q9 16 章真实跑门禁修复后人工通读通过。
- Web：`apps/web` 已退场；旧页面只保留在历史文档和 git 历史中。
- Provider/LLM：通过 Provider Gateway 真实接入与降级，敏感配置必须来自本机私有运行时环境变量。

**不做：**

- 不能宣称真实 3-5 万字长程质量验收通过；30 章真实长程已人工退回重跑。
- 不能把自动审计、golden gate 或模型自评等同于人工通读通过。
- 不能宣称稳定生产级长篇生产闭环。
- 不能宣称真实 Tauri 桌面端到端写回确认链路已经完成（现在入口是 NSIS 安装包双击装机路径，需人工点穿）。
- 不能把 Agent 工具循环（含循环内审稿 / 修订 / 新文件起草、一致性观察与深度一致性）的真·LLM headless 实跑证据（单 provider）当作真机桌面端多轮渲染、自动打开新文件与补丁确认验收；chapter.review / bookrun.* 未循环化是已记录的决定而非缺口；`project.consistency` 只产出机械观察信号，不具备语义一致性判定能力；`project.deep_consistency` 的 issue 是 advisory 参考信号（实跑仅验证显性矛盾场景，隐性 / 跨章长程矛盾召回率未验），不得当作质量判定或验收结论。
- 暂不承诺完整多人协作、生产级对象存储签名下载、多租户认证或全步骤 Studio 编排器。

## 8.1 当前下一步优先级

1. Agent loop 收口（余项）：真机 GUI 多轮渲染、自动打开新文件与补丁确认观感随端到端复验（深度一致性已于 2026-07-02 挂进循环；2026-07-04 W1 已补齐 live 循环可中断 / 起服收尸 / 断线重建终态 / 关键词表下线 / sidecar 版本握手，PR #70）。
2. 跑真实 Tauri 桌面端到端（安装包装机路径，承接 E2E-1 清单）：打开项目 -> 对话（含工具循环流程树、会话历史列表、欢迎页首条 prompt、方向键复验）-> Agent 审稿 -> 指定问题修订 -> diff 确认 -> 写回 -> 版本记录；W1 新行为的真机验收点=点停止后事件表无后续 tool_trace、超时转后台仍取回结果、强杀宿主重启无孤儿且连新 sidecar。
3. 质量轨（后台）：基于 30 章通读意见与 Q9 门禁修复重跑真实 3-5 万字长程并人工盲评；Q1-Q8 一致性逐步做成 agent 工具挂进循环。

## 9. 常见陷阱

- **PowerShell 执行策略：** Windows 下 `pnpm.ps1` 可能被阻塞，改用 `pnpm.cmd` 或 `powershell.exe -NoProfile -Command "pnpm.cmd run X"`。
- **OpenAPI 漂移：** 改了路由没跑 `pnpm openapi` → CI 立刻挂。
- **API Key：** 默认 `local-dev-key`，生产环境如未配置 `STORYFORGE_API_KEY` 会触发 warn_default_credentials 日志告警。
- **CORS：** 默认允许桌面 Vite `http://localhost:3007` / `http://127.0.0.1:3007`，自定义前端域名要改 `STORYFORGE_CORS_ORIGINS`。
- **migration 锁：** docker entrypoint 自动获取 advisory lock，多实例并发部署时不要绕开。

## Agent skills

### Issue tracker

Issues and PRDs live in GitHub Issues for `XZZKANY/StoryForge`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: read root `CONTEXT.md` plus relevant architecture docs under `docs/architecture/`. See `docs/agents/domain.md`.
