## 2026-10-31 前几刀记下的零散重复各留一份：菜单分隔线、设置搜索过滤、选封面图片、删除类菜单项的危险色

开分支时 #579（异步守卫）还没合，按约定从 `origin/refactor/shared-async-guards`（`0b0b208a`）开；PR base 仍是 master。#561 在改的十二个 chat-window 文件和七个测试文件一个没动（这几件事在那些文件里也没有要改的地方）。

- 改动：
  1. **菜单分隔线**：`ui/Menu.tsx` 新增 `MenuSeparator`（`<div role="separator" className="mx-1.5 my-1 h-px bg-border" />`），`ui/index.ts` 导出。原来手写的 5 处全换掉：`EditorTabMenus` 两处、`SidePanel`（作品切换菜单）、`SessionMenu`（会话菜单）、`ContextMenu`（右键菜单）。
  2. **设置搜索过滤**：`settings/search-context.ts` 把 `useSettingsRowVisible` 拆出两个共享件——`useSettingsQuery()`（读搜索词、去首尾空白、转小写）与 `settingsTextMatches(query, text)`（没在搜或文字里有搜索词），`useSettingsRowVisible` 改由这两个组成，语义不变。原来手写 `useContext(SettingsSearchContext).trim().toLowerCase()` 再 `includes` 的 4 处：
     - `AboutRows.tsx` 的更新说明：与设置行同义，直接改用 `useSettingsRowVisible('更新说明', notes)`。
     - `SettingsView.tsx` 的「连接与存储详情」：比对的文字同设置行，但还要拿搜索词决定 `<details>` 是否展开，所以用 `useSettingsQuery` + `settingsTextMatches`。
     - `ModelProfilesSection.tsx`、`PluginsSection.tsx`：按整组关键词串（`SEARCH_TEXT`）命中、不是标题 + 说明，模型服务组还要用搜索词展开「高级」——比对用同一个 `settingsTextMatches`，「拿哪段文字比」「搜索时展开」这两点不同的语义留在调用处。
  3. **选封面图片**：`lib/book-cover.ts` 不再自己动态引 `@tauri-apps/plugin-dialog`，改调 `lib/tauri-fs.ts` 的 `pickFile('选择封面图片', [{ name: '图片', extensions: COVER_EXTENSIONS }])`；取消 / 空串照旧返回 null。`book-cover.ts` 还用 `invoke` 调 `read_project_file_base64` / `copy_into_project`，仍引 `@tauri-apps`，所以**留在宿主白名单里**（白名单双向核对照样通过）。整体 mock `tauri-fs` 的测试都不走选封面这条路，**没有改任何既有测试**。
  4. **删除类菜单项的危险色**：模型卡片菜单的「删除」「移除 Key」加 `danger`。口径与盘点见下面「危险色口径」。
- 守护 / 新测试（共 +7 条，新文件 1 个）：
  - `ui-primitives`：①含 `h-px` 又含 `bg-border` 的类名串只出现在 `src/components/ui/Menu.tsx`（两词顺序不限），且 `MenuSeparator` 带 `role="separator"`；②`useContext(SettingsSearchContext)` 只出现在 `settings/search-context.ts`。
  - `source-standards`：`@tauri-apps/plugin-dialog` 只在 `src/lib/tauri-fs.ts` 里引。
  - `settings-async`：模型卡片菜单「编辑」不标危险色，「移除 Key」「删除」标。
  - `settings-plugins`：设置搜索 `ZIP` 留下插件分组（不分大小写）、搜「字号」藏起来——这条路原先没有测试盯着。
  - 新文件 `tests/book-cover.test.ts`（2 条）：只替身宿主（对话框 `open` 与 `invoke`），`book-cover` 与 `tauri-fs` 走真代码——取消不动盘、对话框参数（标题 / 只列 5 种图片扩展名）、复制成 `.storyforge/cover.<扩展名>`、换扩展名删旧封面。**把 `book-cover.ts` 换回起点版本（自己调 plugin-dialog）这 2 条同样通过**，证明改前改后行为一致；换回后按字节还原，sha256 与改后相同。新的插件搜索那条也在 `PluginsSection.tsx` 起点版本上跑过，通过。

### 危险色口径（第 4 条）

