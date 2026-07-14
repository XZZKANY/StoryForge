# 验证报告 · 番茄 API 直连 phase2（对账 + 批量发章）

时间：2026-07-14  
分支：`feat/publish-fanqie-api-phase2`

## 范围

在已落地的 API 直连 phase1（登录 webview / 读端点 / 单章发布）之上，做两块：

- **对账（reconcile）**：拉某号线上 book_list ↔ library 匹配（onlineBookId 优先，其次归一书名），写线上快照（章/字/审核态）回匹配书；暴露「线上多出」「本地标已开但线上查无」；台账已开 vs 线上本数并排展示。
- **批量发章（batch）**：复用现有单章发布流程顺序驱动——线上已发标题去重（防 -3010）、字数下限跳过（<1000）、两章间隔节流（防 -3009，`batchPublishIntervalSec` 默认 45s）、可中途停止。

## 诚实边界（关键）

- 番茄 book_list **不带可靠开书日期**，故对账**不**推算「本月已开」月账、**不**自动改配额；只写本地快照 + 暴露差异，配额仍用账号行「校准已开」手动定。未编造月份计数（守「不造假兜底」红线）。
- 批量发章**不新增 Rust 代码路径**：复用现有 `publish_fanqie_chapter` 命令，前端 `publishChapterOnce` 一次性等回执 + 顺序循环 + 节流。无代登/无打码/无反检测（L4/L3-c 未触碰）。
- 线上章节列表字段随平台版本浮动：`fetchChapterList` 尽力投影 title，拿不到即不去重（非致命），不伪造。

## 落点

- 纯函数：`model/reconcile.ts`、`model/batch-publish.ts`（+ `model/types.ts` 扩 `PublishBook.onlineBookId/onlineSnapshot`、`PublishSettings.batchPublishIntervalSec`）。
- storage：`publish-api.ts` 加 `fetchChapterList` / `publishChapterOnce`；`publish-repository.ts` normalize 补新字段 + settings 加载合并默认（旧文件缺字段回退）。
- hook：`usePublishCockpit` 加 `onlineBooksByAccount`（`onlineBooks` 改派生）、`reconcile*` / `bindOnlineBook` / `importOnlineBook` / `startBatchPublish` / `stopBatch`。
- 视图：`tabs.tsx` 账号页加「对账」按钮 + ReconcilePanel + BatchPublishPanel。

## 验证

```text
npm --prefix apps/desktop/frontend run typecheck                       # pass
npm --prefix apps/desktop/frontend run test                           # 40 files / 213 passed（含新 publish-reconcile 6 + publish-batch 2 = 9 新用例）
npx eslint apps/desktop/frontend/src/features/publish tests/publish-*  # clean
npx prettier --check <本刀新增/编辑的文件>                              # 新文件与 hook 全 clean
```

## 未验证 / 已知

- **真机 Tauri + 真实番茄 Cookie 的 reconcile/batch 端到端**：归 E2E-1 真机轨（webview fetch 发布、频控节流实测、chapter_list 字段真形状）。单元测试只覆盖纯函数计划/对账，不含 IO 编排真跑。
- **pre-existing 格式债**：publish 目录多个**本刀未改**的文件（auto-assign/quota/survival/status-machine/ui/tabs 等）在 master(`bfcca450`) 即未过 `prettier --check`；本刀不做无关格式化（守「禁止顺手重构无关代码」），仅保证新增/编辑文件自身 prettier-clean。

---

# 验证报告 · 发行 UI/UX 中低优先打磨

时间：2026-07-13

## 范围

中优先 + 低优先（不含高优先：会话健康条 / Agent 桥 / 搜索占位）

## 改动摘要

- Stats 默认一行摘要，可展开四格（`CapacitySummary`）
- 文案：Ready→可开分、spare→余量、API 开书→平台开书
- 确认已开：confirm 摘要 + flash 额度前后
- Flash：失败 8s + 可关闭；语义色 `error/success/warning` token
- 空库 `OnboardingGuide` 三步
- 数字键 1–7 切 Tab
- demo.html 同步

