## 2026-10-31 列目录、查文件在不在也只留检查作品边界的口子（删宿主的 `list_dir` / `path_exists`）

- 改动：作者要求「同一件事只留一种做法」。上一刀（#562）让读作品文件只走带围栏的 `read_project_file`，但同文件里列目录 `list_dir(path, recursive)`、查存在 `path_exists(path)` 仍然**不查是否在作品内**，前端 45 处调用（不含 `tauri-fs.ts` 自己的 1 处）都直接传绝对路径。本刀：
  - Rust（`apps/desktop/src-tauri/src/fs.rs`、`main.rs`）：删掉 `list_dir`、`path_exists` 命令与注册，换成三条：
    - `list_project_dir(project_root, path, recursive)`：走同文件的 `canonical_project_root` + 公共 `ensure_canonical_path_inside_project`（写入各路同一套），**作品根本身可以列**；作品外的路径、经 symlink 指到作品外的目录报「路径不在当前作品内」；作品内不存在的目录照旧报「路径不存在」、是文件照旧报「路径不是目录」。遍历照传进来的路径走（不是 canonicalize 后的真实路径），返回给界面的条目路径写法不变（Windows 上 canonicalize 会加长路径前缀）；递归跳过 `.git` / `node_modules`、不跟 symlink 条目、目录在前排序，都没动。
    - `project_path_exists(project_root, path) -> Result<bool>`：作品内（含作品根）存在回 true、不存在回 false；**作品外的路径报错而不是回 false**，免得拿它探作品外有没有某个文件。
    - `project_folder_exists(path) -> bool`：B 类专用，只回答「是不是一个现存的绝对路径文件夹」，不看里面有什么、不跟作品根比。
    - 两个作品内命令共用新加的 `resolve_inside_project`：存在就校验真实路径在作品内；`NotFound` 时先把最近一级存在的父目录解析成真实路径、确认在作品内（与上一刀 `read_project_file`、写入前 `validate_pending_mutation_path` 同一套），再回「不存在」——作品外不存在的路径照样报「路径不在当前作品内」。
    - `fs_engine_reader.rs` 文首注释里的 `list_dir` 改成 `list_project_dir`（只改注释）。
  - 前端（`apps/desktop/frontend/src/lib/tauri-fs.ts`）：删掉 `TauriFileSystem.listDir` / `pathExists`，换成 `listProjectDir(projectRoot, path, recursive)`、`projectPathExists(projectRoot, path)`、`projectFolderExists(path)`。方法改了名而不是只加参数：测试里大量 `mockImplementation(async (path) => …)`，只加参数会让旧桩把作品根当路径、悄悄错位；改名后旧桩一律当场报错。目录列表缓存键加上作品根（同一路径换个作品根，宿主的围栏结论可能不同）；失效仍按路径匹配。浏览器替身 `window.__STORYFORGE_MOCK_FS__` 的 `listDir` / `pathExists` 键名不变，三个浏览器回归的 fixture 不受影响。