规则：**撤销不了的才标危险色**；撤销得了的（挪进回收夹、右下角能撤销、只是从列表里拿掉）照现有多数——**不标**。

盘点（文字或读屏名里有「删除 / 移除 / 清空 / 丢弃」的 MenuItem / Button / 图标按钮；「丢弃」在界面控件里没有出现）：

| 控件 | 撤销得了吗 | 原来 | 现在 |
| --- | --- | --- | --- |
| 模型卡片菜单「删除」 | 不能：删掉这套配置和它存的 Key | 普通 | **危险色** |
| 模型卡片菜单「移除 Key」 | 不能：删掉本机存的 Key，要重填 | 普通 | **危险色** |
| 知识收件箱「拒绝」（不在四个词里，顺带核对） | 不能（确认框写明） | 危险色 | 不变 |
| 插件卡「移除」 | 能：挪进回收夹 | 次要按钮 | 不变 |
| 作品切换菜单「×」从最近打开移除 | 能：文件夹不动 | 普通 | 不变 |
| 作品库「×」从作品库移除 | 能：同上 | 普通 | 不变 |
| 会话菜单「×」从列表移除 | 能：有撤销，记录留在本机 | 普通 | 不变 |
| 速记「×」删除这条 | 能：有撤销 | 普通 | 不变 |
| 题材「×」移除题材 | 能：再加回来 | 普通 | 不变 |
| 搜索框「×」清空搜索 | 不是删数据 | 普通 | 不变 |
| 修订面板「移除并重试」 | 不是删数据：这次重试不带那条知识 | 幽灵按钮 | 不变 |
| 文件树右键「删除文件 / 删除文件夹」 | **不保证**：删前留快照、右下角有撤销，但图片和过大的文件留不了快照（确认框会写「删掉就找不回来」），撤销入口只在内存里 | 危险色 | 不变（见下） |

- 可撤销的 6 项（另有 2 项不是删数据）全部不标危险色，这就是「现有多数」，本刀没有要改到多数口径的可撤销项。
- 文件树删除按「不保证可撤销」归到危险色一边，保留不动。它从 `cfb877c4`（删除还不能撤销时）起就是危险色，#385 加了撤销但没改颜色。**若作者认为它算可撤销、要按多数口径去掉红色，只改 `ResourceExplorer.tsx` 那一项的 `danger: true`**，本刀没替作者定。
- 二次确认框（`AppDialog` 的 `tone: 'danger'`）不在本条范围：删除文件、移除插件、删模型配置、放弃修改等确认框一律是危险色确认键，本刀没动。

### 观感变化

- 模型卡片「…」菜单：「移除 Key」「删除」文字变红、悬停底色变成淡红（与右键菜单的删除一样）。「删除（正在用，先切到别的）」「删除（至少留一套）」这两种不可用的状态，从半透明灰变成半透明红。
- 菜单分隔线外观不变（同一串类名）。页签「…」菜单、作品切换菜单、会话菜单的分隔线多了 `role="separator"`（原来只有右键菜单有），读屏会读出分隔；方向键只在可聚焦的菜单项之间走，键盘行为不变。
- 设置搜索、选封面图片：看不出变化。

