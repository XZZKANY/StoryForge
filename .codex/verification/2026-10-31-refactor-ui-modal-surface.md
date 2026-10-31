## 2026-10-31 弹窗只留一套写法：共享模态外壳 ModalDialog，命令面板改走层管理

- 改动（作者要求「同一件事只留一种做法」）：
  - `components/ui/Dialog.tsx` 新增 `ModalDialog`（经 `ui/index.ts` 导出）：渲染遮罩 + `DialogSurface`。遮罩的样式、静态 z 层、淡入动画、`role="presentation"` / `data-modal-backdrop`，以及表面共有的外框（`rounded-xl border border-border shadow-dialog animate-slide-up-fade`）都只写在这一处；`role="dialog"` / `aria-modal` 由 `DialogSurface` 设。各弹窗只用 `className` 给表面的宽高、底色、内边距，用 `placement`（`center` 默认 / `top`）选对齐。portal 规则也在这里定：顶层弹窗就地渲染；嵌在另一层表面里打开（`LayerContext` 有父层）时挂到 `document.body`，免得外层表面的 transform / overflow 困住 fixed 遮罩。
  - 五处改用它：`app/AppDialog.tsx`、`app/NewProjectDialog.tsx`、`settings/PluginImportDialog.tsx`（删掉自己的 `createPortal`，它嵌在设置弹窗里，按上面的规则照样挂到 body）、`SettingsView.tsx`（设置里的确认框 `AppDialogHost` 原来放在设置遮罩里面，现在放在 `ModalDialog` 后面做兄弟节点，不嵌进表面，免得被当成嵌套层挂到 body）、`CommandPalette.tsx`。四处重复写的 `role="dialog"` / `aria-modal="true"` 删掉。
  - 命令面板改走 `DialogSurface` / `useLayer`：删掉自己挂在 window 上的 Esc 监听、挂载时手动 focus 的 effect、遮罩 `onMouseDown` 关闭和表面上 `stopPropagation` 的配对、自己的 Tab 陷阱分支；改为 `initialFocusRef={inputRef}`、`dismissOutside`，Esc / 点外面 / 焦点陷阱 / 关闭后还焦点 / 叠放顺序都交给层管理。↑↓ / Enter 选择逻辑和「输入法组字中的键一律交给输入法」那段原样保留。选项按钮加 `tabIndex={-1}`（见下方行为清单第 6 条）。
  - 命令面板新增可选 prop `onModeChange`，`AppShell` 传 `setPalette`：`DialogSurface` 会拦下冒泡到 window 的按键，原来「面板开着再按 Ctrl+P / Ctrl+Shift+P 切换文件 / 命令」靠的是 `App.tsx` 的全局监听，现在由面板自己接住这两个键，行为不变。
  - 守护测试并进上一刀的 `tests/ui-primitives.test.tsx`：①`bg-black/`、`data-modal-backdrop`、`aria-modal`、`<DialogSurface` 四个写法只出现在 `src/components/ui/` 里（同时断言 `ui/Dialog.tsx` 确实含有，防改名后空转）；②JSX 里声明 `role="dialog"`（含 `role={'dialog'}`）只在 `components/ui/`，`closest('[role="dialog"]')` 这类选择器不算（正则先用三个样例自检）；③`ModalDialog` 结构：遮罩 / 表面属性、`placement` 两种对齐、顶层就地渲染、嵌套时挂到 body 且 z 层更高。`tests/command-palette.test.tsx` 补四条行为测试（见行为清单）。

