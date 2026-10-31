## 2026-10-31 前端认宿主报错改按类型：「作品文件还没有」与漂移拒写不再匹配报错文字

- 背景：作者要求「架构与组件统一」，同一件事只留一种做法。上一刀（`refactor/host-error-type`，PR #575）把宿主的结构化报错收成一个 `HostError { kind, message }`，并盘点出前端有两处靠匹配宿主报错文字做判断。本刀把这两处改成按错误类型判断（第 3 条「canon 派生缓存未失效」回执前缀牵涉落盘回执兼容，本刀不做）。本分支叠在上一刀上开（PR #575 开本刀时尚未合并），PR 目标仍是 master。
- 真 bug：`useBookProfile` 用正则 `/not found|no such file|enoent|不存在|找不到|…/` 认「档案还没建」。作品目录本身没了时，宿主 `canonical_project_root` 报「无法解析作品目录 <根>: <系统原话>」，中文 Windows 的系统原话是「系统找不到指定的路径」，被「找不到」命中 → 当成档案还没建、不报错，作者点保存还会按「不存在」基线去写（英文 Windows 同一情况却不命中，两边行为不一致）。

### 改动

1. Rust（`message` 文案一个字没改）：
   - `fs::read_project_file` 改返回 `HostError`：作品内还没有这个文件 → `missing`；越出作品（含经 symlink 越出、读作品根本身）→ `outside-project`（复用现有取值，没新造同义词）；其余（作品目录解析不了、路径是目录、读失败）→ `io`。
   - `fs::check_disk_baseline` 的漂移拒写 → `drift`；`write_file_if_unchanged`（fs 与 `managed_writeback` 命令）、`commit_staged_write_if_unchanged`、`fs_writeback_receipts::write_file_with_receipt` / `apply_with` 跟着改返回 `HostError`，其余失败经 `From<String>` 落 `io`。
   - `managed_writeback::run_mutation` 改成对错误类型泛型（`E: From<String>`），其余 6 个命令仍是 `String`，类型推断不变；它的 3 处单测闭包补上 `Ok::<(), String>` / `Err::<(), String>` 标注。
   - 带回执写入在「已登记意图之后」才撞上的失败照旧写进回执 `detail`，只记原文（`.map_err(|error| error.message)`），回执格式不变。
   - `fs_engine_reader.rs` 里的 `fn outside`（kind `outside-project`）挪到父模块 `fs.rs`，两处读口共用一个。
   - `read_project_file_base64` 没有「不存在」分支（文件不在走的是「无法解析作品文件」），照任务说明不动，仍返回 `String`。
   - `host_error.rs` 模块文档补上 `fs` 这一组 kind；序列化测试补 `missing`、`drift` 两条逐字 JSON。
2. 前端封装层翻译：新文件 `src/lib/host-file-errors.ts` 定义 `HostFileError`（`io` 与认不出的字符串报错）及子类 `ProjectFileMissingError`、`ProjectPathOutsideError`、`DiskDriftError`，都 `extends Error`，`message` 是宿主原文；覆写 `toString()` 返回原文——这些命令以前直接以字符串 reject，`String(error)` 拿到的就是原文（`useSuggestionIntake` / `useSuggestionState` 有 3 处直接 `String(error)` 拼进提示），翻成类后保持不变。`lib/tauri-fs.ts` 的 `readProjectFile`、`writeFileIfUnchanged`、`writeFileWithReceipt` 在 catch 里经 `hostFileFailure` 翻译，做法照 `lib/engine/reader.ts`：已是 `Error` 原样上抛；`{ kind, message }` 按 kind 翻；形状认不出 → `TypeError('Invalid Native file error')` 带 `cause`；字符串 → `HostFileError`。浏览器替身（`window.__STORYFORGE_MOCK_FS__`）的报错走同一个翻译；替身自己的漂移拒写改抛 `DiskDriftError`。错误类单独成文件，是因为 19 个测试整体 `vi.mock` 掉 `lib/tauri-fs`，类放在里面会被一起替换掉。
3. 判断改按类型：
   - `useBookProfile.readTextOrNull`：删正则，改 `error instanceof ProjectFileMissingError`。
   - `PatchReviewPanel.actionFailureText`：删 `includes('内容已变化')`，改看原错误 `cause instanceof DiskDriftError`。原错误的来路：`useSuggestionState.failAction(token, message, cause)` 多带一个原错误（5 处调用都传了接住的那个错误），`useSuggestionWriteback` 多返回 `actionErrorCause`，`Editor` 把它作为新 prop `errorCause` 交给面板；面板自己接住的失败（`runAction` 的 `fail`）也一并记下原错误。`actionError` 仍是字符串，现有约 20 处断言不用改。
   - 前端自己的整文件漂移拒写（`useGuardedSuggestionWrite.ts` 的「当前文件内容已变化，旧修订不能直接写进文件…」）**没改**：核对调用路径后，这道闸只在不带 `operationKind` 时生效，而整份接受 / 逐处接受 / 撤销都带 `operationKind`，只有 Ctrl+K 行间修订（`useInlineDiff`）不带，它的失败在行间面板里自己显示，到不了补丁面板。照任务说明「走这里才改」，保持 `new Error`。
   - 复核 `src/` 里别的文字匹配：上一刀列出的不归宿主的几处（定位类拒写、`API 返回 \d+`、步骤说明里的「重试」、写章结果两段文字比较）照旧；没有新的对宿主报错文字的匹配。