## 验证

```text
npm --prefix apps/desktop/frontend run typecheck  # pass
npm --prefix apps/desktop/frontend run test -- tests/publish-*.test.ts  # 22 passed
```

## 未验证

- 真机 Tauri 观感
- 浅色主题下 token 对比人工目视

---

# 验证报告：源码标准专窗 S0

时间：2026-07-13
分支：`refactor/source-code-standards-s0`
基点：`baf57933f2cf2317365f80421a439bc13ff75fbf`
任务：`.trellis/tasks/07-13-source-code-standards/`

## S0 结果

- 创建专窗 worktree 时未提交 publish WIP 未带入；专窗使用 `.worktrees/source-code-standards-s0`，本分支 publish 路径零改动。
- AST 精确冻结跨模块私有依赖 256 点：agent_runs 78（77 import + 1 attribute），book_runs 178（159 + 19）。
- 18 个既有超限源码/测试/前端主文件进入只减不增行数护栏；新增 live Python 模块上限 500，新增 live 测试上限 800。
- 新增 `agent_runs/STRUCTURE.md`，当前主链读序限制为 8 文件，并记录 6 个目标公共面。
- T1 审计：WS 命名 encoder 是 SSE/REST live 依赖，转 T2 迁移后删；零引用 `_chapter_request` 与无用 `NovelLoopRequest` 绑定已删除。

## 已执行

| 命令 | 结果 |
| --- | --- |
| `uv run pytest tests/test_source_code_standards.py -q` | 5/5 通过 |
| `.venv/Scripts/python -m pytest tests/test_source_code_standards.py tests/test_book_generation_parallel.py tests/test_book_generation_parallel_wrapper.py -q` | 19/19 通过 |
| `.venv/Scripts/python -m pytest tests/test_ws_contract_golden.py tests/test_ws_schema.py tests/test_api_surface.py -q` | 22/22 通过 |
| `.venv/Scripts/ruff check app/domains/agent_runs app/domains/book_runs tests/test_source_code_standards.py` | 通过 |
| `git diff --check` | 通过 |
| publish 路径 status/diff guard | 无改动 |

## 未执行

- `pnpm openapi`：未改 route、DTO、schema 或 OpenAPI 输出，无契约 drift 面。
- Desktop typecheck/vitest：未改 Desktop 源码。
- `pnpm verify`：按计划留到 S8 专窗总验收；S0 已跑本波相关最小集与行为护栏。

---

# 验证报告：源码标准专窗 S1

时间：2026-07-14
分支：`refactor/source-code-standards-s0`
任务：`.trellis/tasks/07-13-source-code-standards/`

## S1 结果

- 建立 `loop`、`tools`、`fs`、`events`、`permission`、`patches` 六个公共 package face。
- `runtime.py` 从 2677 行降至 265 行，仅保留 facade、总入口、兼容 monkeypatch seam 与临时 re-export。
- agent_runs 跨模块私有依赖从 78 降至 0，并新增恒零护栏与公共面存在性测试。
- 旧 `AgentRuntime` 37 个方法与 33 个模块 helper 在新位置 AST 结构等价；本波无意图行为变更。
- publish/fanqie 路径零改动；未触碰 route、DTO、schema 或 OpenAPI 输出。

## 已执行

| 命令 | 结果 |
| --- | --- |
| `uv --cache-dir ... run ruff check app/domains/agent_runs tests/test_source_code_standards.py` | 通过 |
| `uv --cache-dir ... run pytest -p no:cacheprovider tests/test_source_code_standards.py tests/test_agent_runs.py tests/test_agent_loop_runtime.py tests/test_ide_agent_orchestrator.py tests/test_ide_agent_transport.py tests/test_runtime_tools.py -q` | 142/142 通过 |
| AST 方法/helper 等价脚本 | 37/37 方法、33/33 helper；无 drift |
| 私有依赖扫描 | agent_runs = 0 |
| 行数护栏 | `runtime.py` 265；新增 live 模块全部 ≤500；冻结文件无增长 |
| `git diff --check` | 通过 |

