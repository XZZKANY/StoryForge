## 2026-10-31 剩下六个超过 500 行的组件拆小，行数门禁扩到 components 下所有文件

开分支时 #569（编辑器拆分）还没合，按约定从 `origin/refactor/editor-split`（`6b384fdb`）开；PR base 仍是 master。六个被拆的文件与两份读源码的护栏测试在这个起点和 `origin/master`（`61e0b9d2`）上逐字节相同。

### 拆分方案（动手前写定）

原则同 #569：纯搬移，行为零变化。行号按起点上的原文件。整段搬走的函数 / 组件逐字照抄，只在需要跨文件引用的定义前补 `export `；hook 的函数体按源码先后切成连续几段，由原文件按原顺序调用，组件里所有 hook 的调用顺序与拆前一致；子 hook 之间传同一个对象。

**`shell/ObservatoryView.tsx`（785 行，LF）**

| 原行号 | 内容 | 去处 |
| --- | --- | --- |
| 56–60、222–406 | 实体出场章节、伏笔卡 `PromiseCard`、实体卡 `EntityCard` | `shell/ObservatoryCards.tsx` |
| 32–40、408–582 | 检查器名、「让 AI 查」话术、改法名、`checkerKeyOf`、`CheckerFinding`、`CheckerRow` | `shell/ObservatoryCheckers.tsx` |
| 其余 | 扫描时间、提案分区（含 `Section` / `EmptyLine` / 并入与不要按钮）、观测镜容器 | 留原地 |

**`SettingsView.tsx`（783 行，LF）**

| 原行号 | 内容 | 去处 |
| --- | --- | --- |
| 387–637 | `SettingGroup`、`UnsavedBadge`、`SettingCard`、`RowShell`、`ToggleRow`、`RangeRow`、`SelectRow`、`ActionRow` | `settings/SettingRows.tsx` |
| 663–783 | 更新状态文案、`UpdateNotes`、`AboutRows` | `settings/AboutRows.tsx` |
| 其余 | 设置弹窗容器、连接与存储详情、左栏锚点与图标 | 留原地 |

**`PatchReviewPanel.tsx`（714 行，LF）**——放进 `editor/`（它由 `Editor.tsx` 渲染，原本就用 `editor/usePatchHunkZones` 与 `editor/options`）。

| 原行号 | 内容 | 去处 |
| --- | --- | --- |
| 37–110、712–714 | 纯函数：动作名、失败提示、追溯标题、改动行数、圈号 | `editor/patch-review-text.ts`（不含 React） |
| 127–205 | 状态所有者：收起 / 说明、拒绝草稿、本地动作与错误、动作锁 ref、面板 ref、`runAction` | `editor/usePatchReviewActions.ts` |
| 256–302 | Ctrl+Y / Ctrl+N / Ctrl+E 快捷键 effect | `editor/usePatchReviewShortcuts.ts` |
| 304–383 | 只读内联对比编辑器：挂载期创建、换补丁只换 model、展开重排、字号字体追平 | `editor/usePatchDiffEditor.ts` |
| 其余 | 改动统计与分块定位（useMemo）、`submitRejection`、逐处接受 zone、JSX | 留原地 |

调用顺序：actions → 四个 useMemo → shortcuts → 对比编辑器 → `usePatchHunkZones`，与原文件自上而下一一对应。`buildPatchReviewTraceTitle` 仍从 `PatchReviewPanel` 导出（`export { … } from`）。

**`shell/BookProfileView.tsx`（699 行，LF）**——一个大组件，状态贯穿整段 JSX。照仓里已有的 `ObservatoryFacts.tsx` 的 `FactLedgerBody` 做法：分区外壳 `<Section>` 与全部 state / ref / useMemo 留在容器，只把三个分区里面的内容搬成只吃 props 的展示组件。没把速记的状态挪进子组件：那样作者在速记框里打字就不再重渲染容器（容器每次渲染会重读今日进度），重渲染范围会变。

| 原行号 | 内容 | 去处 |
| --- | --- | --- |
| 55–69、430–528 | 拆书字段名与状态名、「拆书」分区内容 | `shell/BookBreakdown.tsx`（`BookBreakdownBody`） |
| 537–584 | 「大纲」分区内容（三元链改成 `return`） | `shell/BookOutline.tsx`（`BookOutlineBody`，另导出 `OutlineGroup` 类型） |
| 593–694 | 「灵感速记」分区内容（两个兄弟节点包进 `<>`，不产生 DOM） | `shell/BookNotes.tsx`（`BookNotesBody`，另导出 `EditingNote` 类型） |
| 其余 | 档案草稿、标签、速记状态、进度、大纲分组 useMemo、头部与封面、简介、进度分区 | 留原地 |

