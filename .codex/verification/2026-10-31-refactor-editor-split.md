## 2026-10-31 编辑器这边按对话窗口的规矩拆小，并纳入行数门禁

### 拆分方案（动手前写定）

行号按开分支时的 `origin/master`（`621498c8`）。

原则：纯搬移，行为零变化。每个大 hook 的函数体按**源码里的先后顺序切成连续几段**，每段成为一个子 hook，由原文件（门面）按原顺序依次调用——这样组件里所有 `useState` / `useRef` / `useCallback` / `useEffect` 的调用顺序与拆前完全一致，effect 的注册先后自然不变。被搬的代码逐字照抄（缩进层级不变），依赖数组一个字符不改；子 hook 之间只传同一个对象（ref、setter、useCallback 结果原样传下去）。照 chat-window 的做法：第一个子 hook 是状态所有者，返回对象，`export type XState = ReturnType<typeof useX>`，后面的子 hook 以 `(params, state, 前面产出的函数)` 取用并在签名里解构。

**`editor/useSuggestionWriteback.ts`（1860 行）**

| 职责块（原行号） | 状态所有权 / 副作用 / 事件 / 纯函数 | 去处 |
| --- | --- | --- |
| 97–138、1854–1860 | 纯：`SuggestionOpState` 形状、按补丁对象身份存原始 op 的 WeakMap（模块单例）、`createOperationState`、`issueResolutionNote`、`firstChangedLine` | `suggestion-op-state.ts`（不含 React） |
| 89–95、140–165、185–361 | 状态所有者：待确认补丁、修订中、动作锁（begin / isCurrent / fail / finish）、半截稿两步武装（含计时器清理 effect、换补丁撤武装 effect）、`mountedRef`、`suggestionOpsRef`、`updatePendingSuggestion`（首次领取时写恢复 journal） | `useSuggestionState.ts` |
| 363–559 | 补丁进出：切走回填缓冲（reset）、`APPLY_FILE_SUGGESTION_EVENT` 监听、从缓冲领取、恢复 journal 核验与恢复（recover）、结算并清 journal（forget） | `useSuggestionIntake.ts` |
| 561–898 | 写回红线核心 `writeAcceptedSuggestion`：派生目录只读、写前快照 → 推进分支头 → 原子写（带回执）→ 版本记录、漂移拒写、结算只动目标 model | `useGuardedSuggestionWrite.ts` |
| 900–1130 | 写回后的撤销 toast：新建则删文件、漂移则指去版本历史、其余原路守卫写回 | `useSuggestionUndo.ts` |
| 1132–1384 | 整份接受（半截稿硬闸、批量写章结算、连载计划标记、事实记账）+ 自动档 effect | `useWholeSuggestionAccept.ts` |
| 1386–1570 | 分块接受 | `useHunkSuggestionAccept.ts` |
| 1616–1807 | 不写正文的三条出口：空目标页签摘除判定、存旁注、重试、拒绝 | `useSuggestionDismissal.ts` |
| 1–88、1572–1614、1809–1851 | 组合；窗口命令监听（修订结果、对话侧接受、对话侧拒绝）；返回值 | `useSuggestionWriteback.ts`（门面，留原地） |

门面调用顺序：state → intake → guarded write → undo → whole accept → hunk accept →（两个窗口监听 effect）→ dismissal →（拒绝监听 effect）→ return，与原文件自上而下的顺序一一对应。

**`editor/useInlineChat.ts`（1119 行）**