## 未执行

- `pnpm openapi`：未改 route、DTO、schema 或 OpenAPI 输出。
- Desktop typecheck/vitest：S1 未改 Desktop 源码。
- `pnpm verify`：按计划留到 S8 专窗总验收。

---

# 验证报告：源码标准专窗 S4

时间：2026-07-14
分支：`refactor/source-code-standards-s0`
任务：`.trellis/tasks/07-13-source-code-standards/`

## S4 结果

- file review、chapter polish/BookRun、chapter review/repair 三组 fixed pipeline mixin 从 `loop/` 移至 `adapters/`，函数体保持不变。
- `runtime.py` 只保留 chat-loop 与 `run_fixed_intent_pipeline` 两路；五个显式 intent 经 typed `FixedPipelineRequest` 一一分派。
- `bookrun.start/pause/resume/retry_from_checkpoint` 统一经 `bookrun_managed_run_adapter.py`，保留 IDE command audit、assistant tool-call evidence 与 managed WritingRun 语义。
- 静态护栏禁止 free-text loop 导入 adapters/book_runs，并禁止 runtime 恢复直接 fixed 私有方法调用。
- `runtime.py` 257 行；所有 adapter 模块均低于 500 行；publish/fanqie 路径零改动。

## 已执行

| 命令 | 结果 |
| --- | --- |
| `uv --cache-dir ... run ruff check app/domains/agent_runs ...` | 通过 |
| `uv --cache-dir ... run pytest -p no:cacheprovider tests/test_source_code_standards.py tests/test_agent_adapters.py tests/test_loop_contract_types.py tests/test_loop_tool_schemas.py tests/test_runtime_tools.py tests/test_agent_runs.py tests/test_agent_loop_runtime.py tests/test_agent_llm_context.py tests/test_agent_canon.py tests/test_ide_agent_orchestrator.py tests/test_ide_agent_transport.py tests/test_ide_commands.py tests/test_ide_run_events.py tests/test_redaction_boundaries.py tests/test_ws_contract_golden.py tests/test_ws_schema.py tests/test_api_surface.py -q` | 271/271 通过 |
| adapter/import 静态护栏 | 14/14 通过 |
| 私有依赖扫描 | agent_runs = 0 |
| `git diff --check` | 通过 |

## 未执行

- `pnpm openapi`：未改 route、DTO、Pydantic wire model 或 OpenAPI 输出。
- Desktop typecheck/vitest：S4 未改 Desktop 源码。
- `pnpm verify`：按计划留到 S8 专窗总验收。

---

# 验证报告：源码标准专窗 S3

时间：2026-07-14
分支：`refactor/source-code-standards-s0`
任务：`.trellis/tasks/07-13-source-code-standards/`

## S3 结果

- 新增 `LoopRoundResult`、`LoopToolCall`、`LoopToolFeedback`，provider/tool 原始 payload 在边界一次解码；`run_chat_loop` 除工具名映射外无 `.get()` 业务字段读取。
- `ToolResult` 泛型化并可携带 typed `PatchProposal`；file revise/create、trim prose、judge repair 产物建立 typed view，原 wire dict 原样保留。
- completed/failed terminal event payload 由 frozen dataclass 构造，WS/Pydantic wire frame 未改变。
- `loop_runtime.py` 552→329 行；prompt/history/budget/feedback 外移。
- `llm_context.py` 601→461 行；context value/filter helper 外移。
- `save_points.py` 577→125 行；save-point projection helper 外移，目标模块 498 行。

## 已执行

