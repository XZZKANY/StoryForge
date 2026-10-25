# CLAUDE.md — StoryForge 项目上下文

> 本文件帮助新一轮 AI 会话快速理解 StoryForge 仓库。
> 根级协作约定见 `AGENTS.md`；`docs/internal/` 目录级补充见该目录 `AGENTS.md`。
> 当前阶段事实以 `docs/internal/current-phase.md` 为准；下一步入口见 `docs/internal/TODO.md`。

> **测量期与功能冻结（2026-10-25 至 2026-11-14，决策日 11-21）。** 作者 10-25 定的目标排序：写完一本自己想读下去的书 ＞ 做一个给别人用的产品 ＞ 做一个让自己想不停创造的桌面工具；并接受冻结。窗口内对所有 AI 会话生效：
> - 不加功能，不开审计、巡检、UI 打磨波次；发现的缺陷只记不修，作者提的新功能记进需求日志。
> - 只允许：丢稿类 P0、对外失实更正、关闭助手 Markdown 的远程图片（S-04）、`output/` 下的实验驱动；E0 不过线时至多一轮定点修复。
> - **每次合并都要作者发出的解冻编号**（PR 描述写「解冻编号：U-NN」）；暂停「做完就一路合并」的习惯。
> - 三本账分开：写书账（北极星：作者保留章数）、产品账（本窗口不投入）、爱好账；互不借理由。
> - 规则、解冻编号账、实验登记与判定表见 `docs/internal/measurement-window-2026-10.md`。越线即按「冻结没被接受」结案。

## 1. 项目定位

StoryForge 是面向长篇小说的 Desktop IDE-first AI 写作工作台（2026-06-24 拍板为**作者辅助 IDE**，不是自动长篇生产器）：
作者打开本地小说项目，通过对话式 Agent 审稿、修订、查看 diff，并按项目权限确认或自动写回，全流程保留证据链。
早期「先做诊断控制台，再做生成器」的立场仍然适用：任何生成路径都先有读取证据 → 评审 → 修复 → 批准的闭环。

## 1.1 项目演进流水（历史记录，2026-07-11 止）

> 本节是历次拍板与合并流水，用于追溯决策来源；其中「当前/已合并/最新」均为各自时点表述，
> 不作为今天的现状或下一步依据。当前能力边界见 §8，当前下一步见 `docs/internal/TODO.md`。