| 职责块（原行号） | 内容 | 去处 |
| --- | --- | --- |
| 55–61、74–120、974–1119 | 纯（只碰 Monaco 与 DOM）：会话形状、行高、流式区 / 加载区 / 恢复输入区的 zone 装配、焦点兜底、句内高亮段 | `inline-chat-session.ts`（不含 React） |
| 63–72、144–264 | 会话所有者：会话 ref、会话 id 与其所属项目、归属守卫（matches / isActive / qualify）、teardown、右下角 toast、落位动效 | `useInlineSession.ts` |
| 266–550 | diff 阶段：接受写回 `applyAccepted`、画红标绿块与动作条 `renderPlan` / `renderDiff`（含 Alt+Enter / Esc） | `useInlineDiff.ts` |
| 552–722 | loading 阶段：`cancelLoading`、`send`（修订单发 / 续写流式） | `useInlineRequest.ts` |
| 1–53、122–143、724–972 | 头注释、`inlineSessionIdForProject`、input 阶段入口 `open`、快捷键注册与生命周期 effect | `useInlineChat.ts`（门面，留原地） |

**`Editor.tsx`（1100 行）**

| 职责块（原行号） | 内容 | 去处 |
| --- | --- | --- |
| 92–130 | 读取中 / 读取失败遮罩组件 | `editor/EditorLoadStatus.tsx`（`Editor.tsx` 原名转出） |
| 294–383 | 保存：`saveCurrentFile`（串进写回队列的守卫写回）、`saveCurrentFileRef` 与同步 effect、`handleSave` | `editor/useEditorSave.ts` |
| 166–167、277–292、439–472 | 审稿标记：留存 issue、`applyIssueDecorations`、`REVIEW_ISSUES_EVENT` 监听、切文件清留存、改字后去抖重标 | `editor/useReviewIssueMarkers.ts` |
| 474–625 | 光标与视图同步：光标行广播 + 记光标、恢复现场光标、作者视图广播、观测定位（含挂起等加载） | `editor/useEditorCursorSync.ts` |
| 627–760 | 窗口命令：外部请求保存（含关窗握手）、导出、切版本历史 | `editor/useEditorWindowCommands.ts` |
| 762–966 | 版本恢复 / 检出节点 / 从节点开分支（每次渲染重建的闭包，照旧） | `editor/useVersionRestore.ts` |
| 其余 | 组合容器 + JSX | `Editor.tsx` |

`Editor.tsx` 里两处 effect 与原位置不连续：`applyIssueDecorations`（useCallback）与 `reviewIssuesRef`（useRef）随审稿标记块挪到 `useInlineChat` 之后调用。二者都不是 effect，前者依赖为 `[]`、只读 ref，后者初值是常量，挪动只改变 hook 槽位、不改变任何 effect 的先后与 ref 读写时机。其余块都在原位置调用。

护栏测试跟着代码走：`editor.test.tsx`（建议写回、整份接受、恢复 / 开分支、保存、原生弹窗）、`undo-writeback.test.tsx`（offerUndo）、`inline-chat.test.ts`（applyAccepted 重入闸）、`inline-chat-dom.test.ts`（装配护栏）、`inline-expansion-gate.test.ts`（polish 档）改读搬到的新文件。

### 结果

