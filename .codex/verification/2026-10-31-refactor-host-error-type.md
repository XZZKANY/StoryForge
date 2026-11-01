## 2026-10-31 Rust 宿主的结构化报错只留一个 `HostError`；字符串报错只查不改

- 背景：作者要求「架构与组件统一」，同一件事只留一种做法。宿主给引擎读作品口、模型出网、「获取模型」三处各写了一份同形的 `{ kind, message }` 报错结构体（`fs_engine_reader.rs` 的 `EngineReadError`、`engine_llm.rs` 的 `EngineLlmError`、`llm_draft_probe.rs` 的 `DraftProbeError`），前端按 `kind` 把它们映射成引擎的错误类。本刀把三份合成一个，其余返回 `String` 的命令只盘点、不改。
- 改动（只动 Rust，前端、引擎、golden 零改动）：
  1. 新文件 `apps/desktop/src-tauri/src/host_error.rs`：唯一的 `HostError { kind: &'static str, message: String }`（`Debug, Serialize, PartialEq, Eq`，字段 `pub(crate)`），构造器 `HostError::new(kind, message)`；`From<String>` / `From<&str>` 一律记成 `io`（原 `EngineReadError` 的约定，读作品口靠 `?` 直接转字符串报错）。三处原有的 kind 说明合并到模块文档里。`main.rs` 加一行 `mod host_error;`。
  2. `fs_engine_reader.rs`：删 `EngineReadError` 及其三个 impl，留一个模块内 `fn outside(message) -> HostError`（kind `outside-project`），5 个签名改 `HostError`。
  3. `engine_llm.rs`：删 `EngineLlmError`，`refused()` 改返回 `HostError`，其余 `EngineLlmError::new` 换成 `HostError::new`；`engine_llm_tests.rs` 跟着换类型名（4 行）。
  4. `llm_draft_probe.rs`：删 `DraftProbeError` 与只是转调构造器的 `failure()`，18 处 `failure(` 换成 `HostError::new(`（rustfmt 因此重排了几行）。
  5. 守护与钉形状（`host_error.rs` 的测试）：
     - `every_kind_serializes_to_the_shape_the_frontend_reads`：现有 10 种 kind（`outside-project` / `io` / `config` / `refused` / `connect` / `timeout` / `read` / `unauthorized` / `misconfigured` / `unreachable`）各序列化一次，与逐字写死的 JSON 字符串比对（字段名、字段顺序、中文不转义）。
     - `unclassified_string_failures_are_io`：`From<String>` / `From<&str>` 落 `io`。
     - `host_error_is_the_only_kind_message_error_struct`：扫 `src/` 下所有 `.rs`（含 `llm_config_store/`、`shadow_git/` 子目录），找出带 `kind` 字段、且同时带 `message` 字段或名字以 `Error` 结尾的具名结构体，断言只有 `host_error.rs::HostError` 一个。
- 选型取舍：
  - kind 保持 `&'static str`，没做成枚举。三份原来都是字符串字面量，保持字符串序列化结果天然不变、改动最小；做成枚举要改约 30 处调用点与测试断言。kind 的全部取值与含义写在 `host_error.rs` 模块文档，测试逐个钉住。
  - `From<String>` → `io` 放在共用类型上是全局的：`engine_llm` / `llm_draft_probe` 以后若对字符串报错直接 `?` 也会落 `io`。两处现在都显式写 kind，没有这种用法。
  - 没并进来的同类：`engine_llm.rs` 的 `BodyEvent::Error { kind, detail }` 是响应体流事件（序列化成 `{ "event": "error", kind, detail }`，前端 `NativeBody` 读 `detail`），形状不同、不是报错返回值，本刀不动；守护只扫具名结构体，不扫枚举变体。`fs.rs` 的 `DiskBaseline`（`tag = "kind"`）是入参，不相干。

### 改前改后逐条比对（序列化结果不变）

