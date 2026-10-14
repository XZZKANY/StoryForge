# 后端换 TS：Python sidecar → 单进程 Tauri 迁移计划

状态：**P0 已验收 · P1 内核与 P2 已合并 · P3 实施中**（2026-10-12；P1 首段状态写于 2026-10-11）。作者已认可 P0、批准三批本机提交（不 push），并已认可 P1 的 PRD/设计/实施清单、批准按保留现有路径行为启动。完整引擎继续使用 `packages/engine`，全量保留现有功能与 provider（§12 B/C）。P1 提交另行确认；付费真跑、作者数据操作、默认切换与真机安装仍按阶段确认。2026-10-11 作者另拍板「划定输入范围、范围外直接报错、不再模仿 Python」，JSON 嵌套上限定为 64 层，见 §4.3.1。本文是这项迁移的唯一计划文档；每个 PR 合并时在 §6 的清单里打勾。

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
│     Http→ Rust engine_llm_send 代发（只放行已配置 baseUrl 同源，Channel 流式回传）   │
│     Db  → @tauri-apps/plugin-sql（sqlite，WAL）                                      │
│     Key → 不出 Rust：引擎只拿占位串，Rust 发请求时换成真 key（2026-10-12 改）        │
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

新建 `storyforge-engine.sqlite3`（与旧库并排），基础表：`sessions`、`messages`、`runs`、`run_events`、`artifacts`、`tool_calls`；`schema_version` 表管前向迁移（TS 里手写 `migrations/0001.sql …`，无 alembic）。2026-10-11 已确认全量保留，不能按原裁剪建议省略 `subagent_runs` 数据或功能；其新库映射在 P4 按实际消费契约确定。

旧库**只读导入一次**（Phase 4）：sessions / messages 全导，runs / events / artifacts 按需导（终态 run 只导摘要），导入后写标记，旧文件永不改动——回滚 0.1.10 时数据完好。

### 2.4 新增 Tauri 插件（2026-10-11 兼容锁解析）

| 插件 | 版本 | 用途 | 替代方案 |
| --- | --- | --- | --- |
| `tauri-plugin-http` | 2.6.1（exact） | 原计划承载模型请求；2026-10-12 起模型请求改走自有 `engine_llm_send` 命令（见风险 13），插件不再承载 key，P6 评估是否移除 | — |
| `tauri-plugin-sql` | 2.4.1（exact） | sqlite | `tauri-plugin-store`（JSON，不够关系查询）；不选 |

原候选 HTTP 2.8.2 / SQL 2.5.0 要求 Tauri 2.12；本次保留 Tauri 2.11.2 / frontend API 2.11.0，仅依赖锁中 fs 2.5.1→2.5.2。P0 使用官方 crate 自带 global API；npm import wrapper 安装/调用单独验证，不能以 global 探针替代交付。SQL 无 db/path scope，`select` 可执行 mutating SQL，旧库只读必须由 driver `mode=ro`、拒写及 hash 实证保证。

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
4. 送进模型的 system / user 文本与 Python **逐字节相同**（仅限范围内输入，见 §4.3.1；craft、llm_context、book_context 块、五条管线提示词、工具描述）。
5. 工具 JSON schema 与 Python 生成的逐字节相同（`test_loop_tool_schemas.py` 的 golden 搬过来）。
6. 11 种帧的字段与语义不变。
7. BYO key 位置与格式不变（`%APPDATA%\com.storyforge.ide\llm-provider.json`）。
8. 旧会话数据导入不丢、旧库不改。
9. 迁移期间 UI 零改动、Python 只修不加。

---

## 4. 迁移机制

### 4.1 三道开关

`lib/engine/flags.ts`：`engine.ideCommands`、`engine.assistant`、`engine.agentLoop`，各三档 `python | ts | shadow`，存 `localStorage`（dev）与设置页（私测版）。默认值随阶段推进：Phase 1 末 ideCommands=shadow，Phase 2 末 assistant=ts，Phase 5 末全部 ts，Phase 6 删开关。2026-10-12 作者拍板：Phase 2 末只切开发档的 assistant 默认值，装机版随 P5 再切（见 P5-2）。

### 4.2 影子模式

`shadow` 档两边都跑，结果给 Python 的，TS 的与之 deep-diff，差异写到 `%LOCALAPPDATA%\com.storyforge.ide\shadow-diffs.jsonl`（只记结构化差异与路径，不记正文）。用作者自己的书跑一周，差异归零才允许切 `ts`。对 LLM 路径影子模式只比 prompt 文本，不双倍花钱。

2026-10-11 源码核对补充：IDE 目录的 `writes=False` 不是无副作用证明；canon/observatory 写派生文件，plan 写计划，breakdown 还可能调用模型并记录 DB run/artifact。影子比较不得对同一作者文件树/数据库双写：只读命令比较同一稳定输入，有写入的命令使用隔离副本或捕获 TS write-intents，且不重复模型调用/记账。具体 snapshot/适配合同在 P1/P2/P4 落实；依赖未就绪不把局部命令验证称九命令 shadow 验收完成，也不靠 catch-all 静默回切掩盖差异。

### 4.3 golden 预言机

`apps/api/scripts/golden_dump.py`：对 §6 标「golden」的每个纯函数，用合成夹具（入库，`packages/engine/golden/*.json`）和作者作品副本（**不入库**，本机生成到 `packages/engine/golden-local/`，已 gitignore）各跑一遍，输出 `{input, output}`。TS 测试读同一文件断言 deep-equal / 字符串相等。Python 删除前把合成夹具的输出冻结入库，之后 TS 测试不再依赖 Python。

### 4.3.1 输入范围（2026-10-11 作者拍板）

golden「逐字节一致」只对**范围内**的输入成立。范围外的输入，TS 直接报错（`InputDomainError`，写明文件、字段与期望），不再复刻 Python 对它们的偶然行为。判断标准只有一条：应用自己写不出来、作者照文档也不会写出来的输入，就在范围外。golden 文件不重录；范围外的用例在测试里逐条改判为「应当报错」或「视为缓存失效」，并钉住条数，记作接受的差异。

| 来源 | 范围内 | 范围外 |
| --- | --- | --- |
| 所有 JSON 文件的公共底线 | UTF-8 且不带 BOM；标准 JSON（RFC 8259，没有 NaN / Infinity）；嵌套不超过 64 层；整数是 JS 安全整数；字符串是合法 Unicode（没有孤立代理码点）；重复键后者生效；键的先后顺序不属于契约 | 见下面各行 |
| 作者声明：`canon/canon.json`（`hooks.json`、`book.json`、`serial-plan.json` 迁移时同规则） | 字段类型与应用生成的格式一致：实体 `id`、`canonical_name` 是字符串或缺省，`aliases` 是字符串数组或缺省；不变量里的物品、持有者、实体、先后节点是字符串，章号是整数字面量或缺省。缺省字段与空白名字照旧按 Python 的语义处理；只有实体缺 `id` 时不取出场跨度（Python 会拿字符串 `None` 去匹配，属于意外） | 报错，所在命令失败并指出位置。Python 的做法是静默丢掉整份人物表，或者按 Python 语义继续（把 `true` 当第 1 章、把字符串别名拆成单字） |
| 应用自己写的缓存与回执：`canon/derived/*.json`、`writeback-receipts/` | 与写入方的结构一致：presence 的 `id` 是字符串或 null，章号是整数或 null，`missing` 是布尔；回执字段集合与类型固定，时间戳是非负安全整数 | 视为缓存失效，与 Python 处理坏缓存的方式一致；但不再接受 UTF-16/32、BOM、代理码点、超大整数这类应用写不出的内容 |
| 正文 `.md` | 任意文本：UTF-8，可带 BOM，任意换行；单文件不超过 2 MiB，前 1 KiB 没有 NUL | 沿用现有省略规则：读不了的上一章只省略结尾，不挡续写；非法 UTF-8 按替换字符解码，这是两边相同的自然行为，不算模仿 |
| IDE 命令参数 | `project_root` 是绝对路径；`current_file` 是绝对路径或相对项目根的路径；参数里的字符串是合法 Unicode | 400 报错。相对的 `current_file` 一律按项目根解析：Python 的「当前文件」字段按进程工作目录解析属于意外，不复刻 |
| glob 模式 | 任意字符串，模型工具与 IDE 命令都能传 | 没有范围外；完整保留 `Path.match` 语义 |
| 文本的大小写与单词字符 | 以宿主 JS 引擎的 Unicode 为准 | 不再随源码携带 Python 3.13 的 Unicode 15.1 字符表。与 Python 不同、已接受的只有两处：新版 Unicode 才有的字符；glob 在 Windows 上不再把土耳其语 İ、ı 当成 i、I 的大小写（Python 正则特有的等价，JS 的 Unicode 大小写折叠没有）。脱敏的关键词匹配仍认这几个变体，宁可多遮 |

由此定下的三件事：

- **JSON 嵌套上限 64 层**，取代此前待审的 4096 方案。应用写出的文件最深是 presence 缓存，6 层（出场记录里的命中形式列表）；64 与目录遍历的深度上限一致。4096 只是为了容纳测试里人为构造的两千多层嵌套 ID。
- **死代码不搬**：`common/math.py` 的 `safe_ratio` 在后端没有任何调用方，TS 侧删除 `safeRatio` 及其 golden。
- **作者声明写错会报错**：这是作者看得见的行为变化，Python 原来静默丢弃。P1-8 接线到界面时要把错误原文显示给作者，不能吞成空结果。

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
| P0-1 | 流式响应 | Native `plugin-http` 对受控合成服务逐块读取，验证跨块 UTF-8、结束前可见、取消/错误与 ACL；作者 baseUrl/key 另行批准真跑 | 合成首块 < 3 s 且逐块到达；真实模型 TTFT 尚未验证，失败先定位再决定替代方案 |
| P0-2 | sqlite | 当前模型生成合成旧库及一致性副本，16 个合成会话只读查询/拒写/hash；独立新库 + WAL；分开量启动、load、建表 | 合成行正确，缺失只读库不被创建；新库建表 < 100 ms，不改作者库 |
| P0-3 | CPU | 迁移真实段落规则四族，在三个精确 1 MiB UTF-8 合成正文上，真实 WebView2 主线程预热/采样各 10 次 | 记录 p50/p95/max 与长任务；p95 ≥ 200 ms 规划 Worker，低于门限不批准全扫描留主线程 |
| P0-4 | golden 流水线 | 以 `manuscript` 读序 + `book_context` 渲染为样本打通 Python dump → TS 测试 | 两个函数逐字节相等，含 CRLF 与末尾换行 |
| P0-5 | 无 sidecar 构建 | 临时去掉 `externalBin` 打 NSIS，量体积 | 预期 25 到 30 MB，给作者看 |

