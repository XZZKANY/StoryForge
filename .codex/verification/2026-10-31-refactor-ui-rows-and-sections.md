## 2026-10-31 设置行、菜单项、左栏分区三处「各写一份」各留一份

开分支时 #572（剩下六个超长组件拆小）还没合，按约定从 `origin/refactor/split-oversize-views`（`b86f580d`）开；PR base 仍是 master。上一刀的验证记录末尾没有「注意到的重复」一节，本刀直接按任务清单逐处比对。#561（对话框小行设计）在改的七个文件一个没动。

### 比对结果与做法

**1. 设置行外壳**

| 原写法 | 位置 | 外壳 | 去处 |
| --- | --- | --- | --- |
| `RowShell` 有 controlId | `SettingRows.tsx`（开关 / 滑块 / 下拉） | `Field` 横排 + `min-h-[76px] px-4 py-3` | 留，即共享外壳 |
| `RowShell` 无 controlId | `SettingRows.tsx`（`ActionRow`）、`AboutRows.tsx` 两行 | 手写 `flex min-h-[76px] items-center gap-4 px-4 py-3` | 改成与 `Field` 横排同一套 `sf-field` 类，见下 |
| `ChoiceRow` | `AppearanceSection.tsx`（模式、强调色两个单选组） | 与上一行逐字相同的手写 flex 外壳 + 自己的 useId | 删，改用 `RowShell`（无 controlId，children 拿到 `labelId` / `descriptionId`） |
| `SelectFieldRow` | `AppearanceSection.tsx`（主题、字体） | 与 `SelectRow` 逐字相同 | 删，改用 `SelectRow` |
| `ColorRow` 外壳 | `AppearanceSection.tsx`（背景、前景） | `Field` 横排 + 同样的 class，说明里拼对比度警告 | 外壳换成 `RowShell`（新增 `note`：接在说明后面、不参与搜索）；取色框、十六进制框、「恢复」按钮只外观用，留在原文件 |

- `RowShell` 现在只有一个外观：有 controlId 时是 `Field`（标题是 `<label>`），没有时输出同一套 `sf-field` / `sf-field-label` / `sf-field-help` / `sf-field-control` 类，只是标题是带 id 的 `<div>`（按钮、单选组、只读值不能靠 `<label>` 命名）。props 用联合类型分开两种 children。
- 搜索过滤：`RowShell` 原来自己写了一遍 `useContext(SettingsSearchContext).trim().toLowerCase()`，与 `search-context.ts` 的 `useSettingsRowVisible` 同义，改成调它。
- 删掉 `RowShell` 的 `descriptionId` 参数（没有调用方传过）和无 controlId 分支里永远走不到的 `<label>` 三元。
- 看过没收的：`ModelProfilesSection` 的「整章润色用」是嵌在「高级」`<details>` 里的 `Field` 横排，不是顶层设置行（套 `RowShell` 会多出一层行高、内边距与搜索过滤），本来就用共享的 `Field`，没动。`ModelProfileEditor` 的竖排 `Field` 与「服务商」单选组是表单字段，`PluginsSection` 没有设置行，都没动。

**2. 菜单项** —— 新建 `components/ui/Menu.tsx`：`MenuItem`（文字、可选图标、快捷键 `shortcut`、次要信息 `hint`、`danger`、`disabled`、当前项 `current` 打 ✓、行尾小操作 `actions`）与 `MenuItemAction`（行尾图标小操作，`label` 进 aria-label，`title` 不给就用 label）。两者都是 `PlainButton` + `role="menuitem"`，不接 className；菜单容器仍是 `FloatingSurface`，方向键 / Home / End / Esc 照旧由它管。

| 原写法 | 位置 | 去处 |
| --- | --- | --- |
| `MenuRow`（文字 + 快捷键） | `shell/EditorTabMenus.tsx`（润色菜单、「…」文件操作） | `MenuItem`（`shortcut`），删 `MenuRow` |
| `MenuRow`（文字 + 禁用） | `settings/ModelProfilesSection.tsx`（模型卡片「…」） | `MenuItem`，删 `MenuRow` |
| 手写 `PlainButton role="menuitem"`（危险 / 禁用） | `shell/ContextMenu.tsx`（文件树右键等） | `MenuItem`（`danger`、`disabled`） |
| 作品行（✓ + 名字）+ 「×」移除，都是手写 menuitem | `shell/SidePanel.tsx`（切换作品） | `MenuItem current` + `actions={<MenuItemAction>}` |
| 「打开本地作品…」（图标 + 文字） | 同上 | `MenuItem icon` |
| 会话行（✓ + 标题 + 时间）+ 改名 / 移除两个图标按钮 | `chat-window/SessionMenu.tsx` | `MenuItem current hint` + 两个 `MenuItemAction`；删 `actionClass` 常量 |
| 「新建会话」（图标 + 文字） | 同上 | `MenuItem icon` |
| 手写 `<button role="menuitem">` | `chat-window/ContextPanel.tsx` | **没动**（#561 在改），守护测试里临时豁免、注明等 #561 |