- 改动（作者要求「同一件事只留一种做法」：编辑器照对话窗口的拆法，并纳入同一道行数门禁）：
  - 三个大文件拆成 21 个文件，全部 ≤500 行：`Editor.tsx` 1100 → 467；`useSuggestionWriteback.ts` 1860 → 161（门面）+ `suggestion-op-state.ts` 62、`useSuggestionState.ts` 273、`useSuggestionIntake.ts` 256、`useGuardedSuggestionWrite.ts` 395、`useSuggestionUndo.ts` 274、`useWholeSuggestionAccept.ts` 317、`useHunkSuggestionAccept.ts` 231、`useSuggestionDismissal.ts` 222；`useInlineChat.ts` 1119 → 314（门面）+ `inline-chat-session.ts` 217、`useInlineSession.ts` 168、`useInlineDiff.ts` 321、`useInlineRequest.ts` 207；`Editor.tsx` 拆出 `EditorLoadStatus.tsx` 41、`useEditorSave.ts` 139、`useReviewIssueMarkers.ts` 77、`useEditorCursorSync.ts` 193、`useEditorWindowCommands.ts` 175、`useVersionRestore.ts` 272。
  - 对外接口不变：`Editor`、`EditorLoadStatus`、`EditorPendingSuggestionSummary` 仍从 `components/Editor` 导出；`useSuggestionWriteback` 的参数与返回值、`TRUNCATED_ACCEPT_CONFIRM_TIMEOUT_MS` 与三个类型仍从原文件导出；`useInlineChat`、`inlineSessionIdForProject` 仍从原文件导出。调用方（`WritingWorkspace.tsx`、测试、浏览器回归夹具）一行没改。
  - 写回红线相关代码（派生目录只读、写前快照 → 推进分支头 → 带回执的原子写 → 版本记录、漂移拒写、项目边界、撤销、关窗前落盘）只搬不改，逐字核对见下。
  - 依赖数组一个字符没改。拆开后，原来在同一个 hook 里 `useRef` / `useState` 出来的 ref 与 setter 改由上层传入，`react-hooks/exhaustive-deps` 认不出它们身份稳定，报了 36 条警告（拆前全仓 0 条）。没有往依赖数组里补这些 ref（那等于改依赖数组），在报警的那一行上方加了 36 条 `// eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖数组照拆分前原样；漏列的是上层传入、身份不变的 ref / setter`（导出命令那条写的是「挂载期只注册一次，handleExport 只经 ref 读最新文件」），写法照仓里已有的 `useMonacoEditor.ts:183`。
  - 门禁：`tests/source-standards.test.ts` 把 `src/components/editor` 加进 `LIVE_MODULE_ROOTS`，`src/components/Editor.tsx` 加进 `HARD_LINE_LIMITS`（500）。`STRUCTURE.md` 加「Editor Read Order」，所有权边界加四条，行数门禁一句改成覆盖三个目录。
  - 护栏测试跟着代码走（读源码的断言不再读被掏空的门面）：
    - `editor.test.tsx`：整文件漂移拒写 → `useGuardedSuggestionWrite.ts`；分块定位 → `useHunkSuggestionAccept.ts`；「请重新生成修订后再分块接受」负断言 → 九个建议写回文件合起来；半截稿硬闸 → `useWholeSuggestionAccept.ts`；恢复 / 开分支三条 → `useVersionRestore.ts`（开分支块的结束锚从 `const emptyStateHint` 换成该文件里的 `return { handleRestore`）；空文件写入 → `useEditorSave.ts`；外部 flush 读最新保存闭包 → `useEditorSave.ts` + `useEditorWindowCommands.ts`，并补两条断言钉住 `Editor.tsx` 把 `useEditorSave` 交出的同一个 `saveCurrentFileRef` 转给窗口命令；原生弹窗负断言加上从 `Editor.tsx` 拆出的六个文件。
    - `undo-writeback.test.tsx`：offerUndo → `useSuggestionUndo.ts`（路径仍经变量传给 `new URL`）。
    - `inline-chat.test.ts`：applyAccepted 重入闸 → `useInlineDiff.ts`（同上经变量）。
    - `inline-chat-dom.test.ts`：装配护栏读行间对话五个文件合起来（`assertive` 仍是 4 处：diff 1 + 请求 3）。
    - `inline-expansion-gate.test.ts`：`qualityGate: 'polish'` → `useInlineRequest.ts`；扩写关键词负断言 → 五个文件合起来。
  - 开分支经过：开工时 #566 还没合，按约定从 `origin/refactor/ui-buttons` 开；做完前 #566 合进了 master，同时 #565 改了 `Editor.tsx` 与 `useSuggestionWriteback.ts`（`pathExists` → `projectPathExists`）。按约定改从 `origin/master`（`621498c8`）重开分支，用同一个生成脚本按 master 的行号重切（`useSuggestionWriteback.ts` 1616 之后的段与 `Editor.tsx` 762 之后的段各后移 4 行），测试与文档改动按补丁原样打上，没有手工合并。