容器里两行跟着改成引用导出的类型：速记编辑状态 `useState<{ line; original; text } | null>`（5 行）→ `useState<EditingNote | null>`，大纲分组 `new Map<string, { relativePath; path; items }>` → `new Map<string, OutlineGroup>`，形状不变、只定义一次。

**`CommandPalette.tsx`（578 行，LF）**——新建 `command-palette/`，照 `Editor.tsx` + `editor/`、`ChatWindow.tsx` + `chat-window/` 的样子。

| 原行号 | 内容 | 去处 |
| --- | --- | --- |
| 66–129 | 相对作品路径、模糊匹配与评分、匹配高亮 `HighlightedLabel` | `command-palette/palette-items.tsx` |
| 22–30、217–336 | `Command` 类型、命令清单 useMemo | `command-palette/usePaletteCommands.ts`（`usePaletteCommands`） |
| 38–39、44–63 | props 里命令清单用到的 21 个字段 | 同上，成为 `PaletteCommandSources` 类型；`CommandPaletteProps = PaletteCommandSources & { mode; onClose; onModeChange; onOpenFile }`，不重复写一遍字段 |
| 其余 | 文件列表读取、过滤与排序、键盘、JSX | 留原地，在原位置调 `usePaletteCommands` |

**`shell/EditorTabs.tsx`（530 行，CRLF）**

| 原行号 | 内容 | 去处 |
| --- | --- | --- |
| 394–530 | 「润色当前章」菜单、`MenuRow`、「…」文件操作菜单 | `shell/EditorTabMenus.tsx`（新文件随 `shell/` 多数用 LF） |
| 其余 | 页签与页签行 | 留原地，仍 CRLF |

**门禁**：`tests/source-standards.test.ts` 的 `LIVE_MODULE_ROOTS` 加 `command-palette`、`icons`、`settings`、`shell`、`ui`；`src/components/` 顶层文件（不递归）并进同一条「不超过 500 行」断言；另加一条「components 下每个子目录都列进了行数门禁」，以后新建子目录忘了登记会红。唯一例外仍是 `chat-window/panels.tsx`，注释写明等 #561 合了再拆。`STRUCTURE.md` 的 Size Gates 改成「components 下所有文件 ≤500 行」。

**护栏测试跟着代码走**：只有 `accessibility-guards.test.ts` 的「图标-only 按钮必须有 aria-label」整文件扫描 `ObservatoryView.tsx` 与 `BookProfileView.tsx`；把从这两个文件搬出去的五个文件（`ObservatoryCards`、`ObservatoryCheckers`、`BookBreakdown`、`BookOutline`、`BookNotes`）加进 `SWEPT_FILES`。其余读源码的断言（LiveStatus、面板 h2 标题、头部刷新按钮、`h-shell-row`、命令面板的 `sf-input-shell` / `sf-inner-input` / 高度类名）读的都是留在容器里的代码，没动。

### 结果

