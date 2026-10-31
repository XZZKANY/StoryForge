## 2026-10-31 前端读作品文件只留 `readProjectFile` 一个口子（删宿主不带围栏的 `read_file`）

- 改动：作者要求「同一件事只留一种做法」。前端读作品文件原有两个口子：`TauriFileSystem.readFile(path)` → 宿主 `read_file`（直接 `fs::read_to_string`，**不查是否在作品内**），和 `readProjectFile(projectRoot, path)` → `read_project_file`（查，但把检查内联手写了一份）。本刀：
  - Rust（`apps/desktop/src-tauri/src/fs.rs`、`main.rs`）：删掉 `read_file` 命令与注册；`read_project_file` 改用同文件的 `canonical_project_root` + 公共的 `ensure_canonical_path_inside_project`（与 `read_project_file_base64`、写回各路同一套），删掉内联检查。拒绝作品外路径、拒绝作品内指向作品外的 symlink、作品根本身不能当文件读，三条行为不变；作品外的拒绝文字随公共函数从「文件不在当前作品内」变成「路径不在当前作品内」（前端没有按旧文字判断的地方）。
  - 「文件不存在」给稳定信号：路径解析报 NotFound 时，先把最近一级存在的父目录解析成真实路径、确认在作品内（与写入前 `validate_pending_mutation_path` 同一套，**不放宽围栏**），再报「作品文件不存在: <路径>」；作品外的不存在路径照旧报「路径不在当前作品内」，不会借报错探出作品外有没有这个文件。以前这条路报的是系统原话（中文 Windows「系统找不到指定的文件」，英文 Windows「cannot find the file specified」——后者 `useBookProfile` 的正则认不出来）。
  - 前端：删掉 `TauriFileSystem.readFile`，12 处调用全部改走 `readProjectFile`（逐点见下表）；`useProjectSearch.ts` 注释里「不用无校验的 read_file」一句随命令删除去掉。
- 逐个调用点（行号以 `origin/master` `bc240eb2` 为准）：

  | 调用点 | 改前 | 改后 / 作品根从哪来 | 「文件不存在」怎么认 |
  |---|---|---|---|
  | `components/app/useBookBreakdown.ts:244` 拆书写法放进 写法/ | `readFile(path)` | `readProjectFile(activeProject, path)`；hook 的 `activeProject`（函数开头已判空） | 不特判，报错进「放进 写法/ 失败」弹窗（文字由系统原话变成「作品文件不存在: …」） |
  | `components/app/useBookProfile.ts:76` `readTextOrNull` | `readFile(path)` | `readProjectFile(projectPath, path)`；加参数，两处调用传 `activeProject` | 靠正则 `/…不存在…/`，命中宿主的「作品文件不存在」→ null；「路径不在当前作品内」不含「不存在」，照常报错（两条都加了测试） |
  | `components/app/useBookProfile.ts:99` `readTextOrEmpty(…, false)` | `readFile(path)` | 同上；`scanOutline(projectPath)` 把自己的 `projectPath` 传下去 | 不允许缺失，报错进 `outlineError`（没变）；文件来自 `buildProjectIndex` |
  | `components/editor/useEditorFileLoader.ts:114` 打开文件 | `readFile(filePath)` | `readProjectFile(projectPathRef.current, filePath)`；新加 `projectPathRef` 参数，Editor 传自己已有的 `projectPathRef`（每次渲染在更早的 layout effect 里同步 `projectPath` 属性 = `workspace.activeProject`）。用 ref 不用值，避免把作品路径加进加载 effect 的依赖、改变重载时机 | 先 `pathExists`，不存在按空的新文件打开（没变）；文件在但没打开作品时报「没有打开作品，读不了文件：…」（界面里没有不开作品单开文件的入口） |
  | `lib/branches.ts:115` 分支清单 | `readFile(path)` | `readProjectFile(projectPath, path)`；函数参数（已判空） | 任何读错都回退默认清单（没变） |
  | `lib/canon-merge.ts:121` 读 canon.json | `readFile(path)` | `readProjectFile(projectPath, path)`；函数参数 | 先 `pathExists`（没变） |
  | `lib/canon-write.ts:63` 撤销 canon 写入 | `readFile(before.path)` | `readProjectFile(projectPath, before.path)`；函数参数 | 先 `pathExists`（没变） |
  | `lib/fact-write.ts:44` `readLedger` | `readFile(path)` | `readProjectFile(projectPath, path)`；加参数，11 处调用都已有 `projectPath` | 先 `pathExists`（没变） |
  | `lib/manuscript-stats.ts:27` 全书字数 | `readFile(draft.path)` | `readProjectFile(projectPath, draft.path)`；函数参数 | 读错计入 `unreadable`（没变）；文件来自 `buildProjectIndex` |
  | `lib/versions.ts:103` `readLineage` | `readFile(…lineage)` | `readProjectFile(projectPath, …)`；函数参数 | 任何读错回 `[]`（没变，平常就没有这个文件） |
  | `lib/versions.ts:437` `readMetadata` | `readFile(path)` | `readProjectFile(projectPath, path)`；`listVersions` → `readVersionDir` → `readLegacyEntry` / `readTreeEntry` 一路加参数传下来 | 任何读错回 `{}`（没变） |
  | `lib/versions.ts:498` `readVersionState` 旧式版本文件 | `readFile(entry.contentRef.path)` | `readProjectFile(projectPath, …)`；函数参数 | 路径来自列版本目录，报错照旧上抛 |

  - 浏览器替身：`readProjectFile` 在有 `window.__STORYFORGE_MOCK_FS__` 时走 `mock.readFile(path)`，与原 `readFile` 同一条，三个浏览器回归的 fixture 不受影响；`tests/support/`、`scripts/http-doubles-plugin.mjs` 里没有对 `read_file` 的模拟（grep 过）。
  - 测试替身跟着改：`idea-notes-undo`、`use-book-profile-errors`、`versions-checkpoint`（替身顺带校验路径在传入的作品根下）、`project-library-restore-app`（`spyOn` 目标）、`editor-file-loader`（Harness 传 `projectPathRef`）。