- 验证：
  - 切法：一个 Python 生成脚本按行号从 `git show HEAD:<原文件>` 取段（43 段），胶水（import、子 hook 签名与解构、返回值、`ReturnType` 类型别名、每个新文件一行职责注释）手写；再按 eslint 报警位置插抑制注释；最后 `prettier --check` 通过（被搬的行没被 prettier 动过）。
  - 行集合比对（两种做法，都在临时目录脚本里，不入库）：
    1. 逐段核对：对 43 段中的每一段，在目标文件里（去掉抑制注释行后）按顺序找一段连续、逐字相同的行（只允许 15 行补了 `export ` 前缀：被搬到新模块、需要跨文件引用的类型与函数）。结果 43/43 找到。原文件里没被任何一段覆盖的只有：三个文件的 import 块，`useSuggestionWriteback` 与 `useInlineChat` 的原签名（解构参数表，换成了 `params`），`Editor.tsx` 无遗漏（签名原样保留）。
    2. 多重集合比对：新文件里每一行（去掉 `export ` 前缀、去掉抑制注释）在原文件里找不到的，逐行列出后只有 import、签名与解构、返回对象、类型别名、职责注释与门面的组合调用；原文件里有、新文件里少了的非 import 行只有上面两个原签名（函数头加解构参数表，`useSuggestionWriteback` 13 行、`useInlineChat` 5 行；其余参数名在新签名里仍出现，故不计），`Editor.tsx` 为 0。
  - 调用顺序：三个门面按原文件里的先后顺序调用子 hook（`useSuggestionWriteback`：state → intake → 守卫写回 → 撤销 → 整份接受 → 分块接受 → 两个窗口监听 → 拒绝类 → 拒绝监听；`useInlineChat`：会话 → diff → 请求 → open 与生命周期 effect），所以全部 hook 的调用顺序与拆前逐个相同。`Editor.tsx` 只有审稿标记块里的 `reviewIssuesRef`（初值常量）与 `applyIssueDecorations`（依赖 `[]`、只读 ref）两个非 effect 槽位挪到 `useInlineChat` 之后，effect 先后不变。
  - `pnpm lint`：EXIT=0，0 error，2 warning（都在没动过的 `tests/independent-claim-history.test.ts`，拆前就有）；prettier 全部通过。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14252 passed、2 skipped；`packages/engine/golden/` 零变化（本刀没碰引擎）。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，270 个文件，2756 passed。
  - 变异验证（脚本逐条改一处、跑对应测试、按原字节还原并核对 sha256，跑完 `git status` 与跑前一致）：
    | 打在哪 | 测试 | 结果 |
    | --- | --- | --- |
    | `useEditorSave.ts` 撑到 659 行 | `source-standards.test.ts` | 红 1 条 |
    | `Editor.tsx` 撑到 987 行 | `source-standards.test.ts` | 红 1 条 |
    | `useGuardedSuggestionWrite.ts` 漂移拒写文案改掉 | `editor.test.tsx` | 红 1 条 |
    | `useSuggestionUndo.ts` 撤销改成直接 `TauriFileSystem.writeFile` | `undo-writeback.test.tsx` | 红 1 条 |
    | `useInlineDiff.ts` 去掉 `session.accepting = true` | `inline-chat.test.ts` | 红 1 条 |
    | `useVersionRestore.ts` 去掉恢复前保存脏缓冲 | `editor.test.tsx` | 红 2 条 |
    | `useInlineRequest.ts` 续写失败改 `polite` | `inline-chat-dom.test.ts` | 红 1 条 |
    | `useWholeSuggestionAccept.ts` 去掉半截稿硬闸条件 | `editor.test.tsx` | 红 1 条 |
  - 行尾：`useSuggestionWriteback.ts`、`useInlineChat.ts` 原为 CRLF，改后仍全 CRLF；`Editor.tsx`、测试、`STRUCTURE.md` 原为 LF，仍全 LF；新文件随 `components/editor/` 多数用 LF；全部无 CRCRLF。`git diff --numstat` 与 `--ignore-all-space --numstat` 只差几行空行，没有行尾翻转。

