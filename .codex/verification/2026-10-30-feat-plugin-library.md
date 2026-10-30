## 2026-10-30 插件第 1 刀：本机插件库、从文件夹导入、引擎解析与列出

- 背景：作者 10-30 拍板做技能插件（本机统一插件库、按作品启用、能带技能 / 写法 / 指令片段、能导入别人的插件），分刀见 `docs/internal/TODO.md`「2026-10-30 当前入口」。本刀只做宿主库与导入、引擎的纯读解析；不接进对话 / 起草，不做界面，没有作者可见的变化。
- 宿主（`apps/desktop/src-tauri/src/plugin_library.rs`，`main.rs` 注册 5 个命令）：
  - 库根 `<app_data_dir>/plugins`（走 `runtime_paths::app_data_dir`，冒烟隔离照旧）；`.staging/<stageId>/` 一次只留一个暂存，`.trash/<名>-<毫秒>/` 收被移除或被同名覆盖的旧插件（只 rename，不删）。
  - `plugin_stage_import`：先完整遍历校验、再从内存写暂存，超限整体报错不留半个暂存。只收 `md` / `markdown` / `txt` / `json`；单文件 > 512 KiB、非 UTF-8、文件名不是合法 Unicode、符号链接与联接点（不跟随）记进 skipped 并写原因；点开头目录（`.codex-plugin` 除外）与 `node_modules` 不进；收下文件 > 300、合计 > 4 MiB、目录层级 > 8、遍历条目 > 5000 整体报错；source 在插件库里或包含插件库都拒绝。OneDrive 云文件等非链接类 reparse point 照常读。
  - `plugin_commit_import`：校验 stageId 与插件名；同名已装的先挪进 `.trash`，暂存改名失败时挪回。`plugin_discard_import`、`plugin_remove`（挪进 `.trash`）。五个命令 `spawn_blocking` + 模块级锁串行。
  - 插件名规则与 `project-core` 的 `pluginNameProblem` 一致（1–40 码点、无首尾 Unicode 空白、不含 `< > : " / \ | ? *` 与控制字符、不以 `.` 开头、不以 `.` 或空格结尾、非 Windows 保留名）。
  - 前端薄封装 `apps/desktop/frontend/src/lib/plugin-library.ts`（只有 invoke 与类型）。
- 引擎与共享内核：
  - `packages/project-core/src/plugins.ts`：`PLUGINS_FILE`（`.storyforge/plugins.json`）、`pluginNameProblem`、`parsePluginsFile`（坏文件当一个都没启用并说明；不合规名字丢掉；不分大小写去重保序）、`serializePluginsFile`。
  - `packages/engine/src/kernel/pluginManifest.ts` + `plugins.ts`：`describePlugin` / `listInstalledPlugins` / `readEnabledPluginNames` / `resolveEnabledPlugins`。清单认 `storyforge-plugin.json` 与 Codex `.codex-plugin/plugin.json`（连接器 / MCP 记一句不会使用；`skills` 只认插件内相对路径）；技能 `技能/<名>.md|.markdown` 或 `技能/<名>/SKILL.md`（Codex 只认 `<skills>/<名>/SKILL.md`），写法 `写法/*.md|.markdown`，指令 `指令.md`（4000 码点保开头）；各最多 20 份；全部先脱敏再解析、求 sha256；SKILL.md 缺名字用文件夹名；插件条目的头部认 YAML 引号与块标量（不改 `parseWritingSkill`）。读不到的部分记 problems 不抛。
- 验证：
  - Rust：`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml plugin_library` 17 passed（名规则、扩展名 / 点目录 / `.codex-plugin`、超大 / 非 UTF-8、层级 / 数量 / 总量 / 条目上限整体报错且不留暂存、空文件夹、库内与包含库的 source、junction 记 skipped 不跟随、新暂存清旧暂存、覆盖进 `.trash`、discard、remove 两次都留）。新文件 `rustfmt --check` 通过。`cargo clippy --all-targets -- -D warnings` 新文件 0 条；master 上原有 5 条（`shadow_git/core.rs`、`smoke_ui.rs` 两条、`main.rs` 的 `let _ = app.exit(0)`、`host_close_state.rs`）没动。
  - project-core vitest 34 passed（插件 12 条）；引擎 `plugins.test.ts` 28 passed；工作者做了 11 处变异（排序、SKILL.md 取名、点目录、指令 sha、Codex 不收平铺、引号还原 ×2、块内行、`.markdown`、块标量、大小写去重），每处恰有测试变红，已还原。
  - `pnpm verify` EXIT=0：project-core 34、引擎 14045 passed + 2 skipped、前端 2529 passed、三个浏览器回归通过；golden 零改动。
  - 行尾：`main.rs` 保持 CRLF（裸 LF 0），其余新文件 LF；`packages/engine/src/index.ts`、`packages/project-core/src/index.ts` 保持 LF。
- 未覆盖：
  - 没在真宿主上点穿导入（真 WebView + 真 Rust 命令）；没有界面入口，作者暂时用不到。
  - OneDrive 云文件实际读取（会触发下载）没在真机验证；skipped 列表没有单独上限（受 5000 条目约束）。