- 刻意没动：`read_project_file_base64` 早已调用公共函数，本刀不碰；`apps/desktop/STATUS.md` 里 2026-06 的历史清单仍写着 `read_file`（文首已标注历史时点，不改历史文档）。
- 行为上的副作用（有意的）：作品内指向作品外的 symlink，以前经 `read_file` 能被字数统计、版本记录读到，现在一律拒读（字数统计计入读不出的文件）。每次读多一次作品根的 canonicalize。

### 验证

- `pnpm lint`：EXIT=0（eslint 0 error，2 条既有 warning 在无关的 `independent-claim-history.test.ts`；prettier 全部通过）。
- `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
- `npm --prefix apps/desktop/frontend run test`（vitest 全套）：269 个文件、2736 passed，EXIT=0。首轮 `project-library-restore-app.test.tsx` 9 条红——它 `spyOn(TauriFileSystem, 'readFile')`，方法删了；改 `spyOn` 目标后单跑 9 passed，再跑全套绿。
- `pnpm --filter @storyforge/engine test`（含 golden）：111 个文件、14251 passed / 2 skipped，EXIT=0；引擎与 golden 没改，`git status --short packages/` 为空。
- Rust：`npm --prefix apps/desktop/frontend run build` EXIT=0 后，`CARGO_TARGET_DIR=D:/StoryForge/apps/desktop/src-tauri/target cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`：208 passed / 1 ignored，EXIT=0。新加 4 条：作品根本身不能读、作品内不存在（含 `.storyforge/` 还没建的两级）报「作品文件不存在」、作品外不存在的路径报「路径不在当前作品内」且不含「不存在」、symlink 目录后面的不存在路径被拒；原来用 `read_file` 的 4 处测试改用 `read_project_file`，两条旧测试的拒绝文字改成「路径不在当前作品内」。
  - 本机没有建 symlink 的权限（`mklink` 报权限不足），既有与新加的 symlink 用例按原写法建链失败即提前返回，**在本机是空过**。
  - 仓库没有 `cargo fmt` / `clippy` 的脚本或 CI 步骤（`apps/desktop/package.json` 只有 `test:rust`），本刀没跑。
- 变异验证（每次都用带 `assert count==1` 的定点替换改回，改回后文件 sha256 与改前一致）：
  1. Rust 去掉「不存在」分支里的父目录围栏 → `read_project_file_fences_missing_external_paths_before_reporting_missing` 红（1 failed / 7 passed）。
  2. Rust 把读取的 `allow_root` 改成 true → `read_project_file_rejects_project_root_itself` 红。
  3. 前端 `TauriFileSystem` 里加回 `readFile` 并调 `'read_file'` → `tauri-fs.test.ts` 新守护用例红（`Reflect.has` 那条断言）。
  4. 前端只在 `tauri-fs.ts` 加一个调 `'read_file'` 的模块级函数、不加方法 → 同一用例红，报出 `lib\tauri-fs.ts`（源码扫描那条断言）。
  5. `useBookProfile` 正则去掉「不存在」→ 新用例「宿主报「作品文件不存在」…」红。
  6. `versions.ts` 读元数据时传错作品根 → `versions-checkpoint.test.ts` 7 条红。
- 未覆盖：
  - **真宿主未点穿**：没有在装机版 / 开发版窗口里打开作品实际走一遍（打开章节、作品总览档案还没建、版本记录、分支画布、拆书放写法、事实台账记账与撤销）。Rust 端只有单测，前端只有替身。
  - **没跑 Tauri 冒烟**（D 盘只剩约 5 GB，开发档 / 发行版冒烟都要从头编几个 GB）。
  - 本地没跑三个浏览器回归（本机有别的会话在跑 headless Chrome，会互相拖超时），以 CI `Windows Verify` 的 `pnpm verify` 为准。
  - symlink 相关 Rust 用例在本机空过（见上）。