P0 结束出一份 `verification-report` 记录，附数字，再决定 P1 开工。

2026-10-11 P0 验收记录：P0 五项合成技术门通过，作者认可结果并批准三批本机提交及准备 P1 规划；当时未获 P1 实现授权，后续启动/增量见下。P0-4 为 338 个 TS 用例，半偶舍入变异 11 个失败、还原全绿；只覆盖枚举后的手稿读序和 `book_context` renderer，不代表完整遍历/context builder 已迁移。P0-1/2 Native 合成边界复跑通过：五块 UTF-8/SSE、首块 31–40 ms、取消/503/ACL；只读行/拒写/hash、缺失库拒绝、新库 WAL，单事务建表 16.4–23.3 ms。P0-3 最新 p95 98.4 / 64.2 / 5.8 ms，有 10 / 10 / 0 个长任务，只回答该规则子集。P0-5 同 release/完整前端/MinGit 的 NSIS 为 75.304→29.756 MiB（-60.485%），离线提取的 main 与 368 个 MinGit 文件 hash 相同，仅 sidecar 缺席；未安装/运行 size-only 应用。真实 provider/作者库、HTTP/SQL npm imports、完整单进程运行尚未验。详细验证见 `.codex/verification-report.md`。

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

2026-10-11 首批增量（**不是 P1 整体验收**）：
- 正式 frontend `file:../../../packages/engine` manifest/lock 已接入；owned clean root pnpm 9.15.4 → frontend npm bootstrap、真实包导入、单一 core 解析、typecheck、完整 React production build（`envFile=false`）通过。三键开发开关已实现，production 忽略实验值；实际所有 IDE/assistant/agent 路径仍 Python，完整配置脱敏来源就绪前不放行真实 UI。
- 四项 uncached/bounded Native read 原语、typed port/binding 与 raw traversal 已实现。引擎 352 测试（含新 14 项）、Rust 118 passed/4 ignored；真实 junction、缺失普通余段、verbatim drive、16KiB/512KiB/2MiB `cap+1` 和目录末尾错误保留已验证。文件 symlink 新用例因 1314 明确跳过，不能计为通过；该轮未跑新 WebView IPC 或 Python reader golden，不声明完整路径兼容/race-free。过滤前预算变异在独立副本中 3 项变红、还原 14 项绿。
- 后续同日增量：同一个 exporter 已新增 `p1-context`（50 文件夹具、29 JSON 边界），reader-backed builder/知识索引/canon 回执版本与台账/上章尾部及 browser payload 已实现；Engine 439 项、前端 2008 项通过（另 1 skip），46 组正式包 → 既有 mapper 合成结果一致。保留整数/浮点/bool 与大整数 prompt；独立期望树的整数变异 14 项失败、stamp 旁路 1 项失败，还原均绿。
- Unicode/脱敏增量：真实文件反例证明 raw surrogatepass 合并会把人物章号 `2–3` 错配为 `98–99`；现已在既有 JSON owner 中保留字符串/字典键码点身份，并冻结 Python Unicode 15.1 分类。当时 59 文件夹具、51 JSON 边界、41 类敏感键/43 组脱敏输出，Engine 557 全绿；六项独立副本变异均检出。纯脱敏只消费完整有序合成 secrets 快照，不读取宿主配置、不代表 P2 配置 owner 已完成。
- 命令响应增量：`executeBookContextCommand` 已复用 builder/renderer/redactor，保留原始 args 回显及三次脱敏。真实 registry/model/JSONResponse 与 owned ASGI 的 84 组命令（70 成功、9 个 400、5 个 500；其中 1 个 Python 成功的相对输入仍不准入 TS）和 4 组 422 比对通过。Engine 652、前端 2088+1skip，十项变异均检出并恢复绿；57 组 builder、69 组成功命令经过正式包与现有 mapper。
- Native 合成链路增量：同一 Python v4 的 84 命令经真实 WebView/npm invoke→四项 Rust 读取→完整 engine→既有 mapper，两次新建隔离树均为 69 完全匹配/14 预期错误/1 相对输入零 IO 不准入，文件树字节未变。最终源码一致，正常全量前端2088+1skip/Engine652/core9/types/lint通过。大字节读仍有84–112ms长任务；P0共享启动器回归建表403.3ms超过100ms，保留failed、原因待定位，不能称全部验收通过。
- 读边界性能/隔离增量：CPU对照仅改base64数组填充，reader自身采样279→30ms；最终无profiler的两次84合同Native回放均零长任务、字节不变。修复隔离Known Folder目录缺失引起的HTTP plugin启动错误；之后P0实测schema16.8ms通过原100ms门。旧403.3ms证据保留且不强行归因。当前前端2093+1skip/Engine652/core9/types/lint及fresh React97chunks构建通过。
- reader真实文件树增量：同一Python描述由memory/真实Native回放，12树30动作中28一致，2个file-symlink因1314跳过。真实红基线定位并修复3处错误语义差异：typed containment错误不再变通用解析失败，missing/file根在读取目录阶段失败，writer根不变。最终Native reader28与完整命令84均当前源码/字节不变；前端2098+1skip/Engine680+2skip/core9/Rust120+4ignored、types/lint及fresh bootstrap通过。参见 `output/ts-engine-p1/reader-tree-evidence.json`；仍不等于完整reader/production admission/P1验收。
- 深层ID增量：真实Python新增6个list/dict深层ID夹具，原61 context/51 JSON记录不变；旧TS的5处递归repr栈溢出已由既有owner内的显式栈修复，定向225全绿。Native完整90合同、0longtasks/字节不变；前端2110+1skip/Engine692+2skip/core9/types/lint/fresh97chunks构建通过。作者允许设计明确深度预算；具体4096层方案待审核、未实现，解析资源差异仍未关闭。证据 `output/ts-engine-p1/deep-json-evidence.json`；默认Python、未提交。
- 标点内核增量：完整迁移比较规范化/原标点恢复/对话pattern，保留重复空行匹配、全文仅标点变化例外和引号授权单元边界。真实Python1142用例与emitted正式包一致；五项变异均检出并恢复绿。前端2110+1skip/Engine1834+2skip/core9/types/lint/fresh React97chunks通过；未接真实修订/策略来源/Native负载。math及其余内核继续，证据 `output/ts-engine-p1/punctuation-evidence.json`。
- 数学内核增量：在原math.ts增加safeRatio、复用且原样保留pythonFixed；精确整数商→binary64→四位舍入，保留负零/混合数值/溢出。真实Python757项与emitted正式包一致，五项变异均检出并恢复绿；前端2110+1skip/Engine2591+2skip/core9/types/lint/fresh97chunks通过。共享纯oracle审计提取后标点snapshot字节不变；未改默认路由、未提交。证据 `output/ts-engine-p1/math-evidence.json`；继续canon及其余内核，P1-2剩余路径边界未以此关闭。
- canon 闸门增量：迁移唯一持有/时间线/退场提示纯检查，保留闭区间、10**9哨兵、DFS顺序/深度64、稳定SHA-1 ID、重复issue及Python数值/容器/Unicode/错误语义。真实Python842项（含33预期错误）与正式emitted包一致，七项变异均检出并还原；前端2110+1skip/Engine3433+2skip/core9/types/lint/fresh97chunks通过，518source/100artifact hashes。默认Python、未提交；presence/assertions/dossier/cache/derived写入及命令接线仍待迁。证据 `output/ts-engine-p1/canon-gate-evidence.json`。
- Path.match依赖增量：presence/consistency源码支持任意glob，现已迁词法匹配并接回正文排序；保留相对右匹配、锚点/UNC/盘符、非递归**、字符类与Unicode15.1大小写等价，未复用会折叠父路径的UI工具。7464真实Python项与正式包一致，七项变异检出；前端2110+1skip/Engine10899+2skip/core9/types/lint/fresh97chunks绿。规范绝对根与增量有界解码仍是完整presence链前置项；默认Python、未提交。证据 `output/ts-engine-p1/path-match-evidence.json`。
- 输入范围改写（作者 10-11 拍板，见 §4.3.1）：新 `json.ts` 取代 Python 风格 JSON（标准 JSON、嵌套上限 64、安全整数、整数与小数字面量分开、无 BOM 的 UTF-8），canon 读取、book.context 命令、脱敏、canon 闸门都先校验成干净类型再跑原逻辑；删除死代码 `safeRatio` 及其 757 条 golden、Unicode 15.1 字符表（107 KB）和整套 Python 值模拟。golden 不重录，测试逐条改判：book.context 68 条（28 条与 Python 一致、20 条作者声明写错应报错、19 条缓存超范围视为失效、1 条相对路径按项目根解析）、canon 闸门 194 条一致 / 648 条应报错、JSON 边界 6 / 11 / 34、glob 7464 条中 16 条为已接受差异、脱敏 43 条中 42 条比对（17 条先成对剪去范围外或新版 Unicode 字符的叶子，1 条密钥本身含代理码点整条在范围外）。导出器只新增一条毫秒时间戳的合法回执用例，其余 golden 逐字节不变。九处变异全部被测试抓住。实际路由仍是 Python，未提交。
- canon 链余下部分（2026-10-12）：assertions / context / dossier / rebuild / service 与声明、派生缓存读写搬完，连带提前搬了 consistency_scan、generation_sources 和 fs_tools 的有界读。新增只写 `.storyforge/` 的写口，内核交出与 Python 逐字节相同的内容（Windows 上是 CRLF）。新的文件型预言机 `golden_fs.py` 在合成项目上逐次记录输出与写盘字节，13 个项目 54 次调用 + 27 条断言用例逐字节一致，16 处变异全部抓住。canon.json / hooks.json 读到的字段按 §4.3.1 先校验。canon.refresh 尚未接 TS，Native 写口留到 P1-8。
- 扫描组（2026-10-12）：文笔气味、伏笔承诺、场景承重、实体预算搬完；4 个合成项目 55 次调用 + 23 条纯函数用例逐字节一致，16 处变异全部抓住；canon.json 的 promises 字段纳入输入范围校验。observatory 等 canon_delta 搬完后随 P1-5 做，cross_chapter 的模型调用随 P1-8。
- 提案与连载计划组 + 观测镜（2026-10-12）：canon_delta、hooks_delta、serial_plan、serial_plan_update、observatory 搬完；6 个合成项目 57 次调用 + 16 条纯函数用例逐字节一致（含 proposals / serial-plan / observations 写盘字节），25 处变异全部抓住；serial-plan.json 读到的字段纳入输入范围校验，观测镜生成时间改由调用方注入时钟。
- 知识组（2026-10-12）：知识块、知识读取 / 索引 / 子串检索、检索排序、提议组、普通上下文、知识上下文合并、物化编译搬完；132 条纯函数用例 + 67 次项目调用逐字节一致，变异 27 处抓住 24 处（余 3 处等价）。收件箱与对话压缩的存储 / 模型部分随 P3 / P4，正则知识检索随 P3 文件工具。
- 文风与策略组（2026-10-12）：创作准则、文风指纹与基线、作者指令与产字 prompt 组装、作者编辑政策、生成送达、角色与技能目录搬完；112 条纯函数用例 + 20 次项目调用逐字节一致，27 处变异全部抓住。review_report、revise_scope 随 P1-8 与审稿栈一起搬。
- 审稿栈（2026-10-12，P1-8a）：review_skills / review_reasoning / review_report / revise_scope / revise_delivery / cross_chapter_consistency / cross_chapter 搬完，模型调用改为显式端口（P2 实现），新增 difflib 的 SequenceMatcher 移植；176 条纯函数用例 + 22 次项目调用逐字节一致（模型用脚本化回复替身），70 处变异全部抓住。只有测试在用的 scoped_revise_context_bundle 不搬。IDE 命令注册表与拆书随 P1-8b。
- 拆书（2026-10-12，P1-8b）：book_breakdown / book_breakdown_control 搬完；DOCX 读取新写 `docx.ts`（zip 判定贴近 CPython zipfile，XML 只收 well-formed 文档）。109 条纯函数用例 + 63 次项目调用逐字节一致（含 35 种 DOCX、写盘字节），51 处变异全部抓住。参考文本的输入范围按 §4.3.1 补齐（64 MiB、JSON 公共底线、加密 / zip64 / DOCTYPE 等直接报错）。IDE 命令注册表随 P1-8c。
- IDE 命令注册表（2026-10-12，P1-8c）：九个命令在引擎侧有统一入口 `executeIdeCommand`，交出与 HTTP 相同的信封（422 / 404 / 400 原文 / 500、四遍脱敏）；49 次命令调用逐字节一致，17 处变异全部抓住。P1 内核到此搬完；前端按 `engine.ideCommands` 分流到 TS 还缺三个 owner：完整密钥快照（P2）、Tauri 原生写口、拆书运行记录（P4），P1-9 shadow 周用需作者副本授权。
- LLM 通道纯函数层（2026-10-12，P2-1a）：配置值解析、鉴权头、模型列表地址校验（照 CPython urlsplit / ipaddress）、思维链剥离与流式可见文本过滤、用量与成本、请求体、重试策略搬进 `engine/llm/`；373 条用例逐字节一致，45 处变异全部抓住。llm-provider.json 与 DPAPI 仍归 Rust，引擎只收已解密的配置槽。传输与客户端、桌面适配器随 P2-1b。
- LLM 通道传输与客户端（2026-10-12，P2-1b）：契约、协作式中断、OpenAI 兼容 provider、带重试的非流式与流式传输、call_llm 系列入口搬进 `engine/llm/`，出网经 `HttpPort` 注入；57 个录制场景逐项一致（请求字节、等待、进度、错误与记账），48 处变异全部抓住。Anthropic / Gemini 随 P2-2，桌面适配器随 P2-1c，调用观测随 P4。
- Anthropic / Gemini 原生协议（2026-10-12，P2-2）：两家适配器与原生出网（紧凑 JSON 的重试 POST、SSE 事件流、模型名 quote）搬进 `engine/llm/`，`sdkProvider` 按家族分派；46 个录制场景逐项一致（含思维块与函数调用签名的续接回放），41 处变异全部抓住。Python 与 TS 两侧的录制回放 harness 抽成共用模块。
- 桌面出网适配器（2026-10-12，P2-1c）：按改写后的风险 13，key 不出 Rust——新增 `engine_llm.rs` 三个命令（取配置源 / 代发 / 关闭），引擎配置源里的 key 是占位串，Rust 只在四个鉴权头里换成真 key、只放行已配置 baseUrl 同源（跨源重定向不跟），响应头 / 响应体 / 错误文本里的真 key 换回占位串；前端 `lib/engine/llm.ts` 实现 `HttpPort` 与配置源。配置源照装机 sidecar 实际吃到的值（超时缺省 60.0、继承进程环境里的非密钥调参项、润色槽只有身份四项）。P1-8c 缺的「完整密钥快照」由此定案：WebView 侧的快照就是占位串。Rust 14（含配置存储 1 个）+ 前端 5 个用例，变异 24 + 25 处全部抓住；真 WebView 合成探针（`--llm-only`，随机合成 key + 本地假 provider）通过，首个增量 9 ms 到达，key 未出现在 WebView 与任何产物里。P2-3 assistant 接线前默认仍走 Python。
- 写作上下文准入（2026-10-12，P2-3a）：assistant 接线的前置依赖，从 P3-4 提前搬来——llm_context 快照（请求文件筛选、循环读到的文件、故事记忆 / 章节上下文 / 审稿报告三条合成通道的请求记账与最终预算投影、快照 id）、还原成旧版 context_bundle 的提示投影、写作请求准入与已准备上下文的交接（含章节适配器用的守卫交接）、上一章结尾（含生成来源记账）；文风基线与上一章改用同一个正文列举。58 条纯函数用例 + 33 次项目调用逐字节一致（合成项目，含知识检索、CRLF / BOM / 坏 UTF-8 / 二进制 / 超 2 MiB 的章节），39 处变异抓住 37 处（余 2 处等价）。接受的差异：项目身份按词法规范化比较，不认 Windows junction 别名（Python 用 realpath，TS 偏向拒绝）；pydantic 校验错误只比类别不比原文。默认仍走 Python。
- assistant 纯函数层（2026-10-12，P2-3b1）：续写（上文 / 后文取窗、落点、插入、提示组装、掐重复开头与裁到句末）、修订（提示组装、扩写授权判定、一次生成 → 标点还原 → 作者编辑政策 → 可选润色门禁，生成器由调用方注入）、起草与对话提示；润色门禁连同事实守卫从 P3-6 提前搬来（修订的 polish 档要用）。188 条用例逐字节一致（修订用脚本化生成器，失败时也记录生成器有没有被调用），46 处变异抓住 42 处（余 4 处等价）。会话、证据链与模型调用的编排随 P2-3b2。默认仍走 Python。
- assistant 编排（2026-10-12，P2-3b2）：修订、光标处续写（逐帧回调，帧形与 SSE 的 event / data 相同）、起草、项目对话回复、模型服务诊断搬进 `engine/assistant/`；会话与工具调用证据链经 `AssistantStore` 端口（P4 前由 Python 现有会话接口实现，脱敏归存储），模型经 `AssistantLlm` 端口（生产绑定引擎 LLM 客户端）。预言机在合成项目上跑真实 Python 服务函数（内存假存储 + 脚本化模型替换它自己的那几处缝）：39 个场景逐操作一致（存储调用序列、模型调用与提示、返回值或错误类别 / 文本 / 状态码、续写帧），18 个诊断场景一致；46 处变异全部抓住。默认仍走 Python。
- assistant 前端分流（2026-10-12，P2-3c）：`lib/api/assistant.ts` 的修订 / 续写 / 测试连接在开发档 `engine.assistant=ts` 时经动态 import 走引擎（Python 档零初始化引擎），`lib/engine/assistant.ts` 提供 HTTP 版会话存储（写回 Python 现有 `/api/assistant/sessions*`）、Native 读盘与 Rust 代发；作者取消（Esc / 换文件）接 `RunControl`，在下一个读流边界停下并把工具调用记为 paused。前端 8 个行为用例 + 10 处变异全部抓住；真 WebView 合成探针（`--assistant-only`）通过：修订、续写（首个增量 3 ms）、取消中的续写（Rust 流在服务端收尾前被关掉）、会话不存在、测试连接全部走引擎，会话接口收到 16 次调用且顺序与字段符合预期，项目文件零写入，合成 key 不出现在 WebView、会话接口与任何产物里。至此 P2-3 完成；默认仍走 Python，切默认值另起 PR，P2-4 真跑需作者批准。
- 真跑（2026-10-12，P2-4，作者批准）：真 WebView + 作者自己的模型配置（DPAPI 加密文件复制进隔离目录，key 只在 Rust 里解开）+ 合成两章项目 + 假 sidecar 会话接口，照编辑器的真实路径各跑一次 Ctrl+K（锚定窗口 + 内联指令 + polish 门禁）与 Ctrl+Shift+K（内联上下文包）。两次都成功：修订 6.8 s、门禁通过；续写首个增量 3.3 s、共 10.8 s、250 字。两次发出的 system / user 提示经 sha256 核对与 Python 逐字节相同。用量（provider 回报）：修订 17,431 + 176、续写 8,198 + 298，合计 26,103 token；我们的提示只有约 2,000 / 2,500 字，多出的输入 token 来自服务端。真跑顺带发现一处既有问题（与迁移无关，Python 路径同样会发生）：模型同时去掉末尾换行并改动锚定段外的标点时，编辑器的锚定 diff 会把整次改写丢掉，作者只看到「没有改动」。
- 切 assistant 默认值（2026-10-12，作者拍板只切开发档）：开发档没设 `engine.assistant` 时默认走引擎，设成 `python` 可切回；发行版仍一律 Python、不读存储，等 P5 装预览版再切。原因：P2-3c 探针与 P2-4 真跑都跑在 Vite 开发服务器上，发行版打包后的路径（分包后的动态 import + release Rust）还没被引擎跑过，装机版也没有切回手段。直接拿假 fetch 打 `/api/assistant/*` 的 9 个测试文件显式钉回 `python`（它们测的是 Python 传输与编辑器行为）；路由层补两条：开发档无偏好走引擎、发行版无偏好走 Python 且不初始化引擎。顺带修两处测试问题：happy-dom 下同一文件里第二次 `vi.spyOn(Storage.prototype, 'getItem')` 拦不到调用，开关测试里「存储被拒」「未知键不读存储」两条一直空转，改为替换整个 localStorage 并断言读没读；引擎路由测试的第一条用例要冷加载整个引擎包，满载时超过 5 秒（master 上同样满载可复现），挪进 `beforeAll`。6 处变异全部抓住。
- 首片仍未完整验收：继续补深层 JSON/reader 矩阵，并在后续负载保留性能验收；真实 WebView → mapper 的合成响应链已验证，但生产完整配置来源/实际 UI admission 仍待后续 owner。实际路由仍 Python，handoff 相对输入不变；P1-8/9 仍依赖 P2/P3/P4 与作者副本周用授权，不把合成绿测当全量完成。证据详见 `.codex/verification-report.md`。

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