| 命令 | 结果 |
| --- | --- |
| `uv --cache-dir ... run ruff check app/domains/agent_runs ...` | 通过 |
| `uv --cache-dir ... run pytest -p no:cacheprovider tests/test_source_code_standards.py tests/test_loop_contract_types.py tests/test_loop_tool_schemas.py tests/test_runtime_tools.py tests/test_agent_runs.py tests/test_agent_loop_runtime.py tests/test_agent_llm_context.py tests/test_agent_canon.py tests/test_ide_agent_orchestrator.py tests/test_ide_agent_transport.py tests/test_ide_commands.py tests/test_ide_run_events.py tests/test_redaction_boundaries.py tests/test_ws_contract_golden.py tests/test_ws_schema.py tests/test_api_surface.py -q` | 267/267 通过 |
| loop 主路径 AST 护栏 | 三个 typed decoder 存在；裸业务 payload `.get()` 为 0 |
| 私有依赖扫描 | agent_runs = 0 |
| 行数护栏 | `runtime.py` 288、`tooling.py` 59、`loop_runtime.py` 329、`llm_context.py` 461、`save_points.py` 125；均达标 |
| `git diff --check` | 通过 |

## 未执行

- `pnpm openapi`：未改 route、DTO、Pydantic wire model 或 OpenAPI 输出；WS golden 已通过。
- Desktop typecheck/vitest：S3 未改 Desktop 源码。
- `pnpm verify`：按计划留到 S8 专窗总验收。

---

# 验证报告：源码标准专窗 S2

时间：2026-07-14
分支：`refactor/source-code-standards-s0`
任务：`.trellis/tasks/07-13-source-code-standards/`

## S2 结果

- `tooling.py` 从 1061 行降至 59 行，只保留兼容 facade。
- 22 条 AgentRuntime ToolSpec 按 context/fs、project、patch/file、BookRun、hooks 五组拆分；catalog 顺序与每条 spec AST 均保持不变。
- schema/name/patch-tool 派生落在 `tools/loop_schema.py`；registry/result/permission/subagent 类型落在 `tools/execution.py`。
- 生产代码改走 `tools` / `permission` 公共面；领域模块同时拥有 handler 实现与本地映射，中央注册不再维护第二份工具名镜像。
- 修复并测试 `runtime.py` 的 `_trim_prose_instruction`、`_safe_summary` 等显式兼容出口，避免 Ruff 清理仅供旧路径 import 的符号。

## 已执行

| 命令 | 结果 |
| --- | --- |
| `uv --cache-dir ... run ruff check app/domains/agent_runs ...` | 通过 |
| `uv --cache-dir ... run pytest -p no:cacheprovider tests/test_source_code_standards.py tests/test_loop_tool_schemas.py tests/test_runtime_tools.py tests/test_agent_runs.py tests/test_agent_loop_runtime.py tests/test_agent_canon.py tests/test_ide_agent_orchestrator.py tests/test_ide_agent_transport.py tests/test_redaction_boundaries.py -q` | 221/221 通过 |
| ToolSpec AST/顺序等价脚本 | 22/22 spec 无 drift；原顶层类型/派生函数无 drift |
| 私有依赖扫描 | agent_runs = 0 |
| 行数护栏 | `runtime.py` 288≤400；`tooling.py` 59≤500；新增模块全部≤500 |
| `git diff --check` | 通过 |

## 未执行

- `pnpm openapi`：未改 route、DTO、schema 或 OpenAPI 输出。
- Desktop typecheck/vitest：S2 未改 Desktop 源码。
- `pnpm verify`：按计划留到 S8 专窗总验收。

---

# 验证报告：源码标准专窗 S5

时间：2026-07-14
分支：`refactor/source-code-standards-s0`
任务：`.trellis/tasks/07-13-source-code-standards/`

## S5 结果