- 改前先在三处测试模块里各临时加一条打印测试（`tmp_snapshot_print`，不入库），用各模块原来的构造路径产出 13 条报错并打印 JSON：读作品口走真命令（`resolve_engine_project_path` 越根、相对根，`read_engine_project_directory` 超预算）加 `outside()` / `From<String>`；模型出网走真 `prepare` 的拒绝加 `timeout` / `connect` / `read` / `config` 四种构造；获取模型走真 `prepare`（`ftp://`）、真 `decode`（`{}`）加 `unauthorized`。改后同样的测试（只换类型名 / 构造器名）再打一次：两份排序后 `diff` 无差异（13 条全同，覆盖 10 种 kind）。打印测试随后按标记段删掉。
- 字符串字面量逐文件比对（`origin/master` 对工作区，5 个改动文件）：除 `fs_engine_reader.rs` 少了一个 `"io"`（挪进 `host_error.rs` 的 `From` impl）外，增删均为空——所有 `message` 文案、kind 取值一个字节没动。

### 字符串报错盘点（只查不改）

命令只在 `main.rs` 的 `generate_handler!` 一处注册，复核为 **55 个**（审查说约 58）。其中 7 个返回 `HostError`（读作品口 4、模型出网 2、获取模型 1），6 个不返回错误（`close_guard` 3 个、`engine_llm_close`、`acknowledge_host_closing`、`project_folder_exists` 回 `bool`），**42 个返回 `Result<_, String>`**（审查说约 32）：

| 分组 | 命令 | 数量 |
|---|---|---|
| 读作品文件 / 目录（界面用） | `fs::read_project_file`、`read_project_file_base64`、`list_project_dir`、`project_path_exists`、`reveal_in_file_manager` | 5 |
| 引擎写口 | `fs::engine_writer::write_engine_project_file` | 1 |
| 写回（正文落盘、文件树增删改） | `managed_writeback::write_file`、`write_file_if_unchanged`、`write_file_with_receipt`、`create_writeback_audit`、`copy_into_project`、`delete_path`、`create_dir`、`rename_path` | 8 |
| 写回回执 | `fs_writeback_receipts::describe_writeback_operation`、`inspect_writeback_receipt`、`repair_writeback_canon_cache` | 3 |
| 退出握手 | `host_close_state::begin_writeback_delivery`、`end_writeback_delivery`、`host_close::read_host_close_diagnostic` | 3 |
| 引擎库 | `engine_db::engine_db_select`、`engine_db_transaction`、`engine_python_db_snapshot`、`engine_db_backup` | 4 |
| 模型配置 | `llm_config::list_llm_profiles`、`save_llm_profile`、`delete_llm_profile`、`activate_llm_profile`、`set_llm_polish_profile` | 5 |
| 影子 git | `shadow_git::create_shadow_snapshot`、`retain_shadow_snapshot`、`release_shadow_snapshot`、`read_shadow_snapshot_file`、`filter_shadow_snapshot_hashes` | 5 |
| 插件库 | `plugin_library::plugin_library_dir`、`plugin_stage_import`、`plugin_commit_import`、`plugin_discard_import`、`plugin_remove` | 5 |
| 自动更新 | `app_update::app_update_check`、`app_update_download`、`app_update_restart_install` | 3 |

这些字符串在前端怎么用：`invoke` 以字符串 reject，`lib/tauri-fs.ts`、`lib/engine/writer.ts`、`lib/engine/db.ts`、`lib/desktop-llm-config.ts`（不带 kind 时）、`lib/shadow-git.ts`、`lib/plugin-library.ts`、`lib/app-update.ts`、`lib/native-delivery.ts` 等包装层都原样上抛或包成 `new Error(String(error))`（`lib/host-close.ts` 多数直接吞掉），绝大多数只进弹窗 / toast / 错误面板给作者看。

**前端靠匹配报错文字做判断的地方**（grep `apps/desktop/frontend/src` 非测试文件里对报错 / message / detail 的正则、`includes`、`startsWith`；行号以 `origin/master` `e8e0da1d` 为准）：