testid、title、aria-label、onClick 原样透传；各菜单项的 textContent 与原来一字不差（测试按 textContent 找菜单项）。

**3. 左栏分区** —— 三个视图的 `Section` 包装逐个看：

| 视图 | 包装加了什么 | 去处 |
| --- | --- | --- |
| 手稿 `ManuscriptView.tsx` | 只固定 `prefix="manuscript"` | 删包装，3 处直接 `<PanelSection prefix="manuscript">` |
| 作品 `BookProfileView.tsx` | 只固定 `prefix="book"`（默认展开、计数原本就在每处写明） | 删包装，5 处直接 `<PanelSection prefix="book">` |
| 观测镜 `ObservatoryView.tsx` | 固定 `prefix="obs"`、一律默认展开、`count` 数字转成 meta（0 也显示）、内容外再包一层 `flex flex-col gap-2 px-3` | 删包装；`PanelSection` 的 `meta` 放宽到 `string \| number \| null`（数字照原样显示、0 也显示，null / 空串不占位），新增 `stack`（内容排成缩进、带间隔的一列）；5 处写 `prefix="obs" defaultOpen stack meta={数字}` |

上一刀拆出的子文件（`BookBreakdown` / `BookOutline` / `BookNotes` / `ObservatoryCards` / `ObservatoryCheckers`）与 `ObservatoryFacts` 都不直接套分区，不涉及。三处都没有视图专属逻辑，没留薄包装。`stack` 打开时仍是原来的两层 div，DOM 不变。

**4. 守护测试**（`tests/ui-primitives.test.tsx`）

- `role="menuitem"` 只在 `components/ui/` 里声明（选择器里查 `[role="menuitem"]` 不算）；`chat-window/ContextPanel.tsx` 临时豁免，注明等 #561。
- 大写开头的顶层函数（组件）不在多个文件里各自定义；`MenuItem` 只在 `ui/Menu.tsx`、`MenuRow` 不存在。改前扫出来正好是 `MenuRow`×2、`Section`×3 两组，改后零重复、不需要豁免。查过 #561 分支：它新增的组件名与本分支没有撞名（它把 `ContextSummaryPanel` 从 `panels.tsx` 挪到新文件，合后仍只有一处）。
- 设置行行高 `min-h-[76px]` 只写在 `SettingRows.tsx`。
- 另加行为测试：`MenuItem` / `MenuItemAction` 的渲染（✓、快捷键、危险、禁用、actions 成行、行尾操作的 role / aria-label / title）；外观两个单选组由行标题命名、说明描述，前景对比度警告读在取色框的 aria-describedby 里（`tests/appearance-settings.test.tsx`）；`PanelSection` 的数字 meta 与 `stack`（新文件 `tests/panel-section.test.tsx`）。

### 观感差异（原 class → 新组件）

DOM 与样式完全不变的：外观「主题」「字体」两个下拉行、「背景」「前景」两个取色行（`Field` 结构、id、aria 都同前）；手稿 / 作品 / 观测镜三个视图的分区；页签两个菜单的行高、内边距、字号。

细微差异：