P3 拆刀与进度（2026-10-12 起，每刀一个 PR、合并后接下一刀；P3-8 真跑前单独找作者批准与报预估）：

- 外部写回协议（`loop/external_*`、deferred 工具结果、外部等待阶段）不搬：装机版 `EXTERNAL_WRITEBACK_RELEASED=false`，生产里从不协商。SDK 的审批阶段（`require_approval` / `approval_required`）也不搬：StoryForge 的策略只出 allow / deny，工具从不要求审批；作者确认补丁走的是 run 结算后的 `permission.confirm`，与 SDK 审批无关。
- run 存储：P3 先用内存实现（引擎端口），P4 换 sqlite；会话、消息与工具调用证据照 P2-3 经现有 `/api/assistant/sessions*` 写回 Python 库。
- SDK 工具循环（2026-10-12，P3-1）：`ai_sdk/runtime`（loop / state / budget / feedback / models / ports）与 `tools`（models / registry / validation）搬进 `engine/loop/`（`sdkLoop` / `sdkPorts` / `sdkState` / `sdkTools`），模型、工具、轨迹、检查点、用量记账端口一律可 await。预言机在真实 `ToolCallingRuntime` 上跑 87 个脚本化场景（100 步）（脚本化模型 / 工具结果 / 中断触发点 / 检查点恢复，含基础设施失败），逐条比对轨迹事件、每次检查点存盘、模型请求、工具与策略调用、中断检查、用量记账与最终结果，外加 38 条 schema 校验、10 条参数解析、6 条限额校验；54 处变异抓住 52 处（余 2 处等价：TS 的恢复命令只有 continue / null；空输出 schema 本就不出问题）。接受的差异：模型给的工具参数按标准 JSON 解析（§4.3.1），NaN / Infinity、超出安全整数、孤立代理码点按「不是合法 JSON」反馈给模型；检查点字典只读回应用自己写的形状，不再把错类型硬转。默认仍走 Python。2026-10-13 累计验收 F3：检查点原先只复制数组外壳，交给钩子 / 存储的快照能改到活动状态里的 pending 参数（策略批的是 A、处理器执行的是 B）；已按 Python frozen dataclass 的契约整棵冻结（pending 及重试外壳、消息的工具调用 / metadata / 续接状态、产出物 payload、检查点本身），处理器仍拿可写副本。
- Agent 契约层（2026-10-12，P3-2）：权限四档策略（`permission/policy` 的档位归一、阶段与工具裁决、run 门）、意图识别、run 载荷摘要、结果契约、事件类型与控制消息、作者视图（从 P3-4 提前，载荷摘要要用）、工具轨迹与恢复标记、运行进度、实时帧编码（七种持久事件帧 + 控制回执 + 两种文本流帧）与边收边推的文本流搬进 `engine/loop/`（`permission` / `runPayloads` / `authorView` / `traces` / `frames` / `textStream`）。预言机 `golden_contracts.py` 跑 35 个函数 1,571 条记录（档位 × 阶段 × 工具风险 × 载荷全组合、帧编码含脱敏、作者视图的码点窗口）+ 15 个文本流场景，逐条一致；另有帧契约快照测试：引擎发出的每种帧字段集合与 `agent-ws.schema.json` 完全一致。变异 68 处抓住 66 处（余 2 处等价：`draft` 阶段永远不会要求审批；提及解析后还有第二道可提及过滤）。不搬：外部写回的等待帧；「托管宿主正在关闭」的中断分支（单进程关窗即退出，没有这个中间态）。接受的差异：重试等待的进度文案里秒数按浮点写，Python 只有「放弃 stream_options 重发」那次是整数 0，`Retry-After: 0` 时 TS 显示「0」而 Python 显示「0.0」。默认仍走 Python。
- 工具目录（2026-10-12，P3-3a）：28 个工具声明（含 22 个循环工具的 function schema）、确认位与权限级的单点派生、目录顺序、循环名映射、补丁工具集、确认集合、工具定义与 agent 层注册表、子代理执行器、参数辅助函数（受保护参数、模型整数参数容错、上下文摘录、证据摘要、快照摘要）搬进 `engine/loop/tools/`。7 个声明文件由一次性生成脚本从 Python 声明产出（长描述按句号断行），此后就是源码。预言机 `golden_tool_catalog.py`：声明逐字段一致，模型看到的循环工具 schema 逐字节一致（含键序），151 条辅助函数记录一致；变异 28 处抓住 27 处（余 1 处等价：所有循环参数本就以 `type: object` 开头）。接受的差异：模型给的整数字符串只认 ASCII 数字（Python 的 isdigit 还认全角 / 上标，其中一部分转换时会抛错）。处理器随 P3-3b（只读 / 检查 / canon）与 P3-6（产补丁、章节、深度一致性）。默认仍走 Python。
- 只读 / 检查 / canon 工具处理器（2026-10-12，P3-3b）：16 个工具的处理器（context.load、fs.list / read / search、project.knowledge、knowledge.propose、project.consistency / prose_check / collapse_check / entity_budget_check / promise_check / plan_update / cross_chapter_check、project.canon / canon_delta / hooks_delta）搬进 `engine/loop/tools/`，依赖（读写口、密钥快照、知识提议的 uuid 与时钟、已落库 artifact 查询、跨章模型端口、正则编译器）在注册时注入；内核补齐 `fs.list` / `fs.search` / 新文件路径解析 / 原始读取，知识检索补上 P1 留下的正则模式（与 fs.search 同一个匹配器，查询长度改按码点算）。预言机 `golden_tool_handlers.py` 在合成项目上跑真实 Python 处理器 123 次（含对冲突 / 去重 / 迁移知识提议、承诺与不变量、canon 增量写盘、505 个文件的列表上限），输出、轨迹、artifact 与写盘字节逐项一致；变异 41 处抓住 38 处（余 3 处等价）。接受的差异：正则用 JS 方言（Python 用 regex 模块），报错原文不同；JS 在进程内打断不了单次匹配，只能在行间核累计预算——P3-7 接线时换成能打断的实现（Worker 或 Rust）；canon.json 写错时一致性检查按 §4.3.1 直接报错（Python 静默丢掉别名）；`remove_ordinals` 里的布尔值不再当作 0 / 1。默认仍走 Python。
- 对话上下文（2026-10-12，P3-4）：chat 循环的 system prompt（由一次性脚本从 Python 运行时取三段原文生成）、初始消息组装（作者指令 / 全书底座 / 连载计划 / 场景约束 / 会话历史 / @钉上下文 / 作者视图 / 本轮消息，连同逐段来源指纹）、会话历史投影（消息、证据覆盖、模型压缩检查点的有效性判定与父链）、压缩检查点生成与发布前复核、工具结果回给模型的摘要与审稿 / 修订反馈搬进 `engine/loop/`（`promptContext` / `loopMessages` / `conversationHistory` / `toolFeedback`）。会话事实经 `ConversationSources` 端口读取（P4 前：消息与工具调用来自 Python 库，run 事件与 artifact 来自引擎存储）。预言机 `golden_conversation.py` 首次用内存 sqlite 跑真实 ORM（审计钩子只放行 `:memory:`），57 条记录 + 5 次消息组装逐项一致，含两代检查点、6 份「只破坏一处、其余重算一致」的伪造检查点、11 种压缩失败模式与预算超限；变异 46 处全部抓住。接受的差异：经 HTTP 读回的会话消息是 Python 已脱敏的版本（P4 前，消息含密钥时历史与 Python 不同）；压缩请求的 metadata 本就不进请求体，不搬。默认仍走 Python。
- run 存储与事件落库（2026-10-12，P3-5a）：run / 事件 / artifact / 子代理四张表的存储端口（`engine/store/runs.ts`，P4 前内存实现，id 全局自增、事件 sequence 按 run 自增）与 `event_sink`、`service_lifecycle` 的建 run / 续接（同会话守卫、终态重新进入 running、档位迁移标记）、`service_execution` 的执行开始与收尾结算（确认等待、章纲确认、暂停 / 停止的中断结算与「无结果时从上一条权限 / 中断事件重建」）、`events/contracts` 的完成载荷、`events/runtime_support` 的结果整形搬进 `engine/loop/runEvents.ts`。完成 / 失败 / 权限请求都先看 run 状态，控制通道落成的 paused / stopped 不会被覆盖。预言机 `golden_run_store.py` 在内存 sqlite 上用真实服务跑 13 个操作脚本 77 步（含跨会话续接被拒、无参续接保留旧档位与范围、三轮停止取最新中断、摘要里的 emoji 按码点截断、密钥脱敏），逐步比对新增行、帧与 run 行，全部一致；预言机执行前深拷贝操作（Python 原地改写结果，否则记下的「输入」已是处理后的样子，删字段的逻辑测不出来）。变异 54 处全部抓住。不搬：执行权租约（`execution_owner_event_id` 比较交换与「被取代」分支，单进程里执行权恒为本次）、外部写回等待、宿主关闭分支。默认仍走 Python。2026-10-13 累计验收逮到两处原子边界缺陷（F1 结算先读后写、中间能插进停止；F2 并发创建同一 run 绕过归属守卫），已改为存储层条件结算（`settleRun`：仍在 running 才写，并在同一原子边界记事件）与 public_id 唯一约束（后到者按续接重走归属守卫）。**P3-5c 的控制通道也必须是条件写**（Python 的暂停 / 停止按读到的 status + current_step 比较交换，终态 run 不被迟到的控制拖回）。
- chat 循环本体（2026-10-13，P3-5b1）：`loop_runtime.run_chat_loop` 与它的 SDK 适配层搬进 `engine/loop/`：`chatLoop`（循环入口、模型把工具调用写成正文时的说明、首轮不可用的回落信号）、`chatLoopAdapters`（`loop/sdk_adapters`：模型适配与待记账费用、用量记账、补丁一次一个 + 按档位裁决的策略、已有补丁时撤下产补丁工具、失败反馈文案、处理器之前就被挡下的调用补记证据与轨迹、循环工具执行与证据链）、`chatLoopContext`（`loop/sdk_context`）、`chatLoopTypes`（`loop/types` 的循环结果与工具反馈、`patches/types` 的补丁提案）、`runControl`（`loop/run_control`：控制所有者与中断收尾）、`chatLoopCheckpoints`（`loop/checkpoint_store` 缩版）。Python 经 ContextVar 隐式传递的两样东西改为显式：运行控制所有者（`RunControlScope`）由调用方交给循环；嵌套 writer 的送达回执经 `GenerationDeliveryCapture` 随工具执行传入。检查点按 §2.6 缩：只留在引擎内存（`LoopCheckpointStore`，按 run 保存 SDK 快照、结果累计、派发状态、档位与续跑消息），不落 artifact 表、不做摘要与脱敏、不记来源指纹与生成回执——这些只服务暂停后的续跑，随 P3-5c 按进程内语义重定（循环目前没有续跑入口）。预言机 `golden_chat_loop.py`（`--suite p3-chat-loop`）在内存 sqlite 上跑真实 `run_chat_loop`：脚本化模型（打在 `loop_runtime.build_llm_provider`）、脚本化工具执行（含送达回执、执行中改 run 状态、各类抛错、超大输出）、按边界改 run 状态的控制写、可推进的单调时钟（截止时间）；36 个场景逐项比对模型请求（长正文按摘要）、运行控制被问到的边界序列、证据存储操作、轨迹、文本帧、工具调用、每次检查点（阶段 / 轮次 / 序号 / 派发状态 + 快照与结果摘要）、最后一个检查点全文、循环结果或错误；`--check` 复导逐字节一致。变异 90 处抓住 88 处（余 2 处等价：`write_pending` 在任何档位的 draft 阶段都不会要求审批，P3-2 已记的死分支；运行控制拿到中断原因后不再回调检查函数，所有者层的「已有中断不再问」走不到）；「放行的调用登记给处理器认领」只在续跑时可观测，补了一条直接测试。**逮到一个 Python 既有缺陷**：模型对目录调 `fs_read`（工具本身正常报「不是文件」）后，下一次检查点保存时来源指纹对目录抛 `recovery_source_not_file`，SDK 把它当基础设施失败，整轮以「本轮未完成：Checkpoint store failed.」结束；TS 缩版不记来源指纹，循环照常继续。Python 侧已修（目录不再进来源指纹），预言机场景随之改为普通比对。接受的差异：整数值的费用在 TS 里是整数（Python 2.0 / TS 2，比对按数值）；「没有控制所有者」的分支不搬（`run_chat_loop` 唯一的调用方 `run_user_message` 总会建控制所有者）。P3-5 余下：5b2 对话轮次编排（`conversation_runtime`、`run_user_message` 的 chat 分支、隐藏系统任务、模型请求证据、`run_agent_user_message` 组装），5c 控制通道与续跑（含 `save_points` 投影）；`events/chapter_checks` 随 P3-6 章节管线。默认仍走 Python。
- 模型请求证据与隐藏系统任务（2026-10-13，P3-5b2a）：`request_evidence`（请求快照、路由来源、agent 请求观察者）与 `llm_observation` 的观察 provider 搬进 `engine/loop/requestEvidence.ts`、`engine/llm/observation.ts`。Python 的三个 ContextVar（观察者、当前操作与来源、当前派发）合成一个 `ModelObservation`，随 `LlmContext.observation` 显式传递；挂钩点只有 `sdkProvider`（与 Python `_sdk_provider` 同层），Ctrl+K / 续写等助手直连路径不带观察范围、不记证据（与 Python 同）。`system_jobs`（标题 / 摘要 / 压缩任务的确定性计划）与 `compaction_job`（一次压缩模型调用、用量另记一条工具调用、失败不伪造摘要）搬进 `engine/loop/systemJobs.ts`。P3-4 的压缩检查点补上 `conversation.compact` 操作来源与请求 metadata（P3-4 当时以「不进请求体」为由没搬，但它进本地证据）。`RunStore` 加 `updateArtifact`；`AssistantStore.createToolCall` 放宽为可一步记下已结束的调用（压缩任务要用）。预言机 `golden_run_evidence.py`（`--suite p3-run-evidence`）：2 份请求快照、15 个路由来源、21 步真实观察 provider（完成 / 截断 / provider 错误带用量 / 中断 / 普通异常 / 流式完成、完成事件不带用量、中途报错、错误自带用量、未完成、消费方提前关流、结算后再报错 / 130 次进度溢出 / 请求与来源超 2 MB / 开始与结算时落库失败 / 观察范围外 / 环境密钥、只在配置源里的凭据、键名里的凭据与敏感键的脱敏 / 续接状态与 metadata 省略 / 非法 metadata 类型 / 码点计数），10 个标题、4 组任务计划、12 个压缩任务场景（阈值内 / 阈值内且缺模型名 / 发布 / 带父检查点的第二轮 / LLMError / ProviderError / 坏 JSON / 派发中中断 / 响应后中断 / 缺模型名 / 超预算 / length 结束），逐项比对结果、错误及其携带的用量、证据 artifact 行与工具调用行；`--check` 复导一致。另有 3 条直接测试：同一观察范围里操作与当前派发的恢复、进度写入失败、`sdkProvider` 挂钩。变异 85 处抓住 84 处（余 1 处等价：证据「已结算就不再结算」的守卫在观察 provider 里走不到第二次结算）；首轮 71/85，补场景后抓住。接受的差异：传输进度写入证据失败时，TS 在这次派发结算时报 `RequestEvidenceError`，Python 在下一次传输边界就报。隐藏任务的编排（`_run_hidden_system_jobs`：发布前中断检查、发布前来源复核、改会话标题、记系统任务事件）随 5b2b 在真实 `run_agent_user_message` 预言机里验证。默认仍走 Python。
- 对话轮次编排（2026-10-13，P3-5b2b）：`runtime.run_user_message` 的 chat 分支、`loop/conversation_runtime`（循环入口与工具执行包装、回落单轮、隐藏系统任务编排）、`tools/execution_runtime`（中断边界 + 权限门 + 工具自己的模型操作范围）、`runtime_delivery.interrupted_delivery_result`、`events/review_sources`、`service.run_agent_user_message` 的组装搬进 `engine/loop/agentRuntime.ts`。运行控制在传输层是同步检查，run 状态改由存储同步读出（`RunStatusView`，P3 的内存存储直接实现；P4 换 sqlite 时补写穿缓存）；传输进度是同步回调，事件 sink 先排队、之后每次记录与收尾前都排空，事件与帧的顺序与 Python 的同步提交一致（有一组「进度写得更慢」的异步存储测试钉住）。P3-6 之前的边界：固定管线 intent 与文件输入模式的循环工具（审稿 / 修订 / 起草 / 润色 / 续写 / 压缩字数）直接报「随 P3-6 搬迁」；补丁确认、作用域绑定、审稿报告交接与 writer 送达事实的代码已按 Python 搬好，由 P3-6 的场景验证（本刀不计入变异）。预言机 `golden_agent_run.py`（`--suite p3-agent-run`）首次驱动真实 `run_agent_user_message`：模型在 HTTP 层脚本化（provider 配置层、观察层、请求证据、流式文本都走真代码），控制写按中断边界或在请求进行中触发，时钟虚拟；25 个场景（作答 / 一轮两个工具 / 两轮工具 / 流式 / 长历史触发模型压缩并改标题 / 工具后暂停 / 请求中停止 / 循环结束后收尾前停止 / 隐藏任务发布前停止（含压缩请求之后）/ 回落单轮前停止 / 截止时间 / 未配置模型 / 无项目单轮作答与失败 / 循环 provider 错误 / 会话归属冲突、两处会话 id 冲突、会话不存在 / 文件 intent 降级 / 前端交来的审稿报告不是最新、未绑定内容摘要、就是最新 / 知识提议产物落 artifact / 自定义标题保留），逐项比对帧、文本帧、结果或错误、run / 事件 / artifact / 会话 / 消息 / 工具调用行、HTTP 请求与中断边界序列；`--check` 复导一致。为让含绝对路径的摘要可复现，`golden_fs.isolated_fs_oracle` 加了固定目录模式，根路径记进 golden，TS 回放用同一个字符串。变异 67 处抓住 65 处（余 2 处等价：中断投递里的「不再等确认」随后又由收尾的 `interruptedResult` 设一次；完成结算前的进度排空在任何路径上都已被前面的系统任务事件排空）；首轮 61/67，补异步存储顺序测试与两个场景后抓住。**逮到第二个 Python 既有缺陷**：隐藏摘要 / 标题任务读的会话消息是本轮开头加载进 ORM 身份映射的旧集合（生产同样 `expire_on_commit=False`），永远漏掉本轮的两条（新会话摘要记 0 条、标题来源记成 `agent_result`）；TS 读当前消息。Python 侧已修（隐藏任务前刷新会话的消息集合），预言机去掉了临时补丁，重导内容不变。接受的差异：Python 的 `runtime_checkpoint` artifact 不进 TS 的 artifact 表（§2.6），其余 artifact 的 id 因此前移（预言机按顺序重新编号并改写 `artifact_id`）；整数值费用的 2.0 / 2 差异会进入压缩输入与证据摘要（两边各自自洽，预言机用非整数费率避开）。默认仍走 Python。
- 控制通道与续跑（2026-10-13，P3-5c）：`service_control`（控制消息记账与裁决、恢复后的续跑与诊断回写、认领了恢复却无检查点可接时回落 stopped）、`service_execution.agent_execution_state`、`loop/recovery` 的检查点续跑与停靠（不能续跑时停在 `paused / runtime.recovery` 并带上次轨迹与原因）、`loop/checkpoint_store` 的续跑诊断与上下文恢复、`loop/recovery_sources` 的来源指纹搬进 `engine/loop/runControlChannel.ts` 与 `chatLoopCheckpoints.ts`；`execute_agent_user_message_run` 从 `runAgentUserMessage` 拆出，续跑复用同一段执行（计划不重记、轨迹序号接着往下）。续跑规则按作者 10-13 同意的方案：续跑就是从内存检查点接着跑；接之前核对本轮读过的文件（当前文件、作者指令、带摘录的上下文文件、读写文件类工具的 path；按第一次读到时的指纹，不存在的文件也记，之后被新建同样算变了）没被改过，否则不续跑、停在 runtime.recovery 让作者重新发起；派发结果未知（请求发出后被打断）、已到终态的检查点、卡在不可安全重放的工具上同样不续跑。控制通道全部是条件写（存储层 `updateRunIf` 比较 status + current_step）：终态 run 不被迟到的暂停 / 停止拖回，恢复只从已结算的 paused 生效、权限等待上的恢复不生效，两条恢复只有一条认领成功，请求进行中的暂停 / 停止记为 requested、由循环在下一个边界收尾；调用方自带的 `control_effect` / `runtime_recovery` 一律不认。预言机沿用 `golden_agent_run.py`（新套件 `--suite p3-agent-control`；`p3-agent-run` 随之重构，复导逐字节不变）：控制经另一个 session 走真实 `handle_agent_control_message`，可以在请求进行中发、也可以在 run 停下后按顺序发，请求进行中或 run 停下后都能改项目文件；「刚建好还没执行」与「停在权限确认」两种 run 经真实的建 run / 执行开始 / sink / 收尾造出。27 个场景（请求中暂停后恢复并跑完 / 工具后暂停（第二个调用待执行、且是对目录的读取）恢复并再跑一轮 / 待执行的第二个调用是未知工具、恢复后照样补记失败轨迹 / 只读工具前暂停后恢复 / 恢复两次 / 请求中暂停又恢复（后者因仍在跑被忽略）/ 续跑进行中再恢复 / 暂停后改当前文件、改读过的文件、新建作者指令、改上下文摘录文件、读完后下一次请求进行中改该文件 → 来源已变 / 流式请求中暂停 → 派发结果未知 / 写类工具前暂停 → 工具结果未知 / 收尾前暂停 → 终态检查点 / 回落单轮前暂停（无检查点）→ 回落 stopped / 还没开始执行的 run 上暂停后恢复 / 请求中两次停止后恢复 / 已完成 run 上的暂停停止恢复 / 正在跑时恢复 / 伪造控制载荷 / 别的会话发控制 / 权限等待上的批准、带执行结果的批准（再批准被忽略）、拒绝、恢复（被忽略）、暂停后恢复），逐项比对每次控制的结果（事件 / 续跑结果 / 诊断）与 agent-run 套件的全部行；`--check` 复导一致；另挑 5 个「run 停下后才发控制」的场景在异步存储上复跑（请求进行中的控制与传输进度是两条连接的并发写，先后本就不定，不进异步比对），并加了「两条恢复并发只认领一次、续跑只跑一遍」与存储比较交换的契约测试。回放台从 `agentRun.test.ts` 抽成 `agentRunReplay.test-support.ts`，两个套件共用。变异 79 处抓住 63 处（首轮 58/78，补场景与并发测试后重跑抓住 5 处）；余 16 处等价或单进程走不到：续跑诊断成功时不外露、`tool_started` 落盘时 attempt 必然 ≥ 1、回合数收尾时由模型调用次数覆盖、续跑前处理过的调用不会再报处理器前失败、续跑没有文本观察者（与 Python 一致，轮次序号不可观测）、认领后诊断失败而不停靠只出现在章纲待定调用（P3-6）、迟到结算与执行权租约只在多进程出现、比较交换失败后的状态重读与权限等待「仍在跑」只在并发交错时可观测、权限确认步骤总与权限请求事件原子写入、停靠结果的轨迹与中断事件里的一致、续跑消息与结果里的 `run_id` 运行时自己会设、两处回落 stopped 的守卫在调用点恒真 / 恒假（Python 里是重启后的僵尸 run）。接受的差异：TS 的续跑诊断没有 `artifact_id`（检查点不落库，预言机删掉该字段）；provider 续接状态留在内存，不会出现 `provider_continuation_unavailable`；Python 检查点的摘要 / 脱敏 / 工具策略版本核对不搬（同一进程内的内存快照，不跨重启）。不搬或延后：章纲确认的待定调用续跑（`runtime_pending_call`，含 `chapter_brief` 参数）与生成回执随 P3-6；执行权租约不搬（单进程）；起服收尸不需要（内存存储，P4 换 sqlite 时再定）；`save_points` 状态投影另起一刀。默认仍走 Python。
- 管线拆刀（2026-10-13，作者说「做 P3-6」）：按依赖拆五刀，每刀一个 PR——6a 循环内产补丁工具（文件输入模式 + 审稿 / 修订 / 起草 / 续写 / 压缩）、6b 润色（润色槽解析 + 受控润色 + `chapter.polish`）、6c 深度一致性 + 语义 judge、6d 固定管线框架与审稿 / 修订 / 润色三条固定管线（含审稿的待定调用续跑）、6e 写章管线（章纲确认与续跑、检查、修复、来源守卫）。
- 循环内产补丁工具（2026-10-13，P3-6a）：`loop/conversation_runtime` 里循环工具的文件输入模式（existing_file 两种读法：修订与审稿读原始字节、不归一换行，审稿哈希与补丁区间绑定同一份作者原文；其余走有界读、超过 20 万字直接拒绝；new_file 解析新文件目标；可信上下文快照连同循环里读到的文件一起交接）、`patches/runtime_tools` 的 file.review / file.revise / file.create / judge.run、`patches/writing_context`（writer 派发时用后端来源刷新快照，自动检索结果不重新钉住）、`patches/revise_input`、`events/review_sources`、`tools/prose_continue_runtime`、`tools/project_canon_runtime` 的压缩修订，以及 assistant 层只给循环用的非流式续写 `draft_continuation` 搬进 `engine/loop/tools/patchHandlers.ts`、`patchContext.ts`、`engine/loop/reviewSources.ts` 与 `engine/assistant/service.ts`。Python 处理器经 DB 会话与 ContextVar 隐式拿到的东西改为显式：`ToolExecutionContext.services`（会话证据 + 绑定本次 run 运行控制与模型观察的模型端口、会话产物读取、中断检查）与 `deliveries`（嵌套 writer 的送达回执）；补丁与审稿报告的 id 由注册时注入的十六进制 id 生成器给。5b2b 搬好但未验的补丁确认（ask 档停在 permission.confirm、auto / full 档直接完成）、作用域绑定、审稿报告交接与续写的送达回执由本刀场景验证。预言机 `golden_agent_run.py` 新套件 `--suite p3-patch-tools`：47 个场景驱动真实 `run_agent_user_message`，模型在 HTTP 层脚本化（循环、修订 / 起草 / 续写的流式 writer、三视角审稿都走真代码），覆盖三个档位下的修订、只读档拦写、先读后改与钉上下文、审稿（模型审稿 / 部分降级 / 连续性信号 / 钉上下文与角色提示 / CRLF 原文）、同轮审稿后按序号修订、前端交来的当前报告 / 过期报告 / 未绑定的旧报告（含超出快照文本上限的条目与不存在的序号）、指向审稿却没有报告、不存在的序号、自动检索到的结构化知识、模型错误、隐藏路径 / 不存在 / 空白路径 / 未规范化路径、BOM 与 CRLF、含 NUL 的文件、修订请求中停止、审稿请求中停止与暂停、同轮两个产补丁工具、起草新文件 / 空占位 / 已存在 / 越界 / 超长指令、续写（光标落点 / 显式落点 / 光标在别的文件 / 只复述上文 / 字数越界 / CRLF / 未规范化路径 / 超过读取上限 / auto 档）、压缩（默认 / 指定比例 / 整数比例的文案 / 比例越界 / 空文件），逐项比对帧、结果、run / 事件 / artifact / 会话 / 消息 / 工具调用行、HTTP 请求与中断边界序列；`--check` 复导一致。**逮到 TS 既有问题**：P1-8 搬的审稿推理对所有异常都降级为启发式，审稿请求进行中的停止 / 暂停与证据落库失败会被吞成一份「启发式审稿结果」；已按 Python 只在模型错误、输出或输入不合格（JSON 解析错误 / RangeError / TypeError）时降级，其余照常抛出。变异 87 处首轮抓住 52 处；补 15 个场景与 3 条推理契约测试、收紧两个夹具后重跑存活项再抓住 21 处，合计 73 / 87；余 14 处逐条核为等价或循环里走不到：assistant 失败转编排错误（循环把所有处理器错误按同一文本反馈给模型）、子代理结果守卫与角色键名（只进错误文案）、未配置模型时的启发式审稿（循环只在配置好模型时运行）、`payload.project_root` / `payload.context_bundle` / 无项目根的回落（循环总给项目根、context_bundle 是受保护参数）、`metrics`（无消费方）、压缩修订自己的轨迹入参（非处理器自有轨迹，用通用摘要）、旧快照文件交接（循环里旧快照只有自动检索与循环读到的条目）、准备后回写的 `llm_prompt_context_bundle` 与续写响应的 `summary`（循环里无消费方）——其中几处到 6d 固定管线才可达。接受的差异：审稿 JSON 解析失败的降级原因文案随解析器不同；快照里「省略的 artifact 数」不含检查点（§2.6，检查点不进 TS 的 artifact 表，预言机在快照入口滤掉 `runtime_checkpoint`）。预言机的虚拟 `sleep` 改为推进虚拟时钟、重试抖动钉成 0.375（重试等待按时钟轮询；其余套件不重试，复导不变）。judge.run 只被固定管线调用，随 6d 验证；润色工具随 6b，深度一致性随 6c。默认仍走 Python。
- 润色（2026-10-13，P3-6b）：`patches/polishing_service`（本地确定性候选 + 在线候选经相对原文质量门禁择一、在线失败的三类归因、润色请求与分段 JSON 回包解析、润色目标路径校验）、`patches/polish_context`（只从已准入的上下文投影保守约束：人物 / 设定 / 时间线 / 伏笔文件、故事记忆、章节目标）、`llm_env.resolve_polish_llm`（专用润色槽，缺失时只允许作者显式借用主模型）与 `chapter.polish` 处理器搬进 `engine/loop/tools/polishService.ts`、`polishContext.ts`、`polishHandlers.ts`（门禁与事实守卫本身 P2-3b1 已搬）。润色槽经 `ToolRunServices.polish` 交给处理器：主模型与专用槽各自的配置源，provider 按槽出网（生产里 Rust 按槽换真 key、只放行该槽 baseUrl 同源），同样绑定本次 run 的运行控制与模型观察；`AgentRuntimeDeps.polish` 给专用槽的配置源（身份四项）与出网端口。预言机 `golden_agent_run.py --suite p3-polish`：22 个场景驱动真实循环，润色模型按请求里的片段回显并做脚本给的替换（两侧同一套构造），覆盖在线通过（ask / auto）、专用槽未配置 / 不完整、非 JSON / 代码块包裹 / 缺 segments / 片段数或下标变了、上游 500（专用槽没有调参项，按缺省三次重试）、length 截断、无改动、改专名被事实守卫拦下、可信上下文约束（人物 / 设定 / 时间线文件 + 故事记忆 + 章节目标）、风格要求与大写的服务商名、作者自定义指令、降级补丁在 auto 档仍要确认、结构化文件与派生目录、空正文、请求中停止、只读档；`--check` 复导一致。TS 回放台按槽校验出网（润色请求走错槽即失败）。另有 3 条润色槽解析的契约测试（借用主模型、专用槽缺失的文案、槽位）。变异 63 处首轮抓住 35 处；补 5 个场景、按槽校验与契约测试后重跑存活的 28 处抓住 19 处，合计 54 / 63；余 9 处等价或循环里走不到：`online_attempted` 与外部给的 `use_main_model`（循环里恒为在线、模型给不了这个参数，6d 固定管线才可达）、原文对自身的编辑政策校验（政策就是按这份原文建的）、「未配置且本地候选也被拒」的文案（本地规则只做保守清理，构造不出被拒）、快照 kind 守卫、桌面绝对路径越界与目标再校验（循环交来的路径恒在项目内，6d 可达）、输出里的约束计数（不进反馈）、风格要求是否存在（恒回落作者原话）、处理器轨迹的状态（循环用适配层自己的轨迹，6d 固定管线才用）。默认仍走 Python。
- 深度一致性与语义 judge（2026-10-13，P3-6c）：`deep_consistency`（目标稿件 + 本地 Character Bible：显式路径优先，否则扫 人物/ 设定/ 下的 Markdown，人物文件进「角色声音约束」、其余进「必含事实」，正文 / 单文件 / 总量各有预算）与 `judge/semantic`（评审提示、JSON 回包的三级提取：整段 / 代码块 / 第一个数组片段、条目规整与按摘录反查偏移、远程失败与未配置分开报告）搬进 `engine/judge/semantic.ts`、`prompts.ts`（由一次性脚本从 Python 取原文生成）与 `engine/loop/tools/deepConsistency.ts`，`project.deep_consistency` 处理器随之接上。评审请求经 `ToolRunServices.model` 发出：本次 run 的主模型配置源，请求挂在 `judge.semantic` 模型操作下记证据（Python 是工具操作里嵌套的 `model_operation`），绑定运行控制。提示里的必含事实 / 风格规则 / 证据链接按 Python 列表字面量写（`repr`），条目里的偏移按 Python `int()` 规整（ASCII 数字、可带空白 / 符号 / 下划线，浮点向零取整，布尔为 0 / 1，失败时报 Python 原文），偏移与行号按码点算。预言机 `golden_agent_run.py --suite p3-deep-consistency`：28 个场景驱动真实循环，覆盖有 / 无问题、代码块 / 夹在说明里的数组 / 大写 JSON 代码块包着对象 / JSON 字符串 / 数组片段里带括号与转义引号、非 JSON / 非数组 / 上游 500、上游失败时停止、显式 Bible 与事实去重、41 条事实截断、Bible 不存在、空稿 / 目录 / 隐藏路径目标、目标本身在 人物/ 里、judge 覆盖（模型 / 端点 / 超时，端点不同则不按产字价格计费）、条目规整（越界 / 字符串偏移 / 布尔 / 浮点 / 负数 / 非法严重度 / 缺字段 / 非对象 / 列表摘录 / 布尔摘录）、非法与空偏移、多处命中取最近、13 个设定文件触发预算截断、超长正文、请求中停止、大写后缀的设定与非 Markdown 的人物文件、主模型配置了 max_tokens 时 judge 照样不带；`--check` 复导一致。变异 72 处首轮抓住 50 处；补 7 个场景后重跑存活的 22 处抓住 13 处，合计 63 / 72；余 9 处等价或不可观测：JSON 整数恒为整数（截断与舍入相同）、无 category 的条目先被滤掉、未配置分支（循环只在配置好模型时运行）、请求配置源里的 judge 覆盖键与鉴权方式（预言机不记请求头与配置源）、judge 调用的费用（不落任何记录）、处理器与核心两层的空路径过滤、非处理器自有轨迹的入参。接受的差异：`STORYFORGE_JUDGE_LLM_*` 覆盖从配置源读（Python 读进程环境），桌面配置源不带这些键，实际总走主模型；Python `json.loads` 认 NaN / Infinity 与超大整数，TS 按 §4.3.1 视为非法 JSON（降级为调用失败）；`int()` 只认 ASCII 数字。默认仍走 Python。
- 固定管线（2026-10-13，P3-6d）：`runtime.run_user_message` 的非对话分支（固定管线结果的计划 / 逐条轨迹落库与每条之后的中断边界、`before_finalize:agent_runtime` 检查）、`intent_fixed_pipeline_adapter`、`file_review_pipeline`（审稿送达前逐条记子代理轨迹并检查中断；在「读完上下文」或「送达途中」暂停时记下可恢复的未决调用，恢复时从未决调用接着跑：只差审稿就补审稿，审稿已做完就只补记剩余轨迹与送达；停止时补记已完成的轨迹并保住只读报告）、`chapter_generation_pipeline` 的 file.revise 分支（上下文 → 审稿或沿用当前会话报告 → 修订 → judge.run 自检 → 等作者确认）、`chapter_polishing_pipeline`（上下文 → 受控润色，外部可传 `use_main_model` / `online_enabled` / `style_instruction`）、`runtime_delivery.check_result_delivery`、`runtime_recovery` 的恢复诊断与消费记录、`service_control` 按未决调用恢复（没有未决调用才走内存检查点；恢复被忽略时，仍有未决调用的 run 不回落 stopped）搬进 `engine/loop/fixedPipelines.ts`、`traces.ts`、`runControlChannel.ts` 与 `agentRuntime.ts`；sink 补 `recordRuntimePendingCall`（私有正文进 artifact、事件只露摘要、带当时的权限档位）。固定管线经 `FixedPipelineHost` 拿运行时能力（Python 是 AgentRuntime 的 mixin）。不搬：`chapter_generation_pipeline` 里 intent 为 file.review 的分支（分派表只把 file.revise 交给它，走不到）与 `_record_chapter_review_pending_call`（章节审稿已退役，没有调用方）。写章（chapter.write）随 6e。预言机 `golden_agent_run.py --suite p3-fixed-pipelines`：29 个场景驱动真实 `run_agent_user_message` 与控制通道，覆盖审稿（模型 / 启发式 / 角色提示与钉上下文）、在计划后 / 读完上下文 / 送达途中 / 送达前 / 收尾前暂停后恢复、停止、两次暂停（第二个未决调用胜出）、消费记录落库后的再次暂停（无未决调用可接，回落 stopped）、恢复中的 run 再收到恢复、审稿中途超时；修订（ask / auto 档都等确认、judge 标记、沿用前端交来的当前报告、范围警告、指向审稿却无报告、模型错误、修订后暂停）；润色（借用主模型、关闭在线、专用槽无改动、auto 档降级仍要确认、auto 档在线通过直接交 Desktop、项目外路径、相对路径）。另有 40 条恢复诊断与 10 条消费记录的纯函数记录（端到端走不到的分支：未支持的 intent、缺恢复消息 / 载荷、run 未恢复）。`--check` 复导一致，TS 首轮回放即逐项一致。预言机修正：控制写原先经主 session 改 run 行，第二次写入与缓存里的旧值相同时 SQLAlchemy 不发 UPDATE，「一次 run 里暂停两次」的触发会悄悄失效；改为写前先 refresh，其余套件复导不变。变异 62 处首轮抓住 44 处；补 5 个场景与纯函数记录后重跑存活项再抓住 9 处，合计 53 / 62；余 9 处等价：未决调用只会出现在已恢复的 run 上（当前步骤恒为 resumed）、恢复消息里的 run_id 在记录时恒为空、中断载荷恒带边界、TS 的审稿轨迹本就是普通字典、修订载荷里交前端报告还是解析后的报告由修订内部再解析成同一份、润色产物缺省时收尾按结果里的补丁补记同一条、上下文轨迹恒存在、恢复认领后恒为 running / resumed（诊断不可能拒绝）、恢复消息的 intent 与载荷里的相同。默认仍走 Python。
- 写章管线（2026-10-14，P3-6e，P3-6 收口）：`adapters/chapter_writing_pipeline`（第一段：解析目标 → 冻结来源 → 整理 Chapter Brief → 记下待确认的未决调用、请作者确认后停在 `chapter.brief.confirm`；第二段：作者确认（可编辑）后起草 → 检查 → 必要时定向修复一次 → 再检查，只有通过才产补丁，否则把候选稿作为只读证据留下）、`chapter_writing_contracts`（目标解析：显式目标优先，否则连载计划的下一章，显式目标不是计划下一章时不借用计划的标题 / 目标；brief 种子 / 提示 / 解析 / 确认、起草与修复指令）、`chapter_writing_tools`（chapter.brief / draft / check / repair 四个处理器）、`chapter_check_protocol`（带版本、失败即关闭的检查：回包必须逐字回显检查源摘要，整份 findings 先全部校验再承认，硬失败必须有能定位到所报行的原文证据，重复键 / 非有限数字 / 超预算一律不认）、`chapter_source_guard`（固定来源文件、钉选文件、上一章结尾、测得的声音与场景约束合成签名，再加冻结写作上下文的知识 / 普通来源重放）、`loop/generation_recovery` 里共用的 `writing_context_sources_unchanged`（连同 `knowledge_recovery` / `ordinary_recovery`）与控制通道恢复时注入作者确认的 brief 搬进 `engine/loop/chapterWritingPipeline.ts`、`chapterWritingContracts.ts`、`chapterCheckProtocol.ts`、`chapterSourceGuard.ts`、`writingContextRecovery.ts`、`tools/chapterWritingTools.ts`。`parseJson` 加可选的 `uniqueKeys`（缺省行为不变）；执行期的编排失败照 Python 包成 `AgentRuntimeError`（消息入口再包成它的子类 `AgentRuntimeUserMessageError`，控制通道里续跑失败报 `AgentRuntimeError`）。预言机 `golden_agent_run.py --suite p3-chapter-writing`：34 个场景驱动真实 `run_agent_user_message` 与控制通道（检查模型按自己提示里的检查源回显摘要，两侧同一套构造），覆盖整理 brief、确认后通过（ask / auto）、修复后通过 / 仍失败、只有建议、检查回包无效 / 摘要不符 / 证据行不符 / 超过条数 / 上游失败、字数越界触发修复、brief 过期（id / 修订号）/ 字数范围无效 / 恢复时没交 brief、确认期间改作者指令 / 上一章 / 钉选文件 / 新增结构化知识、整理 brief 期间改来源、没有项目 / 目标已有正文 / 目标在项目外、按连载计划的下一章、显式目标不是计划下一章（含计划记了落盘路径）、brief 不是 JSON / 代码块包裹且字段需收口、整理 brief 收尾前暂停、钉选上下文、空占位目标、带项目名、确认的 brief 里含密钥；另有 34 条检查协议纯函数记录（端到端走不到的校验分支）与检查提示原文。`--check` 复导一致；TS 首轮回放即逐项一致。变异 70 处首轮抓住 47 处；补 6 个场景与检查协议记录后重跑存活项再抓住 13 处，合计 60 / 70；余 10 处等价或不可观测：TS 里检查源的逐项全等已覆盖协议版本的类型检查（Python 需要它是因为 True == 1、2.0 == 2）、行号越界由随后的「引用不在该行」兜住、签名里的声音与场景约束（依赖的固定来源文件已在签名里，夹具改动没让测得的声音变化）、未决调用只出现在已恢复的 run 上、目标路径不可编辑、普通来源与清单摘要的核对与文件签名重叠，以及下面这处只在作者消息含密钥时才可达的分支。**逮到一个 Python 既有边角问题（未修，待作者定）**：作者的写章消息里含已配置的 key 时，来源守卫存的是脱敏后的消息，知识选择的查询哈希对不上，整理 brief 时自己的漂移校验就报「来源在确认期间已变化」，模型都没调（已用一次性脚本实证）；TS 照搬同样的行为。不搬或延后：`events/chapter_checks.query_chapter_check_history` 是 HTTP 读接口（检查历史列表，依赖 artifact 的 `created_at`），随 P4-2 历史读取一起搬；`generation_recovery` 的检查点生成回执按 §2.6 不搬（检查点只在内存）。至此 P3-6 五刀全部合并，循环、固定管线与写章管线都已在引擎里，默认仍走 Python。

