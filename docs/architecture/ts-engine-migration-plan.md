# 后端换 TS：Python sidecar → 单进程 Tauri 迁移计划

状态：**草案，待作者拍板**（2026-10-10）。本文是这项迁移的唯一计划文档；拍板后按 §12 的决定表改成「执行中」，每个 PR 合并时在 §6 的清单里打勾。

---

## 0. 一页摘要

**做什么**：把安装包里单独跑的 Python 后端（FastAPI + SQLAlchemy + PyInstaller 冻结 exe，46 MB）整个搬进桌面 app 的 TypeScript 里，变成一个进程。界面不动，仍是 v1 的 Tauri 2 + React。`.storyforge/` 文件格式不动，手稿仍只由 Rust 原子写。

**为什么**：
- 两个进程对不上是 2026-09 到 10 月几乎全部可靠性工作的来源（强杀、断电、冷恢复、孤儿进程、版本握手、回执台账）。要发给别人用，这是最容易在别人电脑上出事的地方。
- Python 后端里约 **8,400 行**只因为它是独立服务和跨进程而存在；前端里约 **2,500 行**同理；Rust 里 main.rs 的 sidecar 段和七个模块同理。单进程后这些直接删，不用搬。
- PyInstaller 冻结 exe 常被杀毒软件误报，启动慢，安装包从 0.1.0 的 49 MB 涨到 0.1.10 的 75 MB。

**怎么做**：绞杀式，不推倒。每一步 app 都能用。前端调后端只有三个替换点（IDE 命令派发、assistant 单轮调用、agent 事件流），每个点加一个开关，默认走 Python，新引擎就绪后切 TS，出问题切回去。确定性代码用 Python 当预言机做逐字节比对；LLM 代码用录制回放；最后真 key 跑一轮再切默认。

**要搬多少**：Python 源码 43,092 行，其中删 8,410、搬 34,200（确定性内核 14,524 / LLM 通道 8,404 / agent 循环与管线 11,272）。

**多久**：全量搬 **9 到 11 周**；只搬你用的功能（见 §12 决定 C）**6 到 8 周**。我之前说的「一到两个月」是没清点前的估计，偏乐观。

**作者要做的事**：§12 的八个决定；阶段门禁时提供 key 跑真实验证（预算见 §12 决定 G）；Phase 5 和 Phase 7 在你机器上装一次。

---

## 1. 现状盘点（2026-10-10 实测）

### 1.1 进程与制品

| 项 | 数值 |
| --- | --- |
| 后端冻结 exe（`binaries/storyforge-api*.exe`） | 46.2 MB |
| NSIS 安装包 0.1.0 / 0.1.1 / 0.1.10 | 49.0 / 49.0 / 75.0 MB |
| 后端起服链 | Tauri 起 sidecar → 轮询 `/health/ready` → 比对 `app_version` → 不符则 taskkill 旧孤儿重启 |
| 本机 Python 版本依赖 | 17 个（含 psycopg、redis、boto3、sentry、prometheus、pyjwt、limits，单机 app 全用不上） |

### 1.2 后端代码（`apps/api/app`，43,092 行源码，不含测试）

按迁移处置分四类（按文件名归类，见 §6 逐文件清单）：

| 处置 | 行数 | 文件数 | 内容 |
| --- | --- | --- | --- |
| **删**：服务与跨进程 | 8,410 | 64 | FastAPI 装配、路由、中间件、鉴权、限流、metrics、sentry、redis、s3、SQLAlchemy/alembic、外部写回协议（`loop/external_*`、writeback 路由、回执、交付审计）、宿主关闭握手、run 存储/控制/执行/生命周期的服务层、系统任务 |
| **搬 · 确定性内核**（golden 逐字节比对） | 14,524 | 71 | canon 链、各类扫描、serial plan、book_context、manuscript 读序、知识库、拆书、评审推理、craft/文风/标点/作者编辑策略、工具 schema、事件类型与编码 |
| **搬 · LLM 通道与 provider**（录制回放） | 8,404 | 39 | `llm_client` 及其配置链、脱敏、`platform/ai_sdk`（循环、三家 provider、工具校验）、assistant 单轮（revise / continue / draft / chat）、语义 judge |
| **搬 · agent 循环 / 工具 / 管线**（行为测试） | 11,272 | 58 | `loop/` 非 external 部分、`tools/` 与 28 个工具 spec、`patches/`、`adapters/` 五条管线、权限策略、llm_context、runtime、save points、deep consistency |
| 未归类 | 482 | 8 | `author_chat.py`（终端 CLI，删）、小工具模块（随所属模块走） |

### 1.3 对外面

- **OpenAPI 35 条路径**，桌面端实际调用的前缀只有 `/api/agent-runs`、`/api/assistant`、`/api/ide` 加 `/health`：
  - `agent-runs`：`capabilities`、`chapter-checks/query`、`host/closing`、`knowledge-proposals/{materialize,query,refresh,resolve,revise}`、`roles`、`roles/resolve`、`skills`、`writeback-recovery`、`{run_id}`、`{run_id}/{artifacts,events,events/stream,save-points,writeback}`、`{run_id}/writeback/{wait_id}/{prepare,reconcile,recover}`
  - `assistant`：`continue`、`provider-health`、`revise`、`sessions`、`sessions/{id}`、`sessions/{id}/messages`、`sessions/{id}/tool-calls`、`tool-calls/{id}`
  - `ide`：`agent/sessions/{id}/control`、`agent/sessions/{id}/stream`（SSE）、`commands/{command_id}`、`review/cross-chapter`
  - `health`：`live`、`ready`
- **IDE 命令 9 个**：`audit.open`、`book.breakdown`、`book.breakdown.cancel`、`book.breakdown.status`、`book.context`、`canon.refresh`、`observatory.scan`、`plan.mark_written`、`plan.unmark_written`。
- **agent 循环工具 28 个**（按 spec 文件）：
  - `context_fs_specs`：`context.load`、`fs.list`、`fs.read`、`fs.search`、`knowledge.propose`、`project.knowledge`
  - `patch_specs`：`chapter.polish`、`file.create`、`file.review`、`file.revise`、`judge.run`、`project.trim_prose`、`prose.continue`
  - `chapter_specs`：`chapter.brief`、`chapter.check`、`chapter.draft`、`chapter.repair`
  - `project_canon_specs`：`project.canon`、`project.canon_delta`、`project.promise_check`
  - `project_consistency_specs`：`project.consistency`、`project.cross_chapter_check`、`project.deep_consistency`
  - `project_specs`：`project.collapse_check`、`project.entity_budget_check`、`project.plan_update`、`project.prose_check`
  - `hook_specs`：`project.hooks_delta`
