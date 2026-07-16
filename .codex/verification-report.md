# 验证报告 · 发行车队写侧脱 webview（多号直连发章）

时间：2026-07-15
分支：`feat/publish-direct-write-20260715`

## 问题

写侧（发章）此前走隐藏 webview 内 fetch（`publish_fanqie_chapter`，`credentials:'include'`），
用的是 webview 共享会话里**当前登着的那个号**——同一时刻只能发一个号的书，多号必须反复切登录，
且发布前不校验 webview 登的是不是所选号（串号误发只会被平台拒绝，报错不提示根因）。
用户诉求：能同时上多个号。

**顺带发现的潜伏 bug**：`tauri.conf.json` 仅有 `main-capability`（`windows:["main"]`）授予 `core:event:allow-emit`，
远程发布 webview（`publish-login`/`publish-worker`）无任何 capability 授权，其页面内
`window.__TAURI__.event.emit(...)` 回传（Cookie 自动捕获、章节发布回执）在真机构建下会被 ACL 拒绝——
与「真机 publish 归 E2E-1 未验」一致，此前很可能从未真机跑通。

## 变更

### 会话捕获（Rust `publish_api.rs` + capability）
- 登录窗初始化脚本（`initialization_script`，每页/导航都注入）在轮询 Cookie 基础上，
  **钩住 `fetch`/`XHR.setRequestHeader` 捕获页面自身携带的 `x-secsdk-csrf-token`**（写侧直连令牌）。
- Cookie 到手后自动导航到作者工作台 `book-manage`，让 muye 应用发认证请求以触发 csrf 捕获（60s 兜底关窗）；
  Cookie/csrf 用 `AtomicBool` 去重协调（初始化脚本每页重跑，只转发首次），两者齐了即关窗。
- csrf 经新事件 `publish:csrf-captured` 回传。
- **新增 `publish-webview-capability`**：授予 `publish-login`/`publish-worker` 两窗 `core:event:allow-emit`，
  `remote.urls` 限 `https://fanqienovel.com` / `https://*.fanqienovel.com`——修上述潜伏 ACL 缺口。

### 写侧直连流程（纯函数 `packs/fanqie/publish-flow.ts`，新）
- `buildNewArticleBody`/`buildCoverArticleBody`/`buildPublishArticleBody`：form body 构造，字段与 webview 版本逐字段对齐。
- `parseNewArticleItemId`/`parseDraftListItemId`/`parseStepResult`：响应解析，仅 HTTP200+code:0 判成功。
- `publishChapterViaApi`（`storage/publish-api.ts`）：Rust 代理带「账号 Cookie + 该号 csrf 令牌 + Origin/Referer/UA」
  走 new_article → cover_article → publish_article，**会话按账号显式传入，不依赖 webview jar**。
- `callPlatformApi` 增 `rawBody` 直传（与 bodyTemplate 互斥）；`newArticle`/`coverArticle`/`getDraftList` 端点补全
  （原 `editArticle` 是 GET 加载草稿，非写端点，改名 `coverArticle` 指实测真路径）。

### 账号模型与路径选择
- `PublishAccount` 增 `csrfToken`/`csrfCapturedAt`；`session.ts` 增 `markCsrfCaptured`/`canPublishDirect`/`isCsrfStale`。
- 单章与批量发布：`canPublishDirect(acc)`（有 Cookie+令牌）即走直连（按号隔离，多号可各自并存发章），
  否则回落隐藏 webview（保留旧路径，零功能回退）。
- 账号行显示「直连就绪 / 令牌偏旧 / webview 发章」状态；hook 监听 `onCsrfCaptured` 存令牌。

## 验证

- `npm --prefix apps/desktop/frontend run test`：45 files / 246 tests 全绿（新增 `publish-direct-write.test.ts` 12 条：
  form 编码 round-trip 含中文/HTML、item_id 解析、step 结果判定、canPublishDirect/isCsrfStale/markCsrfCaptured）。
- `npm --prefix apps/desktop/frontend run typecheck`：干净。
- `pnpm.cmd lint`：0 errors（Editor.tsx exhaustive-deps 1 warning 为存量）；prettier 全过。
- `cargo check`（tauri crate）：exit 0；`rustfmt` 已对 `publish_api.rs` 收口（`publish_store.rs` 存量 fmt 漂移未碰）。
- 零后端 / OpenAPI 契约变更。

## 未联通能力

- **真机端到端未验，归 E2E-1**：csrf 令牌捕获、直连三步发章、多号并存发章、新 capability 下远程 emit 是否放行——均需 Tauri 真机构建 + 真番茄会话验证。
- csrf 令牌时效未知：失效表现为写步骤 code≠0，UI 提示「重新 WebView 登录」；`isCsrfStale` 3 天阈值是保守猜测，待真机校准。
- 直连请求头（Origin/Referer/UA）在 Rust 代理上下文的接受度未实测（webview 内 fetch 天然带，直连需手工对齐）。
- 无代登/打码/反检测（L4/L3-c 不交付）；多号环境隔离属线下运营纪律，产品侧不实现。

---

# 验证报告 · 伏笔承诺记账与 prose 规则扩面