- 逐个调用点（行号以上一刀 `origin/fix/host-read-file-fence` `8045bd5a` 为准；A = 路径在已打开的作品内，B = 天然在作品之外）：

  | 调用点 | 改前 | 改后 | 类 | 作品根从哪来 | 出错 / 不存在怎么处理 |
  |---|---|---|---|---|---|
  | `components/app/useFileTreeActions.ts:75` 新建文件挑默认名 | `listDir(dir).catch(() => [])` | `listProjectDir(activeProject, dir).catch(() => [])` | A | hook 的 `activeProject`（上一行判空） | 吞错只影响默认文件名；随后 `insideProject` 字符串检查、`projectPathExists`、写入围栏都会把真问题报出来 |
  | 同上 `:91` 新建文件前查重名 | `pathExists(target)` | `projectPathExists(activeProject, target)` | A | 同上 | 进「新建文件失败」弹窗（没变） |
  | 同上 `:164` 重命名查重名 | `pathExists(target)` | `projectPathExists(activeProject, target)` | A | 同上 | 进「重命名失败」弹窗（没变） |
  | 同上 `:185` 移动：列可选文件夹 | `listDir(project, true)` | `listProjectDir(project, project, true)` | A | 作品根本身 | 进「移动失败」弹窗（没变） |
  | 同上 `:222` 移动查重名 | `pathExists(target)` | `projectPathExists(project, target)` | A | `project` | 同上 |
  | 同上 `:239` 撤销移动查原位置 | `pathExists(path)` | `projectPathExists(project, path)` | A | 闭包里的 `project` | 进错误 toast（没变） |
  | 同上 `:261` 复制挑默认名 | `listDir(dir).catch(() => [])` | `listProjectDir(project, dir).catch(() => [])` | A | `project` | 同 `:75` |
  | 同上 `:287` 复制查重名 | `pathExists(target)` | `projectPathExists(project, target)` | A | `project` | 进「复制失败」弹窗（没变） |
  | 同上 `:384` 删除前备份（列文件夹） | `listDir(path, true)` | `listProjectDir(project, path, true)` | A | `collectDeleteBackup` 的参数 | 进「删除失败」弹窗、不删（没变） |
  | 同上 `:416` 撤销删除查同名 | `pathExists(file.path)` | `projectPathExists(project, file.path)` | A | `restoreDeleted` 的参数 | 进「恢复失败」toast（没变） |
  | 同上 `:447` 改名后带走版本记录 | `listDir(to, true)` | `listProjectDir(project, to, true)` | A | `carryVersionHistory` 的参数 | 进「版本记录没能跟过去」toast（没变） |
  | `components/app/useProjectSearch.ts:54` 全书搜索 | `listDir(projectPath, true)` | `listProjectDir(projectPath, projectPath, true)` | A | 作品根本身 | 进搜索错误状态（没变） |
  | `components/CommandPalette.tsx:192` 命令面板文件列表 | 同上 | 同上 | A | 作品根本身 | 进错误状态 + 重试（没变） |
  | `components/ResourceExplorer.tsx:79` 文件树 | 同上 | 同上 | A | 作品根本身 | 显示错误（没变） |
  | `lib/project/index.ts:93` `buildProjectIndex` | 同上 | 同上 | A | 作品根本身 | 上抛（没变） |
  | `components/app/useProjectWorkspace.ts:16` 启动时过滤「最近作品」里已不存在的 | `pathExists(path)` | `projectFolderExists(path)` | **B** | 无：查的就是作品文件夹本身 | 出错保守保留（没变）；路径还在但已经不是文件夹的，现在也算不在 |
  | `components/app/useSessionRestore.ts:81` 恢复上次现场前查作品还在不在 | `pathExists(session.project)` | `projectFolderExists(session.project)` | **B** | 无：同上 | 出错走「无法验证」（没变） |
  | 同上 `:87` 恢复现场时逐个查页签文件 | `pathExists(path)` | `projectPathExists(session.project, path)` | A | 存档里的 `session.project` | 出错保留页签（没变，见「行为上的变化」） |
  | `components/chat-window/PluginsBlock.tsx:60` 插件启用文件目录 | `pathExists(dir)` | `projectPathExists(projectRoot, dir)` | A | 函数参数 | 上抛（没变） |
  | `components/chat-window/useAgentInstructions.ts:22` 新建长期规矩 | `pathExists(file)` | `projectPathExists(projectRoot, file)` | A | 函数参数 | 上抛（没变） |
  | `components/chat-window/useConversationSkills.ts:43` 新建技能 | `pathExists(file)` | `projectPathExists(projectRoot, file)` | A | 函数参数 | 上抛（没变） |
  | `components/editor/useEditorFileLoader.ts:111` 打开文件前查在不在 | `pathExists(filePath)` | `projectPathExists(projectPathRef.current, filePath)` | A | 上一刀加的 `projectPathRef` | 查不了按「在」处理、交给 `readProjectFile` 报真错（没变）；没打开作品时不查（见下） |
  | `components/editor/useSuggestionWriteback.ts:1038` 撤销新建后要不要摘页签 | `pathExists(path)` | `projectPathExists(projectRoot, path)` | A | 本次动作开头锁定的 `projectRoot` | 没变 |
  | 同上 `:1634` 拒绝 / 存旁注后要不要摘空页签 | `pathExists(suggestion.filePath)` | `projectPathExists(project, …)` | A | 在第一个 await 前和预览身份一起锁定的 `projectPathRef.current` | 没打开作品时不摘（见下） |
  | `components/Editor.tsx:919` 版本恢复删文件后要不要摘页签 | `pathExists(path)` | `projectPathExists(project, path)` | A | 本次恢复锁定的 `project` | 没变 |
  | `lib/canon-merge.ts:118` 读 canon.json 前 | `pathExists(path)` | `projectPathExists(projectPath, path)` | A | 函数参数 | 没变 |
  | `lib/canon-write.ts:62` 撤销 canon 写入 | `pathExists(before.path)` | `projectPathExists(projectPath, …)` | A | 函数参数 | 没变 |
  | `lib/fact-write.ts:44` `readLedger` | `pathExists(path)` | `projectPathExists(projectPath, path)` | A | 函数参数 | 没变 |
  | `lib/project/knowledge-writeback.ts:106` 知识写回读盘面 | `pathExists(patch.file_path)` | `projectPathExists(projectRoot, …)` | A | 函数参数 | 没变 |
  | `lib/project/create.ts:45` 新建空白作品前查目标目录 | `pathExists(projectPath)` | `projectPathExists(parentPath, projectPath)` | A（根 = 所选保存位置） | 紧接着的 `createDir(parentPath, projectPath, false)` 本来就拿所选保存位置当根，查存在用同一个根 | 没变：目标处已有文件或文件夹都报「目标目录已存在」 |
  | `lib/project/initialize.ts:85` 补骨架时 README | `pathExists(readmePath)` | `projectPathExists(projectPath, …)` | A | 函数参数 | 没变 |
  | 同上 `:92` `writeIfMissing` | `pathExists(path)` | `projectPathExists(projectPath, path)` | A | 函数参数 | 没变 |
  | 同上 `:134`、`:137` 发送即开书挑不重名的书名 | `pathExists(base / candidate)` | `projectPathExists(parentPath, …)` | A（根 = 书库目录） | 调用方刚 `createDir(docs, booksRoot)` 建好书库目录，随后 `createDir(booksRoot, projectPath)` 也拿它当根 | 没变 |
  | `lib/suggestion-recovery.ts:48` 读待确认提案日志 | `pathExists(path)` | `projectPathExists(project, path)` | A | 函数参数 | 没变 |
  | 同上 `:179`、`:181` 列待确认新建文件的日志目录 | `pathExists(dir)` + `listDir(dir)` | `projectPathExists(project, dir)` + `listProjectDir(project, dir)` | A | 函数参数 | 上抛，调用方 `useEditorWorkspaceTabs` 整体 `.catch(() => undefined)`（没变） |
  | 同上 `:194` 日志里的目标文件还在不在 | `pathExists(file)` | `projectPathExists(project, file)` | A | 函数参数 | 在 try 里，出错跳过这份日志（没变；日志里写着作品外路径的现在也是跳过） |
  | 同上 `:303`、`:384` 写入审计还在不在 | `pathExists(path)` | `projectPathExists(project, …)` | A | 函数参数 | 没变 |
  | `lib/versions.ts:145` `targetFileExists`（写前快照判断「新建」） | `pathExists(filePath)` | `projectPathExists(projectPath, filePath)` | A | 新加参数，唯一调用方 `snapshotBeforeWrite` 已判空 | 出错保守当成「已存在」（没变） |
  | 同上 `:329` `readVersionDir` | `listDir(dir).catch(() => [])` | `listProjectDir(projectPath, dir).catch(() => [])` | A | 函数参数 | 见下「吞错」 |
  | `lib/write-batch-undo.ts:52` 清 canon 派生缓存 | `pathExists(filePath)` | `projectPathExists(projectRoot, filePath)` | A | 函数参数 | 在 try 里吞掉（没变，只是缓存） |
  | 同上 `:62` `stillThere`（批量撤销后确认删掉了） | `pathExists(filePath)` | `projectPathExists(projectRoot, filePath)` | A | 新加参数，唯一调用方有 `projectRoot` | 出错保守当成「还在」、不计入已删（没变） |
  | `lib/writing-skill-adopt.ts:39` 放进 写法/ 查重名 | `pathExists(target)` | `projectPathExists(projectPath, target)` | A | 函数参数 | 没变 |
  | `lib/tauri-fs.ts:259` `readWritebackAudit` | `this.pathExists(path)` | `this.projectPathExists(projectRoot, path)` | A | 方法参数 | 没变 |

  - **B 类的依据**：只有「打开作品之前，核对作品文件夹本身还在不在」这一种——那时还没有作品根可比，要查的正是根本身（`project_path_exists(path, path)` 在文件夹不存在时会因为作品根解析不出而报错，答不了「不存在」）。专用命令只回答「是不是现存的文件夹」，守护测试只许 `useProjectWorkspace.ts`、`useSessionRestore.ts`（和定义它的 `tauri-fs.ts`）用。
  - **原以为是 B、判成 A 的**：`lib/project/create.ts` 新建作品、`initialize.ts` 给新书挑名字。它们查的都是「所选文件夹的直接子目录」，紧接着的 `createDir` 本来就拿那个父文件夹当根走围栏，查存在用同一个根即可，能力比通用的「任意路径存在吗」小得多，也不用再开一个命令。代价：父文件夹本身在点「创建」前被删掉时，报错文字从「无法完成目录创建：…」变成「无法解析作品目录 …」（两者都是失败、都不建目录）。