- StoryForge 当前处于**Desktop 对话式 Agent 与私测 Alpha 收口阶段**。
- 产品定位（2026-06-24 拍板）：**作者辅助 IDE**，不是自动长篇生产器；`apps/desktop` 是唯一主产品体验；`apps/web` 已退场（2026-06-21 完成收口），不再作为维护、调试、兼容或契约验证入口。
- 交互中枢（2026-06-30 拍板）：**对话式 agent**；批量自动整书不再是主线，BookRun 降级为 managed Writing Run 的内部兼容实现与后台工具。
- 2026-07-01 已合并：单色调明暗双主题 UI 改版（PR #42）；私测 Alpha 单机后端——PyInstaller sidecar exe 独立起服、BYO-key、`llm-provider.json` 写盘换模型即生效、NSIS 安装包内嵌 sidecar（PR #43/#44）；中间交互区收口为对话式 Agent，`chat.explain` 接真·LLM，对话从文件级解绑为项目级（PR #46）。
- 2026-07-02 已合并：左栏会话历史列表接真后端 + 欢迎页输入框接真发送（PR #48）；Agent loop 三步落地——path-scoped 只读 `fs.list` / `fs.read` / `fs.search`（PR #49）、chat 自由文本走 LLM 工具循环（最多 8 轮、失败回落单轮，PR #50）、前端流程树全事件驱动删预制骨架步骤（PR #51）。
- Agent loop 边界：工具循环入口是 chat 自由文本；审稿 / 修订 / 新文件起草 / 一致性观察 / 深度一致性已作为循环内工具并入（`file.review` / `file.revise` / `file.create` / `project.consistency` / `project.deep_consistency`，一次对话最多一个 proposed patch，机械观察工具不下结论、语义评审工具只出 advisory 信号），显式按钮路径仍走固定管线；chapter.review / bookrun.* 绑定 DB 实体、BookRun 定位后台工具，不并入循环（已记为决定）；语义 judge 已从 `os.getenv` 迁 `resolved_llm_env`（下沉 `app/common/llm_env.py`，吃 `llm-provider.json` 覆盖链）；真·LLM tool-calling headless 实跑已通过（2026-07-02，deepseek-v4-flash，证据 `.codex/real-llm-agent-loop-*` 五个目录，深度一致性 6 处埋雷全中），真机 GUI 渲染观感未验；写回红线见下条（2026-07-31 已随权限档位改写）。
- 2026-07-04 已合并（蓝图 W1「live 循环语义收口」，PR #70，schema 冻结下零 ORM 变更）：**F09** live 工具循环每轮开头读 `run.status`，作者点暂停 / 停止即收尾不再烧新一轮 BYO-key（不 append / 不 complete，status 保持控制通道写入的 stopped/paused），起服收尸非终态 run（`reap_non_terminal_agent_runs`，failed + reason=process_restart，**仅 sqlite 单进程 sidecar 收尸**）；**F10** 完成 / 失败事件 payload 富化 + 终态流事件，前端超时改「close socket → 后台轮询事件表重建终态」（不再硬 reject，纯函数 `reconstructAgentResultFromEvents`）；**F11** `intent._detect_intent` 中文关键词表下线，固定管线只认显式 intent + 结构化参数，自由文本一律落 chat.explain 循环；**sidecar 版本握手**（taskkill+respawn）：`/health/ready` 暴露 `app_version`，Tauri 起服比对版本不符即强杀旧孤儿 sidecar 重启。真机 GUI 多轮渲染 / 点停止桌面观感 / 超时转轮询实取回 / 版本握手实机验证均归 E2E-1 真机清单未验。
- 2026-07-04 已合并（蓝图 W2「sqlite schema 单一事实源」，唯一定时炸弹 F01 拆除）：sidecar 起服由 `bootstrap_sqlite_database` 跑 alembic 收口——已纳管库 `upgrade head`、存量 create_all 库（无 alembic_version）走「SQLite backup API 备份（`*.pre-alembic-<版本>.bak`，保留 3 份）+ `PRAGMA quick_check` 失败即中止 + create_all 补表 + 补 agent_run_events 唯一索引 + `stamp head`」纳管、全新库 create_all + `stamp head`；`alembic/env.py` 支持注入连接 + SQLite `render_as_batch`；alembic 脚本经 `--add-data` 打进冻结 exe（`app/db/migrations.py` 兼顾源码 / `_MEIPASS` 定位）；`create_all` 保留为 SQLite 建表器与收口失败回退。**F01 定时炸弹拆除实证**：已纳管库缺列时起服 `upgrade head` 把列补回（fixture `test_managed_db_applies_pending_migration` 绿）。此后 ORM 列变更走 batch 安全迁移，schema 冻结解除（见 §6 新规矩）。真机「旧版 NSIS 存量库换新 exe 起服 + 会话史完整」归 E2E-1 未验。
- 2026-07-04 已合并（蓝图 W3 首刀「LLM 单一 chat 通道」，拆 high 级 F16 核心）：chat/completions 出网收敛到唯一模块 `app/common/llm_client.py`（自 book_runs 原样下沉带重试 urllib 客户端 + 双鉴权 + 记账；errors 改由该模块定义 `LLMError`/`LLMConfigError`，`book_runs/errors.py` 别名同一类对象、`except`/`isinstance`/502·422 零改动）；**F16 靶心**——`agent_runs/loop_runtime.py` live 循环改吃 common 通道、不再 import book_runs；**真 bug 修复**——`story_state/semantic.py` grounding 配置从裸 `os.getenv` 改吃 `resolved_llm_env` 覆盖链（此前漏迁，sidecar 下读不到 `llm-provider.json` → grounding 静默失活）；密钥脱敏 `redact_secrets` 落 judge/story_state 失败日志；ruff `TID` banned-api 禁裸 `urllib.request` 另起碎片化 chat 客户端。本刀不动：judge/story_state 仍走 httpx（只统一配置源 + 脱敏，未统一传输）、retrieval embedding/reranker、workflow 第 7 客户端（W5 将删）、usage 记账 + 三客户端一致性矩阵（F16 后续）。真 key headless 复跑归真跑轨未验。
- 2026-07-04 已合并（蓝图 W4 batch-1「死域冻结隔离」，拆 F04）：新增 `apps/api/app/domains/DOMAINS.md` 三档清单（live/backing/frozen，**新会话第一入口**，§5 指路）；discovery-first 逐域实证后只卸载 4 个零耦合 frozen router（`analytics`/`batch_refinery`/`collaboration`/`commercial`），护栏 `test_api_surface.py::test_frozen_domain_routers_stay_unmounted` 可证伪、回滚=加回一行 `include_router`；契约 paths 109→100（zero added）、e2e 21/21、全量 847 passed。**冻结只卸 router 不删 `models.py`**（9 域是 models-only/service-live，目录必留）；物理删除 + batch-2 留后续。
- 2026-07-04 已合并（蓝图 W5 core「workflow 分层 prompt 迁入 API」，修 F05 装机死路，schema 冻结下零 ORM 变更）：workflow 的**纯函数**分层 prompt 构建器（7 文件）+ 技能审计投影（`skills/audit.py`）迁入进程内包 `app.domains.book_runs.prompts/`，拆掉两座 importlib 文件路径桥（`workflow_prompt_bridge` / `workflow_skill_audit_bridge`，`git rm`），随 `collect_submodules('app')` 打进冻结 exe。旧桥指相邻 `apps/workflow` 目录、装机 exe 内不存在会在 bookrun.start 才炸；现 `book_generation` 起服链模块级依赖新包、漏打即起服炸。`main.py` 加起服自检 `prompt_layer_bundled`，daily/packaged 两档 sidecar-smoke 断言（**packaged 冻结 exe 实测绿：`分层 prompt 构建器已随 exe 打包(F05 死路已收口)`**）。全量 847 passed（= W4 基线零回归）、ruff 绿、e2e 21/21。**本刀不做**：`apps/workflow` app 物理删除 + 第 7 LLM 客户端删除（W5 高风险步，留后续；prompts 暂在 api/workflow 双存，api 是 live 唯一装机路径）。真机「装机 exe → bookrun.start 真装配」归 E2E-1。
- 2026-07-04 已合并（蓝图 W7「前端行为测试基建」+ 修 F26/F27）：引入 vitest + happy-dom（frontend 是独立 npm 工程），落三条**可证伪**红线行为测试（①before 漂移拒写 ②快照→写盘→记录时序 + 快照失败阻断写回 ③会话切换中途 run 完成不污染当前会话）；修两条真 bug——**F26** `ChatWindow` 会话切换竞争：`runAuthorAgent` 终态块与 `applyResumedAgentResult` 加会话守卫 `isRunResultForActiveSession`（run 起跑会话≠当前活动会话即不写回，纯 `runId` 守卫不足因切会话不改 runId）；**F27** 写盘非原子（Rust `fs.rs::write_file` 改「同目录临时文件+sync+原子 rename」，拆 `stage_atomic_write` 使原子性不变量可单测证伪）+ 快照失败照写（TS `performGuardedWriteback` 纯核心删吞错 try/catch，快照 reject 即阻断 write/record）。证据：vitest 9 passed、cargo test fs:: 9 passed（含 2 新原子写）、verify-unit 既有 101 passed 零回归、lint 绿。**本刀不做**：既有 19 测试迁入 vitest + 删 verify-unit（双跑一周期后）、ChatWindow 全量 happy-dom 挂载、真机桌面观感（归 E2E-1）。
- 2026-07-05 至 07-11 已合并：桌面壳子 redesign P0-P4（PR #81-#85）+ Agent 壳子接线契约（PR #80）；**E2E-1 真机首轮门禁 G.1 全 PASS**（2026-07-07，共逮 6 真 bug 均修 PR #87-#96/#109）；查缺补漏审计修复（PR #90-#94）；W6 WS 契约化 slices1-3 + F25 权限四轨（PR #105-#107/#111/#112，slice4 跳过 / slice5 保留 facade 已拍板封档）；canon 防漂移 slice1/2（PR #114/#115，`.storyforge/canon/` 骨架 + 薄不变量闸 + dossier 富 view，确定性无 LLM）；Desktop/API 边界加固（Codex，PR #118，redaction / WS 子协议凭据 / fs.rs 读侧 containment）；W4 batch-2 六域 router 全卸（PR #119/#120）+ 冻结域死码物理清理（PR #121）；workflow 能力迁移 ledger + 三刀 agent 工具（prose_check / collapse_check / entity_budget_check）+ canon_delta 确定性提案工具（PR #122-#125）；LLM 出网传输全收敛 `app/common/llm_client.py`（PR #124/#125，生产 httpx 归零）；前端测试 vitest 单跑、verify-unit 已删（PR #124）。全量门禁（2026-07-11）：API pytest 939、前端 vitest 148、e2e 契约绿、OpenAPI 零漂移。
- 2026-07-31 已合并（Codex Desktop 式「对项目的权限」）：档位词表收敛为 **read / ask / auto / full**（只读 / 询问 / 自动 / 完全放行），DEFAULT=`ask`，**所有历史档位（risk_confirm / step_confirm / autonomous / full_allow）一律迁到 ask——迁移绝不把任何人升级成免点击落盘**；档位改为**按项目**存本机（`localStorage` 的 `storyforge:agent-permission:<projectPath>`，照 daily-progress 模式；刻意不写进 `.storyforge/`，避免授权随 git 传播），入口收在 Composer 下拉、SettingsView 不再有全局 Agent 分区；**写回红线改写**——后端在任何档位都不写项目文件（这条没变），变的是「作者必须逐次点接受」：`proposed_patch.requires_confirmation` 改由 `PermissionPolicy.decide_stage(profile, "writeback")` 单点派生（read/ask=True，auto/full=False），Desktop 只读这一位、不自己按档位字符串推；自动落盘仍逐次走 `performGuardedWriteback`（写前快照 → 原子写 → 版本记录 + 撤销 toast），漂移拒写、`.storyforge/canon/derived/` 只读、项目边界一律不放宽（`writeAcceptedSuggestion` 补上了此前缺失的派生目录闸）；`full` 档额外免除 BookRun 长任务的二次确认（2026-07-31 时点；此后 live 循环已不注册 `bookrun.*` 工具，BookRun 仅经后台 managed run 适配器运行，该豁免不再对应 live 入口）；Ctrl+K / Ctrl+Shift+K 走 `/api/assistant/*` 不经后端 gate，**只被只读档挡住发起**（自动档下仍要 Alt+Enter 手动接受，因为那是作者在光标处主动发起的）；`confirmed` / `user_confirmed` 已加入 `PROTECTED_LOOP_TOOL_ARGUMENT_KEYS`（模型不能自填权限授予）。真机「改档 → 自动落盘 → 撤销 → 重启后档位仍在」未验，归 E2E-1。
- 自主连载 pivot：2026-07-07 拍板方向（网文中位以上自主连载）+ 完成番茄平台政策与数据面侦察；2026-07-10 收窄（近期作者即 oracle，品味机 deferred）；**2026-07-11 拍板「编辑器优先」**——08-31 盛夏寻章不当锚，先把编辑器做到「安全可日更」（装机前两小刀 → 重建 0.1.2 → AI 装机预验 → 真机第二轮观感波 → 修复锁版），再在编辑器上接续 n=1 连载；愿景 = 写 → 发 → 收集信号 → 喂 → 进化编辑器 → 写出更有风格的作品；n=1 创作资产已存档仓库外 `D:\记事本\`（勿入库）。
- 真实 LLM 1 章、3 章和 10 章 smoke 已完成脱敏验证，其中 10 章 smoke 已通过人工通读，最终门禁为 `gate: pass_for_real_10ch_final_acceptance`。
- 一次 30 章真实长程已经跑完并导出 Markdown、EPUB 和审计报告，证据目录为 `.codex/real-llm-30ch-mimo25pro-20260611-192356`；但人工通读结论是**退回重跑**。2026-06-30 Q9 16 章真实跑修复门禁丢章四根因并抢救为完整 16 章、人工通读通过（PR #40/#41）。
- 因此当前只能宣称“真实长程运行链路可达、制品导出成立”，不能宣称真实 3-5 万字长程质量验收通过，也不能宣称稳定生产级长篇生产闭环。
- 2026-10-11 至 10-16（TS 引擎迁移，计划与逐刀进度见 `docs/architecture/ts-engine-migration-plan.md`）：P0–P4 把 agent 循环、修订 / 续写、IDE 命令、会话与运行存储逐模块搬进 `packages/engine`（golden 预言机比对 Python 行为、影子档在装机版后台比对）；P5 切默认；作者拍板一路做到删 Python（不出中间包）；P6 拆除：前端只走引擎（#366/#367）、宿主不再起后端（#369）、打包去 sidecar（#371，NSIS 80.9 → 32.8 MB）、门禁去 Python / OpenAPI（#372）、删 `apps/api` 等（#373，最后一版 `5e6f8e58`）。

## 2. 技术栈

- **Desktop IDE（唯一产品）：** Tauri 2 + Vite + React 18 + Monaco Editor。
- **TS 引擎（`packages/engine`，业务真相源）：** agent 工具循环、修订 / 续写 / 起草、IDE 命令、知识提议、章节检查、跨章一致性、语义评审、模型调用协议都在这里，在桌面端 WebView 里进程内运行（界面经 `lib/api` 进引擎，`lib/engine` 给引擎装配原生读写口）。2026-10 从 Python 后端逐模块迁来，迁移时录下的 golden 预言机输出冻结在 `packages/engine/golden/`。
- **Rust 宿主（`apps/desktop/src-tauri`）：** 本地文件读写口（项目边界、原子写、写回回执）、引擎库端口（SQLite）、模型出网（reqwest；**key 只在 Rust 里**，`llm-provider.json` 加密存本机）、影子 git（随包 MinGit，快照与版本）、退出握手。宿主不起任何后端进程。
- **共享内核：** `packages/project-core`（路径围栏等，全产品单一事实源）。
- **包管理：** pnpm 9.x workspace；`apps/desktop/frontend` 是独立 npm 工程（自带 `package-lock.json`）。
- **已删除（2026-10-16，P6-5）：** Python 后端 `apps/api`（FastAPI / SQLAlchemy / Alembic / pytest）、OpenAPI 契约与 `packages/shared`、PostgreSQL / Redis / MinIO / Sentry / Prometheus、Docker 编排。删除前最后一版是 `5e6f8e58`，引擎注释里「与 Python 某文件同语义」指的就是这一版，用 `git show 5e6f8e58:apps/api/<路径>` 取。

## 3. 仓库布局

```
apps/
  desktop/
    frontend/     React + Monaco 界面；src/lib/api 是进引擎的唯一入口，src/lib/engine 装配引擎的原生读写口
    src-tauri/    Rust 宿主：fs / engine_db / engine_llm / llm_config_store / shadow_git / host_close / smoke_ui
    scripts/      Tauri 冒烟、NSIS 安装校验、随包 git 准备