- **SSE 帧 11 种**（`packages/shared/src/contracts/agent-ws.schema.json`）：`AgentRunStartedFrame`、`AgentRunWaitingFrame`、`AgentStepFrame`、`AgentTextStreamStartedFrame`、`AgentTextDeltaFrame`、`ToolTraceFrame`、`PermissionRequiredFrame`、`ControlAckFrame`、`TerminalFrame`、`AgentExecutionOutcome`、`AgentRuntimeInterruption`。前端 `useAgentStreamEvent` 等消费层只认这些形状。
- **数据库 7 张表**（`%LOCALAPPDATA%\com.storyforge.ide\storyforge.sqlite3`，2.2 MB + WAL 4.1 MB）：`agent_runs`、`agent_run_events`、`agent_artifacts`、`subagent_runs`、`assistant_sessions`、`assistant_messages`、`assistant_tool_calls`（+ `alembic_version`）。作者库实测行数：runs 55 / sessions 16 / messages 110 / events 524 / artifacts 71 / tool_calls 246。

### 1.4 Rust（`apps/desktop/src-tauri/src`，10,074 行）

| 模块 | 行 | 迁移后 |
| --- | --- | --- |
| `main.rs` | 2,101 | **瘦身**：删 sidecar 段（`spawn_api_sidecar`、`spawn_dev_api_server`、`start_api_server`、`wait_api_ready`、`is_api_ready`、`fetch_api_version`、`kill_process_on_port`、`kill_windows_process_tree`、`backend_env`、`desktop_api_*`、`should_*`、`get_api_config`、docker/migrations 启动）；smoke probe 段改为不依赖 API |
| `fs.rs` + `fs_conditional_tests.rs` | 1,145 | **保留原样**：containment、原子写、`write_file_if_unchanged`、list/read |
| `shadow_git*` | 2,490 | **保留原样**：影子快照用内置 MinGit |
| `fs_writeback_receipts*` + `managed_writeback.rs` | 1,390 | **先保留、后简化**（§9） |
| `llm_config_store*` + `llm_config.rs` + `secret_protection.rs` | 732 | **保留原样**：`llm-provider.json` 读写、DPAPI |
| `managed_agent_host.rs`、`host_close.rs`、`host_close_state.rs`、`owned_process_tree*`、`external_native_ipc_fixture.rs`、`external_chat_bridge_tests.rs` | 1,017 | **删**：全部是宿主与 sidecar 之间的进程归属、关闭握手、Job 对象、IPC 夹具 |
| `smoke_ui.rs`、`lifecycle_gui_fixture.rs` | 1,003 | **改**：去掉等 API 就绪、`gui_lifecycle_backend.py` 夹具 |
| `runtime_paths.rs` | 196 | 保留 |

Tauri 命令 28 个，前端全部在用；迁移新增 2 个插件（§2.4）。

### 1.5 前端（`apps/desktop/frontend/src`）

- 只因跨进程存在、迁移后删或缩成一行的代码：`lib/api/*` 2,267 行中的传输层、`lib/external-writeback/` 656 行、`ExternalWritebackProvider/Panel`、`useAgentRunRecovery` / `useAgentRunReconciliation` / `useAgentRunAdmission` / `suggestion-recovery` / `writeback-receipt*` / `native-delivery` 中的跨进程分支，合计约 **2,500 行**。
- **三个替换点**（整个迁移的开关都在这里）：
  1. `lib/api/ide-commands.ts`（27 行）的 `executeIdeCommand(id, args)`，8 个调用方。
  2. `lib/api/assistant.ts`（243 行）：`reviseFileContent`、`streamContinueProse`、`listAssistantSessions`、`getAssistantSession`、`probeProviderHealth`。
  3. `lib/api/agent-socket.ts`（486 行）：`sendAgentUserMessage`（SSE）与 `sendAgentControlMessage`。
- 权限四档已在 TS（`lib/agent-permission.ts`），后端只派生 `requires_confirmation`。

### 1.6 测试与门禁

- pytest：**1,844 个测试函数 / 230 文件**（参数化后 3,299 用例）。按关心的事分：外部写回/回执/恢复/宿主 252（35 文件，**随删除退役**）；内核类扫描/计划/知识/观测 271（27 文件，转 golden）；ide/拆书/跨章 214（28 文件）；loop/sdk 165（25 文件）；llm/provider/脱敏 137（16 文件）；canon 131（8 文件）；assistant 74（8 文件）；源码规范/契约/迁移/schema 116（16 文件，部分转 vitest、部分退役）。
- 前端 vitest 1,939；Rust 103；e2e 契约 2 个 spec；`verify-local.mjs` 10 道门；pre-push = lint + OpenAPI 漂移 + 活路径 pytest + 前端 vitest。
- **注意**：`apps/api/tests/test_source_code_standards.py` 在用 Python 给**前端**文件体积设门禁（App 400、ChatWindow 500 等）。Python 删掉前必须把它搬成 vitest（§7.4）。

### 1.7 作者的实际配置

`llm-provider.json` schemaVersion 2，`provider: "openai"`，自定义 `baseUrl`（中转站），模型为 Claude 系。**OpenAI 兼容协议是必做项**，Anthropic / Gemini 原生协议见 §12 决定 B。

---

## 2. 目标架构