4. 测试替身改成回宿主的形状：
   - `vi.mock` 掉 `TauriFileSystem` 的测试改抛翻译后的类：`use-book-profile-errors`（missing / outside / io / 漂移）、`idea-notes-undo`（missing / 漂移）。
   - `__STORYFORGE_MOCK_FS__` 替身改抛 `{ kind: 'missing', message }`：`tests/fixtures/uiux-app.tsx`、浏览器回归 `scripts/verify-smoke.mjs`、`scripts/verify-agent-conversation.mjs`（原来抛 `ENOENT: …`，靠旧正则才被当成「还没有」）。`verify-sidebar-scroll.mjs` 的替身抛的是 `Missing fixture file`，旧正则本来就不命中（那边一直显示档案读取失败），为不改变它的布局量测，没动。
5. 守护：`tests/tauri-fs.test.ts` 的「前端不靠宿主报错的文字做判断」扫 `src/` 每一行，`不存在|找不到|内容已变化|not found|no such file|enoent` 出现在 `.includes( / .startsWith( / .endsWith( / .indexOf( / .match( / .search(` 的字符串参数里、正则字面量后接 `.test( / .exec(`、`.match( / .search( / .replace( / .split(` 的正则参数里、或 `RegExp(` 字符串里即报。白名单（键是「文件:去掉缩进的那一行」，值写原因）目前为空。

### 验证

