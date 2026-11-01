## 2026-11-01 撤掉守护里给 #561 留的临时豁免，那批文件改用共享组件

从 `origin/master`（`f5bc3df8`，#561 已合）开分支。作者 11-01 定：「架构与组件统一」那一轮为了不和 #561 撞车，在 `tests/ui-primitives.test.tsx` 里给它在改的文件留了四组豁免（注释写「等 #561 合了再收」），现在收掉。本节是第一个提交；拆 `panels.tsx` 见下一节。`packages/` 零改动。

- 改动：
  - 守护里删掉的豁免（四组全删，守护不再有任何 chat-window 文件的例外）：
    - `BUTTON_EXEMPT`（JSX `<button>` 只写在 `components/ui`）：`ChatSideRail`、`ChatWindowView`、`Composer`、`ComposerDock`、`ContextPanel`、`ContextSummaryPanel`、`WriteBatchPanel`、`panels`。其中 `ComposerDock`、`WriteBatchPanel` 在 master 上已经没有手写 `<button>`，直接从清单去掉。
    - `MENUITEM_EXEMPT`（`role="menuitem"` 只在 `components/ui` 声明）：`ContextPanel`。
    - `MENU_SURFACE_EXEMPT`（菜单外框只写在 `ui/Menu.tsx`、`role="menu"` 只由 `MenuSurface` 声明）：`ContextPanel`。
    - `REVEAL_EXEMPT`（悬停才出现只经 `revealOnHover`）里的 `panels.tsx`；`EditorTabs.tsx` 那条（页签关闭钮的圆点 ↔ × 互换，不是悬停才出现）照旧保留。
    - 测试标题里的「（#561 在改的文件暂时豁免）」一并去掉。
  - 6 个文件里 16 处手写 `<button>`、1 个手写菜单外框、1 处手写悬停显隐，逐处换掉（映射口径照 `2026-10-31-refactor-ui-buttons.md`：先保高度、外观类全交给共享尺寸与变体、列表行 / 卡片 / 标签片 / 下拉触发器 / 折叠行用 PlainButton 并原样保留 className）：

| 文件 | 地方 | 原写法 | 换成 | 依据 |
| --- | --- | --- | --- | --- |
| `ChatSideRail.tsx` | 批量写章每章一行（写进了的点开文件） | `<button>` 行 | PlainButton，className 原样 | 列表行 |
| `ChatWindowView.tsx` | 会话记录加载失败条的「重试」「关闭」 | `h-7 border border-warning px-2.5 text-xs` | `Button size="xs" variant="secondary"` | 原高 28px → xs；带边框、重试不是危险操作 → secondary（同上一刀错误框里的重试） |
| `Composer.tsx` | 待发送消息的「取消」 | `text-3xs px-1.5 py-0.5`，无边框（行高继承 `text-xs` 16px，原高 20px） | `Button size="mini" variant="ghost" className="-my-0.5"` | 原高 20px、10px 字、左右 6px → mini 三项都对上；无边框无底 → ghost；`-my-0.5` 是布局类保留 |
| `Composer.tsx` | `@角色` 建议 | `h-7 border border-border-strong px-2.5 text-xs`，悬停变强调色实底 | `Button size="xs" variant="secondary"` | 原高 28px → xs；中性边框 → secondary |
| `Composer.tsx` | 固定参考标签片里的 ✕ | 无框小叉 | PlainButton，className 原样 | 标签片里的移除叉（套方框会把标签片撑高） |
| `Composer.tsx` | 「+N」看全部固定参考 | 与旁边固定参考同款的 `h-6 rounded-md bg-elevated` 片 | PlainButton，className 原样 | 标签片（与同一排的固定参考片同一外观） |
| `ContextPanel.tsx` | 「新建技能」模板菜单外框 | `FloatingSurface role="menu"` + `w-64 animate-fade-in rounded-lg border border-border bg-surface p-1 shadow-dropdown` | `MenuSurface className="w-64"` | 外框类名逐个相同（`MenuSurface` 实底就是这一串） |
| `ContextPanel.tsx` | 模板菜单项（名字 + 什么时候用两行） | `<button role="menuitem">` 竖排两行 | `MenuItem`，两行写成两个 `block truncate` 的 span 作 children | 菜单项；名字仍 `text-foreground`、说明仍 `text-2xs text-subtle` |
| `ContextPanel.tsx` | 技能一行、「这一轮读了」文件一行 | `<button>` 行 | PlainButton，className 原样 | 列表行 |
| `ContextSummaryPanel.tsx` | 固定参考片（点了取消固定） | `<button>` 片 | PlainButton，className 原样 | 标签片 |
| `ContextSummaryPanel.tsx` | 候选资料一行（点了固定 / 取消） | `<button>` 行 | PlainButton，className 原样 | 列表行（固定态是强调色实底，等于可切换的行） |
| `ContextSummaryPanel.tsx` | 「▾ 参考资料 · N 份」折叠行 | `<button>` 行 | PlainButton，className 原样 | 折叠行 |
| `panels.tsx` | 对话头会话切换（标题 + ▾） | `<button>` | PlainButton，className 原样 | 下拉选择器的触发器（显示当前值，同作品切换） |
| `panels.tsx` | 「有新内容 · 回到底部」 | 浮在消息上的 `rounded-full` 紫描边药丸，`bg-surface` 加投影 | PlainButton，className 原样 | 浮层药丸：共享变体里紫描边的 `agent-subtle` 是透明底，浮在消息上会透字；按上一刀「建议片」同口径归 PlainButton |
| `panels.tsx` | 轻状态行「重试本轮」 | `h-7 border border-border-strong px-2.5 text-xs text-foreground` | `Button size="xs" variant="secondary"` | 原高 28px → xs；中性边框 → secondary |
| `panels.tsx` | 用户消息下的复制行 | `opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100` | `revealOnHover()` | 平时完全隐藏 → 默认 `hidden` |