```
┌──────────────────────────── StoryForge.exe（唯一进程）────────────────────────────┐
│  WebView2（React 18 + Monaco，v1 界面原样）                                         │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │ @storyforge/engine（纯 TS，无 Tauri 依赖，vitest 可测）                       │  │
│  │  kernel/   canon · scans · serialPlan · bookContext · manuscript · knowledge  │  │
│  │  prompts/  craft · llmContext · chapter 管线提示词（逐字节同 Python）          │  │
│  │  llm/      OpenAI 兼容流式客户端 · (Anthropic · Gemini 待定) · 脱敏 · 重试    │  │
│  │  loop/     工具循环 · 28 工具 · 权限策略 · 事件帧（同 11 种）                  │  │
│  │  pipelines/ chapter.write · chapter.polish · file.review · revise · create     │  │
│  │  store/    sessions · messages · runs · events · artifacts（SQL 由 port 提供） │  │
│  │  ports/    Fs · Http · Db · Clock · Random（接口）                             │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│   适配器（apps/desktop/frontend/src/engine/）：                                      │
│     Fs  → 既有 Tauri 命令 read_project_file / list_dir / path_exists（containment 不变）│
│     Http→ @tauri-apps/plugin-http（Rust reqwest 发请求，无 CORS）                    │
│     Db  → @tauri-apps/plugin-sql（sqlite，WAL）                                      │
│     Key → 既有 get_llm_config / save_llm_config                                      │
│   写回不变：performGuardedWriteback → Rust write_file*（快照 → 原子写 → 版本记录）    │
├──────────────────────────────────────────────────────────────────────────────────┤
│  Rust 主进程：fs · shadow_git · llm_config_store · 窗口 · 单实例（无 sidecar）        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 引擎放哪

`packages/engine/`（`@storyforge/engine`），与 `packages/project-core` 同级，前端用 `file:` 依赖引入（前端是独立 npm 工程）。纯 TS，不 import `@tauri-apps/*`；所有副作用经 `ports/` 接口注入。这样 vitest 用内存适配器就能跑全部内核与循环测试，golden 比对不需要起 app。

### 2.2 在哪个线程跑

主线程。agent 循环是 I/O 绑定（等模型），不占 CPU。确定性扫描在 1 MB 正文上实测后再决定要不要进 Web Worker（Phase 0 第 3 项）；扫描是纯函数，进 Worker 只需 `postMessage` 文本，不需要 IPC。

### 2.3 数据存储

新建 `storyforge-engine.sqlite3`（与旧库并排），6 张表：`sessions`、`messages`、`runs`、`run_events`、`artifacts`、`tool_calls`；`schema_version` 表管前向迁移（TS 里手写 `migrations/0001.sql …`，无 alembic）。`subagent_runs` 确认无消费方后不建（§12 决定 C）。

旧库**只读导入一次**（Phase 4）：sessions / messages 全导，runs / events / artifacts 按需导（终态 run 只导摘要），导入后写标记，旧文件永不改动——回滚 0.1.10 时数据完好。

### 2.4 新增 Tauri 插件（crates.io 2026-10-10 查询）

| 插件 | 版本 | 用途 | 替代方案 |
| --- | --- | --- | --- |
| `tauri-plugin-http` | 2.8.2 | 从 Rust 发模型请求，流式读响应 | 若流式不达标：自写一个 Rust 命令 `llm_stream`，reqwest 流 + `tauri::ipc::Channel` 推 chunk（约 80 行，Cargo 已有 reqwest） |
| `tauri-plugin-sql` | 2.5.0 | sqlite | `tauri-plugin-store`（JSON，不够关系查询）；不选 |

### 2.5 事件流

引擎的 `runAgent(input, { onFrame })` 直接回调前端，帧类型沿用 `lib/api/generated/agent-ws.ts` 的 11 种。`agent-socket.ts` 的 SSE 解析改为进程内订阅，**消费层（`useAgentStreamEvent`、步骤映射、恢复展示）零改动**。Python 退役后，TS 类型成为帧契约的唯一来源，加一个 JSON schema 快照测试防前端消费层漂移。

### 2.6 run 生命周期（简化后）

状态集不变：running / waiting / paused / stopped / completed / failed。差别只在恢复：

1. 等待确认（权限、补丁、章纲）= 一个未决的 Promise，UI 点了就继续；不再有「外部写回等待」「世代」「回执核对」。
2. 写回仍由前端 + Rust 做；引擎在 `await writeback()` 返回后才把 run 标 settled，同一个 JS 运行时里没有「写了但没记上」的窗口。保留一个很薄的意图日志（写前 append、写后 append、启动时对账）兜崩溃。
3. 启动时发现上次 run 不是终态 → 标 `interrupted`，artifacts（含 proposed patch）原样保留可查看；不自动续跑。

关窗语义与 v1 实际一致：v1 已用 Windows Job 把 sidecar 和宿主绑死，关窗即停早就是现状。

---

## 3. 不变量（红线，每个 PR 都要能证伪）

1. `.storyforge/` 下所有文件格式不变（`book.json`、`canon/canon.json`、`canon/derived/*`、`serial-plan.json`、`versions/`、`checkpoints/`、`author-loop/`）。
2. 手稿只由 Rust `write_file*` 写；引擎永不写手稿（与「后端不写盘」红线同义）。
3. 权限四档语义不变；`requires_confirmation` 的派生规则逐案例同 Python。
4. 送进模型的 system / user 文本与 Python **逐字节相同**（craft、llm_context、book_context 块、五条管线提示词、工具描述）。
5. 工具 JSON schema 与 Python 生成的逐字节相同（`test_loop_tool_schemas.py` 的 golden 搬过来）。
6. 11 种帧的字段与语义不变。
7. BYO key 位置与格式不变（`%APPDATA%\com.storyforge.ide\llm-provider.json`）。
8. 旧会话数据导入不丢、旧库不改。
9. 迁移期间 UI 零改动、Python 只修不加。

---

## 4. 迁移机制

### 4.1 三道开关

`lib/engine/flags.ts`：`engine.ideCommands`、`engine.assistant`、`engine.agentLoop`，各三档 `python | ts | shadow`，存 `localStorage`（dev）与设置页（私测版）。默认值随阶段推进：Phase 1 末 ideCommands=shadow，Phase 2 末 assistant=ts，Phase 5 末全部 ts，Phase 6 删开关。

### 4.2 影子模式

`shadow` 档两边都跑，结果给 Python 的，TS 的与之 deep-diff，差异写到 `%LOCALAPPDATA%\com.storyforge.ide\shadow-diffs.jsonl`（只记结构化差异与路径，不记正文）。用作者自己的书跑一周，差异归零才允许切 `ts`。对 LLM 路径影子模式只比 prompt 文本，不双倍花钱。

### 4.3 golden 预言机

`apps/api/scripts/golden_dump.py`：对 §6 标「golden」的每个纯函数，用合成夹具（入库，`packages/engine/golden/*.json`）和作者作品副本（**不入库**，本机生成到 `packages/engine/golden-local/`，已 gitignore）各跑一遍，输出 `{input, output}`。TS 测试读同一文件断言 deep-equal / 字符串相等。Python 删除前把合成夹具的输出冻结入库，之后 TS 测试不再依赖 Python。

### 4.4 录制回放

LLM 路径沿用 Python 的 `providers/deterministic.py` 思路：TS 一个 `ScriptedProvider`，按剧本返回文本与工具调用；真实对话录制成 `packages/engine/recordings/*.json`（脱敏，正文替换为占位）。每阶段末用作者 key 做一次 headless 真跑（同 `.codex/real-llm-agent-loop-*` 的做法），预算见 §12 决定 G。

### 4.5 PR 纪律

- 每个 PR 只做 §6 清单里一组模块，diff 控制在 1,500 行内（golden 夹具除外）。
- 每个 PR 自带：golden / 行为测试、变异验证（至少一处）、`.codex/verification-report.md` 记录、两组 numstat 一致。
- 开关默认值在独立 PR 里切，不混在功能 PR。
- 不改 UI、不改 `.storyforge/` 格式、不往 Python 加功能。

---

## 5. 分阶段计划

| 阶段 | 内容 | 时长 | 退出条件 |
| --- | --- | --- | --- |
| **P0 探针** | 验证流式、sqlite、CPU、golden 流水线、无 sidecar 构建 | 3 到 5 天 | 五项探针各有结论与数字 |
| **P1 内核** | 14.5k 行确定性代码 + 9 个 IDE 命令 → TS，golden 全绿 | 2.5 到 3 周 | `ideCommands=shadow` 跑作者副本一周差异为零 |
| **P2 LLM 通道 + assistant** | 流式客户端、脱敏、重试、记账；revise / continue / draft / chat / provider-health | 1.5 周 | Ctrl+K、Ctrl+Shift+K 走 TS，真跑一轮 |
| **P3 循环 / 工具 / 管线** | 工具循环、28 工具、权限、五条管线、帧流 | 3 周 | `agentLoop=ts` 下全部 28 工具的录制回放与行为测试绿；真跑一轮覆盖写章 / 审稿 / 修订 |
| **P4 存储与导入** | sqlite 表、会话历史、旧库导入 | 1 周 | 作者库副本导入零丢失 |
| **P5 影子与切换** | 三开关 shadow → ts；作者机装预览版用一周 | 1 周 | 影子差异为零；作者点头 |
| **P6 拆除** | 删 Python、sidecar、Rust 跨进程模块、前端跨进程层、旧门禁；门禁改造 | 1 到 1.5 周 | 仓库无 `apps/api`，`pnpm verify` 新门禁全绿 |
| **P7 发版** | 0.2.0 NSIS、升级覆盖验证、安装包体积 | 3 天 | 作者机从 0.1.10 覆盖安装成功、数据在 |

合计 **9 到 11 周**（全量）。精简版（§12 决定 C 全选「不搬」）P1 少 1 周、P3 少 1 周 → **6 到 8 周**。

### P0 探针（PR 编号 P0-1 … P0-5，可并行）

| # | 探针 | 做法 | 判据 |
| --- | --- | --- | --- |
| P0-1 | 流式响应 | 在 dev 构建里装 `plugin-http`，对作者的 baseUrl 发 `stream: true` 请求，记录首 token 延迟与是否逐块到达 | 逐块到达且首块 < 3 s；否则改 Rust `llm_stream` 命令 |
| P0-2 | sqlite | `plugin-sql` 打开旧库只读查 16 个会话；新建库 + WAL；量启动耗时 | 读旧库成功；新库建表 < 100 ms |
| P0-3 | CPU | 把 `prose_scan` 的正则部分手搬一小段，在合成 1 MB 正文上主线程跑 | < 200 ms 留主线程，否则规划 Worker |
| P0-4 | golden 流水线 | 以 `manuscript` 读序 + `book_context` 渲染为样本打通 Python dump → TS 测试 | 两个函数逐字节相等，含 CRLF 与末尾换行 |
| P0-5 | 无 sidecar 构建 | 临时去掉 `externalBin` 打 NSIS，量体积 | 预期 25 到 30 MB，给作者看 |

P0 结束出一份 `verification-report` 记录，附数字，再决定 P1 开工。

### P1 内核（PR P1-1 … P1-9）

| # | 范围（Python → TS） | 验证 |
| --- | --- | --- |
| P1-1 | 脚手架：`packages/engine`、ports、vitest、golden 目录、`golden_dump.py` 骨架、三道开关（全 `python`） | 空跑绿 |
| P1-2 | `common/manuscript.py`、`project_tree.py`、`punctuation.py`、`math.py`、路径与排序工具（见 §8 风险 1、2） | golden |
| P1-3 | canon 链：`canon_store`、`canon_gate`、`canon_assertions`、`canon_context`、`canon_dossier`、`canon_rebuild`、`canon_cache_freshness`、`canon_service` | golden（含 derived 缓存文件逐字节） |
| P1-4 | 扫描：`prose_scan` + `prose_pattern_rules`、`promise_scan`、`collapse_scan`、`entity_budget_scan`、`consistency_scan`、`cross_chapter`、`observatory` | golden |
| P1-5 | 提案：`canon_delta`、`canon_hooks_delta`、`serial_plan`、`serial_plan_update` | golden |
| P1-6 | 上下文投影：`book_context`、`knowledge_context`、`fs/project_knowledge`、`fs/knowledge_entries`、`fs/knowledge_retrieval`、`fs/knowledge_proposals`、`fs/ordinary_context`、`events/knowledge_inbox`、`events/knowledge_materialization`、`compaction*`（§12 决定 C 可裁） | golden |
| P1-7 | 文风与策略：`craft`、`style_baseline`、`style_fingerprint`、`author_voice`、`author_edit_policy`、`generation_sources`、`generation_delivery`、`review_report`、`revise_scope`、`role_catalog`、`skill_catalog` | golden（prompt 子句逐字节） |
| P1-8 | IDE 命令 9 个：`command_registry`、`book_breakdown*`、`review_reasoning`、`review_skills`、`cross_chapter_consistency`，接到 `executeIdeCommand` 的 `ts` 档 | golden + 前端既有测试（mock 不变） |
| P1-9 | 切 `ideCommands=shadow`，作者副本跑一周 | 差异文件为空 |

### P2 LLM 通道 + assistant（PR P2-1 … P2-4）

| # | 范围 | 验证 |
| --- | --- | --- |
| P2-1 | `llm/`：OpenAI 兼容 chat/completions 流式客户端、`llm_env` 覆盖链（env → 配置文件）、`llm_config_file`、`redaction`、`stream_text`、重试与 `Retry-After`、用量与成本估算（`_token_usage`、`_cost_breakdown`）、`llm_control`、`llm_observation` | 录制回放；脱敏单测；与 Python 对同一响应的用量计算 golden |
| P2-2 | Anthropic / Gemini 原生 provider（按 §12 决定 B） | 录制回放 |
| P2-3 | assistant：`revise_file_content`、`stream_continue_prose`、`draft_file_content`、`chat_reply`、`probe_provider_health`、`writing_context`、`continuation`、`revision`；接 `assistant.ts` 的 `ts` 档 | prompt golden + 录制回放 + 前端既有行为测试 |
| P2-4 | 真跑：Ctrl+K 行内改一次、Ctrl+Shift+K 续写一次，作者 key，记录 token | 作者看结果 |

### P3 循环 / 工具 / 管线（PR P3-1 … P3-8）

| # | 范围 | 验证 |
| --- | --- | --- |
| P3-1 | `ai_sdk/runtime`（loop、state、budget、feedback、external_results 中非外部部分）、`tools/validation`、`tools/registry`、`contracts`、`capabilities` | 录制回放 |
| P3-2 | `permission/policy`（含 `PROTECTED_LOOP_TOOL_ARGUMENT_KEYS`）、`intent`、`tooling`、`text_stream`、`run_payloads`、`result_contracts`、`event_types`、`event_encoders`、11 帧 TS 类型钉死 | 策略逐案例 golden；帧 schema 快照 |
| P3-3 | 工具层：`tools/spec_models`、`loop_schema`、`execution*`、`runtime_arguments`、7 个 spec 文件、`fs_tools` + `fs_safety`（fs 工具改走 Tauri 命令）、`project_checks_runtime`、`project_canon_runtime`、`prose_continue_runtime`、`fs/runtime_tools` | 工具 schema golden（`test_loop_tool_schemas` 搬）；行为测试 |
| P3-4 | `llm_context`、`llm_prompt_context`、`loop/context_values`、`loop/prompt_context`、`loop/sdk_context`、`loop/support`、`loop/author_view`、`request_evidence`、`context_provenance`、`context_channel_requests` | system prompt 逐字节 golden（用录制的真实上下文） |
| P3-5 | 循环本体：`loop_runtime`、`runtime`、`loop/conversation_runtime`、`loop/sdk_adapters`、`loop/run_control`、`loop/types`、`loop/checkpoint_store`（缩）、`loop/recovery*`（缩成 §2.6 三条规则）、`save_points`、`events/runtime_support`、`events/contracts`、`events/chapter_checks` | 录制回放 + 中断 / 暂停 / 停止行为测试 |
| P3-6 | 管线：`adapters/chapter_writing_pipeline`、`chapter_writing_contracts`、`chapter_writing_tools`、`chapter_generation_pipeline`、`chapter_check_protocol`、`chapter_source_guard`、`chapter_polishing_pipeline`、`file_review_pipeline`、`intent_fixed_pipeline_adapter`；`patches/*`（polishing、polish_context、polish_fact_guards、writing_context、revise_input、runtime_tools）；`deep_consistency` + `judge/semantic` | 五条管线各一份录制回放；提示词 golden |
| P3-7 | 接 `agent-socket.ts` 的 `ts` 档：进程内帧回调；控制通道（暂停 / 停止 / 恢复 / 权限批准 / 补丁决定） | 前端既有 ChatWindow 行为测试全绿（mock 换成引擎） |
| P3-8 | 真跑：新会话 → 起草下一章 → 章纲确认 → 草稿 → 补丁接受写回；再跑一次审稿、一次修订 | 作者看结果；记录 token |

### P4 存储与导入（PR P4-1 … P4-3）

| # | 范围 | 验证 |
| --- | --- | --- |
| P4-1 | `store/`：6 张表、`schema_version`、迁移机制、Db port 的 plugin-sql 适配器与内存适配器 | 单测；并发写顺序测试 |
| P4-2 | 会话列表 / 历史 / 消息持久化 / tool_calls 记账接到引擎（`listAssistantSessions`、`getAssistantSession` 走 `ts`） | 前端会话切换守卫测试全绿 |
| P4-3 | 旧库导入：首启动检测旧库 → 事务导入 → 写 `imported_from_v1` 标记；失败则不标记、下次重试 | 用作者库副本导入：16 会话 / 110 消息 / 55 run 逐条比对 |

### P5 影子与切换（PR P5-1 … P5-3）

| # | 范围 | 验证 |
| --- | --- | --- |
| P5-1 | `assistant`、`agentLoop` 开关进 shadow（只比 prompt）；作者机装预览版 | 影子差异文件为空 |
| P5-2 | 三开关默认 `ts`；Python 仍在、可切回 | 一周真实使用无回切 |
| P5-3 | 回归：前端全量 vitest、浏览器导览截图（`tour.mjs` 升级为仓库脚本）、Rust 测试 | 全绿 |

### P6 拆除（PR P6-1 … P6-7）

| # | 范围 |
| --- | --- |
| P6-1 | 前端：删三开关与 Python 传输实现、`lib/external-writeback/`、`ExternalWritebackProvider/Panel`、恢复 / 回执 / 交付的跨进程分支、`api-client` 的 key 注入、`runtime-health`、`managed-agent-host`、`HostCloseNotice` |
| P6-2 | Rust：删 main.rs sidecar 段与 §1.4 标「删」的模块；`smoke_ui` 去 API 依赖；`get_api_config` 删除 |
| P6-3 | 打包：`tauri.conf.json` 去 `externalBin`；删 `build-api-sidecar.mjs`、`sidecar-smoke.mjs`、`storyforge-api.spec`、`verify-nsis-install` 里的 sidecar 断言；`desktop:build` 不再先打 exe |
| P6-4 | 门禁：`test_source_code_standards.py` 搬为 `apps/desktop/frontend/tests/source-standards.test.ts`（体积上限、双轨 import 禁令改成 TS 规则）；删 OpenAPI 生成 / 漂移门、`tests/e2e` 契约、`packages/shared` 的 OpenAPI 快照与生成类型（帧类型留 engine）；`verify-local.mjs` 从 10 道门改为 7 道；pre-push 改为 lint + engine vitest + 前端 vitest |
| P6-5 | 删 `apps/api`、`alembic`、`uv.lock`、`docker-compose*.yml`、`deploy/`、`scripts/migrate.sh`、`dev-start.mjs` 的 docker / 迁移段；冻结 golden 输出入库 |
| P6-6 | 文档：CLAUDE.md §2 §3 §4 §5 §6 §9、`DOMAINS.md` 退役、`STRUCTURE.md`、`authoring-feedback.md`、`current-phase.md`、`TODO.md` |
| P6-7 | 记忆与报告：`verification-report` 总结一条，含前后体积、代码量、门禁清单 |

### P7 发版

版本号从 5 处（`tauri.conf.json`、`Cargo.toml`、`pyproject.toml`、根与 desktop `package.json`、OpenAPI `info.version`）变 3 处（`tauri.conf.json`、`Cargo.toml`、`package.json`）；0.2.0；作者机从 0.1.10 覆盖安装：旧 sidecar 若仍在跑先 taskkill（保留 main.rs 里那段握手逻辑的最后一次用途：启动时清理名为 `storyforge-api*` 的孤儿进程，0.3 删）；验证会话在、书打开、起草一章。

---

## 6. 逐模块搬迁清单

说明：「处置」= 删 / 搬 / 缩；「验证」= golden（逐字节）/ 录放（录制回放）/ 行为（行为测试）/ 单测；「阶段」对应 §5 的 PR 编号。按文件归类后的行数合计见 §1.2。

### 6.1 `app/common`（5,384 行）

| Python | 行 | 处置 | TS 目标 | 验证 | 阶段 |
| --- | --- | --- | --- | --- | --- |
| `llm_client.py` | 1,380 | 搬（缩，预计 ~450 行） | `engine/llm/client.ts`、`retry.ts`、`usage.ts` | 录放 + 用量 golden | P2-1 |
| `author_edit_policy.py` | 396 | 搬 | `engine/kernel/authorEditPolicy.ts` | golden | P1-7 |
| `generation_sources.py` | 263 | 搬 | `engine/kernel/generationSources.ts` | golden | P1-7 |
| `performance.py`、`performance_logging.py` | 294 | 删（改用 `performance.now()` 打点） | — | — | P6-5 |
| `style_baseline.py` | 250 | 搬（200 KB 读量预算保留） | `engine/kernel/styleBaseline.ts` | golden | P1-7 |
| `manuscript.py` | 202 | 搬 | `engine/kernel/manuscript.ts` | golden | P1-2 |
| `craft.py` | 189 | 搬 | `engine/prompts/craft.ts` | golden（逐字节） | P1-7 |
| `llm_env.py`、`llm_config_file.py`、`llm_protocol.py`、`llm_control.py`、`llm_observation.py` | 708 | 搬 | `engine/llm/config.ts`、`protocol.ts`、`control.ts`、`observation.ts` | 单测 | P2-1 |
| `redaction.py` | 171 | 搬 | `engine/llm/redaction.ts` | golden | P2-1 |
| `s3_client.py`、`redis_cache.py`、`auth.py`、`middleware.py`、`logging_config.py`、`metrics.py`、`sentry_config.py`、`config.py`、`scope.py`、`version.py`、`exceptions.py`、`llm_http.py` | 897 | 删 | — | — | P6-5 |
| `author_voice.py`、`punctuation.py`、`style_fingerprint.py`、`project_tree.py`、`generation_delivery.py`、`stream_text.py`、`math.py` | 633 | 搬 | `engine/kernel/*` | golden | P1-2 / P1-7 / P2-1 |

### 6.2 `app/platform/ai_sdk`（3,716 行）

| Python | 行 | 处置 | TS 目标 | 验证 | 阶段 |
| --- | --- | --- | --- | --- | --- |
| `runtime/loop.py` | 735 | 搬 | `engine/loop/sdkLoop.ts` | 录放 | P3-1 |
| `providers/openai_compatible.py`、`openai_stream.py` | 357 | 搬 | `engine/llm/providers/openaiCompatible.ts` | 录放 | P2-1 |
| `providers/anthropic.py` | 465 | 决定 B | `engine/llm/providers/anthropic.ts` | 录放 | P2-2 |
| `providers/gemini.py` | 467 | 决定 B | `engine/llm/providers/gemini.ts` | 录放 | P2-2 |
| `providers/deterministic.py` | 83 | 搬 | `engine/llm/providers/scripted.ts` | — | P2-1 |
| `runtime/models.py`、`state.py`、`ports.py`、`feedback.py`、`budget.py`、`external_results.py` | 683 | 搬（external 部分删） | `engine/loop/*` | 单测 | P3-1 |
| `contracts.py`、`capabilities.py`、`provider.py`、`errors.py`、`stream_usage.py`、`tools/*`、`observability/*`、`_immutability.py` | 926 | 搬 | `engine/loop/contracts.ts`、`tools/validation.ts` | 单测 | P3-1 |

### 6.3 `app/domains/agent_runs` 顶层（14,134 行）

| Python | 行 | 处置 | TS 目标 | 验证 | 阶段 |
| --- | --- | --- | --- | --- | --- |
| `canon_store`、`canon_gate`、`canon_assertions`、`canon_context`、`canon_dossier`、`canon_rebuild`、`canon_cache_freshness`、`canon_service` | 1,518 | 搬 | `engine/kernel/canon/*` | golden | P1-3 |
| `canon_delta`、`canon_hooks_delta` | 646 | 搬 | `engine/kernel/canon/delta.ts`、`hooksDelta.ts` | golden | P1-5 |
| `prose_scan`、`prose_pattern_rules`、`promise_scan`、`collapse_scan`、`entity_budget_scan`、`consistency_scan`、`cross_chapter`、`observatory` | 1,904 | 搬 | `engine/kernel/scans/*`、`observatory.ts` | golden | P1-4 |
| `serial_plan`、`serial_plan_update` | 728 | 搬 | `engine/kernel/serialPlan.ts` | golden | P1-5 |
| `book_context`、`knowledge_context`、`compaction`、`compaction_sources`、`compaction_job` | 1,024 | 搬（compaction 看决定 C） | `engine/kernel/bookContext.ts`、`knowledge/*`、`compaction.ts` | golden | P1-6 |
| `review_report`、`revise_scope`、`role_catalog`、`skill_catalog` | 1,079 | 搬 | `engine/kernel/*` | golden | P1-7 |
| `llm_context`、`llm_prompt_context`、`llm_context_limits` | 815 | 搬 | `engine/prompts/llmContext.ts` | golden（逐字节） | P3-4 |
| `request_evidence`、`context_provenance`、`context_channel_requests`、`run_payloads`、`result_contracts`、`schemas`、`event_types`、`event_encoders`、`intent`、`tooling`、`text_stream`、`runtime_progress`、`_text`、`trace`、`errors` | 1,504 | 搬 | `engine/loop/*` | golden / 单测 | P3-2 |
| `fs_tools`、`fs_safety` | 403 | 搬（读走 Tauri 命令） | `engine/loop/tools/fs.ts` | 行为（含越界、符号链接、字节预算） | P3-3 |
| `runtime`、`loop_runtime`、`save_points`、`deep_consistency` | 956 | 搬 | `engine/loop/runtime.ts`、`savePoints.ts`、`deepConsistency.ts` | 录放 | P3-5 / P3-6 |
| `runtime_recovery`、`system_jobs`、`event_sink`、`ws_schema`、`ws_messages` | 992 | 缩（恢复三条规则；事件进程内回调；帧类型留 TS） | `engine/loop/frames.ts`、`recovery.ts` | 行为 | P3-2 / P3-5 |
| `service`、`service_store`、`service_control`、`service_execution`、`service_lifecycle`、`service_types`、`models` | 1,621 | 删（替换为 `engine/store/runs.ts` 约 300 行） | — | 单测 | P4-1 |
| `router`、`writeback_router`、`writeback_recovery_router`、`writeback_contracts`、`writeback_projection`、`revise_delivery`、`runtime_delivery`、`host_lifecycle`、`host_lifecycle_router`、`external_admission` | 943 | 删 | — | — | P6-5 |

### 6.4 `agent_runs/loop`（4,056 行）

| Python | 行 | 处置 | 阶段 |
| --- | --- | --- | --- |
| `conversation_runtime`、`sdk_adapters`、`context_values`、`support`、`types`、`author_view`、`sdk_context`、`prompt_context`、`run_control` | 1,981 | 搬 | P3-4 / P3-5 |
| `checkpoint_store`、`generation_recovery`、`knowledge_recovery`、`ordinary_recovery`、`recovery`、`recovery_sources` | 667 | 缩 | P3-5 |
| `external_writeback`、`external_wait_state`、`external_recovery`、`external_chat`、`external_wait_store`、`external_resume`、`external_checkpoint`、`external_wait_lifecycle`、`external_observation` | 1,366 | 删 | P6-5 |

### 6.5 `agent_runs/tools` + `specs`（2,659 行）

全部搬，P3-3。`catalog.py` 的注册顺序与 `spec_roles` 的角色映射用 golden 钉死（`test_loop_tool_schemas.py` 的夹具原样搬）。

### 6.6 `agent_runs/fs`、`events`、`patches`、`adapters`、`permission`（7,633 行）

| 目录 | 行 | 处置 | 阶段 |
| --- | --- | --- | --- |
| `fs/project_knowledge`、`knowledge_entries`、`knowledge_retrieval`、`knowledge_proposals`、`ordinary_context` | 1,384 | 搬（决定 C：知识收件箱可裁） | P1-6 |
| `fs/runtime_tools` | 310 | 搬 | P3-3 |
| `fs/native_receipts`、`delivery_audit` | 275 | 删 | P6-5 |
| `events/knowledge_inbox`、`knowledge_materialization` | 754 | 搬（决定 C） | P1-6 |
| `events/runtime_support`、`contracts`、`chapter_checks`、`review_sources` | 595 | 搬 | P3-5 |
| `events/save_point_projection` | 436 | 删（引擎直接查 store） | P6-5 |
| `patches/*` | 1,604 | 搬 | P3-6 |
| `adapters/*` | 1,905 | 搬 | P3-6 |
| `permission/policy` | 209 | 搬 | P3-2 |

### 6.7 `app/domains/ide`、`assistant`、`judge`、`health`、`db`、`main.py`

| Python | 行 | 处置 | 阶段 |
| --- | --- | --- | --- |
| `ide/command_registry`、`book_breakdown*`、`review_reasoning`、`review_skills`、`cross_chapter_consistency`、`schemas` | 1,531 | 搬（拆书看决定 C） | P1-8 |
| `ide/router`、`stream_queue`、`stream_measurement`、`orchestrator`、`service`、`_coerce` | 541 | 删 | P6-5 |
| `assistant/service`、`revision`、`continuation`、`writing_context`、`provider_health`、`schemas` | 2,071 | 搬 | P2-3 |
| `assistant/router`、`models`、`session_scope`、`continue_context` | 285 | 删（存储进 P4-1） | P6-5 |
| `judge/semantic`、`types`、`schemas` | 439 | 搬 | P3-6 |
| `health/*`、`db/*`、`main.py`、`models.py`、`author_chat.py` | 约 1,100 | 删 | P6-5 |

---

## 7. 测试与门禁迁移

### 7.1 pytest 1,844 个测试的去向

| 组 | 测试数 | 去向 |
| --- | --- | --- |
| 外部写回 / 回执 / 恢复 / 宿主 / save point / checkpoint / settle | 252 | **退役**（被删代码的测试），其中「中断 / 暂停 / 停止 / 终态」语义的约 30 个改写成引擎行为测试 |
| 扫描 / 计划 / 知识 / 观测 / 一致性 | 271 | golden（夹具生成）+ 关键分支改写 vitest |
| ide / 拆书 / 跨章 | 214 | golden + vitest |
| loop / sdk | 165 | 录制回放 + vitest |
| llm / provider / 脱敏 | 137 | vitest（协议解析、重试、脱敏逐字节） |
| canon | 131 | golden |
| assistant | 74 | 录制回放 + prompt golden |
| 源码规范 / 契约 / 迁移 / schema | 116 | 体积门禁搬 vitest；OpenAPI / alembic / 契约 golden 退役；帧 schema 快照新建 |

### 7.2 新门禁（P6-4 后的 `pnpm verify`）

1. 根 lint（eslint + prettier）
2. 前端 typecheck
3. engine vitest（golden + 行为 + 录放）
4. 前端 vitest
5. project-core 测试
6. Rust `cargo test`
7. 浏览器导览（`tour.mjs` 升级版：作品副本 + 引擎，截图 + 零 console error）

pre-push：lint + engine vitest + 前端 vitest（目标 < 3 分钟）。

### 7.3 退役的门禁

OpenAPI 生成与漂移检查、`tests/e2e` 契约 spec、sidecar-smoke（daily / packaged）、API pytest、ruff、`verify-nsis-install` 的 sidecar 断言、`.githooks/pre-push` 的 pytest 段、`scripts/fast-tests.mjs` 的 pytest 列表。

### 7.4 必须搬的一个 Python 测试

`tests/test_source_code_standards.py` 给前端文件设体积上限（`App.tsx` 400、`AppShell` / `ChatWindow` 等 500）并禁止跨模块私有依赖。Python 删掉前先把它改写成 `apps/desktop/frontend/tests/source-standards.test.ts`，上限表原样搬，再加 `packages/engine` 自己的上限（文件 500、测试 800）。

---

## 8. 风险登记簿

| # | 风险 | 影响 | 对策 |
| --- | --- | --- | --- |
| 1 | **排序语义**：Python 按码点排字符串，JS `sort()` 按 UTF-16 码元；`localeCompare` 另一套 | 章序错一位就全错 | 引擎统一 `codePointCompare`；禁用 `localeCompare`（eslint 规则）；golden 用含生僻字文件名的夹具 |
| 2 | **路径与大小写**：Python `normcase` 33 处 | Windows 下大小写不敏感比较 | 引擎一个 `normalizePath`，与 Python 行为逐案例 golden |
| 3 | **正则差异**：port 集合 108 处 `re.*`、`(?P<name>)` 4 处、lookbehind 4 处、possessive `++` 1 处、`\X` 1 处 | 扫描结果不同 | 逐条改写，JS 用 `u` 标志；`\X`（字素簇）换 `Intl.Segmenter`；每条正则各一个 golden 用例 |
| 4 | **换行**：Python 通用换行读文件把 CRLF 当 `\n`；读字节再 decode 又不是 | 字数、锚点、补丁偏移错位 | 引擎读文件统一「原样字节 → 文本」，另给一个 `normalizeNewlines`；golden 夹具含 CRLF 文件；前端 `text-metrics.ts` 口径对齐 |
| 5 | **JSON 序列化**：`sort_keys` 9 处、`ensure_ascii=False`、浮点格式 | canon.json、derived 缓存、回执 hash 不一致 | 引擎 `stableStringify`（键排序、2 空格、末尾换行同 Python）；derived 文件逐字节 golden |
| 6 | **`difflib`** 6 处（修订定位、相似度） | 补丁锚点 | 用同算法的 TS 实现（Ratcliff/Obershelp）并 golden；或改为引擎自有的精确子串定位（v1 已是整文件 before/after + 精确子串） |
| 7 | **流式响应**在 plugin-http 不达标 | 续写、对话无逐字 | P0-1 探针；兜底 Rust `llm_stream` 命令 |
| 8 | **主线程卡顿**（大书扫描） | UI 冻结 | P0-3 探针；Worker |
| 9 | **sqlite 并发**：引擎多个 run 同时写 | 事件顺序 | 单写队列；`sequence` 列由引擎分配 |
| 10 | **旧库导入**不全（JSON 列、时区） | 丢会话 | 作者库副本逐条比对；失败不标记可重试 |
| 11 | **估时偏差**：34k 行搬迁 | 拖期 | 每阶段末重估；决定 C 的裁剪是主要杠杆 |
| 12 | **期间无新功能** | 作者 6 到 11 周看不到产品变化 | P0-5 的体积数字、P2-4 / P3-8 的真跑先给作者看；预览版 P5 提前装 |
| 13 | **安全**：key 从 Rust 读后在 JS 内存 | 比 v1 多一层暴露 | key 不进 localStorage、不进日志、脱敏沿用；plugin-http 请求头由 JS 组装但只在进程内 |
| 14 | **token 计数与成本估算**依赖 Python 侧实现 | 记账不一致 | golden 比对同一响应的用量 |

---

## 9. Rust 侧改动细目

**删除**（P6-2）：`main.rs` 第 121 到 568 行之间的 sidecar / docker / 迁移 / API 配置函数（`kill_windows_process_tree` 起到 `get_api_config` 止）；`managed_agent_host.rs`、`host_close.rs`、`host_close_state.rs`、`owned_process_tree.rs` 及测试、`external_native_ipc_fixture.rs`、`external_chat_bridge_tests.rs`、`lifecycle_gui_fixture.rs` 的后端夹具段；Cargo 里 `windows-sys` 的 `Win32_System_JobObjects` 特性（若无他用）。

**保留**：`fs.rs`、`shadow_git*`、`llm_config_store*`、`secret_protection.rs`、`runtime_paths.rs`。

**先留后议**：`fs_writeback_receipts.rs`、`managed_writeback.rs` 与 `write_file_with_receipt` / `begin|end_writeback_delivery` / `create_writeback_audit` 等 9 个命令。它们是跨进程时代的台账，单进程后写回只剩「快照 → 原子写 → 版本记录」。P6 时评估：前端若已不调用，删；若 §2.6 的意图日志复用了回执格式，留 `write_file_with_receipt` 一个。

**新增**：`tauri-plugin-http`、`tauri-plugin-sql`（sqlite 特性）；若 P0-1 失败，加 `llm_stream` 命令；可选 `search_project` 命令（P0-3 若发现 JS 全文搜索慢）。

---

## 10. 数据与配置

| 项 | 迁移前 | 迁移后 | 迁移动作 |
| --- | --- | --- | --- |
| 会话 / 消息 / run | 旧 sqlite，SQLAlchemy 写 | 新 sqlite，引擎写 | 首启动一次性导入，旧库只读 |
| `llm-provider.json` | Rust 读写，Python 经环境变量拿 | Rust 读写，引擎经 `get_llm_config` 拿 | 无 |
| `.storyforge/` | Python 读、派生缓存 Python 写 | 引擎读、派生缓存引擎写（经 Rust `write_file`，仍在 containment 内） | 格式不变，derived 逐字节 golden |
| 权限档位 | localStorage | 不变 | 无 |
| API key 注入（`X-StoryForge-API-Key`） | Rust 生成随机 key 注给前端 | 删 | 无 |
| `STORYFORGE_*` 环境变量 | 配置链一环 | 只剩 `STORYFORGE_LLM_CONFIG_FILE` 一类开发用覆盖 | 文档更新 |

---

## 11. 期间纪律

- Python 冻结：只修 bug，不加功能；每个 Python 修复要在 TS 对应处同步（P1 后）。
- 新功能一律写 TS，且写在引擎的 ports 之上，不直接 import Tauri。
- 不在迁移 PR 里改 UI；不动 `.storyforge/` 格式。
- 每周五在 `verification-report` 记一条进度：已搬行数 / golden 通过数 / 影子差异数。
- 开关默认值变更单独 PR。

---

## 12. 需要作者拍板的决定

| # | 决定 | 我的建议 | 影响 |
| --- | --- | --- | --- |
| A | 做不做；什么时候开始 | 做；P0 立刻开始 | 全局 |
| B | provider 范围 | OpenAI 兼容必做；Anthropic、Gemini 原生协议**不搬**（你现在走中转的 OpenAI 协议；需要时再加，各约 400 行） | 省 1.5 周 |
| C | 功能取舍（可逐项） | 以下建议**不搬、直接删**：拆书 `book.breakdown`（1,000 行，你没用过）、知识收件箱与提案 `knowledge.*`（约 2,100 行）、章节检查历史 `chapter-checks`、roles / skills 目录接口（循环内仍用角色映射，只删 HTTP 面）、compaction（上下文压缩，约 460 行）、`subagent_runs` 表；**保留**：deep_consistency、file.review 多视角、serial plan、canon 全链、全部扫描 | 省 2 到 3 周 |
| D | 引擎位置 | `packages/engine`，独立 vitest | 结构 |
| E | 旧会话 | 一次性导入 | 作者数据 |
| F | 关窗语义 | 关窗即中断、partial 保留、不自动续跑（与 v1 实际一致） | 行为 |
| G | 真跑预算 | 四次 headless 真跑（P2-4、P3-8、P5 两次）各约 5 到 20 万 token；用你的 key，每次先报预估 | 费用 |
| H | 版本号 | 0.2.0 | 发版 |

拍板后把本文头部状态改为「执行中」，在 §5 的表里填开始日期。
