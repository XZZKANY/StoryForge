## 2026-10-31 写入回执里的失败原因带类型，前端不再认回执文字前缀

- 背景：作者要求「架构与组件统一」，同一件事只留一种做法。`refactor/host-error-type`（#575）盘点的第 3 条：写入回执的 `detail` 是一句文字，前端（`lib/writeback-receipts.ts`、`useGuardedSuggestionWrite.ts`）和 Rust 自己都靠它以「canon 派生缓存未失效: 」开头来判断。另修 `fix/host-typed-errors`（#578）留下的小倒退：漂移发生在登记写入意图之后（落成 `not_written` 回执）时，前端只剩回执文字，补丁面板显示「可重试」。本分支叠在 #578 上开（开分支时 #578 未合并），PR 目标仍是 master。
- 先查：回执形状不在 `apps/desktop/frontend/src/lib/api/contracts.ts` 的冻结数据形状里（只在宿主 `fs_writeback_receipts.rs` 与前端 `lib/writeback-receipt-types.ts` 之间），照做。

### 改动

1. Rust `fs_writeback_receipts.rs`：
   - 新增 `DetailKind` 枚举（序列化成 `canon-cache-stale` / `drift`），`WritebackReceipt` 与落盘的 `Outcome` 各加可选字段 `detail_kind`（JSON 键 `detailKind`）。`Outcome` 上是 `#[serde(default, skip_serializing_if = "Option::is_none")]`：旧回执没有这个键照样能读；没有类别时不落盘，旧格式字节不变（v1 落盘 golden `test-fixtures/writeback-receipt-v1.json` 一个字节没动、测试照过）。`detail` 文字原样保留。
   - 写回执时填：`apply_with` 的写入闭包改返回 `HostError`（不再在 `write_file_with_receipt` 里 `.map_err(|e| e.message)` 丢掉 kind），宿主报 `drift` → `detail_kind = Drift`，其余失败不写类别；canon 派生缓存清不掉 → `CanonCacheStale`。detail 被别的原因顶掉时（目标读不了、结果回执落不了盘、缓存修复成功）类别跟着清掉，保证类别总是描述当前那句 detail。
   - 只看类别：`inspect` 的「补记已失效」判断与 `repair_canon_invalidation` 改看 `detail_kind == CanonCacheStale`，不再 `starts_with(CANON_INVALIDATION_WARNING)`。
   - 旧回执兼容只一处：`inspect` 读落盘 outcome 时，没有 `detail_kind` 就交给 `legacy_detail_kind` 按旧前缀认一次（「canon 派生缓存未失效: 」→ CanonCacheStale，「磁盘内容已变化，已拒绝覆盖」→ Drift）。这两段写死成旧回执的落盘格式，不跟现行文案常量走。
2. 前端：
   - `lib/writeback-receipt-types.ts`：`WritebackReceipt` 加 `detailKind?: 'canon-cache-stale' | 'drift'`；`decodeWritebackReceipt` 校验它（认不出的值当回执无效，与认不出的 `state` 同样处理），并在这里做前端唯一一处旧回执兼容（`legacyDetailKind`，同样两个前缀）。没有要补的类别时原样返回同一个对象（`smoke-writeback-probe` 测试按引用比对）。
   - `lib/writeback-receipts.ts`：`requireApplied` 返回解码后的回执，`performReceiptedWriteback` 用它往下走；`not_written` 且 `detailKind === 'drift'` 时直接抛 `DiskDriftError`（文案不变），补丁面板的 `actionFailureText` 原本就按 `DiskDriftError` 判断，下游只有一种判断。修缓存的判断改 `receipt.detailKind === 'canon-cache-stale'`。
   - `components/editor/useGuardedSuggestionWrite.ts`：「修复缓存」入口改看 `loopRecord.receipt.detailKind`（这里拿到的是 `performReceiptedWriteback` 解码过的回执）。
   - 浏览器回执替身 `lib/writeback-receipt-fixture.ts` 照宿主：派发时撞上 `DiskDriftError` 记 `detailKind: 'drift'`；结果落不了盘、detail 被顶掉时去掉类别。