- 观感变化（按类名与共享样式推出，没截图）：
  - 没有变化的：所有换成 PlainButton 的 10 处（className 原样，只多了 `sf-plain-button`：`type` 本来就是 button，焦点环本来就走全局 `:focus-visible`；唯一的差别是禁用时光标由 default 变 not-allowed，只有输入框里固定参考的 ✕ 与「+N」有禁用态）；模板菜单的外框。
  - 会话记录加载失败条的「重试」「关闭」：黄描边、黄字、透明底 → 中性 `border-strong` 描边、前景色字、surface 底；左右内边距 10 → 8px；高度、字号、悬停底色不变。
  - 「重试本轮」：多了 surface 底色；左右内边距 10 → 8px；描边、字色、高度、字号不变。
  - `@角色` 建议：悬停由「描边、底色、字都变成强调色」变成 elevated 底、前景字（共享 secondary 的悬停）；平时多了 surface 底色；左右内边距 10 → 8px；高度、字号不变。这是本刀最明显的变化。
  - 待发送消息的「取消」：字色 subtle → muted（稍亮），悬停底色 border → elevated，圆角 4 → 6px，字距少了 `text-3xs` 带的 0.012em；高度、字号、内边距不变。
  - 模板菜单项：键盘移到这一项时铺 elevated 底（原来只有焦点环，与其它菜单一致）；名字过长时截断不换行（原来会折行，现有模板名放得下）；说明那一行行高 16.5 → 16px（按钮上多了 `text-xs`，行高由继承的 1.5 倍变成 1rem）。
  - 用户消息下的复制行：鼠标悬停、键盘 Tab 到「复制」时照样出现；变的是用鼠标点过「复制」后焦点留在按钮上时，原来一直显着（`focus-within`），现在鼠标移开就隐去（键盘焦点仍会让它显着）——与上一刀作品库、文件树的小操作同一口径。
- 验证：
  - `pnpm lint`：EXIT=0，0 error，2 warning 都在没动过的 `tests/independent-claim-history.test.ts`（原有），0 新 warning；prettier 全过。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，274 个文件，2822 passed（起点同为 274 / 2822：只删了豁免，没加用例）。改完先单跑了 15 个相关文件（守护、上下文面板、输入框、开场、错误态、侧栏、消息列表滚动、复制、会话头、可达性、行高等），169 passed。
  - `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14275 passed / 2 skipped；`packages/` 零改动，golden 零变化。
  - 变异验证（脚本逐条改一处 → 单跑 `tests/ui-primitives.test.tsx` → 按原字节无条件还原并核对 sha256 → 再跑一次；跑完 `git status` 与跑前一致）：

| 打在哪 | 变异后 | 还原后 |
| --- | --- | --- |
| `ChatSideRail` 章节行换回手写 `<button type="button">` | 红 1 条（`<button>` 守护） | 22 passed |
| `ContextPanel` 技能行的 PlainButton 加 `role="menuitem"` | 红 1 条（menuitem 守护） | 22 passed |
| `ContextPanel` 模板菜单的 `MenuSurface` 上再写 `rounded-lg p-1 shadow-dropdown` | 红 1 条（外框守护） | 22 passed |
| `ContextPanel` 上下文浮窗的 `FloatingSurface` 写 `role="menu"` | 红 1 条（role 守护） | 22 passed |
| `panels` 复制行换回手写 `opacity-0 … group-hover:opacity-100` | 红 1 条（悬停守护） | 22 passed |

  - 行尾：`panels.tsx`、`ChatWindowView.tsx`、`Composer.tsx` 原为 CRLF，仍全 CRLF；其余改过的文件原为 LF，仍全 LF；全部无 CRCRLF、无孤立 CR（按字节定点替换，每处断言只出现一次）。`git diff --numstat` 与 `--ignore-all-space --numstat` 完全相同。
- 未覆盖：
  - 本地未跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），以 CI `Windows Verify` 的 `pnpm verify` 为准；Agent 对话回归覆盖这些面板。
  - 观感只在类名、共享样式与 happy-dom 层面核过，没截图、没在装机版上点；`@角色` 建议的悬停色变化与加载失败条按钮由黄变中性，需要作者看一眼。
  - 没跑 Rust 测试与 Tauri 冒烟（本刀不动宿主与引擎）。