### P4 存储与导入（PR P4-1 … P4-3）

| # | 范围 | 验证 |
| --- | --- | --- |
| P4-1 | `store/`：基础 6 张表及全量保留所需 subagent 数据映射、`schema_version`、迁移机制、Db port 的 plugin-sql 适配器与内存适配器 | 单测；并发写顺序测试；不能遗漏 subagent 消费契约 |
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
| 7 | **流式响应**逐块到达不达标 | 续写、对话无逐字 | P0-1 探针（plugin-http 已过）；2026-10-12 模型请求改走 `engine_llm_send`，按网络块经 Channel 回传，回显擦除只扣住可能是 key 前缀的尾巴 |
| 8 | **主线程卡顿**（大书扫描） | UI 冻结 | P0-3 探针；Worker |
| 9 | **sqlite 并发**：引擎多个 run 同时写 | 事件顺序 | 单写队列；`sequence` 列由引擎分配 |
| 10 | **旧库导入**不全（JSON 列、时区） | 丢会话 | 作者库副本逐条比对；失败不标记可重试 |
| 11 | **估时偏差**：34k 行搬迁 | 拖期 | 每阶段末重估；决定 C 的裁剪是主要杠杆 |
| 12 | **期间无新功能** | 作者 6 到 11 周看不到产品变化 | P0-5 的体积数字、P2-4 / P3-8 的真跑先给作者看；预览版 P5 提前装 |
| 13 | **安全**：key 进 WebView 就多一层暴露 | 比 v1 多一层暴露 | 2026-10-12 推翻原「key 从 Rust 读进 JS 内存」：**key 不出 Rust**。引擎配置源里的 key 是占位串；Rust `engine_llm_send` 只在四个鉴权头里把占位串换成真 key，只放行与已配置 baseUrl 同源的地址（跨源重定向不跟），响应头、响应体与错误文本里出现的真 key 换回占位串（与 Python 同用 ≥ 6 字门槛）；引擎的密钥快照就是占位串 |
| 14 | **token 计数与成本估算**依赖 Python 侧实现 | 记账不一致 | golden 比对同一响应的用量 |