- 「不存在就跳过」的地方（文件树、搜索、命令面板、版本记录、修订恢复、批量写章撤销）结果不变：作品内不存在仍是 false / 「路径不存在」，作品内存在仍照常列出。**吞错**的几处逐个看过：
  - `useFileTreeActions` 两处 `.catch(() => [])` 只喂默认文件名，后面的存在检查和写入围栏会把真问题报出来。
  - `versions.ts` `readVersionDir` 吞错回 `[]`：平常没有版本目录（还没记过版本）就走这里，以前权限错误等也一样吞。新进来的只有围栏拒绝：一是改名谱系（`lineage`，作者可手改的 JSON）里写着跳出作品的名字——以前会去列作品外的目录，现在拒绝后当成没有，正是想要的；二是 `.storyforge` / `versions` 本身是指到作品外的 symlink——现在版本记录显示为空。没单独区分。
  - `write-batch-undo` `stillThere`、`versions` `targetFileExists` 出错都按「还在」保守处理，围栏拒绝也走这里，不会把没删掉的当成删掉。
  - `useSessionRestore` 页签检查出错保留页签：见下。
- 行为上的变化（有意的）：
  - 作品内指向作品外的 symlink：列目录时以前就不列 symlink 条目（没变）；直接把这种 symlink 当目录列、或查它在不在，现在报「路径不在当前作品内」。
  - `useEditorFileLoader` 没打开作品时不再查在不在，按「在」处理后由 `readProjectFile` 报「没有打开作品，读不了文件」；以前没打开作品、文件又不存在时会按空的新文件打开。界面里没有不开作品单开文件的入口（上一刀已记）。
  - `useSuggestionWriteback` 拒绝 / 存旁注时没打开作品就不摘空页签（以前照查）；提案都绑在作品上，实际走不到。
  - 恢复上次现场：存档里的页签路径若在作品外（只可能是手改 localStorage），以前不存在就摘掉，现在查询报错按「瞬时失败」保留页签，打开时由 `readProjectFile` 报「路径不在当前作品内」。
  - 「最近作品」与恢复现场：路径还在但已经不是文件夹（被换成了同名文件）的，现在算不在。
  - 列目录、查存在每次多一次作品根的 canonicalize。