时间：2026-07-16
分支：`feat/promise-check-prose-rules-20260716`

## 批次

- `f1670869 feat(agent): B1 伏笔承诺记账`
  - 新增只读 `project.promise_check`：读取 `canon.json.invariants.promises`，返回四类 blocking
    声明矛盾与三类 advisory 跨章提醒。
  - ToolSpec、runtime handler、root/context_explorer 角色、trace、loop summary-only 与 schema golden
    同批接线。
  - `test_agent_promise_scan.py` 覆盖正反边界、稳定 sha1 id、坏类型诚实空态、正文阅读序、
    canon byte 不变、缺 canon 不 scaffold/不写 derived。
- `07dbed3b feat(agent): B2 prose 规则扩面`
  - 新增 `mechanical_transition`、`formulaic_question`、`binary_contrast`、`hollow_summary`
    四个段落级维度；规则表与正则均在本功能内自拟。
  - `StaticProseIssue` wire shape 不变；focused 规则模块 215 行，`prose_scan.py` 397 行，
    新测试 290 行，均低于 source-standards 500/800 硬上限。
  - ToolSpec 描述与 golden 同批更新。
- 可选剧情决策约定未做：B1/B2 功能批次验收时 API 全量曾被未触及的 BookRun 并发测试
  非稳定失败打断；按“其余全绿才做”与最小范围原则，不扩大到 prompt/docs 功能面。

## 定向验证

- B1：`uv run pytest -q tests/test_agent_promise_scan.py tests/test_agent_loop_runtime_tools.py
  tests/test_loop_tool_schemas.py tests/test_runtime_tools.py tests/test_source_code_standards.py`
  -> `66 passed`。
- B2：`uv run pytest -q tests/test_agent_prose_scan.py
  tests/test_agent_loop_runtime_tools.py::test_chat_loop_prose_check_feeds_static_smells
  tests/test_loop_tool_schemas.py tests/test_runtime_tools.py tests/test_source_code_standards.py`
  -> `53 passed`。
- `uv run ruff check .`（`apps/api`）-> `All checks passed!`。
- `git diff --check` / staged diff check（两批）-> 通过。
- 最终 loop schema golden 与 `build_loop_tool_schemas()` byte-for-byte 相等：20,909 bytes，
  550 CRLF，0 bare LF，无末尾换行。

## 完整门禁

- `cd apps/api && uv run pytest -q` -> `1062 passed, 3 skipped, 6 warnings`，exit 0。
- `cd apps/api && uv run ruff check .` -> `All checks passed!`。
- `pnpm.cmd verify` -> exit 0：
  - lint/Prettier：0 errors；保留存量 `Editor.tsx` exhaustive-deps 1 warning；
  - Desktop typecheck 与 shared typecheck 通过；Desktop Vitest `45 files / 246 tests`；
  - API `1062 passed, 3 skipped`；Workflow `323 passed`；两侧 Ruff 通过；
  - daily sidecar ready / assistant / Agent SSE / control / managed sqlite smoke 全绿；
  - OpenAPI、Agent frame、shared types 重生后零漂移。
- `node scripts/check-openapi-drift.mjs`（独立复核）-> `OpenAPI 契约无漂移`。
- `git diff --check master...HEAD` -> 通过。

## 非稳定门禁记录

- B1 后前两次 API 全量各为 `1050 passed, 3 skipped, 1 failed`；失败分别落在
  `test_book_generation_parallel_runner_defaults_to_precommit_revision_dependency` 与
  `test_book_generation_parallel_runner_prefetches_then_revises_before_commit`，均为未触及
  BookRun 并发测试在 in-memory SQLite `session.refresh(Scene)` 的同型竞态。
- 第一条失败测试随后 isolated 连跑 3 次均绿；最终 `uv run pytest -q` 与 `pnpm.cmd verify`
  内的 API 全量均为 `1062 passed, 3 skipped`。未修改 BookRun 或放宽门禁。

## 红线审计

- 分支从同步的 `master` 创建；B1/B2 各自独立提交，暂存均使用显式路径；每次 ToolSpec
  改动都同批包含 golden。
- promise 扫描只调用 `read_canon` 与公共 `chapter_ordinals`，不调用 scaffold/write/projection；
  单测同时验证作者 canon bytes 不变、缺 canon 时项目零新增文件。
- prose 新词表/句式均在本功能内自拟，未引入外部词库、工具或语料依赖。
- 两个功能批次仅含 12 个 agent_runs/测试/golden 文件；最终分支另含本验证报告。本地
  Trellis code-spec 已同步，但按仓库既有 `.trellis/` ignore 策略不进入 PR。未改
  `publish_api.rs`、`tauri.conf.json`、`features/publish/`、OpenAPI/shared contract 或
  source-standards baseline。

## 未验证项

- 未用真实长篇语料校准四个 prose 阈值的误报率/召回率；当前证据仅证明确定性规则与边界。
- 未宣称 promise_check 能自动发现未声明伏笔，或替代人工通读/语义一致性判断。
- 未做真实 LLM 或真机 GUI 调用；两个工具均为无 LLM 的后端确定性能力。
- 可选剧情决策约定未实现。