---

## 9. Rust 侧改动细目

**删除**（P6-2）：`main.rs` 第 121 到 568 行之间的 sidecar / docker / 迁移 / API 配置函数（`kill_windows_process_tree` 起到 `get_api_config` 止）；`managed_agent_host.rs`、`host_close.rs`、`host_close_state.rs`、`owned_process_tree.rs` 及测试、`external_native_ipc_fixture.rs`、`external_chat_bridge_tests.rs`、`lifecycle_gui_fixture.rs` 的后端夹具段；Cargo 里 `windows-sys` 的 `Win32_System_JobObjects` 特性（若无他用）。

**保留**：`fs.rs`、`shadow_git*`、`llm_config_store*`、`secret_protection.rs`、`runtime_paths.rs`。

**先留后议**：`fs_writeback_receipts.rs`、`managed_writeback.rs` 与 `write_file_with_receipt` / `begin|end_writeback_delivery` / `create_writeback_audit` 等 9 个命令。它们是跨进程时代的台账，单进程后写回只剩「快照 → 原子写 → 版本记录」。P6 时评估：前端若已不调用，删；若 §2.6 的意图日志复用了回执格式，留 `write_file_with_receipt` 一个。

**新增**：`tauri-plugin-http`、`tauri-plugin-sql`（sqlite 特性）；`engine_llm.rs` 的三个命令（`get_engine_llm_source` / `engine_llm_send` / `engine_llm_close`，key 不出 Rust，见风险 13）；可选 `search_project` 命令（P0-3 若发现 JS 全文搜索慢）。

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

2026-10-11 已确认：**A 立即实施；B 全量迁移 OpenAI 兼容、Anthropic、Gemini；C 全量保留现有功能，不采用下表原裁剪建议**。D 的样本包位置已用于 P0，完整引擎合同在 P1 复核；E–H 及真实数据/费用/默认切换仍按阶段确认。下表保留初始建议作历史参考，不得据 B/C 建议删除现有能力；`subagent_runs` 的存储映射须在 P4 按真实消费方调查，不预先裁掉。

2026-10-11 另拍板：**输入范围**。golden 只要求范围内逐字节一致，范围外直接报错、不再模仿 Python；JSON 嵌套上限 64 层，取代此前待审的 4096 方案。细则见 §4.3.1。

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

P0 开始日期：2026-10-11；其余阶段开始日期随验收推进补充。
