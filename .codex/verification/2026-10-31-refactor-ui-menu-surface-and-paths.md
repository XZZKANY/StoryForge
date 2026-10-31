## 2026-10-31 上一刀记下的五处重复各留一份：菜单外框、设置折叠区、确认函数类型、悬停才出现的小操作、按分隔符拼路径

开分支时 #581（`refactor/ui-leftover-duplicates`）还没合，按约定从 `origin/refactor/ui-leftover-duplicates`（`4143993c`）开；PR base 仍是 master。#561 在改的十二个 chat-window 文件和七个测试文件一个没动（`ContextPanel.tsx`、`panels.tsx` 里同样的写法在守护里写明豁免，等 #561 合了再收）。`packages/` 零改动。

- 改动：
  1. **菜单外框**：`ui/Menu.tsx` 新增 `MenuSurface`（`FloatingSurface role="menu"` + 外框类名 `animate-fade-in rounded-lg border p-1 shadow-dropdown`；实底 `border-border bg-surface`，`frosted` 换成 `border-border/60 bg-surface/[0.92]` 加 `blur(40px) saturate(1.5)` 背景模糊），宽度仍由调用方 className 给，`ui/index.ts` 导出。改用的 **6 处**：`EditorTabMenus` 两处（润色、「…」）、`SidePanel`（作品切换）、`SessionMenu`（会话菜单）、`ModelProfilesSection`（模型卡片菜单）、`ContextMenu`（右键菜单，`frosted`）。
     - 没换的浮层：`ChapterCheckHistoryPanel` 与 `ContextPanel` 的「上下文」面板（不是菜单，`role` 默认 dialog，也没有 `p-1`）、`ComposerMenuSelect`（listbox，`rounded-xl p-1.5`）、`SkillCommandMenu`（不是 FloatingSurface，绝对定位）、`Tooltip`、`ToastHost`。外框不同、语义也不是菜单。
  2. **搜索时自动展开的折叠区**：`settings/SettingRows.tsx` 新增 `SettingDetails`（自己读搜索词，搜索时 `open`；summary 统一为 `cursor-pointer rounded-sm py-1 text-xs text-muted hover:text-foreground`）。改用的 **2 处**：`SettingsView` 的「连接与存储详情」、`ModelProfilesSection` 的「高级」（`PolishChoice` 不再收 `open` 参数）。「连接与存储详情」的 `<details>` 本身就是 `text-xs text-muted`，summary 多出的这两个类算出来的样式不变。
  3. **`type Confirm`**：`ModelProfilesSection.tsx`、`PluginsSection.tsx` 各删一份，改用 `AppDialog` 早就导出的 `AppDialogApi['confirm']`（与 `shell-help.ts` 的 `Pick<AppDialogApi, 'alert'>` 同一做法），**2 处**，不再有任何一份抄写。
     - 没换：`chat-window/useChatSessionContext.ts` 的 `SessionLeaveGuard.confirmLeave`（选项里没有 `tone`，是另一种形状，不在本条的两个文件里）。
  4. **悬停才出现的小操作**：`ui/Button.tsx` 新增 `revealOnHover(rest = 'hidden' | 'faint')`，给出显隐类名：`opacity-0`（或 `opacity-40`）`transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100`；`ui/index.ts` 导出。改用的 **7 处**：`MenuItemAction`、`BookNotes` 两处（改 / 删速记，`faint`）、`BookProfileView` 题材 ×（`faint`）、`ObsPanel` 未处理观测项的勾（`faint`，与另三处是同一串手写）、`ProjectLibrary` 移除作品外面那层 span、`ResourceExplorer` 文件夹新建按钮外面那层 span（与作品库同一种写法）。
     - 选哪种：三种写法里只有 `MenuItemAction` 在「键盘焦点落进这一行」时也显出来（`focus-visible` + `group-focus-within`），可达性最好，按它统一。行内那一条改用 `group-has-[:focus-visible]`（行里有键盘焦点）而不是 `group-focus-within`（行里有任何焦点）：鼠标点过按钮、焦点留在行上时不算，否则文件树点开一个文件夹、速记点一下勾，那一行的小按钮会一直亮着。菜单行本身的底色就是 `has-[:focus-visible]:bg-elevated`，两者现在同一个条件。
     - 平时的样子不动：速记、题材、观测项原来平时淡淡露着（`opacity-40`，#395 的设计），用 `faint`；菜单行、作品库、文件树原来平时完全隐藏，用默认 `hidden`。
     - `ProjectLibrary`：`li` 的 `group/row` 改成 `group`（共享类名只认不带名字的 group），里面那张卡片原来的 `group` 改名 `group/card`、箭头跟着改成 `group-hover/card:text-foreground`，悬停箭头的效果不变。
     - 没换：`EditorTabs` 关闭钮里「未保存圆点 ↔ ×」互换（按钮一直在，不是悬停才出现的操作）、`panels.tsx`（#561）。
  5. **按路径分隔符拼路径**：`lib/fs-path-ops.ts` 的 `joinChild(dir, name)` 换成 `joinPath(base, ...parts)`（纯字符串：分隔符跟着 base 走，base 里有 `\` 就用 `\`，否则 `/`；base 只去末尾分隔符、中间不改写；各段按 `\` `/` 拆开、丢空段，再用同一种分隔符接上；不查项目边界）。`joinChild` 的 5 个调用（`useFileTreeActions`）与 `siblingPath` 改调 `joinPath`。放在前端 `lib/`：引擎里同样的写法只有 `kernel/plugins.ts` 一处（外加一份测试辅助），本刀不碰引擎；以后引擎也要用就挪进 project-core。
     - 换掉的 **28 处 / 17 个文件**（`x.includes('\\') ? '\\' : '/'` 认分隔符）：`useBookProfile` 1、`useEditorNavigation` 2、`useSuggestionDismissal` 1、`author-loop` 1（连同它私有的 `separator` / `normalizeRoot` / `projectChildPath` 一起删）、`book-cover` 1、`book-profile` 1、`branches` 1、`canon-merge` 1、`fact-write` 1、`fs-path-ops` 1（`joinChild` 本身）、`idea-notes` 1、`project/create` 2、`project/initialize` 7、`suggestion-recovery` 3、`tauri-fs` 1、`versions` 1（连同私有的 `sep` / `normalizeRoot`，文件里 6 处拼接都改用 `joinPath`）、`writeback-receipt-fixture` 2。`enableStarterPlugin` 原来按分隔符 `lastIndexOf` 切出目录，改用同文件已有的 `parentDir`（结果逐字相同：拼出的文件路径末尾没有分隔符，最后一个分隔符就是新接上的那个）。

### 第 5 条逐处核对：原写法与 joinPath 什么时候一样、什么时候不一样

`tests/behavior/fs-path-ops.vitest.ts` 把两种旧写法原样写成参照函数，在 12 个 base（反斜杠 / 正斜杠 / 末尾带一个或两个分隔符 / 中间混用 / UNC / `D:\` / `/`）× 5 组段上逐字比对：

| 原写法 | 处数 | 与 joinPath 的关系 |
| --- | --- | --- |
| 先去 base 末尾分隔符再拼（`replace(/[\\/]+$/, '')` / `normalizeRoot`） | 20 | 段里没有空段时**任何 base 都逐字一致**（含末尾带分隔符、混合分隔符） |
| 不去末尾直接拼：`create.ts` 建 `.storyforge`、`initialize.ts` 示例三文件 / 种子 `灵感.md` / 档案目录、`branches.ts` 分支清单、`versions.ts` 版本目录下的 lineage / checkpoints / meta | 8 | base 末尾**没有**分隔符时逐字一致（测试里也比对了）；末尾带分隔符时旧写法会拼出双分隔符、新写法不会。这几处的 base 都是 `joinPath` / `blankStoryProjectPath` / `versionDirFor` 刚拼出来的，末尾不会有分隔符 |
| 段里带 `/` 再 `split('/').join(sep)`：`useEditorNavigation` 两处（观测锚点、手稿章节的相对路径）、`initialize` 的项目说明与插件文件、`versions` 的相对路径（原来按 `/` `\` 都拆） | — | 段是干净的相对路径时一致。只有段里有空段（`a//b`、开头或结尾的 `/`），或正斜杠项目的段里出现 `\` 时不一样：旧写法留下双分隔符或反斜杠，新写法收成单个、同一种。这些段来自引擎给的 posix 相对路径、`relativePathInsideProject`、或应用自己写的 lineage，不会长这样 |
| `book-cover` 的封面文件名 | 1 | 来自 `book.json` 的 `cover`，作者手改成带分隔符的名字时旧写法会混用分隔符、新写法统一成 base 那种；Windows 上指同一个文件 |
| `createNewBookProject` 的 `灵感.md` | 1 | 原来用文档目录的分隔符、现在用新书路径的；新书路径 = 文档目录 + `StoryForge` + 不含分隔符的书名，两者有没有 `\` 一定相同 |

所以没有哪一处为了保持原行为而不换。

**看到但没动**（不是「按 base 认分隔符再拼」，换了会改行为）：
- `writeback-receipt-fixture.ts` 第 34 行写入回执的替身路径一律用 `/`，不跟 base 走。
- `project/tree.ts` 给文件树的目录节点拼路径一律用 `/`（反斜杠作品下目录节点的 path 是 `D:\book/正文` 这种混合写法），与文件节点、与 `joinPath` 都不一致；这是现有行为，要不要统一另说。
- `editor-tabs-state.ts` 的 `retargetEditorPath`（改名后换前缀，不是拼接）、`book-profile.ts` 取目录名、`book-cover.ts` 取扩展名：只去末尾分隔符，不拼。

### 观感变化

- 生成的 Tailwind 工具类 CSS（用前端自己的配置，分别扫起点版本与改后的 `src`）逐条比对，只差 3 条：去掉 `group-hover/row:opacity-100`，多出 `group-has-[:focus-visible]:opacity-100` 与 `group-hover/card:text-foreground`。菜单外框、磨砂、设置折叠区的类名都还在生成，类名在元素上的先后变了（宽度类挪到最后），不影响样式。
- 菜单、设置折叠区、确认弹窗：看不出变化。
- 悬停才出现的小操作（只在键盘与焦点上有差别，鼠标悬停的样子不变）：
  - 用键盘把焦点移到速记行的勾、作品库的作品卡、文件树的文件夹、观测项正文上时，同一行的小操作现在也显出来（原来只有焦点落到小操作本身才显）。
  - 改一条速记时输入框在同一行里，输入框聚焦算键盘焦点，那一行的 ✎ ×在编辑期间是实色（原来是淡色）。
  - 菜单用鼠标打开、第一项被程序聚焦时，原来会把那一行的小操作也亮出来（行底色却不亮）；现在两者一致，都不亮，悬停或方向键移过去才出现。
  - 作品库的 ×、文件树的新建按钮：原来用鼠标点过后焦点留在按钮上时会一直显着，现在鼠标移开就隐去（键盘焦点仍会让它显着）。

- 验证：
  - `pnpm lint`：EXIT=0，0 error，2 warning 都在没动过的 `tests/independent-claim-history.test.ts`（原有），本刀 0 新 warning；prettier 全过。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，273 个文件，2797 passed（起点 273 / 2785，多的 12 条见下）。
  - `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14267 passed / 2 skipped；`packages/` 零改动，golden 零变化。
  - 新测试 / 守护（+12 条，没有新文件）：
    - `ui-primitives` +5：①菜单外框（同一串里有 `rounded-lg`、`p-1`、`shadow-dropdown`，不管先后）只写在 `ui/Menu.tsx`，`role="menu"` 只由 `MenuSurface` 声明（`ContextPanel` 豁免）；②`MenuSurface` 渲染：`role="menu"`、外框类名、宽度类、实底 / 磨砂两套类名与背景模糊；③悬停才出现（同一串里 `opacity-0` / `opacity-40` 配 `group-hover:opacity-100`）只经 `revealOnHover`（`EditorTabs`、`panels.tsx` 豁免），并核对 `revealOnHover` 两种起点都带键盘焦点的两个条件；④设置里的 `<details>` 只写在 `SettingRows`，`SettingDetails` 搜索词为空 / 只有空白时收起、有词时展开；⑤`type Confirm =` 不再出现。
    - `source-standards` +1：`.includes('\\') ?` 认分隔符的写法只在 `lib/fs-path-ops.ts`（白名单就这一个文件，即 `joinPath` 本身）。
    - `behavior/fs-path-ops` +6：`joinPath` 正斜杠 / 反斜杠 / UNC、base 末尾带分隔符、段里的分隔符与空段、base 中间混用分隔符原样保留，以及上表的两组旧写法逐字比对。原来的 `joinChild` 用例改名 `joinPath`，断言不变。
  - 变异验证（脚本逐条改一处 → 跑对应测试 → 按原字节无条件还原并核对 sha256 → 再跑一次；跑完 `git status` 与跑前一致，只多了这份记录）：

