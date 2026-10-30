## 2026-10-30 插件第 5 刀：内置「起书基础包」

- 背景：插件分刀见 `docs/internal/TODO.md`「2026-10-30 当前入口」；前四刀 #530 / #532 / #535 / #542。作者 10-30 定：基础包随程序带、不能移除、每本书能关，**只对新建作品默认启用**；「新建技能」模板**只留「本书禁用词」**。zip 导入由另一会话在 `feat/plugin-zip-import` 做，本刀不碰。
- 改动：
  - 基础包内容 `apps/desktop/src-tauri/bundled-plugins/starter/`（ASCII 文件名，编进程序时映射到插件内中文路径）：`plugin.json`（起书基础包 1.0.0）、`setup.md`（= 原「立项流程」模板逐字节相同）、`review.md`（审稿口径，去掉模板里「改成你最在意的几条」，末尾说明作品里同名技能优先）。
  - Rust `plugin_library.rs`：`include_str!` 文件表 + `sync_bundled_plugins`，在 `plugin_library_dir` 同一把锁内调用：没有就写（标记文件 `.storyforge-bundled` 最后写，内容是版本号）；带标记同版本不动；带标记版本不同旧的进 `.trash` 再写；同名无标记（作者自己装的）不动；写一半失败清掉；同步失败只 `eprintln!`，命令照常返回。`remove_plugin` 遇到带标记的拒绝并说明去作品里取消勾选。导入同名照旧覆盖（新的无标记，之后不会被同步盖回）。
  - `project-core`：`STARTER_PLUGIN_NAME`（Rust 侧同名字面量旁注明一致）。引擎 `PluginDescription.bundled`（插件根下标记是普通文件才算）。
  - 界面：设置页插件卡片对内置插件显示「内置」小标、不显示「移除」；`SKILL_TEMPLATES` 只留「本书禁用词」；新建作品默认启用：`initialize.ts::enableStarterPlugin`（不存在才写 `.storyforge/plugins.json`），接进 `createNewBookProject`（开书即建）、`createSampleStoryProject`（示例作品）、`create.ts::createBlankStoryProject`（新建作品对话框）。**不放进 `initializeStoryProject`**：它还被 `useProjectCommands.ts` 的「补作品目录」用于已有作品，测试钉住它不写启用文件。
  - TODO：10-30 当前入口第 2 条记插件 ①–⑤ 已做与真机要看的点。
- 验证：
  - Rust：`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml plugin_library` 25 passed（新增 7：首次同步三文件 + 标记逐字节、同版本不动、改版本进回收夹重写、无标记同名不碰、移除带标记被拒、导入同名后不被同步盖回、写一半失败清掉）；两个 Rust 文件 `rustfmt --check` 通过。
  - project-core 35 passed；引擎 `plugins.test.ts` +3（bundled）；前端新增 `tests/starter-plugin-new-project.test.ts`，并按新行为改 4 个测试文件。工作者两处变异均被抓住。
  - **golden 零改动**（`git status --short packages/engine/golden` 为空）。
  - `pnpm verify` EXIT=0：project-core 35、引擎 14112 passed + 2 skipped、前端 2580 passed、三个浏览器回归通过。
  - 行尾：改动文件全 LF；`--numstat` 与 `--ignore-all-space --numstat` 只在 `PluginsSection.tsx` 差 11 行（「移除」按钮包进条件多一层缩进），无 CR。
- 快进合入 master（#540 引擎用词，无重叠文件）后：第一遍门禁被中途打断（控制台关闭，退出码 0xC0000142，非检查失败）；重跑 `pnpm verify` EXIT=0：project-core 35、引擎 14113 passed + 2 skipped、前端 2580 passed、三个浏览器回归通过。
- 未覆盖：
  - 没在真宿主上点穿：装机后首次打开插件库是否写出基础包、升级版本时的替换、新建作品后对话里出现立项流程与审稿口径。
  - 升版本时旧版已进回收夹而新版写失败，不会自动恢复旧版（下次打开插件库会重试写入）。
