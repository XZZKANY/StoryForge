## 2026-10-30 插件第 5 刀前半：从 .zip 导入插件（宿主侧）

- 背景：`docs/internal/TODO.md`「2026-10-30 当前入口」第 2 条要求「zip 要加 Rust `zip` 依赖并防路径穿越」。第 1 刀（#530）只做了从文件夹导入；本刀让 `plugin_stage_import` 的 `source` 也可以是一个 `.zip` 文件。不新增命令、不改 `main.rs`、前端一个字没动；`StagedImport` 形状不变，暂存目录结构与文件夹导入完全一样，插件面板的预览对话框按暂存根去读、不用改。
- 宿主改动（`apps/desktop/src-tauri/src/plugin_library.rs`）：
  - 来源判断：磁盘上是文件夹走原来的文件夹导入；是文件且扩展名为 zip（不分大小写）走 zip；其余报「只能导入文件夹或 .zip 文件」（原来的「要导入的不是文件夹」改成这句）。库内的 zip 同样报「不能从插件库里面导入插件」。暂存 id 照旧由 `new_stage_id(source)` 从 zip 路径派生。
  - 复用而不复制：文件夹与 zip 共用 `Collector`（单文件按实际读到的字节判断 > 512 KiB、非 UTF-8 记 skipped，收下 > 300 个、合计 > 4 MiB 整体报错，空了报错，结果排序）、`read_capped`（改成吃任意 `Read`，`take(上限 + 1)`）、`depth_error`、`is_ignored_dir`、`reserved_stem`（从插件名规则里抽出）与全部原因文案。文件夹导入的判断顺序与文案没变（只把 `skip` 自由函数换成 `Collector` 方法）。
  - zip 流程（`scan_zip`，只读内存、不落盘；一切校验做完才写暂存，任一整体报错都不留暂存）：
    1. 压缩包本身 > 32 MiB 报错（先看文件大小，再 `take(32 MiB + 1)` 读进内存，不信前一步）；中央目录条目 > 5000（测试里可调）直接报错，不逐条读内容；中央目录里有完全同名的条目报「压缩包里有重名的条目，可能已损坏」（zip 库会把它们并成一条，没法逐条记 skipped）；打不开报「打不开这个压缩包（可能已损坏，或不是 zip 格式）」。
    2. 逐条只看元数据：条目名原始字节不是合法 UTF-8（不管有没有 UTF-8 标志位，例如 GBK 老压缩包）记 skipped「文件名编码不是 UTF-8，请用新版压缩工具重新打包，或解压后从文件夹导入」，显示名用有损解码；`\` 当分隔符；任一段是空的、`.`、`..`、以 `.` 或空格结尾、含控制字符（含 NUL）或 `< > : " / \ | ? *`、是 Windows 保留名（`con.md` 等）都记 skipped「路径不安全（…），不解出」——绝对路径、盘符、UNC 前缀都落在这些规则里。自校验之外再要求 `enclosed_name()` 不为空（zip 9 的 `enclosed_name` 会把绝对路径与盘符悄悄改成相对路径、也放过 `a/../b`，所以不能只靠它）。
    3. 链接条目（unix mode 为链接）记「链接或联接点，不跟随」；非文本扩展名记「不是文本文件…」；加密条目记「加了密码，StoryForge 不解密」；压缩方式不是存储 / Deflate 记「压缩方式不支持…」。目录条目本身不算文件。
    4. 整包（不看 `__MACOSX` 与点开头目录、`node_modules` 这些会被跳过的条目）只有一个顶层文件夹、且根上没有文件时剥掉这一层；之后 `__MACOSX` 整棵跳过（任意层），点开头目录（`.codex-plugin` 除外）与 `node_modules` 同文件夹导入。层级 > 8 按剥层后的路径整体报错，位置写到第 9 层目录。
    5. 规范化后按小写比较重名（文件与文件、文件与文件夹），后来的记「和压缩包里前面的文件重名（不分大小写），只收前面那个」；只有真正收下的文件占名字（前一个因非 UTF-8 被跳过时后一个照收）。内容按实际解压字节读（`take(512 KiB + 1)`，不信声明的大小），损坏条目（CRC 不符等）整体报错。