| 打在哪 | 跑的测试 | 变异后 | 还原后 |
| --- | --- | --- | --- |
| `SessionMenu` 手写回菜单外框类名 | `ui-primitives` | 红 1 条（外框守护） | 绿 |
| `SidePanel` 在 `MenuSurface` 上再写 `role="menu"` | `ui-primitives` | 红 1 条（role 守护） | 绿 |
| `frosted` 换成实底类名 | `ui-primitives` + `context-menu` | 红 2 条（`MenuSurface` 渲染、右键菜单 92% 底色） | 绿 |
| `frosted` 丢了背景模糊 | `ui-primitives` | 红 1 条 | 绿 |
| 速记「改这条」换回手写显隐类名 | `ui-primitives` | 红 1 条（悬停守护） | 绿 |
| `revealOnHover` 去掉 `group-has-[:focus-visible]` | `ui-primitives` | 红 1 条 | 绿 |
| `SettingDetails` 搜索时不展开 | `ui-primitives` + `settings-accessibility` | 红 2 条（新渲染测试、搜索找到技术详情） | 绿 |
| 「连接与存储详情」换回起点的手写 `<details>` | `ui-primitives` + `settings-accessibility` | 红 1 条（`<details>` 守护；行为测试仍绿，说明改前改后行为一致） | 绿 |
| 插件分组再写一份 `type Confirm =` | `ui-primitives` | 红 1 条 | 绿 |
| `idea-notes` 换回手拼分隔符 | `source-standards` | 红 1 条（分隔符守护） | 绿 |
| `joinPath` 不去 base 末尾分隔符 | `fs-path-ops` + `project-context` + `blank-story-project` | 红 7 条 | 绿 |
| `joinPath` 不丢空段 | `fs-path-ops` | 红 1 条 | 绿 |
| `joinPath` 一律用 `/` | `fs-path-ops` + `project-context` + `blank-story-project` | 红 10 条 | 绿 |

  - 非 ASCII 字符逐文件比对（起点 vs 改后）：只有 `fs-path-ops.ts` 少了几个字，是改写的两段注释（「文件树右键操作用的」「在 dir 下拼子项，沿用 dir 的分隔符风格」）；其余文件没有丢字；U+2000–U+206F、U+212A、BOM 这类字符只多了 `ui-primitives` 新注释里的一个省略号「…」，其余都是文件里原有的。
  - 行尾：改过的文件原为 LF 的仍全 LF，原为 CRLF 的（`ui/index.ts`、`author-loop.ts`、`branches.ts`、`tauri-fs.ts`、`versions.ts`、`writeback-receipt-fixture.ts`）仍全 CRLF（按字节改），全部无 CRCRLF、无孤立 CR。`git diff --numstat` 与 `--ignore-all-space --numstat` 只有 `SettingsView.tsx` 不同（summary 包进 fragment 后缩进加深，是真改动）。