- 验证：
  - `pnpm lint`：EXIT=0，0 error，2 warning 都在没动过的 `tests/independent-claim-history.test.ts`（原有），本刀 0 新 warning；prettier 全过。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，273 个文件，2785 passed（起点 272 / 2778；多的 1 个文件是 `book-cover.test.ts`，多的 7 条见上）。
  - `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14267 passed / 2 skipped；`packages/` 零改动，golden 零变化。
  - 变异验证（脚本逐条改一处 → 跑对应测试 → 按原字节无条件还原并核对 sha256；跑完 `git status` 与跑前一致）：

| 打在哪 | 跑的测试 | 变异后 | 还原后 |
| --- | --- | --- | --- |
| `SessionMenu.tsx` 换回手写 `<div className="mx-1.5 my-1 h-px bg-border" />` | `ui-primitives` | 红 1 条（分隔线守护） | 绿 |
| `MenuSeparator` 去掉 `role="separator"` | `ui-primitives` | 红 1 条 | 绿 |
| `AboutRows.tsx` 换回手写 `useContext(SettingsSearchContext)…includes` | `ui-primitives` | 红 1 条（搜索词守护） | 绿 |
| `settingsTextMatches` 恒返回 true | 设置相关 4 个文件 | 红 1 条（`appearance-settings` 的「只留下命中的行」） | 绿 |
| `book-cover.ts` 换回起点版本 | `source-standards` + `book-cover` | 红 1 条（plugin-dialog 守护）；`book-cover` 2 条仍绿（行为一致） | 绿 |
| 模型卡片「删除」去掉 `danger` | `settings-async` | 红 1 条（新加的） | 绿 |
| 模型卡片「移除 Key」去掉 `danger` | `settings-async` | 红 1 条（新加的） | 绿 |
| 模型服务组不再按搜索词隐藏 | `settings-view` / `settings-async` / `settings-accessibility` | 红 1 条 | 绿 |
| 插件分组不再按搜索词隐藏 | `settings-view` + `settings-plugins` | 起初 0 条红（没有测试盯着）→ 补了上面的插件搜索测试后红 1 条 | 绿 |
| 「连接与存储详情」不再按搜索词隐藏 | `settings-view` + `settings-accessibility` | 红 1 条 | 绿 |
| 更新说明不再按搜索词隐藏 | `settings-view` / `app-update` / `settings-accessibility` | 0 条红（见未覆盖） | 绿 |

  - 行尾：改过的文件原为 LF 的仍全 LF，`ui/index.ts` 原为 CRLF 仍全 CRLF（按字节改）；新测试文件随 tests 目录多数用 LF；全部无 CRCRLF、无控制字符。`git diff --numstat` 与 `--ignore-all-space --numstat` 逐文件一致。非 ASCII 字符逐文件比对：只多了新注释与新测试里的中文，没有删掉或换掉任何字符。
- 未覆盖：
  - 本地未跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），以 CI 为准。
  - 更新说明的搜索过滤没有测试盯着（`app-update` 状态是模块级的，单独起一条要动测试结构）；改动是把同一行判断换成 `useSettingsRowVisible('更新说明', notes)`，与设置行逐字同义，靠 `settingsTextMatches` 那条变异间接覆盖。
  - 观感只在 happy-dom 与源码层面核过（类名、role），没截图、没在装机版上点；选封面图片没在真宿主上点过（宿主命令没变）。
  - 没跑 Rust 测试与 Tauri 冒烟（本刀没动宿主与引擎）。

### 注意到的重复（只记不改，留给后面的刀）

- **菜单容器的外观**：`animate-fade-in rounded-lg border border-border bg-surface p-1 shadow-dropdown` 在 `EditorTabMenus` 两处、`SidePanel`、`SessionMenu`、`ModelProfilesSection`（还有禁碰的 `ContextPanel`）各写一份，只差宽度；`ContextMenu` 是磨砂变体（`border-border/60`、`bg-surface/[0.92]`、背景模糊）。可以收成 ui 里的菜单容器（`FloatingSurface role="menu"` + 这段类名，宽度当参数）。
- **「搜索时自动展开」的折叠区**：`SettingsView` 的「连接与存储详情」和 `ModelProfilesSection` 的「高级」都是 `<details open={Boolean(query)}>`，summary 的样式也差不多。
- **`type Confirm`**：`ModelProfilesSection.tsx` 与 `PluginsSection.tsx` 各抄一份同样的确认函数类型，与 `AppDialog` 的 confirm 选项同形，可以从 `AppDialog` 导出一个。
- **悬停才出现的小图标按钮**：`BookNotes` 两处（改 / 删速记）、`BookProfileView` 题材「×」手写同一串 `text-subtle opacity-40 transition-opacity hover:text-foreground hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100`；而 `MenuItemAction` 是从完全隐藏起步、`ProjectLibrary` 是给 `IconButton` 外面包一层 `opacity-0` 的 span——同一件事三种写法。
- **按项目路径的分隔符拼路径**：`x.includes('\\') ? '\\' : '/'` 配 `replace(/[\\/]+$/, '')` 在 `src/` 里 17 个文件共 28 处（`book-cover` 的 `coverAbsolutePath` 就是一处；`project/initialize.ts` 7 处、`suggestion-recovery.ts` 3 处）。`project-core` 的 `joinProjectPath` 带路径围栏、出界返回 null，不能原样替代，要另起一个纯拼接的共享函数。