| 地方 | 原来 | 现在 |
| --- | --- | --- |
| 无 label 的设置行（外观「模式」「强调色」、编辑器「恢复默认设置」、关于「当前版本」「检查更新」） | `flex … gap-4`，标题 `text-sm`（行高 20px），说明 `mt-1 text-xs leading-relaxed`（行高 19.5px），控件 `flex-shrink-0` | `sf-field` 横排网格：标题行高随正文 1.5（21px），说明行高 18px；字号、颜色、字重、内边距、最小高度、左右间距不变；窗口窄于 640px 时控件折到标题下面（其余设置行本来就这样）。标题与说明多了 id |
| 菜单项键盘焦点 | 只有右键菜单在 `:focus` 时铺底色，其余只有全局焦点环 | 所有菜单项 `:focus-visible` 时铺 `bg-elevated`、文字变亮（危险项铺 `bg-error/10`），全局焦点环照旧 |
| 菜单项禁用态 | 右键菜单 40% 透明、悬停仍铺底色；模型卡片菜单 50%、悬停不铺底色但文字仍变亮 | 一律 50% 透明，悬停既不铺底色也不变亮（`enabled:hover:`） |
| 菜单项文字 | 右键菜单、模型卡片菜单的文字直接放在按钮里 | 包进 `min-w-0 flex-1 truncate`，过长截断不换行（现有文案都放得下） |
| 作品切换菜单（左栏顶部） | 行高 `var(--sf-row-height)` 30px、左右内边距 8px；「×」平时 40% 可见、离右边 4px | 行高 28px、内边距 10px（与其它菜单一致）；「×」平时隐藏，悬停整行或键盘移到这一行才出现，贴右边 |
| 会话菜单（对话头） | 会话行、「新建会话」内边距 8px；改名 / 移除悬停底色 `bg-elevated`（与整行同色，看不出）；「新建会话」有 `transition-colors` | 内边距 10px；改名 / 移除悬停底色 `bg-surface`（能看出按到哪个）；去掉 `transition-colors` |

**明显的变化**（单独列出）：

1. 右键菜单用鼠标打开时，第一项不再自动铺上高亮底色（原来 `focus:` 在程序聚焦第一项时就生效；现在 `focus-visible:` 只在键盘操作时生效）。键盘打开 / 方向键移动时照样高亮。
2. 作品切换菜单里「从最近打开移除」的「×」平时看不到了（原来 40% 淡显），与会话菜单的改名 / 移除一样悬停才出现。
3. 会话菜单的改名 / 移除两个图标按钮现在是 `role="menuitem"`（原来是普通按钮），与作品菜单的「×」一致；读屏会把它们读成菜单项，名字不变。方向键原本就能走到它们，键盘行为不变。

### 结果

- 改动：
  - 新文件 2 个：`src/components/ui/Menu.tsx`（88 行）、`tests/panel-section.test.tsx`；`ui/index.ts` 导出 `MenuItem`、`MenuItemAction`。
  - 改 14 个文件：`settings/SettingRows.tsx`、`settings/AppearanceSection.tsx`（453 → 375 行）、`settings/ModelProfilesSection.tsx`、`shell/EditorTabMenus.tsx`、`shell/ContextMenu.tsx`、`shell/SidePanel.tsx`、`chat-window/SessionMenu.tsx`、`shell/PanelSection.tsx`、`shell/ManuscriptView.tsx`、`shell/BookProfileView.tsx`、`shell/ObservatoryView.tsx`（409 → 421 行，仍 ≤500）、`ui/index.ts`、`tests/ui-primitives.test.tsx`、`tests/appearance-settings.test.tsx`。
  - 删掉的本地组件：`MenuRow`×2、`ChoiceRow`、`SelectFieldRow`、`Section`×3；`SessionMenu` 的 `actionClass` 常量。