- 未覆盖：
  - 三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话）本地未跑，以 CI（`Windows Verify` 的 `pnpm verify`）为准；其中行间续写回归直接覆盖 Ctrl+K / 续写。
  - 没跑 Tauri 冒烟、真宿主探针、Rust 测试（本刀没动宿主与引擎接口）；没在装机版或真模型上点穿。
  - 36 条 lint 抑制是「依赖数组一字不改」换来的；若作者更愿意把这些稳定的 ref / setter 补进依赖数组（行为不变、可去掉抑制），可另开一刀。

## 2026-10-31 追加：36 条依赖抑制换成补稳定依赖

- 改动：上一个提交为守住「依赖数组一字不改」加了 36 条 `eslint-disable-next-line react-hooks/exhaustive-deps`。按协调者要求换掉：逐条核实 lint 报漏的每个名字的来源，只把「身份保证不变」的补进依赖数组（`useRef` 返回的 ref 对象、`useState` 的 setter；本刀没有 `useReducer`）。这些值在组件整个生命周期里是同一个对象，补进依赖数组后依赖比较永远相等，effect 的触发时机与 callback 的身份都不变，行为等价；去掉抑制后，以后真漏依赖时 lint 又能报出来。来源不是这三种的保留原抑制和理由——只有 1 处。
- 来源核实（沿传递链追到建它的那一行，不看名字）：
  - `Editor.tsx`：`editorRef`、`filePathRef`、`projectPathRef`、`modelCacheRef`、`originalContentRef`、`cleanVersionIdRef`、`isDirtyRef`、`issueDecorationsRef` 都是 `useRef(...)`；`setIsDirty`、`setShowHistory` 是 `useState` 解构出的 setter。它们以简写属性原样传给 `useEditorSave` / `useReviewIssueMarkers` / `useEditorCursorSync` / `useEditorWindowCommands`，中间没有包装。这四个 hook 只有 `Editor.tsx` 调用（全仓搜过，测试里只按文件名读源码）。
  - `useEditorSave.ts`：`saveCurrentFileRef = useRef(saveCurrentFile)`，作为返回值交给 `Editor.tsx`，再原样转给 `useEditorWindowCommands`。
  - `useSuggestionState.ts`：`mountedRef`、`pendingSuggestionRef`、`actionInFlightRef`、`assistantSessionIdRef`、`dropOpenFilePathRef`、`truncationArmedIdRef`、`suggestionOpsRef`、`recoveryEpochRef` 都是 `useRef(...)`；`setIsReviseLoading` 是 `useState` 的 setter。它们放在返回对象里，门面把同一个 `state` 对象传给各子 hook，子 hook 在签名里解构。这些都在 hook 内部建，不来自调用方参数，所以测试直接挂 `useSuggestionWriteback` 时也一样稳定。
  - `useInlineSession.ts`：`sessionRef`、`sessionIdRef`、`sessionIdProjectRef`、`registeredRef`、`openRef` 都是 `useRef(...)`，经同一个 `sessionState` 对象传给门面与 diff / 请求两个 hook；同样不来自调用方参数。
  - 逐条结果（脚本按文件白名单判定：名字不在该文件的白名单里就整条保留抑制）：