- 依赖（`apps/desktop/src-tauri/Cargo.toml`）：
  - `zip = { version = "9.1", default-features = false, features = ["deflate-flate2"] }`，锁定 9.1.3（rust-version 1.88，本机 rustc 1.97.1）。只开 Deflate 解压；不开 aes / bzip2 / zstd / lzma / zopfli / time。
  - `flate2 = { version = "1.1", default-features = false, features = ["rust_backend"] }`：zip 只引 flate2、不选后端；树里已有的 flate2 1.1.9 只在编译期（tauri-macros → tauri-codegen → png）用，resolver 2 下不和运行时依赖合并特性，不显式选后端会编到 flate2 的 `compile_error!("You need to choose a zlib backend")`。走的是已在锁里的 miniz_oxide 0.8.9。
  - `Cargo.lock` 只新增：`zip 9.1.3`、`typed-path 0.13.0`、`nix 0.31.3`（只在 macOS / BSD 上用）、`cfg_aliases 0.2.2`；`storyforge-desktop` 依赖列表加 `flate2`、`zip`；`getrandom 0.4.2` 的依赖列表多了 `js-sys`、`wasm-bindgen` 两条边（zip 在 wasm32 上给 getrandom 开 `wasm_js`，锁文件不分目标；两包原本就在锁里，版本没变）。`git diff Cargo.lock` 删除行 0 条，没有任何已有包换版本。
- 编译环境：`tauri::generate_context!()` 要 `apps/desktop/frontend/dist`，本刀没有 `npm ci` 前端，只建了一个只含最小 `index.html` 的占位 `dist/`（被 git 忽略，不提交）；`CARGO_TARGET_DIR=D:/StoryForge/apps/desktop/src-tauri/target` 复用主仓库编译缓存。没跑 Tauri 冒烟、`pnpm desktop:build`、`pnpm verify`（本刀不碰 TS）。
- 验证：
  - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml plugin_library`：25 passed（原 17 + zip 8）。zip 测试都用 `zip::ZipWriter` 现造压缩包：
    - 与文件夹导入一致：同一棵树（含 `技能/x.md` 中文路径、`exact.md` 正好 512 KiB、`big.md` 512 KiB + 1、非文本、非 UTF-8 内容、`.git` / `.hidden` / `node_modules`、`.codex-plugin`）分别从文件夹与 zip 导入，`files`、`skipped`、暂存里每个文件的字节都相同；zip 里另加的 `__MACOSX/…` 被跳过；暂存目录里只有收下的文件。
    - 单顶层文件夹被剥掉（`my-plugin/` 目录条目、`my-plugin/.git`、`__MACOSX/my-plugin/…` 不妨碍），确认安装后清单在插件根；两个顶层文件夹、顶层文件夹旁有根文件时不剥；顶层旁只有 `.git/` 时照剥。
    - `../evil.md`、`/abs.md`、`C:/x.md`、`a\..\..\b.md`、`sub/../inner.md`、`//server/share/unc.md`、`a//empty.md`、`./dot.md`、`x:stream.md`、`con.md`、`dir./trail.md`、含 BEL / NUL 的名字、`a?.md` 都记「路径不安全」，整个临时目录里只剩压缩包本身与暂存里的 `ok.md`。
    - 链接条目、ZipCrypto 加密条目、压缩方式改成 12（bzip2）的条目、GBK 文件名（把占位名按字节改成「技能」的 GBK 编码，无 UTF-8 标志位）、4 MiB 的高压缩比条目（压缩包整体 < 64 KiB，实际解压 > 512 KiB）各记对应原因。
    - 大小写重名：`Notes.md` / `notes.md`、`Sub/a.md` / `sub/A.md`、文件 `guide.md` 与 `Guide.MD/x.md`、`dir.md/x.md` 与文件 `DIR.md`，后来的记重名；`Bad.md`（非 UTF-8）被跳过后 `bad.md` 照收。
    - 整体报错且不留暂存：301 个文件（300 个可以）、9 × 500 KiB、第 9 层文件与第 9 层目录条目（8 层可以；`top/` 单顶层剥掉后 8 层也可以）、只有非文本 / 空压缩包、完全同名条目（按字节把 `b.md` 改成 `a.md`）、非 zip 内容、> 32 MiB（`set_len` 造）、条目数超限（上限调成 5：5 条可以、6 条报错）。
    - 来源：`PLUGIN.ZIP` 大写扩展名可以；`plugin.rar` 报「只能导入文件夹或 .zip 文件」；名叫 `folder.zip` 的文件夹按文件夹导入；库里的 zip 报「不能从插件库里面导入插件」。原测试 `stage_rejects_bad_sources_and_sources_inside_the_library` 的断言跟着改成新文案。
  - 全量 `cargo test`（同一 manifest）：181 passed，0 failed，1 ignored。
  - `rustfmt --check --edition 2021 src/plugin_library.rs src/plugin_library_tests.rs` 通过（无仓库级 rustfmt.toml）。
  - `cargo clippy --all-targets -- -D warnings`：只有 master 上原有的 5 条（`shadow_git/core.rs:613`、`smoke_ui.rs:98`、`smoke_ui.rs:104`、`main.rs:1249`、`host_close_state.rs:148`），`plugin_library*.rs` 0 条。