- 验证：
  - `pnpm lint`：EXIT=0，0 error，2 warning（都是起点就有的 `tests/independent-claim-history.test.ts`）；prettier 全部通过。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，271 个文件，2766 passed（起点 270 / 2759；多的 1 个文件是 `panel-section.test.tsx`，多的 7 条是 3 条守护 + 4 条行为测试）。没有改动任何既有测试的断言。
  - `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14257 passed、2 skipped；`packages/` 零改动，golden 零变化。
  - 变异验证（脚本逐条改一处、跑对应测试、按原字节还原并核对 sha256、再跑一遍应绿；跑完 `git status` 与跑前一致）：

| 打在哪 | 测试 | 变异后 | 还原后 |
| --- | --- | --- | --- |
| `SidePanel.tsx` 的作品切换按钮手写 `role="menuitem"` | `ui-primitives` | 红 1 条（menuitem 守护） | 绿 |
| `EditorTabMenus.tsx` 里再定义一个 `function MenuRow` | `ui-primitives` | 红 1 条（重名守护） | 绿 |
| `ManuscriptView.tsx` 里再定义一个与 `BookProfileView` 同名的函数 | `ui-primitives` | 红 1 条（重名守护） | 绿 |
| `AppearanceSection.tsx` 自写一个 `min-h-[76px]` 外壳 | `ui-primitives` | 红 1 条（设置行守护） | 绿 |
| `MenuItem` 去掉 `role="menuitem"` | `editor-tabs` / `resource-explorer-new-entry` / `settings-async` | 红 10 条 | 绿 |
| `MenuItemAction` 去掉 `role="menuitem"` | `ui-primitives` | 红 1 条 | 绿 |
| `MenuItem` 当前项不再打 ✓ | `ui-primitives` + `session-manage` | 红 1 条（满载那轮报 2 条，单跑复核为 1 条） | 绿 |
| `RowShell` 不再按搜索词过滤 | `appearance-settings` + `settings-view` | 红 1 条 | 绿 |
| `RowShell` 无 label 分支给单选组错的 labelId | `appearance-settings` + `settings-accessibility` | 红 1 条（新加的命名测试） | 绿 |
| `PanelSection` 的 meta 回到 `{meta && …}` | `panel-section` + 观测镜两份 | 红 1 条（新加的） | 绿 |
| `PanelSection` 的 `stack` 不再包卡片列 | `panel-section` + 观测镜两份 | 红 1 条（新加的） | 绿 |

  - 最后三条在加新测试之前跑过一次，原有测试全绿（单选组命名、数字 meta、`stack` 原先都没有测试盯着），所以补了上面三条行为测试再跑，均转红。
  - 行尾：改过的文件原为 LF 的仍全 LF，`ui/index.ts` 原为 CRLF 仍全 CRLF；新文件随目录多数用 LF；全部无 CRCRLF。`git diff --numstat` 与 `--ignore-all-space --numstat` 只在 `SessionMenu.tsx`、`SidePanel.tsx`、`AppearanceSection.tsx`、`SettingRows.tsx` 有差，都是 JSX 换了一层嵌套后的缩进变化，没有行尾翻转。非 ASCII 字符逐文件比对：只有 ✓ 从 `SidePanel` / `SessionMenu` 挪进 `Menu.tsx`、`ManuscriptView` 删掉的那行注释，没有混进形近字符。
- 未覆盖：
  - 三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话）本地未跑，以 CI（`Windows Verify` 的 `pnpm verify`）为准。
  - 上面的观感差异只在 happy-dom 与源码层面核过，没有截图对比，也没在装机版上点穿；`has-[:focus-visible]`、`enabled:hover:` 这类变体在 happy-dom 里不生效，只核了类名。
  - 没跑 Tauri 冒烟、真宿主探针、Rust 测试（本刀没动宿主与引擎）。
  - `chat-window/ContextPanel.tsx` 的手写菜单项等 #561 合了再收。

### 注意到的重复（留给后面的刀）

- 设置搜索过滤还有四处手写 `useContext(SettingsSearchContext).trim().toLowerCase()`：`AboutRows.tsx` 的 `UpdateNotes`、`SettingsView.tsx` 的 `ProviderRuntimeEnvNotice`（这两处与 `useSettingsRowVisible` 同义）、`ModelProfilesSection.tsx` 与 `PluginsSection.tsx`（按整组关键词串命中，还要用 query 决定 `<details>` 是否展开）。不是设置行外壳，本刀没动。
- 菜单分隔线 `mx-1.5 my-1 h-px bg-border` 写了五处（`EditorTabMenus` 两处、`SidePanel`、`SessionMenu`、`ContextMenu`），只有 `ContextMenu` 带 `role="separator"`。不是菜单项，本刀没收。
- 模型卡片菜单的「删除」没标危险色，右键菜单里的删除是危险色；本刀照原样保留。

## 2026-10-31 追加：推之前 #572 已合，变基到 master 重跑

- 改动：推之前再查，#572 已用合并提交并进 master（`4debf508`），之后还合了 #571（对话发送前不再自动带摘录）与 #573（引擎工具参数）。把本刀的一个提交 `git rebase origin/master`（`1832793f`），无冲突。master 这段时间改的前端文件（`useRunAuthorAgent.ts`、`lib/project/context-bundle.ts`、`source-standards.test.ts` 等）与本刀改的地方不重叠。
- 验证：
  - `pnpm lint`：EXIT=0，0 error，仍是那 2 条老 warning；prettier 全部通过。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，271 个文件，2768 passed（master 新增 2 条 + 本刀 7 条）。三条守护在新的 master 代码上照样零豁免通过（只豁免 #561 的 `ContextPanel.tsx`）。
  - `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14267 passed、2 skipped；`packages/` 本刀零改动。
- 未覆盖：同上。
