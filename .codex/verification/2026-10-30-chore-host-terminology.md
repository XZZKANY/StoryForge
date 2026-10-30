## 2026-10-30 Rust 宿主报错用词：作品 / 写入 / 写进文件

- 改动：作者 10-30 定的界面用词改到 Rust 宿主会露给作者的报错（经 Tauri 命令抛到前端、界面原样显示）。`fs.rs`、`fs_engine_reader.rs`、`fs_engine_writer.rs`、`fs_writeback_receipts.rs`、`shadow_git/core.rs` 共 93 处字符串字面量，只动字符串，不动标识符、注释与日志 key；用脚本按「出现次数 == 期望」逐条定点替换。
  - 「项目」→「作品」（项目目录 / 文件 / 路径 / 映射 / 锁 → 作品目录 / 文件 / 路径 / 映射 / 锁，「当前项目内」→「当前作品内」）；「写回」当名词→「写入」（写入路径 / 目标 / 回执 / 意图 / 结果 / 审计 / 操作身份），「请重试写回」→「请重新写进文件」。
  - 按规则改完读着别扭、另定措辞的 5 句：「项目根不是目录」→「作品根路径不是目录」（fs.rs 与 shadow_git 各 1 处；直译「作品根目录不是目录」自相矛盾）；「路径不是项目普通文件」→「路径不是作品内的普通文件」（2 处）；「引擎只能写项目的 .storyforge/ 目录」→「引擎只能写入作品的 .storyforge/ 目录」（「写作品」会被读成写作）；「创建快照期间项目新增了文件，请重试写回」→「创建快照期间作品里新增了文件，请重新写进文件」（2 处）；「请重试写回」统一写成「请重新写进文件」。
  - 照抄宿主原话的替身同步改成新原话：前端 `src/lib/writeback-receipt-fixture.ts`（「写入目标不在当前作品内」；原先截短的「写回操作身份冲突」补成宿主整句「写入操作身份冲突，已拒绝同一操作 ID 的不同请求」；替身自己的「测试文件系统缺少写回回执能力」→「写入回执」），守护测试 `tests/ui-terminology.test.ts` 删掉这个文件的整条豁免和随之不再用的 `ALL_TERMS`；`tests/engine-agent-deps.test.ts` 两处、`tests/file-move-copy-reveal.test.tsx` 两处；引擎 `readPort.test.ts`、`kernel/memoryProject.test-support.ts`、`kernel/contextFixture.test-support.ts` 各一处「作品文件读取预算无效」。Rust 自己的测试 `fs.rs` 里 11 处断言跟着改。
  - 查过没有按宿主原文做判断的代码：引擎读口按 `EngineReadError.kind`（`outside-project` / `io`）判定，不解析文字；宿主测试里按片段断言的（`身份冲突`、`结果未知`、`新增了文件`、`磁盘内容已变化`）新原话仍包含，不用改。
- 验证：
  - `npm --prefix apps/desktop/frontend run build` 后 `CARGO_TARGET_DIR=D:/StoryForge/apps/desktop/src-tauri/target cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`：EXIT=0，173 passed / 1 ignored。
  - rustfmt：仓库脚本与 CI 都不跑 `cargo fmt` / `cargo clippy`。对改动的 5 个 Rust 文件（含其子模块）分别在改前（b759d8e8）与改后跑 `rustfmt --edition 2021 --check`，两边都有 26 处既有格式差异；把改前的输出套上同样的字符串替换后与改后逐行比较完全一致，这一刀没有新增格式差异。clippy 没跑。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - 前端全套 `npx vitest run`：EXIT=0，252 个文件 2547 passed。之后 prettier 把替身里变长的那行折成两行（只动换行与缩进），守护测试单跑仍绿。
  - 引擎 `pnpm run test:engine`（typecheck + 测试）：EXIT=0，106 个文件 14073 passed / 2 skipped。
  - 根目录 `pnpm run lint`：EXIT=0（0 错误；2 条警告在未改动的 `tests/independent-claim-history.test.ts`，原来就有）。
  - 守护测试变异验证：把 `writeback-receipt-fixture.ts` 的「写入目标不在当前作品内」改回「写回目标不在当前项目内」，守护测试红 1 条，逐行指出 `writeback-receipt-fixture.ts:28 「项目」改说「作品」` 与 `「写回」改说「写进文件」`；用核次数 == 1 的定点替换还原，复跑绿。
  - 行尾：`git diff --numstat` 与 `--ignore-all-space --numstat` 一致（12 个文件）；按字节数过，`fs.rs` 与替身仍是全 CRLF，其余仍是全 LF，没有 CRCRLF。
- 未覆盖：
  - 没跑 Tauri 冒烟（新 worktree 要从头编几个 GB，D 盘只剩约 14 GB）；改的只是报错文本，不影响起服。没在真宿主上看报错的显示效果。
  - 没改的宿主字符串：`main.rs` 冒烟自检诊断信息（约 37 处含旧词，按要求不动）；`fs.rs` 的「符号链接不纳入项目文件索引」（两处调用方都丢掉这个错误，作者看不到）；`llm_config_store.rs` 的「[llm-config] 读取时写回规范化配置失败…」（`eprintln!` 日志，只进宿主 stdout）；Rust 测试的断言说明文字（如「草稿探测不落盘」）。
  - 引擎非测试代码里自己的「无法解析项目文件路径。」（`kernel/fsTools.ts`、`kernel/projectTree.ts`）与 golden 里的引擎报错不是宿主原话，留给引擎那一刀。

## 2026-10-30 编排者集成

- 改动：措辞按代理提议定稿（「作品根路径不是目录」「引擎只能写入作品的 .storyforge/ 目录」「请重新写进文件」等）。合入 origin/master（含 #534，无冲突，master 这段没动 Rust）。`CONTEXT.md` 用词表记下宿主已改、只剩引擎。守护测试合并后第一次跑红过一次，未能重现（连跑 3 次各 0.6–0.9 秒），怀疑冷启动解析整个 src 在满载下越过默认 5 秒，给这条测试单独放宽到 30 秒。
- 验证：`pnpm verify` EXIT=0（project-core 34、引擎 14073 passed / 2 skipped、前端单测 2575 passed、三条浏览器回归全过）；`CARGO_TARGET_DIR=D:/StoryForge/apps/desktop/src-tauri/target cargo test` 173 passed、1 ignored。
- 未覆盖：没跑 Tauri 冒烟（D 盘约 15 GB，新 worktree 要从头编）；没在真宿主上看报错显示。