- 变异（脚本按定点替换、替换前断言目标串出现次数，跑完无条件还原并用 sha256 校验与原件一致）：
  1. 去掉 `..` 检查（连同也会挡住 `..` 的「以 `.` 结尾」规则一起去掉，否则被它掩盖）→ `zip_entries_that_escape_or_are_illegal_on_windows_are_skipped` 红（`sub/../inner.md` 被 `enclosed_name` 放过）。
  2. 去掉空段检查 → 同一测试红（`/abs.md`、`//server/share/unc.md`、`a//empty.md` 被收下）。
  3. 去掉 `Collector::offer` 里按实际字节的大小检查 → `zip_import_stages_the_same_files_as_folder_import`、`zip_links_encrypted_entries_odd_compression_and_legacy_names_are_skipped` 红（文件夹导入有元数据预检，仍绿）。
  4. 去掉剥顶层 → `zip_with_a_single_top_folder_is_unwrapped`、`zip_limits_reject_the_whole_archive_without_leaving_a_stage` 红。
  5. 重名改成区分大小写 → `zip_skips_later_files_whose_names_clash_ignoring_case` 红。
  6. 去掉 `__MACOSX` 跳过 → 三条 zip 测试红。
  7. 去掉完全同名条目检查 → `zip_limits_reject_the_whole_archive_without_leaving_a_stage` 红。
- 行尾：`plugin_library.rs`、`plugin_library_tests.rs`、`Cargo.toml`、`Cargo.lock` 改前改后都是纯 LF（CRLF 0、CRCRLF 0）；`main.rs` 没动。`git diff --numstat` 与 `--ignore-all-space --numstat` 只差 `plugin_library.rs` 一行（rustfmt 换行），没有整文件行尾变化。
- 未覆盖：
  - 没在真宿主上点穿 zip 导入（真 WebView + 真 Rust 命令）；面板里「选 zip」的入口没做（等插件面板合并后另做），作者暂时用不到。
  - Info-ZIP Unicode Path 扩展字段（老压缩包里带 UTF-8 备份名）由 zip 库替换条目名，没单独造包测；真实 Windows 资源管理器 / 7-Zip / macOS 访达打的包没有逐个试。
  - 单个插件文件夹本身叫 `技能` 或 `写法` 而又只打包了这一层内容时（例如只有 `技能/x.md`），按规则会被当成单顶层文件夹剥掉；预览里能看到路径，但不是插件作者的本意。是否给布局目录名开例外留给后续决定。
  - 「要导入的文件夹必须是完整路径 / 不存在 / 无法读取 / 无法解析」几句在来源是 zip 时仍说「文件夹」，没改文案。
  - 读入内存的上限是压缩包 32 MiB + 收下的文本 4 MiB；最坏情况下 5000 个文本条目各解压到 512 KiB + 1 才被判超大，CPU 有一段消耗，没加「累计解压字节」上限。

