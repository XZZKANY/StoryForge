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