- 测试替身跟着改：`tauri-fs`（加 4 条，见下）、`writeback-identity` / `writeback-audit-ipc`（invoke 名与参数）、`versions-checkpoint`（替身顺带校验路径在传入的作品根下）、`workspace-project-lifecycle` / `project-library-restore-app` / `pending-new-file-tabs`（作品文件夹与作品内路径分开打桩；`workspace-project-lifecycle` 加了「页签检查带的是存档里的作品根」「只查一次作品文件夹」的断言，`pending-new-file-tabs` 断言列日志目录带的作品根）、`blank-story-project` / `starter-plugin-new-project`（加断言：挑名字用父文件夹当根）、`context-panel-*` / `version-restore-delete-settlement` / `proposal-panel-writeback-integration`（`toHaveBeenCalledWith` 带上作品根），其余只换方法名与桩的参数位置（`editor.test.tsx` 的源码正则同步）。`tests/support/`、`scripts/http-doubles-plugin.mjs`、浏览器回归脚本里没有对 `list_dir` / `path_exists` 的模拟（grep 过）。
- 刻意没动：`read_project_file` 上一刀的内联写法没改用新的 `resolve_inside_project`（不放根、错误文字不同，不顺手改）；`read_project_file_base64`；引擎自己的 `read_engine_project_directory` 等读口；`apps/desktop/STATUS.md`（2026-06 历史清单）与 `docs/architecture/ts-engine-migration-plan.md`（迁移计划里的端口示意图）里仍写着 `list_dir` / `path_exists`，都是历史文档不改。

### 验证