## 2026-10-30 审查退回四件事（同一分支追加提交）

> 上一节「未覆盖」里第 3–5 条已由本节处理；其余几条照旧。

- 合 origin/master（单独一个合并提交 `ad4dba28`）：`git fetch origin master` 时 master 已到 `37cd51ab`（在审查时说的 `2162ec1a` 之后又合了 #537 宿主用词、#538 自动更新检查），按 `git merge origin/master` 合的是 `37cd51ab`。`plugin_library.rs` 在 master 上没动过；冲突只有 `Cargo.lock`：先整份取 master 的，再用 `cargo metadata` 重新解析，加回 `zip 9.1.3`、`typed-path 0.13.0`、`nix 0.31.3`、`cfg_aliases 0.2.2`。`git diff origin/master -- apps/desktop/src-tauri/Cargo.lock`：45 行新增、1 行删除。删除的那行不是换版本：#538 带进来的 `tauri-plugin-updater` 自己依赖 `zip 4.6.1`，锁里出现两个 zip 版本后，cargo 必须把它依赖列表里的 `"zip"` 写成 `"zip 4.6.1"`（版本不变）。其余是新增条目、`storyforge-desktop` 的 `flate2` / `zip 9.1.3` 两条边，以及之前说明过的 `getrandom 0.4.2` 的 `js-sys` / `wasm-bindgen` 两条边。要想让锁里只有新增，得改用 updater 那份 `zip 4.6.1`：4.x 没有 `by_index_data` / `has_duplicate_names`，会动到元数据读取和完全同名条目检查，本刀没这么做。
- `Cargo.toml`：flate2 那行注释改成「Windows 上别处的 flate2 只在编译期（tauri-codegen）用」。合并后 updater 只在 Linux / macOS 上引 flate2，Windows 上运行期的 flate2 仍只来自本刀（`cargo tree -i flate2 -e normal --target x86_64-pc-windows-msvc` 核过）。
- 1. 剥顶层给插件布局目录开例外：`LAYOUT_DIRS = ["技能", "写法", "skills", ".codex-plugin"]`，唯一的顶层文件夹与其中之一相同（不分大小写，`eq_ignore_ascii_case`）时不剥。新测试 `zip_whose_only_top_folder_is_a_plugin_layout_dir_is_not_unwrapped`：只有 `技能/x.md` → 仍是 `技能/x.md`；`写法/`（含目录条目）、`SKILLS/s/SKILL.md`、`.codex-plugin/plugin.json` 都不剥；带 `__MACOSX/技能/…` 的 `技能/x.md` 也不剥；`my-plugin/技能/x.md` 照样剥成 `技能/x.md`（原测试 `zip_with_a_single_top_folder_is_unwrapped` 也还覆盖这一点）。
- 2. 解压开销封顶：
  - (a) 条目在中央目录里声明的解压后大小 > 512 KiB 的，直接记「文件太大（超过 512 KB）」，不解压（`zip_skip_reason` 里排在「非文本」之后、「加密」之前）。新测试 `zip_entries_declared_too_large_are_skipped_without_unpacking`：把 `huge.md`（512 KiB + 1）的本地头签名改坏，导入成功且 `huge.md` 记「文件太大」，说明没打开它；对照组把声明不超限的 `small.md` 本地头改坏，导入整体报「读取压缩包里的「small.md」失败」且不留暂存，证明「改坏本地头」只要被打开就会暴露。
  - (b) 按实际读出的字节累计，读完才被跳过的（非 UTF-8 等）也算，上限 32 MiB（`MAX_UNPACKED_BYTES`），超了整体报「压缩包解压后的内容太多，没有导入」，不留暂存。上限经 `ScanLimits { entries, unpacked_bytes }` 注入：`stage_import_with_scan_limit(…, max_entries)` 改成 `stage_import_with_limits(…, ScanLimits)`，`stage_import` 用 `ScanLimits::DEFAULT`，原来两处条目数测试改用 `entry_limit(5)`。新测试 `zip_unpacked_bytes_are_capped_including_contents_that_get_skipped`：上限 1000，`a.md` 500 字节 + 非 UTF-8 的 `bad.md` 500 字节正好 1000 能导入；再加 1 字节的 `c.md` 就整体报错（收下的只有 501 字节，超限只能来自被跳过的 `bad.md` 也计了数）。