- 改动（作者要求「同一件事只留一种做法」：组件都按同一道 500 行门禁拆小）：
  - 六个文件拆成 20 个，全部 ≤500 行：`ObservatoryView.tsx` 785 → 409 + `ObservatoryCards.tsx` 203、`ObservatoryCheckers.tsx` 193；`SettingsView.tsx` 783 → 394 + `settings/SettingRows.tsx` 257、`settings/AboutRows.tsx` 136；`PatchReviewPanel.tsx` 714 → 462 + `editor/patch-review-text.ts` 81、`editor/usePatchReviewActions.ts` 114、`editor/usePatchReviewShortcuts.ts` 75、`editor/usePatchDiffEditor.ts` 101；`BookProfileView.tsx` 699 → 445 + `BookBreakdown.tsx` 135、`BookOutline.tsx` 64、`BookNotes.tsx` 129；`CommandPalette.tsx` 578 → 387 + `command-palette/palette-items.tsx` 73、`command-palette/usePaletteCommands.ts` 191；`EditorTabs.tsx` 530 → 392 + `EditorTabMenus.tsx` 144。
  - 对外导出不变：`ObservatoryView`、`SettingsView`、`PatchReviewPanel` 与 `buildPatchReviewTraceTitle`、`BookProfileView`、`CommandPalette` 与 `PaletteMode`、`EditorTabs` 与 `CenterTab` 仍从原文件导出；调用方一行没改。
  - 拆完 `src/components/` 下最长的是 `chat-window/panels.tsx` 986（豁免），其次 `app/AppShell.tsx` 500。
  - 依赖数组：只有一处报警。`usePatchReviewShortcuts.ts` 的快捷键 effect，lint 报漏 `panelRef` 与 `setRejection`；前者是 `usePatchReviewActions.ts` 里 `useRef` 建的、后者是同一文件里 `useState` 解构出的 setter，经同一个 `actions` 对象原样传下来，身份不变，接在原依赖数组末尾，原有六项顺序与内容不动；没加 eslint-disable。`usePatchDiffEditor.ts` 用到的 ref 都在它自己里面建，不报警；它挂载期 effect 上原有的那条 `eslint-disable-next-line` 是拆前就有的，原样保留。其余拆出的文件没有跨文件传进 hook 的 ref / setter。