- book_runs 跨模块私有依赖从 178 降至 0；恒零测试已加入硬门禁。
- live `assistant` / `agent_runs` / `ide` 仅允许使用 `book_generation`、`service`、`models` 三个 BookRun 公共模块；原先直接吃生成私有 helper 的调用方已迁移到公共名。
- `book_generation.py` 947→485 行，保留 serial runner、公共 facade 与显式兼容出口；setup/draft/resume/contracts 分责且均 ≤500。
- `book_generation_judge.py` 722→488 行，story-state 投影/提交外移；`book_generation_parallel.py` 601→464 行，证据与指标 helper 外移。
- `book_context.py` 524→25 行公共 facade，core 376、cache/listener 151 行；缓存失效行为测试保持不变。
- 未改 route、DTO、schema、OpenAPI、publish/fanqie 或产品行为。

## 已执行

| 命令 | 结果 |
| --- | --- |
| `uv --cache-dir ... run pytest tests/test_source_code_standards.py -q` | 13/13 通过 |
| `uv --cache-dir ... run pytest tests/test_book_generation.py tests/test_book_generation_parallel.py tests/test_book_generation_parallel_wrapper.py tests/test_book_generation_long_wrapper.py tests/test_book_generation_llm_retry.py tests/test_book_context_cache.py tests/test_book_runs.py -q` | 125/125 通过 |
| `uv --cache-dir ... run pytest tests/test_source_code_standards.py tests/test_book_run_start.py tests/test_artifact_s3_export.py tests/test_multi_round_repair.py tests/test_usage_accounting_matrix.py tests/test_prompt_assembly.py tests/test_ide_cross_chapter.py tests/test_agent_llm_context.py tests/test_assistant_revise.py tests/test_assistant_provider_health.py tests/test_ide_agent_orchestrator.py -q` | 98/98 通过 |
| `uv --cache-dir ... run ruff check app/common/llm_client.py app/common/llm_env.py app/author_chat.py app/domains/assistant/service.py app/domains/book_runs app/domains/ide app/domains/judge/service.py tests/test_book_generation_parallel.py tests/test_source_code_standards.py` | 通过 |
| 私有依赖 / live import 静态门禁 | book_runs = 0；live 违规 = 0 |
| 行数门禁 | generation 485；judge 488；parallel 464；context facade 25；所有新增模块 ≤500 |
| `git diff --check` | 通过 |

## 未执行

- `pnpm openapi`：未改 route、DTO、Pydantic wire model 或 OpenAPI 输出。
- Desktop typecheck/vitest：S5 未改 Desktop 源码。
- `pnpm verify`：按计划留到 S8 专窗总验收。

---

# 验证报告：源码标准专窗 S6

时间：2026-07-14
分支：`refactor/source-code-standards-s0`
任务：`.trellis/tasks/07-13-source-code-standards/`

## S6 结果

- `ChatWindow.tsx` 从 1492 行降至 72 行，只保留会话状态、session/recovery/stream/control/submission hooks 与 view 的组合；最大新 owner `useRunAuthorAgent.ts` 为 463 行。
- `App.tsx` 从 848 行降至 176 行，只保留 shell/workspace 接线、快捷键、Tauri menu bridge 及原有 publish-side 两个回调；`AppShell.tsx` 293 行，tabs/project/preferences 分别由独立 hook 持有。
- 新增 `apps/desktop/frontend/src/STRUCTURE.md`，把 Desktop 主链读序限制为 8 文件，并固定 Editor/ChatWindow 隐藏不卸载、dirty 单 owner、补丁待确认等边界。
- 新增 3 项 Chat 生命周期回归：pending initial prompt 单次发送、旧会话 stream 隔离、window 监听器原回调卸载；完整 Desktop 206 项测试通过。
- 源码标准门禁加入 App 400、Chat/S6 owner 500 行硬上限，并通用扫描 `components/app` 与 `components/chat-window` 的新模块。
- 两轮只读交叉审查未发现行为漂移或运行时循环；publish/fanqie 路径零改动。

## 已执行