- 改前先红：在旧代码上给 `use-book-profile-errors` 加用例「作品目录本身读不了（系统原话带『找不到』）：不当成档案还没建，如实报出且不写盘」（当时替身抛 `new Error(detail)`，因为 `HostFileError` 还不存在），跑 `npx vitest run tests/use-book-profile-errors.test.tsx`：**1 failed / 11 passed**，红在 `data-profile-error` 实际是 `''`（被当成「还没建」）。改完后同一用例改抛 `new HostFileError(detail)`（就是封装层对 `io` 的翻译结果），转绿。
- Rust：`npm --prefix apps/desktop/frontend run build` EXIT=0 后，`CARGO_TARGET_DIR=D:/StoryForge/apps/desktop/src-tauri/target cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`：**218 passed / 1 ignored，EXIT=0**（上一刀 216 passed / 1 ignored；新增 `read_project_file_reports_an_unresolvable_project_root_as_io_not_missing`、`read_project_file_reports_a_directory_as_io` 两条；既有的读文件 / 条件写入 / 带回执写入用例改成断言 kind，`missing` 与 `drift` 用 `HostError` 整体相等比对原文案）。前端全部改完、变异全部改回后又重新 build（EXIT=0）再跑一遍：218 passed / 1 ignored，EXIT=0。
- `rustfmt --check --edition 2021`：`host_error.rs`、`fs_engine_reader.rs`、`fs_conditional_tests.rs`、`managed_writeback.rs` EXIT=0（这四个改前就是 rustfmt 干净的）。`fs.rs`、`fs_writeback_receipts.rs`（连同 `_tests.rs`）改前就不是 rustfmt 干净的，没整文件格式化，只把自己改的几行按 rustfmt 的排法排好，剩下的差异都在没动过的行。
- `pnpm lint`：EXIT=0（0 error；2 条 warning 在没动的 `tests/independent-claim-history.test.ts`，原来就有；prettier 全部通过）。
- `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
- `npm --prefix apps/desktop/frontend run test`（vitest 全套）：**270 个文件、2769 passed，EXIT=0**（上一刀 2760；新增 9 条：`tauri-fs` 5 条——三种 kind 翻译与 `String(error)` 保持原文、认不出的形状与字符串、两个写命令的 `drift`、浏览器替身的 missing、文字匹配守护；`patch-review-panel` 2 条——同样文字按 `errorCause` 类型分出可重试与否、面板自己接住的 `DiskDriftError`；`behavior/auto-writeback` 1 条——宿主漂移拒写经带回执写入一路带着类型到补丁面板、换成写盘失败才提示可重试；`use-book-profile-errors` 1 条——上面那条复现用例）。
- `pnpm --filter @storyforge/engine test`（含 golden）：111 个文件、14266 passed / 2 skipped，EXIT=0；golden 零变化（`git status` 里没有 `packages/` 的改动）。
- 行尾：`fs.rs`、`tauri-fs.ts`、`useSuggestionWriteback.ts`、`use-book-profile-errors.test.tsx`、`auto-writeback.test.tsx` 是 CRLF，改后仍全 CRLF；其余改动文件与新文件 `host-file-errors.ts` 纯 LF。`git diff --numstat` 与 `--ignore-all-space --numstat` 只在 `tauri-fs.ts`（3 行，包进 try 的重新缩进）、`fs.rs`（2 行）、`managed_writeback.rs`（2 行，rustfmt 重排）差几行，都是缩进变化。
- 变异验证（`mutate.py` 用带 `assert count==1` 的定点替换打入、再定点改回，改回后逐文件 sha256 与改前一致）：
  1. `PatchReviewPanel` 加回 `|| error.includes('内容已变化')` → 守护红，报 `components/PatchReviewPanel.tsx:59`。
  2. `useBookProfile` 换回旧正则 → 2 条红：守护（报 `components/app/useBookProfile.ts:80`）与复现用例（作品目录读不了又被当成「还没建」）。
  3. `tauri-fs.ts` 把 `missing`、`drift` 都翻成 `HostFileError` → `tauri-fs` 3 条红（kind 翻译、写命令 drift、浏览器替身 missing）。
  4. `useWholeSuggestionAccept` 的 `failAction` 不传原错误 → `auto-writeback` 新用例红（漂移拒写又提示「可重试」）。
  5. Rust 一次打三处：`read_project_file` 的 `missing` 改 `io`、作品根解析失败改报 `missing`、`check_disk_baseline` 的 `drift` 改 `io` → **7 条红**（211 passed / 7 failed / 1 ignored）：`fs::tests` 的 missing 与「作品根读不了是 io」两条、`fs::conditional_tests` 四条、`fs_writeback_receipts::tests::pre_dispatch_drift_is_definitely_not_written_and_has_no_claim`。
- Tauri 冒烟里认文字的自检：`main.rs:869` 等的是补丁面板状态条含「磁盘内容已变化」。宿主文案没变；漂移在 `write_file_with_receipt` 登记意图前就被拒，`performReceiptedWriteback` 查不到回执会原样抛出 `DiskDriftError`，整份接受拼成「接受失败: 磁盘内容已变化…」交给面板，状态条是「操作失败：接受失败: 磁盘内容已变化，已拒绝覆盖；…」（不再带「可重试」），仍含这几个字。`smoke_ui.rs` 查的「canon 派生缓存未失效」不在本刀范围。

### 未覆盖

- **没跑 Tauri 冒烟**（开发档 / 发行版都要从头编几个 GB，D 盘只剩约 5 GB），也没跑真宿主探针；报错经 IPC 到 WebView 的那一段只有 Rust 单测钉序列化与前端单测钉翻译，没在真窗口里点穿（删掉作品目录后打开作品档案、外部改稿后点接受）。上面对冒烟自检的判断是读代码推的。
- 本地没跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），本机有别的会话在跑 headless Chrome、会互相拖超时，以 CI（`Windows Verify` 的 `pnpm verify`）为准；其中两个改了替身的报错形状（见改动 4），CI 是它们的第一次实跑。CI 不含 Rust 测试。
- 「登记意图之后」才撞上的漂移（预检与改名之间被改；以及因此落成 `not_written` 回执后作者再点接受）在前端只剩回执 `detail` 里的文字，`requireApplied` 抛的是普通 `Error`，补丁面板会提示「可重试」（以前靠文字命中不提示）。要按类型认得把 kind 写进回执，牵涉落盘回执兼容，归第 3 条那一刀。
- 前端其余几处自己写的「内容已变化」拒写（撤销新建、版本恢复、Ctrl+K 行间修订的整文件漂移闸）不经补丁面板，没改成 `DiskDriftError`。
- 本机没有建 symlink 的权限，Rust 里既有的 symlink 用例建链失败即提前返回，在本机是空过（经 symlink 越出作品报 `outside-project` 那两条因此只在有权限的机器上真跑）。

## 2026-10-31 合并 origin/master（解 #572 拆分补丁面板后的冲突）

- 起因：#578 与 master 冲突，GitHub 没跑 CI。#572 把 `PatchReviewPanel.tsx` 拆了：失败提示的纯函数 `actionFailureText` 挪到 `components/editor/patch-review-text.ts`，面板的本地报错状态与 `runAction` 挪到 `components/editor/usePatchReviewActions.ts`。#575 已合并，#577 只给 `lib/tauri-fs.ts` 末尾加了 `pickDirectory` / `pickFile`（自动合并，与本刀改的三个命令不相干）。
- 做法：`git fetch origin && git merge origin/master`（没有 rebase、没有 force push）。只有 `PatchReviewPanel.tsx` 冲突，两段冲突都取 master 的新结构，再把本刀的改动落到新位置：
  - `patch-review-text.ts`：`actionFailureText(error, cause)` 删掉 `includes('内容已变化')`，改看 `cause instanceof DiskDriftError`。
  - `usePatchReviewActions.ts`：多收 `errorCause`；本地报错记下原错误（`cause`）；合出 `actionFailure`（外面传进来的报错 + `errorCause`，或面板自己接住的失败）一并返回，`actionError` 仍是字符串。
  - `PatchReviewPanel.tsx`：把 `errorCause` 交给 `usePatchReviewActions`，状态条用 `actionFailure` 出字。
  - `failAction` / `actionErrorCause`（`useSuggestionState.ts`、`useSuggestionWriteback.ts`、`Editor.tsx` 及 5 处调用）master 没动，自动合并，原样保留。
- Rust：master 自 `d7e54da9` 起没有改 `apps/desktop/src-tauri`，合并后 Rust 与合并前提交 `2ccdbe84` 逐字节一致，没有重跑 cargo（上面 218 passed / 1 ignored 仍有效）。
- 重跑本地门禁：
  - `pnpm lint`：EXIT=0（0 error；2 条 warning 仍是没动的 `independent-claim-history.test.ts`；prettier 全部通过）。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `npm --prefix apps/desktop/frontend run test`：第一次与 lint 同时跑，`tests/focus-styles.test.ts` 一条超时（5000ms，它要编译整份样式表，与本刀无关）；单跑该文件 5 passed；不并发重跑全套：**271 个文件、2779 passed，EXIT=0**。
  - `pnpm --filter @storyforge/engine test`（含 golden）：111 个文件、14267 passed / 2 skipped，EXIT=0；golden 零变化。
- 合并后在新位置补做变异（打入、定点改回，sha256 与改前一致）：
  1. `patch-review-text.ts` 加回 `|| error.includes('内容已变化')` → 守护「前端不靠宿主报错的文字做判断」红，报 `components/editor/patch-review-text.ts:24`。
  2. `usePatchReviewActions.ts` 不再把 `errorCause` 带进 `actionFailure` → 2 条红：`patch-review-panel` 的「漂移拒写按错误类型认」与 `behavior/auto-writeback` 的「宿主漂移拒写一路带着类型到补丁面板」。守护与集成测试在新结构下仍然覆盖这条链路。
- 未覆盖：同上一节；本地仍没跑三个浏览器回归，以 CI 为准。
