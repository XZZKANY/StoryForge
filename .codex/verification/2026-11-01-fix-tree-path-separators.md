## 2026-11-01 文件树的文件夹路径跟作品根用同一种分隔符；旧存档里的混合写法读出时换成新写法

从 `origin/master`（`1a6477eb`）开；推送前 #561 合进了 master，本地提交还没推过，直接 rebase 到 `f5bc3df8`。#561 的十二个 chat-window 文件和七个测试文件一个没动（rebase 后 `display-utils.ts` 里已没有 `${a}/${b}`，新守护的豁免表跟着去掉它，剩 6 个）。`packages/` 零改动。

### 先摸清：树节点路径流到哪、怎么比

| 去处 | 路径从哪来 | 怎么比 | 比前规范化 |
| --- | --- | --- | --- |
| 宿主 `list_project_dir` | 照传进去的路径往下走，子项用系统分隔符接（Windows 是 `\`） | — | 传进去是什么写法，条目前缀就是什么写法；作品根是 `D:\连载\末世吞噬` 时条目全是 `\`。只有传进去的路径本身混合（以前文件树的文件夹节点）才会列出混合条目 |
| 文件树文件节点 | 宿主条目 `entry.path` | 高亮 `node.path === currentFile`、预览 `=== previewFile` | 无 |
| 文件树文件夹节点（本刀改） | 以前 `${根}/${段}` 一律 `/`；反斜杠作品下是 `D:\连载\末世吞噬/正文` | 交给新建文件 / 新建文件夹 / 改名 / 移动 / 删除 / 在资源管理器中显示 | — |
| 文件夹动作 `useFileTreeActions` | `joinPath(文件夹, 名字)`（分隔符跟 base 走：混合的 base 拼出 `D:\连载\末世吞噬/正文\第004章.md`）→ `openFile` | 移动的候选 `dir !== from` 精确比；改名 / 移动 / 删除后换页签用 `isSameOrInsidePath`（不分分隔符、分大小写） | 部分 |
| 页签 `useEditorWorkspaceTabs`（`openFiles` / `previewFile` / `currentFile` / `dirtyFiles`）、编辑器模型缓存 | 各入口给的路径原样 | `includes`、`===`、`Set` / `Map` 键 | 无 |
| 会话存档 `lib/workspace-session.ts`（localStorage `storyforge:workspace-session`） | 页签原样存：`openFiles`、`activeFile`、`cursors` 的键 | 恢复时宿主查存在（不分分隔符）后按原样铺回页签 | 无（本刀改为读出时换写法） |
| 最近文件 | 没有这个列表；只有最近作品（存作品根，来自选文件夹 / 新建作品，不经文件树） | 作品根原样当各种按作品存的键（权限档、思考等级、日更进度、隐藏会话、已处理观测、驳回提案、固定参考） | 不涉及文件路径；固定参考存的是 posix 相对路径并已规范化 |
| 版本记录、分支清单 `versions.ts` / `branches.ts` | `relativePathInsideProject` 算相对路径当目录名，改名谱系存相对路径 | — | 有（两种分隔符都认） |
| 写入回执 | 宿主按真实相对路径（`\`→`/`，Windows 小写）算操作 id；浏览器替身按 `relativePathInsideProject`；闭环审计 `file` 存相对路径 | — | 有 |
| 新稿日志 `.storyforge/pending-suggestions/<sha256(相对路径)>.json` | 文件名按相对路径（不分写法）；内容存绝对的 `proposal.filePath` 与 `requests[].request.path` | 读出时与调用方给的路径**精确**比，不等就报「待确认修订的恢复信息损坏」 | 无（本刀改为读出时换写法再比） |
| 观测镜 / 手稿视图 / 作品总览章节 / 大纲 / 拆书报告 | 引擎给的相对路径经 `joinPath` 或 `resolveProjectRelativePath` 拼（都跟作品根的分隔符） | `displayedFile !== 路径` 精确比 | 拼出来就是作品根写法 |
| 命令面板、项目搜索、作品索引 | 宿主列作品根的条目 | 打开时原样传 | — |
| 发给引擎 | `current_file` = 当前页签；上下文 = 作品索引的条目路径；`@` 点名是相对路径 | 引擎按作品根解析（Windows 下统一大小写与分隔符） | 引擎侧有 |
| 引擎回来的补丁路径 | `nativeProjectPath`：Windows 把根和相对路径都换成 `\`，posix 用 `/` | 补丁到达 / 上下文点开（`useProjectCommands`）先 `replace(/\\/g,'/')` 比，再 `openFile(原路径)`；批量写章页签用 `normalizePathForMatch` | 有（各自一套） |
| `TauriFileSystem.listProjectDir` 缓存 | 键按 `\`→`/` 加小写规范化 | 混合写法与新写法共用一份缓存，谁先列谁的写法留在缓存里 | 有 |

### 改动

1. **文件树**：`lib/project/tree.ts` 的文件夹节点改用 `joinPath(currentPath, segment)`，起点是作品根原样（不是去掉末尾分隔符的版本，盘符根 `D:\` 才拼得出 `D:\正文`）。反斜杠作品下文件夹节点 = 宿主列出的文件夹条目，逐字一致；正斜杠作品不变。文件节点仍用宿主条目。
   - 宿主条目本身不混：作品根来自选文件夹 / 新建作品（系统分隔符），列作品根得到的条目与根同一种分隔符。混合条目只出现在「列一个混合写法的文件夹」时，那个文件夹路径就是以前的文件夹节点；本刀之后不再产生，所以没有在 `listProjectDir` 封装里另做一层改写。
2. **兼容旧存档（选「读出时换成新写法」，一处函数）**：`lib/fs-path-ops.ts` 新增 `withProjectSeparator(作品根, 路径)`：作品里的路径（根部分只按分隔符比、不分大小写不改大小写）把根后面的部分用作品根的分隔符重拼（就是 `joinPath(作品根, 余下部分)`）；作品外、只是前缀相同的兄弟目录、相对路径原样返回。用在两个读存档的地方：
   - `parseWorkspaceSession`：`openFiles`、`activeFile`、`cursors` 的键都过一遍；同一个文件存了两种写法（旧版会开出两个页签）就并成一个，顺序照第一次出现；两份光标留当时活动页签那份。
   - `suggestion-recovery.ts` 的 `decodeDescriptor`（加 `project` 参数，五个调用都在作品上下文里）：存的 `proposal.filePath` / `request.path` 与调用方给的路径都换成作品根写法再比，返回的描述里也是新写法。宿主与替身的回执 id 按相对路径算，换写法不影响认回执；下一次写这份日志时自然存成新写法（不做批量迁移）。
   - 其余存档不用动：版本、分支、回执、闭环审计都按相对路径；按作品存的 localStorage 键用的是作品根，不经文件树。
3. **守护**（`source-standards` +1）：src 里 `${a}/${b}` 只许出现在豁免表的 6 个文件（计数 / key 的显示、两处作品内相对路径再交 `resolveProjectRelativePath`），豁免里的写法没了要从表里删；`tree.ts` 里必须是 `joinPath(currentPath, segment)`、不许出现引号包着的 `'/'`。

### 顺带修掉的现象（都是文件夹节点混合写法引起的）

- 反斜杠作品里从文件夹的「新建文件」建的章，页签路径是 `D:\连载\末世吞噬/正文\第004章.md`，刷新后文件树里是 `\` 写法：树上不高亮，再从树上点会开第二个页签（两份模型、两份未保存标记）；在这个页签上起的修订，新稿日志也存成混合写法。
- 二级以下的文件夹「移动到…」时，候选里会出现它现在所在的文件夹（`dir !== from` 精确比，`from` 是混合写法）。
- 删除文件夹前留底时列的是混合路径，留底与快照里的路径也是混合写法（落到的还是同一批文件）。

### 看到但没动（记下来）

- **引擎**：`kernel/fsTools.ts::nativeProjectPath` 在 Windows 下把作品根里的 `/` 也换成 `\`，前端 `joinPath` 保留作品根原样。作品根是系统分隔符时两边逐字一致；作品根写成 `D:/书` 时（选文件夹拿不到这种写法；行间续写浏览器回归的替身作品 `D:/browser-fiction/A` 是这种，但它走 Ctrl+K 接口，路径是前端自己的）引擎补丁路径会与页签对不上。`kernel/writingContext.ts` 另有一个引擎内部的 `joinPath`。本刀不改引擎。
- 同样在作品根是 `D:/书` 的 Windows 上：宿主条目是 `D:/书\正文\a.md`，文件夹节点是 `D:/书/正文`，仍不一致。要统一得在 `listProjectDir` 封装里按作品根改写条目，选文件夹拿不到这种根，没做。
- 已有的「比较时规范化」各管各的、都不是为旧存档：`useProjectCommands` 两处 `replace(/\\/g,'/')`（引擎补丁 / 上下文点开），批量写章与新稿日志文件名的 `normalizePathForMatch`，改名移动删除的 `isSameOrInsidePath`，`listProjectDir` 缓存键。本刀没收它们。
- `writeback-receipt-fixture.ts` 的回执替身路径一律 `/`（上一刀已记），没有 `${a}/${b}` 形状，新守护也不管。
- `.storyforge/notes` 里驳回补丁留的旁注正文写着绝对路径（只给人看，不回读）。

- 验证：
  - `pnpm lint`：EXIT=0，0 error，2 warning 都在没动过的 `tests/independent-claim-history.test.ts`（原有），0 新 warning；prettier 全过。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，274 个文件，2832 passed（新增 10 条；rebase 前在 `1a6477eb` 上是 273 个文件 2826 passed）。
  - `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14275 passed / 2 skipped（rebase 前 14271）；`packages/` 对 `origin/master` 无差异，golden 零变化。
  - 新测试（+10，没有新文件）：
    - `behavior/fs-path-ops` +5：`withProjectSeparator` 混合写法换成根的写法、已是新写法原样、盘符根 / UNC / posix 根、作品外 / 前缀相同的兄弟目录 / 相对路径原样、只换分隔符不改大小写。
    - `resource-explorer` +1：反斜杠作品、下层文件夹条目先于上层出现时，文件夹节点与宿主条目逐字一致，整棵树没有 `/`；盘符根作品。
    - `resource-explorer-new-entry` +1：反斜杠作品的文件夹行 `data-folder-path`、「新建文件」、右键「移动到…」拿到的都是宿主那条路径。
    - `workspace-session` +1：旧存档 `[混合, 大纲, 新写法]` 读出为 `[新写法, 大纲]`，`activeFile` 换成新写法，光标留活动页签那份；与 `buildProjectTree` 的文件节点是同一个路径，`openEditorFile` 不多开页签。
    - `pending-new-file-tabs` +1（作品根 `D:\连载\末世吞噬`，宿主替身两种分隔符都认）：旧存档里同一章两种写法 + 混合写法的新稿日志 → 恢复后页签是 `[第001章, 第003章]` 各一个、都是新写法；从文件树点第001章不另开页签、不进预览；用树节点路径标未保存，标记落在同一个页签上；`loadPendingSuggestion(作品, 新写法)` 认出旧日志、不报损坏。
    - `source-standards` +1：上面第 3 条守护。
  - 变异验证（脚本 `C:\Users\kanye\sf-unify\scratch\fix-tree-path-separators\mutate.py`：逐条定点改 → 跑对应测试 → 按原字节无条件还原并核对 sha256 → 再跑；跑完 `git status` 与跑前一致。rebase 前后各跑一遍，结果相同）：