| 文件 | 位置 | lint 报漏的依赖 | 来源 | 处理 |
| --- | --- | --- | --- | --- |
| `useEditorCursorSync.ts` | effect（光标行广播 + 记光标） | `editorRef`, `filePathRef` | Editor.tsx 的 useRef | 补进依赖数组 |
| `useEditorCursorSync.ts` | effect（恢复现场光标） | `editorRef` | Editor.tsx 的 useRef | 补进依赖数组 |
| `useEditorCursorSync.ts` | effect（作者视图广播） | `editorRef`, `filePathRef` | Editor.tsx 的 useRef | 补进依赖数组 |
| `useEditorCursorSync.ts` | applyLocate | `editorRef` | Editor.tsx 的 useRef | 补进依赖数组 |
| `useEditorCursorSync.ts` | effect（LOCATE_IN_EDITOR_EVENT） | `filePathRef` | Editor.tsx 的 useRef | 补进依赖数组 |
| `useEditorSave.ts` | saveCurrentFile | `cleanVersionIdRef`, `editorRef`, `filePathRef`, `modelCacheRef`, `originalContentRef`, `projectPathRef`, `setIsDirty` | Editor.tsx 的 useRef；Editor.tsx 的 useState setter | 补进依赖数组 |
| `useEditorWindowCommands.ts` | effect（REQUEST_SAVE_ACTIVE_FILE_EVENT） | `editorRef`, `filePathRef`, `isDirtyRef`, `modelCacheRef`, `projectPathRef`, `saveCurrentFileRef` | Editor.tsx 的 useRef；useEditorSave.ts 的 useRef（经 Editor.tsx 原样转交） | 补进依赖数组 |
| `useEditorWindowCommands.ts` | effect（EXPORT_CURRENT_FILE_EVENT） | `filePathRef`, `handleExport` | `filePathRef`：Editor.tsx 的 useRef；`handleExport`：本文件里每次渲染新建的普通函数，不是三种之一 | 保留抑制（依赖数组与理由都不动） |
| `useEditorWindowCommands.ts` | effect（REQUEST_EDITOR_COMMAND_EVENT） | `setShowHistory` | Editor.tsx 的 useState setter | 补进依赖数组 |
| `useGuardedSuggestionWrite.ts` | writeAcceptedSuggestion | `assistantSessionIdRef`, `mountedRef` | useSuggestionState.ts 的 useRef | 补进依赖数组 |
| `useHunkSuggestionAccept.ts` | handleAcceptHunk | `pendingSuggestionRef`, `suggestionOpsRef` | useSuggestionState.ts 的 useRef | 补进依赖数组 |
| `useInlineChat.ts` | open | `sessionIdProjectRef`, `sessionIdRef`, `sessionRef` | useInlineSession.ts 的 useRef | 补进依赖数组 |
| `useInlineChat.ts` | effect（同步 openRef） | `openRef` | useInlineSession.ts 的 useRef | 补进依赖数组 |
| `useInlineChat.ts` | effect（注册 Ctrl+K / Ctrl+Shift+K 命令） | `openRef`, `registeredRef` | useInlineSession.ts 的 useRef | 补进依赖数组 |
| `useInlineChat.ts` | effect（正文没焦点时的 Ctrl+K 兜底） | `openRef` | useInlineSession.ts 的 useRef | 补进依赖数组 |
| `useInlineChat.ts` | effect（光标移出锚定行即拆除） | `sessionRef` | useInlineSession.ts 的 useRef | 补进依赖数组 |
| `useInlineChat.ts` | effect（换模型 / 改内容重核会话） | `sessionRef` | useInlineSession.ts 的 useRef | 补进依赖数组 |
| `useInlineDiff.ts` | applyAccepted | `sessionIdRef`, `sessionRef` | useInlineSession.ts 的 useRef | 补进依赖数组 |
| `useInlineDiff.ts` | renderPlan | `sessionRef` | useInlineSession.ts 的 useRef | 补进依赖数组 |
| `useInlineDiff.ts` | renderDiff | `sessionRef` | useInlineSession.ts 的 useRef | 补进依赖数组 |
| `useInlineRequest.ts` | cancelLoading | `sessionRef` | useInlineSession.ts 的 useRef | 补进依赖数组 |
| `useInlineRequest.ts` | send | `sessionIdProjectRef`, `sessionIdRef`, `sessionRef` | useInlineSession.ts 的 useRef | 补进依赖数组 |
| `useReviewIssueMarkers.ts` | applyIssueDecorations | `editorRef`, `issueDecorationsRef` | Editor.tsx 的 useRef | 补进依赖数组 |
| `useReviewIssueMarkers.ts` | effect（REVIEW_ISSUES_EVENT） | `filePathRef` | Editor.tsx 的 useRef | 补进依赖数组 |
| `useReviewIssueMarkers.ts` | effect（改字后去抖重标） | `editorRef` | Editor.tsx 的 useRef | 补进依赖数组 |
| `useSuggestionDismissal.ts` | handleSaveSuggestionNote | `dropOpenFilePathRef`, `pendingSuggestionRef` | useSuggestionState.ts 的 useRef | 补进依赖数组 |
| `useSuggestionDismissal.ts` | handleRetrySuggestion | `pendingSuggestionRef` | useSuggestionState.ts 的 useRef | 补进依赖数组 |
| `useSuggestionDismissal.ts` | rejectPendingSuggestion | `dropOpenFilePathRef` | useSuggestionState.ts 的 useRef | 补进依赖数组 |
| `useSuggestionIntake.ts` | resetSuggestionWriteback | `pendingSuggestionRef`, `recoveryEpochRef`, `setIsReviseLoading` | useSuggestionState.ts 的 useRef；useSuggestionState.ts 的 useState setter | 补进依赖数组 |
| `useSuggestionIntake.ts` | recoverPendingSuggestion | `actionInFlightRef`, `mountedRef`, `pendingSuggestionRef`, `recoveryEpochRef` | useSuggestionState.ts 的 useRef | 补进依赖数组 |
| `useSuggestionIntake.ts` | forgetSuggestionRecovery | `mountedRef` | useSuggestionState.ts 的 useRef | 补进依赖数组 |
| `useSuggestionUndo.ts` | offerUndo | `actionInFlightRef`, `dropOpenFilePathRef`, `mountedRef`, `pendingSuggestionRef`, `recoveryEpochRef`, `suggestionOpsRef` | useSuggestionState.ts 的 useRef | 补进依赖数组 |
| `useSuggestionWriteback.ts` | effect（SUGGESTION_RESULT_EVENT） | `assistantSessionIdRef`, `setIsReviseLoading` | useSuggestionState.ts 的 useRef；useSuggestionState.ts 的 useState setter | 补进依赖数组 |
| `useSuggestionWriteback.ts` | effect（ACCEPT_CURRENT_FILE_SUGGESTION_EVENT） | `actionInFlightRef`, `pendingSuggestionRef` | useSuggestionState.ts 的 useRef | 补进依赖数组 |
| `useSuggestionWriteback.ts` | effect（REJECT_CURRENT_FILE_SUGGESTION_EVENT） | `actionInFlightRef`, `pendingSuggestionRef` | useSuggestionState.ts 的 useRef | 补进依赖数组 |
| `useWholeSuggestionAccept.ts` | handleAcceptSuggestion | `actionInFlightRef`, `mountedRef`, `pendingSuggestionRef`, `suggestionOpsRef`, `truncationArmedIdRef` | useSuggestionState.ts 的 useRef | 补进依赖数组 |

  - 补进去的名字一律接在原依赖数组末尾，原有依赖的顺序与内容不动。
- 验证：
  - 机械核对（脚本，临时目录）：与上一个提交逐文件按词法单元比（去掉抑制注释行），差异只允许是「在依赖数组收尾的 `]` 前插入逗号和本条白名单里的名字」。结果：14 个文件、35 处插入全部合规，0 处其他改动；抑制注释 36 → 1。另有 1 处是 prettier 加的实参尾逗号：`useReviewIssueMarkers.ts` 的 `applyIssueDecorations` 带参数，依赖数组从 `[]` 变成非空后，prettier 不再把它排成一行，改成多行调用，函数体整体多缩进 2 格（`git diff --ignore-all-space` 下只剩依赖数组那几行）。这是本步唯一的空白变化。
  - `pnpm lint`：EXIT=0，0 error，只剩 2 条老 warning（`tests/independent-claim-history.test.ts`，没动过），编辑器目录 0 warning；prettier 通过。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，270 个文件，2756 passed。
  - 引擎测试由 pre-push 钩子跑（本步没碰引擎）。
- 未覆盖：同上一段；浏览器回归以 CI 为准。