- 未覆盖：
  - 本地未跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），以 CI 为准。
  - 观感只在 happy-dom、源码与生成 CSS 层面核过，没截图、没在装机版上点；`group-has-[:focus-visible]` 依赖 WebView2 的 `:has()`（Chromium 105 起支持），没在真宿主上用键盘走一遍。
  - 路径拼接没在真宿主上建过作品、开过示例作品（宿主命令没变，传给宿主的路径在可达输入下逐字不变）。
  - 没跑 Rust 测试与 Tauri 冒烟（本刀没动宿主与引擎）。

## 2026-10-31 合并 origin/master（#578 / #580 / #581 / #582 合入后）

- 改动：PR 与 master 冲突、GitHub 没跑 CI，按要求 `git merge origin/master`（`73f7c46f`），不 rebase、不 force push。三个文件冲突，两边都保留：
  - `lib/tauri-fs.ts`：本分支的 `import { joinPath } from './fs-path-ops'` 与 master 的 `host-file-errors` 四个错误类型 import 并存；master 的 `hostFileFailure` 翻译、`pickDirectory` / `pickFile` 原样保留，`readWritebackAudit` 仍用 `joinPath` 拼审计路径。
  - `lib/writeback-receipt-fixture.ts`：`joinPath` 与 master 的 `DiskDriftError` 两个 import 并存；master 的 `detailKind` 原样保留，两处审计路径仍用 `joinPath`。
  - `tests/source-standards.test.ts`：master 新增的「引擎共享小函数各只定义一次」与本分支的「按 base 认分隔符拼路径只写在 joinPath 里」两个守护都完整保留（master 的在前）。
  - 合并后复查：认分隔符的写法仍只在 `fs-path-ops.ts`；master 新进来的代码里没有新的 `joinChild`、`type Confirm =`、手写菜单外框或悬停显隐写法（全套守护通过）。
- 验证（合并后重跑）：
  - `pnpm lint`：EXIT=0，0 error，2 warning 仍是没动过的 `tests/independent-claim-history.test.ts`（原有），0 新 warning；prettier 全过。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，273 个文件，2815 passed。
  - `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14268 passed / 2 skipped；本分支对 `origin/master` 的 `packages/` diff 为空，golden 零变化。
  - 行尾：冲突的两个 CRLF 文件解决后仍全 CRLF，`source-standards.test.ts` 仍全 LF，无 CRCRLF。
- 未覆盖：同上一段（浏览器回归以 CI 为准；没跑 Rust 测试与 Tauri 冒烟）。