- 验证：
  - 切法：一个 Python 生成脚本按行号从 `git show HEAD:<原文件>` 取 65 段，胶水（import、hook / 组件签名、调用、返回对象、`ReturnType` 类型别名、每个新文件一行职责注释）手写在脚本里；然后 `prettier --write`。脚本放在仓库外 `C:\Users\kanye\sf-unify\scratch\refactor-split-oversize-views\`，不入库。
  - prettier 动过的地方（都只是排版）：7 个文件。import 超长折行（4 处胶水）；`HighlightedLabel` 补 `export ` 后超过 100 列，签名折成多行；快捷键依赖数组补两项后折成多行；三个从 JSX 深处搬出的分区内容整体左移后 prettier 重排——几处多行合成一行，另有两处把 `{' '}` + 换行接文字合成同一行里的一个空格（「… {chapter_count} 章」「…</span> 条标题没列出来。」），渲染出的文字相同，只是 DOM 里原来是两个相邻文本节点、现在是一个。
  - 行集合比对（脚本同上目录）：
    1. 逐段核对：65 段里 60 段在目标文件里找到连续、逐字相同的一段（只允许 manifest 记下的 `export ` 前缀与定点替换）；另外 5 段（快捷键 effect、拆书 / 大纲 / 速记三段 JSX、`palette-items` 一段）去掉空白、分号、折行补的尾逗号、`{' '}` 后与目标一致，正是上一条 prettier 重排的那几处。65/65 找到。
    2. 多重集合：新文件里多出的行只有 import、签名与解构、调用、返回对象、类型别名、职责注释、子组件调用处，以及上面 prettier 重排出的行；原文件里少了的非 import 行只有：`CommandPaletteProps` 的开头行（换成交叉类型）、速记编辑状态那 5 行与大纲分组那 1 行（换成导出的类型）、快捷键依赖数组原来那一行（补了两项）、`HighlightedLabel` 原来的单行签名、大纲三元链的首尾两行（`{… ? (` / `)}` → `return … ? (` / `);`），其余都是 prettier 折行 / 合行的另一半。
    3. 原文件里没被任何一段覆盖的行：只有 import、`CommandPaletteProps = {`、速记编辑状态那 5 行和几处段间空行。
  - 调用顺序：`PatchReviewPanel` 的 hook 顺序与拆前逐个相同（见上）；`CommandPalette` 在原 useMemo 的位置调 `usePaletteCommands`，里面就是那一个 useMemo；`BookProfileView` 的 hook 一个没挪；其余几个文件搬走的是整个组件 / 函数，组件内部的 hook 跟着组件走。
  - `pnpm lint`：EXIT=0，0 error，2 warning（都是拆前就有的 `tests/independent-claim-history.test.ts`，起点上跑同样是这 2 条）；prettier 全部通过。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14252 passed、2 skipped；`packages/` 零改动，golden 零变化。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，270 个文件，2757 passed（比起点多 1 条，是新加的子目录登记断言）。
  - 变异验证（脚本逐条改一处、跑对应测试、按原字节还原并核对 sha256、再跑一遍应绿；跑完 `git status` 与跑前一致）：

| 打在哪 | 测试 | 变异后 | 还原后 |
| --- | --- | --- | --- |
| `shell/EditorTabMenus.tsx` 撑到 744 行 | `source-standards.test.ts` | 红 1 条 | 绿 |
| `settings/SettingRows.tsx` 撑到 857 行 | `source-standards.test.ts` | 红 1 条 | 绿 |
| `ui/Spinner.tsx` 撑到 646 行 | `source-standards.test.ts` | 红 1 条 | 绿 |
| `icons/shell-icons.tsx` 撑到 702 行 | `source-standards.test.ts` | 红 1 条 | 绿 |
| `command-palette/usePaletteCommands.ts` 撑到 791 行 | `source-standards.test.ts` | 红 1 条 | 绿 |
| components 顶层 `SettingsView.tsx` 撑到 994 行 | `source-standards.test.ts` | 红 1 条 | 绿 |
| 新建子目录 `components/zz-mutation-probe/`（放一个小文件） | `source-standards.test.ts` | 红 1 条（子目录登记） | 删掉目录后绿 |
| `BookNotes.tsx` 删掉「改速记」铅笔按钮的 aria-label | `accessibility-guards.test.ts` | 红 1 条 | 绿 |
| `ObservatoryCheckers.tsx` 删掉「标记已处理」的 aria-label | `accessibility-guards.test.ts` | 红 1 条 | 绿 |
| `usePatchReviewShortcuts.ts` Ctrl+Y 改成 Ctrl+U | `patch-review-panel.test.tsx` | 红 2 条 | 绿 |
| `usePatchReviewActions.ts` 动作完成后不再解除「进行中」 | `patch-review-panel.test.tsx` | 红 3 条 | 绿 |
| `usePatchDiffEditor.ts` 差异算完不再停到第一处改动 | `patch-review-panel.test.tsx` | 红 2 条 | 绿 |
| `settings/AboutRows.tsx` 下载中进度文案改掉 | `settings-about-update.test.tsx` | 红 1 条 | 绿 |
| `usePaletteCommands.ts` 去掉「新建会话」命令 | `command-palette.test.tsx` | 红 2 条 | 绿 |

  - 另试过一条「动作锁不再拦重入」（`usePatchReviewActions.ts` 去掉 `actionInFlightRef.current` 判断），`patch-review-panel.test.tsx` 仍全绿：那条「双击只执行一次」的用例第二次点击时按钮已经 disabled，ref 锁这层没被单独测到。拆前就是这样，本刀不补测试，换成上表「不再解除进行中」那条。
  - 行尾：`EditorTabs.tsx` 原为 CRLF，改后仍全 CRLF；其余改过的文件原为 LF，仍全 LF；新文件随所在目录多数用 LF；全部无 CRCRLF。`git diff --numstat` 与 `--ignore-all-space --numstat` 只差几行（`PatchReviewPanel.tsx`、`BookProfileView.tsx` 各 1 行空白差），没有行尾翻转。
- 未覆盖：
  - 三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话）本地未跑，以 CI（`Windows Verify` 的 `pnpm verify`）为准；浏览器冒烟覆盖命令面板与设置。
  - 没跑 Tauri 冒烟、真宿主探针、Rust 测试（本刀没动宿主与引擎接口）；没在装机版上点穿。
  - `chat-window/panels.tsx`（986 行）按约定不碰，等 #561 合了再拆。

## 2026-10-31 追加：推之前 #569 已合，变基到 master 重跑

- 改动：推之前再查，#569 已用合并提交并进 master（`2bb76f5f`），起点 `6b384fdb` 已是 master 的祖先。为了让 PR 直接叠在 master 上，把本刀的一个提交 `git rebase origin/master`，无冲突。master 这段时间多出的是 #568（引擎读文本解码与正文字数，`source-standards.test.ts` 末尾加了两条断言、`lib/text-metrics.ts` 改了几行），与本刀改的地方不重叠；六个被拆的原文件在 master 上没变。
- 验证：
  - 行集合比对改以 `origin/master` 上的原文件为准重跑：65 段，逐字 60、去空白后一致 5，输出与变基前逐行相同。
  - `pnpm lint`：EXIT=0，0 error，仍是那 2 条老 warning。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，270 个文件，2759 passed（比变基前多的 2 条是 #568 加的）。
  - `pnpm --filter @storyforge/engine test`：EXIT=0，111 个文件，14257 passed、2 skipped；`packages/` 本刀零改动。
- 未覆盖：同上。