- 五处遮罩改前 / 改后 class 对照：

  | 位置 | 改前遮罩 | 改后（统一由 `ModalDialog` 给） | 差异与理由 |
  | --- | --- | --- | --- |
  | `app/AppDialog.tsx` | `fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-4 animate-fade-in`，`role="presentation"`，`data-testid="app-dialog-backdrop"`，`data-modal-backdrop` | `fixed inset-0 z-50 flex justify-center bg-black/50 p-4 animate-fade-in items-center`，`role="presentation"`，`data-modal-backdrop` | `px-4 py-4` = `p-4`；`app-dialog-backdrop` 全仓库无引用，删掉 |
  | `app/NewProjectDialog.tsx` | `fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4 animate-fade-in`，`role="presentation"`，`data-modal-backdrop` | 同上 | `z-40` → `z-50`、`bg-black/55` → `/50`（见下） |
  | `settings/PluginImportDialog.tsx` | `fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 animate-fade-in`，`role="presentation"`，`data-modal-backdrop`，自己 `createPortal` 到 body | 同上；嵌在设置弹窗里，由 `ModalDialog` 挂到 body | `bg-black/55` → `/50`；portal 由外壳按「是否嵌套」决定，结果与原来相同 |
  | `SettingsView.tsx` | `fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 animate-fade-in`，`data-modal-backdrop`（没有 `role="presentation"`） | 同上 | `z-40` → `z-50`；补上 `role="presentation"` |
  | `CommandPalette.tsx` | `fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 sm:pt-24 animate-fade-in`，`data-testid="command-palette"`，`onMouseDown={onClose}`，没有 `data-modal-backdrop` | `placement="top"`：`fixed inset-0 z-50 flex justify-center bg-black/50 p-4 animate-fade-in items-start sm:pt-24`，`role="presentation"`，`data-modal-backdrop` | 唯一保留的对齐差异：命令面板贴上方，结果列表变长时输入框位置不跳；`command-palette` testid 移到表面 |

  - z 层：五处静态 `z-40` / `z-50` 统一成 `z-50`。实际叠放由层管理在注册时往 `[data-modal-backdrop]` 上内联写 `100 + 序号×10`（注册发生在 layout effect 里、首帧绘制前），静态值只是兜底，所以原四处弹窗的实际层级不变；命令面板原来没进层管理、实际就是 `z-50`，现在和其他弹窗一样按打开顺序叠（`z=100` 起），通知浮层 `z=1000` 仍在最上面。
  - 遮罩浓度：两处 `/55`、三处 `/50`，没找到 `/55` 的理由（新建作品、插件导入都不比别的弹窗更需要压暗），统一成 `/50`。这是本刀唯一的肉眼可见差异：新建作品和插件导入的遮罩浅了 5% 黑。用 postcss + tailwind 按生产配置编译 `index.css` 核过：`.bg-black\/50`、`.sm\:pt-24`、`.items-start`、`.items-center`、`.z-50`、`.animate-fade-in`、`.animate-slide-up-fade`、`.shadow-dialog`、`.rounded-xl` 都在产物里，`.bg-black\/55` 已不再生成。
  - 表面：五处都写了 `rounded-xl border border-border shadow-dialog animate-slide-up-fade`，挪进外壳；其余（宽高、`bg-panel` / 设置的 `bg-background`、内边距、`flex` / `overflow`）各自留在 `className`，逐字未改。底色没收进外壳：设置是左 `bg-panel` 右 `bg-background` 的整页式布局，和其他四个不同。

- 命令面板行为核对清单（改后）：
  1. 打开即聚焦输入框（`initialFocusRef`，取代原来的 `useEffect` focus）——新测「打开即聚焦输入框…」断言 `document.activeElement` 是输入框。
  2. Esc 关闭：由层管理在 window 捕获阶段处理，焦点在输入框、选项或「重试」按钮上都能关——新测断言 `onClose` 被调一次、面板卸载。
  3. 输入法组字中按 Esc 不关、组字中的回车不执行：层管理对 `isComposing` / `keyCode 229` 直接放行，面板自己的 `!isComposing` 守卫保留——原有测试「输入法选字的回车不执行命令…组字中的 Esc 不关面板」照样绿。
  4. 关闭后焦点回到打开前的元素（原来不还，焦点落到 body）——新测断言回到打开前聚焦的按钮。
  5. 点遮罩关闭、点面板里面不关：`dismissOutside` 取代 `onMouseDown` 配对——新测分别对表面和遮罩发 `pointerdown`。
  6. Tab 留在输入框：交给层管理的焦点陷阱。选项按钮加 `tabIndex={-1}`：选项本来靠 ↑↓ + `aria-activedescendant` 选，不该进 Tab 序；不加的话层管理的 Shift+Tab 会把焦点先跳到最后一个选项（列表随之滚到底）再被拉回。附带变化：读取失败的「重试」、未开作品时的「打开本地作品…」按钮现在 Tab 能到（原来 Tab 一律被拉回输入框，这两个按钮键盘到不了）——新测断言 Tab 被 `preventDefault`、焦点仍在输入框、所有选项 `tabIndex === -1`。
  7. 面板开着再按 Ctrl+P / Ctrl+Shift+P 切到文件 / 命令：经 `onModeChange`——新测断言依次收到 `files`、`commands`，且不关闭面板。
  8. 和其他层叠放：面板上再开一个弹窗，新弹窗遮罩 z 层更高、焦点进新弹窗；Esc 先关上层、焦点回到面板输入框，再按 Esc 才关面板——新测「命令面板上再叠一个弹窗…」。
  9. 打开时背景加 `inert` / `aria-hidden`，关闭后恢复——并在第 1 条新测里断言。
  10. ↑↓ / Enter 选择、鼠标悬停高亮、点选执行：代码未动；原有「能新建文件、改名、开版本历史…」等测试照样绿。
  11. 有意的变化：面板开着时，焦点在面板里按的其他全局快捷键（Ctrl+S / O / B / , / 1 / 2 / 3、Ctrl+Tab、Ctrl+Shift+B / E / F / M / O / I / H）不再穿透到背景执行，和设置、新建作品、确认框这些弹窗一致（`settings-accessibility` 的「设置内快捷键不触发背景 App」就是这条约定）。原来比如 Ctrl+, 会在面板还开着时再叠开一层设置。用临时测试核过：焦点在面板输入框时按 Ctrl+B / S / , / P，window 上的监听一个都收不到（临时文件跑完已删）。另：面板开着时点通知浮层也会关面板（`dismissOutside` 对层外点击一视同仁，设置弹窗早就如此）。