- 3. 报错措辞：「要导入的文件夹或压缩包必须是完整路径」「要导入的文件夹或压缩包不存在」「无法读取要导入的文件夹或压缩包：…」「无法解析要导入的文件夹或压缩包：…」；「不能导入包含插件库的文件夹」等只对文件夹成立的没动。`stage_rejects_bad_sources_and_sources_inside_the_library` 的断言从 `contains` 收紧成整句相等，并加了 `missing.zip` 不存在的情况。
- 验证（合并后的树，环境照旧：占位 `apps/desktop/frontend/dist/index.html`、`CARGO_TARGET_DIR=D:/StoryForge/apps/desktop/src-tauri/target`，没碰 node_modules）：
  - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml plugin_library`：28 passed（17 文件夹 + 11 zip）。
  - 全量 `cargo test`：194 passed，0 failed，1 ignored（合并 master 后测试数比上一节多）。
  - `rustfmt --check --edition 2021 src/plugin_library.rs src/plugin_library_tests.rs` 通过。
  - `cargo clippy --all-targets -- -D warnings`：仍只有 master 原有的 5 条（`shadow_git/core.rs:613`、`smoke_ui.rs:98`、`smoke_ui.rs:104`、`main.rs:1250`（合并后行号 +1）、`host_close_state.rs:148`），`plugin_library*.rs` 0 条。
- 变异（同一套脚本，定点替换前断言目标串次数，跑完无条件还原并用 sha256 校验）：
  - 新增 3 处：去掉布局目录例外 → `zip_whose_only_top_folder_is_a_plugin_layout_dir_is_not_unwrapped` 红（`技能/x.md` 变成 `x.md`）；去掉按声明大小预跳过 → `zip_entries_declared_too_large_are_skipped_without_unpacking` 红（`huge.md` 被打开，报「Invalid local file header」）；去掉累计解压上限 → `zip_unpacked_bytes_are_capped_including_contents_that_get_skipped` 红。
  - 上一节 7 处在新代码上重跑：`..`、空段、剥顶层、大小写、`__MACOSX`、完全同名 6 处照旧恰有测试变红（剥顶层与 `__MACOSX` 现在还会让新的布局目录测试一起红）。**「去掉 `Collector::offer` 里按实际字节的大小检查」这一处现在不再变红**：zip 这边声明超限的已经预跳过，而 zip 9 解压时输出不会超过声明的大小，所以 zip 条目到不了这条检查；文件夹这边有元数据预检，只剩「读的过程中文件变大」这种竞态能到达。这条检查留作纵深防御，没有能稳定触发它的测试。
- 行尾：四个改动文件仍是纯 LF（CRLF 0、CRCRLF 0）；本次 `git diff --numstat` 与 `--ignore-all-space --numstat` 完全一致。
- 仍未覆盖：真宿主点穿、面板「选 zip」入口、Info-ZIP Unicode Path 字段与真实压缩工具打的包，同上一节。

## 2026-10-30 再合 master：内置「起书基础包」#548

- 对齐：`git pull --ff-only origin feat/plugin-zip-import` 已是最新（本地已含协调方的合并提交 `b0fa6065`）。`git fetch origin master` 得到 `5756667f`（#548 合并提交），`git merge origin/master` 单独提交为 `592ca465`。
- 合并结果：`plugin_library.rs` / `plugin_library_tests.rs` 文本自动合并，两边原样保留——#548 的 `STARTER_PLUGIN_*` 常量与 `include_str!`、`bundled_marker` / `write_bundled_plugin` / `sync_bundled_plugins`、`remove_plugin` 拒绝带 `.storyforge-bundled` 标记的插件、`plugin_library_dir` 锁内同步；本分支的 `Collector` / `scan_zip` / `ScanLimits` 与报错措辞。唯一的语义冲突：两边测试各加了一个同名同义的 `files_under` 辅助函数（编译会报重复定义），删掉本分支那份、留 master 的。`Cargo.toml` / `Cargo.lock` 没有冲突；`git diff origin/master -- apps/desktop/src-tauri/Cargo.lock` 与上一节相同（45 行新增 + `tauri-plugin-updater` 依赖行 `"zip"` → `"zip 4.6.1"` 1 处，没有包换版本）。
- 两者的交互（另一个提交）：
  - zip 导入与文件夹导入最后都走 `commit_import`：同名已装的整个挪进 `.trash`（内置包连同标记一起进回收夹），暂存改名成插件文件夹，新的里面没有标记；`sync_bundled_plugins` 见到没有标记的同名文件夹不动，所以不会被盖回；没有标记也就能被 `remove_plugin` 移除。
  - 压缩包（或文件夹）里自带的 `.storyforge-bundled` 冒充不了自带插件：`Path::extension()` 对点开头的文件名返回空，被当成非文本跳过，进不了暂存。
  - 新测试 `zip_import_over_the_bundled_plugin_drops_the_marker_and_sync_keeps_the_import`：先同步出内置包；zip 里是 `起书基础包/技能/立项流程.md`（作者的版本）和 `起书基础包/.storyforge-bundled`；暂存只收 `技能/立项流程.md`，标记记「不是文本文件」；以「起书基础包」确认后插件文件夹里只有这一个文件，回收夹里是带标记的旧内置包；再调一次 `sync_bundled_plugins`（`plugin_library_dir` 锁内调的就是它；命令本身要 `AppHandle`，单测里不起 Tauri）内容仍是作者的版本、回收夹仍只有 1 份；最后 `remove_plugin` 能移除。
- 验证（作者在用这台机器，四项依次跑、没有并行；环境照旧：占位 `dist/index.html`、`CARGO_TARGET_DIR=D:/StoryForge/apps/desktop/src-tauri/target`、没碰 node_modules）：
  - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml plugin_library`：37 passed（文件夹 17 + 基础包 8 + zip 12）。
  - 全量 `cargo test`：204 passed，0 failed，1 ignored。
  - `rustfmt --check --edition 2021 src/plugin_library.rs src/plugin_library_tests.rs` 通过。
  - `cargo clippy --all-targets -- -D warnings`：仍只有 master 原有的 5 条（`shadow_git/core.rs:613`、`smoke_ui.rs:98`、`smoke_ui.rs:104`、`main.rs:1251`、`host_close_state.rs:148`），`plugin_library*.rs` 0 条。
- 行尾：`plugin_library.rs`、`plugin_library_tests.rs`、`Cargo.toml`、`Cargo.lock` 仍是纯 LF。
- 本节没有重跑变异：合并没有改动 zip 相关代码，新测试只钉住已有行为。