packages/
  engine/         TS 引擎：src/{loop,assistant,kernel,llm,judge,store}；golden/ 冻结的预言机输出与帧契约 schema
  project-core/   路径围栏等共享内核
scripts/          verify-local.mjs（根门禁）/ fast-tests.mjs（pre-push）/ lib/emit-agent-ws-types.mjs（帧类型生成）
docs/             架构与运维文档；docs/architecture/ts-engine-migration-plan.md 是迁移计划与逐刀进度
.codex/           验证报告（verification-report.md），所有变更必须留痕
```

本机数据：引擎库 `%LOCALAPPDATA%\com.storyforge.ide\storyforge-engine.sqlite3`；旧版（Python）的 `storyforge.sqlite3` 在同一目录，新引擎第一次打开时只读导入一次、不改它；模型配置 `%APPDATA%\com.storyforge.ide\llm-provider.json`。

## 4. 常用命令

```bash
pnpm dev               # 桌面 IDE（Vite + Tauri 窗口）
pnpm desktop:build     # 打 NSIS 安装包（约 33 MB）
pnpm verify            # 提交前必跑，8 道门（见下）
pnpm test              # apps/desktop 全套（含 Rust 测试与 Tauri 冒烟）+ project-core + 引擎
pnpm lint:fix          # 自动修复格式与 lint
```

- `pnpm verify`（`scripts/verify-local.mjs`）：lint → 前端类型检查 → project-core → TS 引擎类型检查与 golden 契约 → 前端单测 → 行间续写 / 浏览器冒烟 / Agent 对话三个浏览器回归（隔离 FS，后端是 `tests/support/http-*-double.ts` 替身，经 `scripts/http-doubles-plugin.mjs` 接入）。
- pre-push hook（`pnpm hooks:install` 启用）= lint + 前端单测 + TS 引擎；绕过用 `git push --no-verify`，绕过即自担风险。
- Rust：`npm --prefix apps/desktop run test:rust`。Tauri 冒烟：`npm --prefix apps/desktop run verify:tauri-smoke`（开发档）、`node apps/desktop/scripts/verify-tauri-smoke.mjs --release`（发行版 exe）。
- 真宿主探针（真 WebView + 真原生端口，合成输入）：在 `apps/desktop/frontend` 下 `node scripts/verify-engine-p0-native.mjs --agent-only`（另有 `--cpu-only` / `--context-only` / `--reader-only` / `--llm-only` / `--assistant-only`；`--assistant-real` / `--agent-real` 用作者的模型配置、会花钱）。本机有 StoryForge 在跑时探针按设计拒绝启动。
- 帧契约：改 `packages/engine/golden/agent-ws.schema.json` 要同改引擎 `loop/frames.ts`，再 `node scripts/lib/emit-agent-ws-types.mjs --write` 重新生成前端 `lib/api/generated/agent-ws.ts`。
- 单独跑测试：`npm --prefix apps/desktop/frontend run test -- tests/xxx.test.ts`、`pnpm --filter @storyforge/engine test`。
- Windows 下 `pnpm.ps1` 可能被执行策略拦，改用 `pnpm.cmd`。

### prompt 实验结论（实验台已随 Python 删除）

- live 产字只有一条 prompt 链：`packages/engine/src/kernel/craft.ts::craftPromptClause()`（扁平子句，chat 循环 / 修订 / 起草 / 续写共用）。改产字或评稿 prompt 前要有对比证据；原 `apps/api/scripts/prompt_lab/` 实验台在 `5e6f8e58` 里，结论与逐字引文记档在 `.codex/verification-report.md`（搜 `prompt_lab` / `wave`）。
- **已裁定（2026-07-31~08-01）：** 删创作准则的好坏对照锚点 → adopt；`half-examples` 不采用；`task-rewrite` 在无例基线上重测（完整章格 × 3 重复）未见优势，不 adopt。

## 5. 架构事实源

- **TS 引擎是业务真相源。** 判定在 `packages/engine` 里完成；界面不私自计算业务结论，也不直接引引擎——只经 `lib/api`（`tests/source-standards.test.ts` 钉死）。
- **Rust 宿主管本地副作用。** 读写项目文件、引擎库、模型出网、快照都经宿主命令；引擎通过注入的读写口使用它们，不直接碰磁盘或网络。写回红线：引擎在任何档位都只产出 proposed patch，落盘一律走界面的 guarded writeback（写前快照 → 原子写 → 版本记录）。
- **Desktop IDE 是主体验。** `apps/web` 已退场，不新增 Web 代码、脚本或测试。
- **帧契约与数据形状是冻结的。** 流帧 schema 在 `packages/engine/golden/agent-ws.schema.json`；会话 / 提议 / 检查历史等 14 个数据形状在 `apps/desktop/frontend/src/lib/api/contracts.ts`。改它们就是改契约，引擎与界面一起改。
- **退役的东西从 git 历史取。** `apps/workflow`（2026-07-26）、BookRun 自动整书链（2026-10-09）、Python 后端（2026-10-16，`5e6f8e58`）都已物理删除，需要旧实现时取出来重新评审，不要原样搬回。

## 6. 协作约定

- **引擎库 schema：** 前向迁移在 `packages/engine/src/store/schema.ts` 的 `ENGINE_MIGRATIONS`，只追加、不改已发布的条目，每条在一个事务里连同版本号提交；库版本比程序新时拒绝打开。旧库导入（`legacyImport`）按 Python 库的七张表逐列对齐，改表时要照顾导入路径。
- **语言：** 所有回复、文档、注释、日志、提交信息默认简体中文；代码标识符、包名、API 名称保留英文。
- **证据链：** 所有变更必须在 `.codex/verification-report.md` 留下验证记录（命令、输出摘要、未联通能力）；该文件是混合行尾，只做字节级追加。
- **小步推进：** 一次只解决一个明确问题，禁止顺手重构无关代码。
- **不写多余注释：** 只在 WHY 不明显时加一行；不要描述代码做了什么。
- **不写无关 README：** 除非用户明确要求。
- **不创建假数据兜底：** 数据缺失就明确返回错误，不要伪造空对象误导界面。
- **密钥：** 模型 key 只在 Rust 宿主里（加密落盘）；WebView、引擎库、日志、证据里只能出现占位符。

## 7. 可观测性

- 运行证据落引擎库：`agent_runs` / `agent_run_events`（每次 agent 运行的事件流，断线后可据此重建终态）、`assistant_tool_calls`（修订 / 续写 / 起草的输入输出摘要与生成来源）。
- 宿主日志走进程 stdout / stderr；冒烟与探针把证据写到 `output/`（不入库）。
- 没有 Sentry / Prometheus / 健康检查端点（随 Python 后端删除）。

## 8. 当前能做与不能做

**能做：**

- Desktop IDE：打开本地项目、文件树浏览、Monaco 编辑、版本记录、命令面板、保存快照；外观可调（默认纯中性，紫色只给 AI）。
- Desktop 对话式 Agent（全部在 TS 引擎里跑）：项目级会话（切文件不丢，左栏会话历史可切换 / 新建）、自由文本工具循环（只读 `fs.list` / `fs.read` / `fs.search`、一致性观察 `project.consistency`、深度一致性 `project.deep_consistency`、审稿 / 修订 / 起草等，逐调用证据链，流程树全事件驱动）、多视角审稿、稳定 issue id、范围控制、proposed patch（含新文件补丁自动打开目标文件）和按项目权限确认或自动执行的 guarded writeback；Ctrl+K 行间修订、Ctrl+Shift+K 光标处续写。
- 打开作品的第一屏：作品总览「接着写」与新会话伙伴先开口（确定性事实、不调模型，`lib/chapter-handoff.ts`）。
- 单机装机版：NSIS 安装包（不再内嵌任何后端）、BYO-key、改模型配置即生效；旧版会话 / 运行记录在第一次打开时导入新引擎库。
- 真实 LLM：1/3/10 章 smoke 有脱敏证据；30 章真实长程有链路证据但质量未通过；Q9 16 章真实跑门禁修复后人工通读通过（均为 Python 时期的证据）。

**不做：**

- 不能跑自动整书，也不能导出 Markdown / EPUB / 审计报告：BookRun 链已于 2026-10-09 退役。
- 不能宣称真实 3-5 万字长程质量验收通过；30 章真实长程已人工退回重跑。
- 不能把自动审计、golden 比对或模型自评等同于人工通读通过；golden 只证明引擎与迁移前的 Python 行为一致，不证明行为是对的。
- 不能宣称稳定生产级长篇生产闭环。
- 不能宣称「新引擎在作者真实写作里用过」：作者机上是 0.2.0（10-17 交付，第一个全量 TS 引擎的装机版），在它上面的真实写作还没有记录；#379 起的修复都还没打包。现有证据只有门禁、浏览器回归、真宿主探针与冻结 exe 冒烟，且没有 Python 可切回。
- 不能宣称「自动档」已在真机验收：「作者改档 → agent 直接落盘 → 撤销 → 重启后档位仍在」未在装机版点穿；撤销网仍薄（每文件 20 份快照上限、撤销 toast 只在内存里、新建文件无回滚点）。
- `project.consistency` 只产出机械观察信号；`project.deep_consistency` 的 issue 是 advisory 参考信号（隐性 / 跨章长程矛盾召回率未验），不得当作质量判定或验收结论。
- 暂不承诺多人协作、多租户、云端同步。

## 8.1 当前下一步优先级

**当前下一步执行入口以 `docs/internal/TODO.md` 为准。** 0.2.0（第一个没有 Python 的装机版）已于 2026-10-17 交付；之后合并的修复（含全项目查缺补漏 #419–#443）等 0.2.1 一起打包。迁移逐刀进度见 `docs/architecture/ts-engine-migration-plan.md` 的「P6 进度」。2026-07-11 定下的「编辑器优先、提名权交给真实写作摩擦」仍是现在的工作方式。

## 9. 常见陷阱

- **PowerShell 执行策略：** Windows 下 `pnpm.ps1` 可能被阻塞，改用 `pnpm.cmd`。
- **出包要用 `pnpm desktop:build`**，版本号改 `apps/desktop/src-tauri/tauri.conf.json` 与 `Cargo.toml` 两处（`Cargo.lock` 随 cargo 更新），已出过的版本号不能复用；本地验证构建与已发布版本同名时会覆盖 `bundle/nsis/` 里的发布安装包，出包后先另存。
- **浏览器回归不经过真宿主**：它们用 fetch 替身；改了引擎与宿主之间的接口，要跑真宿主探针或 Tauri 冒烟。
- **改引擎后连前端类型检查一起跑**：前端经 `lib/engine` 直接编译引擎源码。
- **引擎库与旧库并排**：别删 `storyforge.sqlite3`，旧库导入只读它一次；导入要求引擎库为空。
- **行尾**：仓库里 CRLF / LF 混用，按文件原有行尾改；提交前对照 `git diff --numstat` 与 `--ignore-all-space --numstat`。

## Agent skills

### Issue tracker

Issues and PRDs live in GitHub Issues for `XZZKANY/StoryForge`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: read root `CONTEXT.md` plus relevant architecture docs under `docs/architecture/`. See `docs/agents/domain.md`.