- 另两处自理 Esc 的地方，判断为编辑区里的普通面板快捷键，没动：
  - `components/editor/VersionHistory.tsx`：版本记录是停靠在右栏位置的抽屉（`fixed bottom-0 right-0 top-9 z-30`），没有遮罩、不困焦点、点外面和失焦都不关，开着时正文照样能编辑；Esc 挂在抽屉自己的 `onKeyDown` 上，只在焦点在抽屉里时生效。改走层管理会让 Esc 在 window 捕获阶段全局生效（焦点在对话框、文件树里按 Esc 也会关掉它），z 层也会被改写成 100 起，行为都变。
  - `components/PatchReviewPanel.tsx`：Esc 只在补丁审阅面板「展开」时把它收回（不是关闭），面板展开也只铺满编辑区那一栏（`absolute inset-0 z-10`），且跳过可编辑目标；驳回输入框里的 Esc 是取消这次草稿。都是面板内快捷键。

- 故意没改：`tests/fixtures/interaction-primitives.tsx`（09-25 的隔离视觉夹具）和 `tests/overlay-primitives.test.tsx` 里手写的 `data-modal-backdrop` 外层，它们测的是 `DialogSurface` 这个底层原件本身；守护测试只扫 `src/`。

- 验证（corepack 的 pnpm 9.15.4 临时 shim）：
  - `pnpm lint` EXIT=0（0 error；2 条 warning 在 `tests/independent-claim-history.test.ts`，原有）。
  - `npm --prefix apps/desktop/frontend run typecheck` EXIT=0。
  - `pnpm --filter @storyforge/engine test` EXIT=0：111 文件，14251 passed / 2 skipped；`packages/` 零改动，golden 零变化。
  - `npm --prefix apps/desktop/frontend run test` EXIT=0：270 文件，2743 passed（上一刀 2736 + 本刀新增 7 条）。弹窗相关 17 个文件（command-palette / app-dialog / new-project-dialog / settings-accessibility / settings-plugins / settings-async / overlay-primitives / welcome-page / workspace-layout-app / decision-choices / app / focus-styles / surface-hierarchy / project-library-restore-app / new-chapter-defaults / behavior/auto-writeback / shortcuts）先单跑 183 passed。
  - 变异验证（脚本逐条改、跑、按原字节写回并比对相同）：
    - M1 给 `CommandPalette` 的 `ModalDialog` 手写 `aria-modal="true"` → 守护①红（1 failed / 6 passed）。
    - M2 给它手写 `role="dialog"` → 守护②红（1 failed / 6 passed）。
    - M3 给 `NewProjectDialog` 表面 class 加 `bg-black/55` → 守护①红（1 failed / 6 passed）。
    - M4 `ModalDialog` 嵌套时不再 portal → `ModalDialog` 结构测试红（ui-primitives + settings-plugins 共 1 failed / 24 passed；settings-plugins 按 document 查询，不受影响）。
    - M5 命令面板去掉 `dismissOutside` → 「点遮罩关闭」红（1 failed / 11 passed）。
    - M6 去掉选项的 `tabIndex={-1}`（两处）→ 「Tab 留在输入框…」红（1 failed / 11 passed）。
    - M7 去掉 `onModeChange(...)` 调用 → 同一条红（1 failed / 11 passed）。
    - 全部写回后复跑 ui-primitives / command-palette / settings-plugins：37 passed。
  - 行尾：改动的 TS/TSX 按原行尾（`ui/index.ts`、`app/AppShell.tsx` 为 CRLF，其余 LF）；`git diff --numstat` 与 `--ignore-all-space --numstat` 的差额全部来自弹窗内容少缩进一层（`AppDialog` / `NewProjectDialog` / `PluginImportDialog` / `CommandPalette`）。
- 未覆盖：
  - 真宿主观感未看：没在装机版或 Tauri 窗口里看过五个弹窗（遮罩浓度、淡入、命令面板贴上方的位置）、设置里再弹确认框 / 插件导入的叠放，浅色 / 深色都没截图。
  - 真键盘 + 真输入法下的命令面板（组字中 Esc / 回车、Shift+Tab）只在 happy-dom 里用合成事件验过。
  - 本地未跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话；本机有别的会话在跑 headless Chrome），以 CI `Windows Verify` 为准。
  - 没改 Rust，未跑 Rust 测试与 Tauri 冒烟。