| 命令 | 结果 |
| --- | --- |
| `tsc --noEmit --strict ... ChatWindow.tsx useEditorWorkspaceTabs.ts useProjectCommands.ts useAppPreferences.ts` | 通过 |
| `npm run test` | 39 files，206/206 通过 |
| S6 改动文件定向 `eslint` | 通过 |
| S6 改动文件定向 `prettier --check` | 通过 |
| `uv run pytest tests/test_source_code_standards.py -q` | 13/13 通过 |
| `uv run ruff check tests/test_source_code_standards.py` | 通过 |
| 行数门禁 | App 176≤400；Chat 72≤500；全部新增 owner ≤500 |
| `git diff --check` | 通过 |

## 外部阻断 / 未执行

- `npm run typecheck`：未通过；错误全部位于隔离分支已有的 `src/features/publish/**`，缺少 Phase2 的 `cookieText`、`PlatformApiEndpoint`、`apiEndpoints`、状态组件等配套类型/导出。本任务按红线不修改 publish/fanqie；S6 自有 hooks 严格定向 tsc 已通过。
- `pnpm openapi`：未改 route、DTO、Pydantic wire model 或 OpenAPI 输出。
- `pnpm verify`：按计划在 S8 集成验收；若 publish Phase2 仍未进入专窗基线，将如实保留同一外部阻断，不以跨范围修复换取假绿。

---

# 验证报告：源码标准专窗 S7

时间：2026-07-14
分支：`refactor/source-code-standards-s0`
任务：`.trellis/tasks/07-13-source-code-standards/`

## S7 结果

- 六个 live 祖传测试文件全部拆至 ≤800 行：`test_agent_runs.py` 346、`test_book_generation.py` 557、`test_agent_loop_runtime.py` 416、`test_agent_canon.py` 257、`test_book_runs.py` 635、`test_ide_agent_orchestrator.py` 661。
- 新增行为面测试文件均 ≤800 行，最大 `test_agent_run_resume.py` 692 行；共享 support/fixtures 文件均为薄辅助。
- 拆分后六组顶层 test/helper/class 定义集合与 HEAD 完全一致：agent_runs 67、book_generation 55、agent_loop_runtime 31、agent_canon 64、book_runs 27、ide_agent_orchestrator 34，missing/added 均为 0。
- `tests/test_source_code_standards.py` 新增六个已完成波次 live 测试文件的硬行数门禁，源码标准测试数从 13 增至 14。
- 未改 route、DTO、schema、OpenAPI、生产代码、Desktop 或 publish/fanqie 路径。

## 已执行

| 命令 | 结果 |
| --- | --- |
| `uv run pytest tests/test_agent_runs.py tests/test_agent_run_save_points.py tests/test_agent_run_resume.py tests/test_agent_run_transport.py tests/test_agent_run_roles.py tests/test_book_generation.py tests/test_book_generation_judge_guards.py tests/test_book_generation_resume_cli.py tests/test_agent_loop_runtime.py tests/test_agent_loop_runtime_tools.py tests/test_agent_loop_runtime_lifecycle.py tests/test_agent_canon.py tests/test_agent_canon_context.py tests/test_agent_canon_hooks.py tests/test_book_runs.py tests/test_book_run_controls.py tests/test_ide_agent_orchestrator.py tests/test_ide_agent_intents.py -q` | 256/256 通过 |
| 拆分定义集合等价脚本 | 六组 HEAD→当前 missing=0、added=0 |
| `uv run ruff check ...S7 touched tests...` | 通过 |
| `uv run pytest tests/test_source_code_standards.py -q` | 14/14 通过 |
| `git diff --check` | 通过 |

## 未执行

- `pnpm openapi`：未改 route、DTO、schema 或 OpenAPI 输出。
- Desktop typecheck/vitest：S7 未改 Desktop 源码。
- `pnpm verify`：按计划留到 S8 专窗总验收。