| 打在哪 | 跑的测试 | 变异后 | 还原后 |
| --- | --- | --- | --- |
| `tree.ts` 换回 `${currentPath}/${segment}`、起点换回去掉末尾分隔符的根 | `source-standards`、`resource-explorer`、`resource-explorer-new-entry`、`workspace-session`、`pending-new-file-tabs` | 红 3 条（树节点、文件夹行动作、守护） | 51 passed |
| 会话读出时不换写法 | `workspace-session`、`pending-new-file-tabs` | 红 2 条（两条兼容测试） | 23 passed |
| 新稿日志读出时不换写法、精确比 | `pending-new-file-tabs`、`suggestion-writeback-lifecycle` | 红 1 条（新稿按混合写法挂回、日志报损坏） | 131 passed |
| `withProjectSeparator` 不排除前缀相同的兄弟目录 | `behavior/fs-path-ops` | 红 1 条 | 16 passed |

  - 行尾：改过的 10 个文件原来都是 LF，改后仍全 LF，无 CRCRLF；`git diff --numstat` 与 `--ignore-all-space --numstat` 完全一致。
- 未覆盖：
  - 本地未跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），以 CI 为准。三处替身作品的写法：浏览器冒烟是 `mkdtemp(tmpdir())`（CI 的 Windows 上是反斜杠），`listDir` 返回空，文件树不出节点；Agent 对话也是 `mkdtemp`，替身文件夹条目写成 `${作品}\正文`，Windows 上与新文件夹节点逐字一致，脚本不点文件夹；行间续写是 `D:/browser-fiction/A`（正斜杠），不渲染文件树。
  - 没在装机版上用作者的旧 localStorage 与旧新稿日志点过；兼容只在 happy-dom 与宿主替身上验。
  - 没跑 Rust 测试与 Tauri 冒烟（本刀没动宿主与引擎，传给宿主的路径只是分隔符变了，宿主两种都认）。
