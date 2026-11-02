## 2026-11-02 通知统一叠在左栏底部，不再压正文

从 `master`（`f37e70d6`）开分支。

起因是作者 11-02 反馈：「弹窗感觉没做好，有的弹窗还弹在正文的右下角」。我用隔离的调试宿主（改了标识，不碰作者装机版）、示例作品《雾港回声》和作者的窗口尺寸 1400×759 截图核对，正文右下角有两套通知：

1. **全站通知（ToastHost）**：#452（10-20）为了不压对话，规定只要右边有对话栏，就挪到编辑区右下角。结果三条通知盖住了正文最后几行。只开编辑器时落在窗口右下角，同样压字。
2. **行间改写（Ctrl+K / Ctrl+Shift+K）的状态提示**：这是另一套 DOM toast，钉在编辑区右下角，和全站通知抢同一个角，会被挡住一半。

10-20 作者原话是这个弹窗「管的事不对」。#452 只把它从对话上挪到了正文上。我给了三种位置让作者选：按来源就近弹、统一放左栏底部、统一放顶部居中。作者选了**统一放左栏底部**。

- 改动：
  - `ToastHost`：
    - 位置改成量左栏（`SidePanel` 上的 `data-toast-dock`），贴左栏内侧往上叠。宽度跟左栏走，最宽 320。
    - 左栏收起、隐藏或拖到窄于 200 时，退到活动栏右边的窗口左下角。那里压到对话（对话占满窗口）时，沿用原来的办法抬到消息列表底边之上，避开输入框。
    - 离底边原来留 36px，是给状态栏的，现在界面上已经没有状态栏，改为 8px。
  - 通知本身的样子：
    - 普通提示左边的竖条原来是紫色（`bg-agent`），违反「紫色只给 AI」，改成中性灰。
    - 「撤销」按钮挪到文字下面。左栏只有 220 宽，按钮和文字并排时，连「已删除「灵感.md」」都要折行。
    - 入场动画从右滑入改成从下浮起，配合左下角的位置。
  - 行间改写的状态提示并进全站通知：
    - `flashStatus` 改走 `emitToast`。失败用 error（读屏抢读，停留更久），其余用 info。
    - `emitToast` 新增 `key`，同一个 key 只留最新一条，连按几次 Ctrl+K 不会往上叠。
    - 删除 `buildInlineToast`、`.sf-inline-toast` 样式和 `useInlineChat` 卸载时清 toast 的副作用。
    - `UseInlineChatParams` 去掉不再用的 `setSuggestionStatus`。
    - 因此不再使用的 `slide-in-right` 动画一并删除。
- 验证：
  - 截图前后对照（`output/readme-shots/shots-popups/`，不入库）：
    - 改前：`01-toast-balanced.png`、`05-both-toasts.png`，三条通知压在正文右下，Ctrl+K 的提示被挡。
    - 改后：`30-after-balanced.png`、`32-after-inline.png`、`33-after-action-below.png`，通知在左栏底部，正文和对话都不压。连按两次 Ctrl+K 只留一条提示，删除的撤销提示单独一条。
  - 测试改动：
    - 行间改写的 5 个测试文件原来在编辑器容器里找提示文字，约 20 处断言。提示挪走后，这些断言（尤其是「不该提示 X」）会白白通过，所以改为读新的 `tests/support/toast-log.ts` 记下的通知。
    - 原来只读编辑器容器的否定断言，保留容器断言，另加一条通知断言。
    - 原来 `inline-chat-dom.test.ts` 里测 `buildInlineToast` 读屏属性的那条，随函数一起删除。改为在指令过长的用例里断言通知走 error，ToastHost 已有 error→`role=alert` 的测试。
  - `toast.test.tsx`：原来 2 条位置测试改写，另新增 2 条：
    - 位置纯函数：左栏在、拖宽到上限、收起、隐藏、过窄、对话在右、对话占满，共 7 种情况；
    - 渲染真 `SidePanel` 与 `MessageList`，通知落在左栏内侧；
    - 同 key 顶替，另一条不受影响；
    - 普通提示不用紫色。
  - 变异验证：4 处，每处至少红 1 条。用脚本定点替换（断言恰好出现 1 次）并在 `finally` 里还原，还原后核对文件内容。
    - `SidePanel` 去掉 `data-toast-dock`：红 1；
    - ToastHost 同 key 不顶替：红 1；
    - 普通提示改回 `bg-agent`：红 1（`toast.test.tsx` 1 failed | 22 passed）；
    - `flashStatus` 不带 key：`inline-chat-lifecycle` 红 1。
  - 定向：
    - 行间 6 个测试文件 121 passed；
    - `toast.test.tsx` 23 passed；
    - 前端 `tsc --noEmit` EXIT=0。
  - 前端全套 vitest：
    - 第一次跑：5 条在满载下超时（book-overview-app、focus-styles×2、suggestion-ops、workspace-layout-app，均为 5000ms 超时，与改动无关的文件）。这 4 个文件单跑 46 passed。
    - stash 后在 master 上同样跑全套：274 文件 2840 passed。
    - 回到分支再跑全套：274 文件 2841 passed，EXIT=0。
  - `pnpm verify`：EXIT=0，8 道门全过。
    - project-core 48；
    - TS 引擎 14325 passed、2 skipped；
    - 前端 274 文件 2841 passed；
    - 行间续写真实 Monaco 回归、浏览器冒烟、Agent 对话浏览器回归均通过。
    - 第一次跑时 ESLint 进程内存溢出（`Fatal process out of memory: Zone`）。当时我在同时跑变异测试，调试宿主和 Vite 也在占内存。单独重跑通过。
- 未覆盖：
  - 没在作者装机版上看，要等打包。截图用的是 debug 宿主 + 真 TS 引擎 + 示例作品，通知是在页面里直接派发事件触发的；行间提示是真按 Ctrl+K 触发的。
  - 没跑 Rust 测试和 Tauri 冒烟（没改宿主）。
  - 确认框、下拉菜单 / 浮层的问题另开分支处理。

## 2026-11-02 补：文案与注释里的「右下角」改成「左下角」

- 改动：
  - 两句界面文案：
    - 移动文件对话框：「移完右下角可以撤销」；
    - canon 写入说明：「写完右下角可以撤销」。
  - 讲通知位置的源码注释 8 处、测试名与测试注释 8 处。
  - 「输入框右下角的停止键」「按钮右下方的小浮窗」说的不是通知，没动。
- 验证：
  - 涉及的 7 个测试文件 185 passed；
  - 前端 `tsc --noEmit` EXIT=0；
  - `git diff --numstat` 与 `--ignore-all-space --numstat` 一致，没有行尾噪音。