| 前端判断 | 依赖的宿主命令 | 依赖的文案（Rust 位置） | 判断用来干什么 |
|---|---|---|---|
| `components/app/useBookProfile.ts:80` `readTextOrNull`：`/not found\|no such file\|enoent\|不存在\|找不到\|找不到指定\|notfound/` 匹配小写化后的报错 | `read_project_file` | 「作品文件不存在: <路径>」（`fs.rs:68`）；另外作品根本身解析不了时 `canonical_project_root` 报「无法解析作品目录 <根>: <系统原话>」（`fs.rs:81`），中文 Windows 的系统原话「系统找不到指定的路径」也会被「找不到」命中，英文 Windows 不会 | 作品档案 `.storyforge/book.json`、灵感文件还没建 → 当 null 不报错；不命中照常抛 |
| `components/PatchReviewPanel.tsx:56` `actionFailureText`：`error.includes('内容已变化')` | `write_file_with_receipt`、`write_file_if_unchanged`（都经 `fs.rs::check_disk_baseline`） | 「磁盘内容已变化，已拒绝覆盖；请重新读取并处理冲突: <路径>」（`fs.rs:214`）。同一判断也命中前端自己的「当前文件内容已变化，旧修订不能直接写进文件…」（`useGuardedSuggestionWrite.ts:143`）和浏览器替身文案（`lib/tauri-fs.ts:160`） | 漂移拒写不提示「可重试」（再点结果一样） |
| `lib/writeback-receipts.ts:72`、`components/editor/useGuardedSuggestionWrite.ts:286`：`receipt.detail?.startsWith('canon 派生缓存未失效: ')` | `write_file_with_receipt`、`inspect_writeback_receipt` 返回的回执 `detail`（成功返回值里的提示，不是报错） | `CANON_INVALIDATION_WARNING`（`fs_writeback_receipts.rs:307`，在 368 / 427 拼进 `detail`） | 决定要不要调 `repair_writeback_canon_cache` 修缓存、给作者「修复缓存」入口 |

同样依赖这些文字的 Rust 侧：Tauri 冒烟 `main.rs:868` 等界面状态文字含「磁盘内容已变化」，`smoke_ui.rs:381` 查「canon 派生缓存未失效」；`fs_writeback_receipts.rs:235 / 347` 自己也对落盘回执的 `detail` 做 `starts_with(CANON_INVALIDATION_WARNING)`（回执会写盘，前缀实际上是落盘格式的一部分）。

不归宿主的文字匹配（列出来免得混淆）：`PatchReviewPanel.tsx:48` 的 `/无法安全定位|无法唯一确定|插入点前文已变/` 与 `:58` 的 `startsWith('接受分块失败')` 匹配的是前端自己抛的文案（`lib/suggestion-ops.ts`、`lib/patch-hunks.ts`、`lib/suggestion-change-set.ts`）；`useBookContext.ts:24` 的 `/^API 返回 \d+$/` 对应 `lib/api/errors.ts` 与 `lib/engine/crossChapter.ts`；`AgentStepsPanel.tsx:38` 的 `/重试/` 看的是引擎步骤说明；`WriteBatchResultCard.tsx:149` 比的是引擎给的两段文字。引擎 `packages/engine/src` 里没有匹配宿主报错文字的地方，只按 `ProjectReadError.kind === 'outside-project'`（`kernel/fsTools.ts`、`canonFiles.ts`、`projectTree.ts`、`authorVoice.ts`、`loop/chatLoopCheckpoints.ts`）与 `HttpTransportError` 的 kind 分支。

**建议（本刀不改）：**

- 值得改成结构化 kind（前端靠文字判断的）：
  1. `read_project_file` 的「不存在」：改返回 `HostError`，kind 用 `missing` / `outside-project` / `io`，`useBookProfile` 改判 kind。顺带修掉两处不一致：作品根没了也被当成「档案还没建」（中文 Windows 系统原话里有「找不到」），英文 Windows 同一情况却不命中。牵动 `TauriFileSystem.readProjectFile` 包装层（要继续给其余 12 处调用方一个带原文案的 `Error`）。
  2. 漂移拒写「磁盘内容已变化」：`write_file_if_unchanged` / `write_file_with_receipt` 改返回 kind `drift`，`PatchReviewPanel` 改判类型；最好同时让前端自己的漂移拒写（`useGuardedSuggestionWrite.ts:143`、替身 `tauri-fs.ts:160`）抛同一个错误类。Tauri 冒烟看的是界面显示文字，不受影响。
  3. 回执 `detail` 的「canon 派生缓存未失效: 」前缀：最好拆成回执里的结构化字段，但回执会落盘、Rust 自己也按前缀读回（还有 `test-fixtures/writeback-receipt-v1.json`），要带旧回执兼容，适合单独一刀、优先级低于前两条。