3. 引擎 `packages/engine/src/kernel/canonStore.ts`（排查时发现的第三个读回执的地方）：`captureCanonSourceRevision` 逐个校验 `writeback-receipts/*.outcome.json` 的字段集合，原先只允许 `state` / `detail`，多一个键就判「回执字段不合约定」→ 来源版本未知 → canon 派生缓存从此不被信任（每次重扫，不写缓存）。改为允许可选的 `detailKind`，值只认 `canon-cache-stale` / `drift`（缺省可以，`null` 与其他值仍判不合约定）。golden 里的回执用例都没有这个键，golden 零变化。
4. 守护：`tests/tauri-fs.test.ts` 的「前端不靠宿主报错的文字做判断」把「派生缓存未失效」纳入扫描；白名单两条，都是 `lib/writeback-receipt-types.ts` 的 `legacyDetailKind` 那两行，原因写明「加 detailKind 之前写下的回执只有文字，读回执的唯一入口按旧前缀认一次」（漂移那行本来就会被「内容已变化」扫到）。

### 验证

- 改前先红：新测试写好后，把 4 个前端源文件临时换回 `HEAD` 版本（`git show HEAD:<路径> > <路径>`，跑完从 scratch 拷回并逐文件核 sha256 一致），跑 `tests/writeback-receipts.test.ts`、`tests/behavior/auto-writeback.test.tsx`、`tests/tauri-fs.test.ts`：**7 failed / 62 passed**。其中复现 #578 小倒退的用例「登记写入后才撞上的漂移落成回执：补丁面板同样不提示可重试，再点一次也一样」红在状态条实际是 `…请重新读取并处理冲突: D:/连载/末世吞噬/正文/第01章.md，可重试`；守护报 `lib/writeback-receipts.ts:72`、`components/editor/useGuardedSuggestionWrite.ts:286`。引擎新用例同样在 `canonStore.ts` 换回 `HEAD` 时红（`expected null not to be null`，即带 `detailKind` 的回执让来源版本变成未知），拷回后 sha256 一致。
- Rust：`npm --prefix apps/desktop/frontend run build` EXIT=0 后，`CARGO_TARGET_DIR=D:/StoryForge/apps/desktop/src-tauri/target cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`：**222 passed / 1 ignored，EXIT=0**（上一刀 218 passed / 1 ignored；新增 4 条：`drift_after_admission_is_typed_in_the_persisted_receipt`——闭包里先改盘再调真 `write_file_if_unchanged`，回执、落盘 outcome、再 inspect 都是 `drift`；`other_rejections_carry_no_detail_kind`——io 失败回执与落盘 outcome 都没有 `detailKind` 键；`canon_cache_warning_is_typed_and_cleared_by_repair`；`legacy_outcome_without_detail_kind_is_classified_by_its_old_prefix`——手写三份旧格式 outcome（canon 前缀 / 漂移前缀 / 其他），读回分别认成 CanonCacheStale / Drift / 无，canon 那份照常能修缓存）。全部改完、变异全部改回后重新 build（EXIT=0）再跑一遍：222 passed / 1 ignored，EXIT=0。
- `rustfmt --check --edition 2021 fs_writeback_receipts.rs`（连同 `_tests.rs`）：这两个文件改前就不是 rustfmt 干净的。把 `HEAD` 版本拷到 scratch 跑同样的检查做基线：改前 3 + 9 处差异，改后仍是同样 3 + 9 处（只是行号后移），都在没动过的行；新加的测试行按 rustfmt 的排法排好。
- `pnpm lint`：EXIT=0（0 error；2 条 warning 在没动的 `tests/independent-claim-history.test.ts`，原来就有；prettier 全部通过）。改过的三个前端测试文件和引擎测试文件另跑 `prettier --check` 通过。
- `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0（改引擎后又跑了一次，EXIT=0）。`pnpm --filter @storyforge/engine typecheck`：EXIT=0。
- `npm --prefix apps/desktop/frontend run test`（vitest 全套）：**271 个文件、2787 passed，EXIT=0**（上一刀 2779；新增 8 条：`writeback-receipts` 7 条——按 detailKind 认缓存未失效、新写入当场返回漂移回执是 `DiskDriftError`、恢复出落盘的漂移回执同样是、没有类别仍是普通错误、旧回执按前缀认、无可补类别时返回同一对象、认不出的 detailKind 当回执无效；`behavior/auto-writeback` 1 条——上面那条复现用例，替身里的条件写入改成和真封装层一样抛 `DiskDriftError`，并断言落盘的替身回执记了 `['not_written', 'drift']`）。改引擎后又跑一次全套：271 个文件、2787 passed，EXIT=0。
- `pnpm --filter @storyforge/engine test`（含 golden）：111 个文件、**14268 passed / 2 skipped，EXIT=0**（上一刀 14267，新增 1 条引擎回执用例）；golden 零变化（`git status` 里没有 `packages/engine/golden/` 的改动）。
- 行尾：`writeback-receipt-types.ts`、`writeback-receipts.ts`、`writeback-receipt-fixture.ts`、`writeback-receipts.test.ts`、`auto-writeback.test.tsx` 是 CRLF，改后仍全 CRLF；其余改动文件纯 LF，改后仍纯 LF；没有 CRCRLF。`git diff --numstat` 与 `--ignore-all-space --numstat` 完全一致。
- 变异验证（`mutate.py` 用带 `assert count==1` 的定点替换打入；Rust 定点改回，前端从 scratch 拷回，改回后逐文件 sha256 与改前一致）：
  1. Rust 一次打三处：写回执时不记 `drift`、`inspect` 去掉旧前缀兼容、`Outcome.detail_kind` 去掉 `skip_serializing_if` → **4 条红**（218 passed / 4 failed / 1 ignored）：`drift_after_admission…`、`legacy_outcome…`、`other_rejections…`，以及原有的 v1 落盘 golden `described_identity_matches_v1_disk_golden_without_admission`（证明没类别时必须不落这个键）。改回第一处时脚本因反向替换不唯一（`None,` 有 5 处）报错停下，按上下文定点改回，sha256 核对一致。
  2. Rust `repair_canon_invalidation` 改成认 `Drift` → **5 条红**：`canon_cache_warning…`、`legacy_outcome…` 与原有的 `failed_cache_invalidation…`、`cache_repair_replaces_corrupt…`、`concurrent_cache_only_repairs…`。
  3. 前端 `writeback-receipts.ts` 加回 `receipt.detail?.startsWith('canon 派生缓存未失效: ')` → 守护红（报 `lib/writeback-receipts.ts:76`），「按 detailKind 认缓存未失效」红。
  4. `requireApplied` 一律抛普通 `Error` → 3 条红：两条 `DiskDriftError` 单测与 auto-writeback 复现用例。
  5. 替身 `writeFixtureReceipt` 不记 `detailKind` → auto-writeback 复现用例红在落盘替身回执 `['not_written', undefined]`（状态条那句因旧前缀兼容仍会对，所以另加了这条断言钉住替身）。
  6. `legacyDetailKind` 删掉漂移那行 → 「旧回执按前缀认」红。
  7. `useGuardedSuggestionWrite` 的修缓存判断改认 `drift` → `suggestion-writeback-lifecycle` 两条「正文已写入但缓存失效失败时显示原生回执警告且不重放正文」红。
  8. 引擎去掉 `detailKind` 的取值校验 → 新引擎用例红（`detailKind: 'future'` 不再让来源版本未知）。
- Tauri 冒烟里认文字的自检（读代码核对，没跑）：`main.rs:869` 等补丁面板状态条含「磁盘内容已变化」——那条是登记意图前就被拒（`HostError{kind:"drift"}`，不落回执），本刀不经过；即使走回执路径，状态条是「…上次写入被拒绝…磁盘内容已变化…」，仍含这几个字。`smoke_ui.rs:381` 查通知里含「canon 派生缓存未失效」：detail 文字没变；「修复缓存（不重写正文）」入口现在看宿主写的 `detailKind`，宿主在同一处填它；冒烟比对恢复前后原始回执文件字节相同，修复只写 `canon-invalidation` 补记、不碰 outcome，仍成立。

### 未覆盖

- **没跑 Tauri 冒烟**（开发档 / 发行版都要从头编几个 GB，D 盘只剩约 4 GB），也没跑真宿主探针；回执经 IPC 到 WebView 的一段只有 Rust 单测钉序列化与前端单测钉解码，没在真窗口里点穿（登记意图后改盘再接受、缓存被锁时接受再修复）。上面对冒烟自检的判断是读代码推的。
- 本地没跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），本机有别的会话在跑 headless Chrome、会互相拖超时，以 CI（`Windows Verify` 的 `pnpm verify`）为准；回执替身多记的 `detailKind` 在 CI 上第一次实跑。CI 不含 Rust 测试。
- 降级不兼容：`Outcome` 原本就是 `deny_unknown_fields`。新版写下的带类别回执（只有登记后漂移的 `not_written` 与缓存未失效的 `applied` 两种）如果被没有本改动的旧版应用读到，会报「写入结果回执损坏，结果未知，已禁止重复写入」，旧版引擎也会因此不信任 canon 派生缓存。只在作者装回旧版时出现；没有类别的回执字节不变，不受影响。
- 前端的旧回执兼容对真宿主实际上不会触发（宿主读回时已经补上类别），只在回执替身或手工构造的旧形状回执上起作用；按任务要求两侧各留一处。