- `pnpm lint`：EXIT=0（eslint 0 error，2 条既有 warning 在无关的 `independent-claim-history.test.ts`；prettier 全部通过）。
- `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
- `npm --prefix apps/desktop/frontend run test`（vitest 全套）：269 个文件、2740 passed，EXIT=0（上一刀 2736 + 本刀新加 4 条）。首轮 6 个文件 170 条红：它们用 `vi.mock` 整个替换 `TauriFileSystem`，桩对象里还是 `pathExists` / `listDir` 键（`suggestion-writeback-lifecycle`、`behavior/auto-writeback`、`behavior/patch-rejection`、`suggestion-issue-attribution`、`independent-claim-history`、`versions-checkpoint`）；按「`TauriFileSystem: {` 块里还有旧键」扫了全部测试，只有这 6 处，改完单跑 199 passed，再跑全套绿。
- `pnpm --filter @storyforge/engine test`（含 golden）：111 个文件、14251 passed / 2 skipped，EXIT=0；引擎与 golden 没改，`git status --short packages/` 为空。
- Rust：`npm --prefix apps/desktop/frontend run build` EXIT=0 后，`CARGO_TARGET_DIR=D:/StoryForge/apps/desktop/src-tauri/target cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`：213 passed / 1 ignored，EXIT=0，无编译 warning。新加 5 条：作品根可列且作品外（存在 / 不存在）目录被拒、经 symlink 跳出作品的目录被拒、`project_path_exists` 作品根与作品内存在回 true / 作品内不存在（含 `.storyforge/canon/` 还没建的两级）回 false / 作品外（存在 / 不存在）报错且不含「不存在」、经 symlink 跳出作品的文件被拒、`project_folder_exists` 只对现存的绝对路径文件夹回 true；原来用 `list_dir` / `path_exists` 的 8 条测试改用新命令（测试名随之改）。
  - 仓库没有 `cargo fmt` / `clippy` 的脚本或 CI 步骤，本刀没跑。
- 变异验证（每次用带 `assert count==1` 的定点替换打进去、跑完无条件定点改回，改回后文件 sha256 与改前一致）：
  1. Rust `resolve_inside_project` 存在分支去掉围栏（作品外路径被拒）→ `fs::` 2 条红：`list_project_dir_lists_project_root_but_rejects_outside_paths`、`project_path_exists_answers_inside_paths_and_rejects_outside_ones`。
  2. Rust 存在分支 `allow_root` 改 false（作品根可列）→ 6 条红（新加 2 条 + 4 条列作品根的既有用例）。
  3. Rust 不存在分支改成报错（作品内不存在回 false）→ 3 条红（新加 1 条 + 改名 / 删除后查存在的 2 条）。
  4. Rust 不存在分支去掉父目录围栏（作品外不存在的路径也不能借「不存在」被探出来）→ 2 条红（同 1）。
  5. Rust `project_folder_exists` 的 `is_dir` 改 `exists` → `project_folder_exists_only_answers_for_existing_absolute_folders` 红。
  6. 前端 `TauriFileSystem` 加回 `pathExists` 方法并调 `'path_exists'` → `tauri-fs.test.ts`「列目录、查存在只留带作品根的口子」红（`Reflect.has` 那条断言）。
  7. 前端只在 `tauri-fs.ts` 加一个调 `'list_dir'` 的模块级函数、不加方法 → 同一用例红，报出 `lib/tauri-fs.ts`（源码扫描那条断言）。
  8. `lib/project/create.ts` 改用 `projectFolderExists` → 「projectFolderExists 只在打开作品前核对作品文件夹的地方用」红，报出 `lib/project/create.ts`。
  9. 目录列表缓存键去掉作品根 → 「listProjectDir 的缓存按作品根分开」红。
  10. `useSessionRestore` 查页签时把路径当作品根传 → `workspace-project-lifecycle.test.tsx`「同一帧重复选择存档作品只启动一组校验」红（逐条报出作品根应为 `P`）。

- 未覆盖：
  - **真宿主未点穿**：没有在装机版 / 开发版窗口里打开作品实际走一遍（文件树、搜索、命令面板、新建 / 改名 / 移动 / 复制 / 删除与撤销、最近作品过滤、恢复上次现场、新建作品与发送即开书、版本记录、修订恢复、批量写章撤销）。Rust 端只有单测，前端只有替身。
  - **没跑 Tauri 冒烟**（D 盘只剩约 5 GB，开发档 / 发行版冒烟都要从头编几个 GB）。
  - 本地没跑三个浏览器回归（本机有别的会话在跑 headless Chrome，会互相拖超时），以 CI `Windows Verify` 的 `pnpm verify` 为准。
  - 本机没有建 symlink 的权限，symlink 相关 Rust 用例（含本刀新加的两条）建链失败即提前返回，**在本机是空过**。