- 保持字符串就够（只显示给作者，或上抛给引擎当普通 `Error`，没人按文字分支）：其余 39 个——读作品的 `read_project_file_base64` / `list_project_dir` / `project_path_exists` / `reveal_in_file_manager`，引擎写口，写回里的 `write_file` / `create_writeback_audit` / `copy_into_project` / `delete_path` / `create_dir` / `rename_path`，回执三条，退出握手三条，引擎库四条，模型配置五条，影子 git 五条，插件库五条，自动更新三条。

### 验证

- Rust：`npm --prefix apps/desktop/frontend run build` EXIT=0 后，`CARGO_TARGET_DIR=D:/StoryForge/apps/desktop/src-tauri/target cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`：**216 passed / 1 ignored，EXIT=0**（改前同一套共 214 条、含 1 ignored——改前打印快照那次过滤跑报「3 passed / 214 filtered out」；新增 3 条都在 `host_error::tests`）。编译时有一条 `could not load dep-graph … 页面文件太小 (os error 1455)` 的增量缓存警告，是本机内存吃紧，不影响结果。
- 变异验证（`mutate.py` 用带 `assert count==1` 的定点替换打入、再定点改回，改回后两个文件 sha256 与改前一致）：
  1. 在 `llm_draft_probe.rs` 加回三个结构体——`Failure { kind, message }`（名字不带 Error、靠 message 认出）、`DraftProbeError { kind, detail }`（没 message、靠名字认出）、写在一行里的 `Compact { code, kind, message }`（字段按逗号也能切出来）→ `host_error_is_the_only_kind_message_error_struct` 红，报出 `["host_error.rs::HostError", "llm_draft_probe.rs::Failure", "llm_draft_probe.rs::DraftProbeError", "llm_draft_probe.rs::Compact"]`。（第一次只打了前两个；之后把扫描改成按换行和逗号切字段，补上单行结构体，重跑这条变异与全套 Rust 测试。）
  2. 给 `HostError.message` 加 `#[serde(rename = "detail")]` → 2 条红：新的 `every_kind_serializes_to_the_shape_the_frontend_reads` 与原有的 `engine_llm::tests::ipc_shapes_match_the_desktop_adapter`（214 passed / 2 failed / 1 ignored）。这条在改扫描之前跑的，改扫描只动测试辅助函数，不影响它。
- `rustfmt --check --edition 2021`：`host_error.rs`、`engine_llm.rs`（连同 `engine_llm_tests.rs`）、`fs_engine_reader.rs`、`llm_draft_probe.rs`（连同 `llm_draft_probe_tests.rs`）EXIT=0。`main.rs` 只加一行（它本来就不是 rustfmt 干净的，没整文件格式化）。仓库没有 `cargo fmt` / `clippy` 门禁。
- 行尾：`main.rs` 是 CRLF（1408 → 1409 行，仍全 CRLF），其余改动文件与新文件 `host_error.rs` 都是纯 LF；`git diff --numstat` 与 `--ignore-all-space --numstat` 一致。
- 前端与引擎零改动（`git status` 只有 `apps/desktop/src-tauri/src/` 与本记录），照通用门禁仍跑了一遍：
  - `pnpm lint`：EXIT=0（0 error；2 条 warning 在没动的 `apps/desktop/frontend/tests/independent-claim-history.test.ts`，原来就有；prettier 全部通过）。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `npm --prefix apps/desktop/frontend run test`（vitest 全套）：270 个文件、2760 passed，EXIT=0。
  - `pnpm --filter @storyforge/engine test`（含 golden）：111 个文件、14266 passed / 2 skipped，EXIT=0；golden 零变化（`git status` 里没有 `packages/` 的改动）。

### 未覆盖

- **没跑 Tauri 冒烟**（开发档 / 发行版都要从头编几个 GB，D 盘只剩约 5 GB），也没跑真宿主探针；报错经 IPC 到 WebView 的那一段只有 Rust 单测钉序列化结果，没在真窗口里点穿（读作品越界、模型出网拒绝、获取模型 Key 不对）。
- 本机没有建 symlink 的权限，Rust 里既有的 symlink 用例建链失败即提前返回，在本机是空过。
- 本地没跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），本机有别的会话在跑 headless Chrome、会互相拖超时，以 CI（`Windows Verify` 的 `pnpm verify`）为准；CI 不含 Rust 测试。
- 字符串报错部分只盘点、给建议，本刀一处没改。
