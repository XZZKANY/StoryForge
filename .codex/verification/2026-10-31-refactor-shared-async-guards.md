## 2026-10-31 异步「丢掉过期结果 / 卸载后不写状态」只留共享写法

开分支时 #577（前端调宿主只经 lib 封装）还没合，按约定从 `origin/refactor/host-access-path`（`f0a68dd7`）开；PR base 仍是 master。#561 在改的十二个 chat-window 文件和七个测试文件一个没动（它们里面也没有手写取消标志或挂载 ref，#561 的 diff 里也没新加，守护测试不需要为它们豁免）；车道 A 在改的 `useBookProfile.ts` 只动了加载 effect 的守卫写法和一行 import，`readTextOrNull` 的报错判断没碰。

- 改动：
  - 新建 `apps/desktop/frontend/src/lib/async-guards.ts`（`lib/` 里已有 `host-close.ts`、`app-update.ts` 这类带 hook 的模块；`lib/host-close.ts` 自己也要用，放 components 下会反向依赖）：
    - `useAsyncEffect(effect: (isCurrent: () => boolean) => void | (() => void), deps: DependencyList): void`
    - `useAsyncLayoutEffect(...)`：同签名，跑在布局阶段（只有 `useEditorFileLoader` 用）。
    - `useMountedRef(): { readonly current: boolean }`：初值 false，布局阶段挂上置 true，卸载时的布局清理置 false。
    - 回调是同步的（与 useEffect 回调一样跑完同步部分、可以返回额外清理），异步活在里面起，`await` / `then` 之后问 `isCurrent()`。清理时先让这一轮作废，再调回调返回的额外清理（与原来「先置标志、再取消订阅 / 清定时器」同序）。
    - 没照任务里举的 `(isCurrent) => Promise<void>` 写，原因：为了让调用点照 useEffect 吃依赖检查，`eslint.config.mjs` 给 `react-hooks/exhaustive-deps` 加了 `additionalHooks: '^(useAsyncEffect|useAsyncLayoutEffect)$'`；名字带 Effect 的 hook 若回调是 async，这条规则会报「Effect callbacks are synchronous」。不登记 additionalHooks 又会让 28 处调用点的依赖数组从此没人查（实测：漏写依赖不再报）。同步回调还顺带保住了一点：effect 同步部分抛错仍按 effect 出错处理，不会变成悬空的 rejected promise。
    - 共享 hook 自身两行 `eslint-disable-next-line react-hooks/exhaustive-deps`（依赖数组由调用方原样转交，规则看不到字面量数组），是通用 hook 的必然写法；调用点没有新增任何 eslint-disable。
  - 逐处分类（语义以「effect 卸载或依赖变了以后丢掉过期结果」为 A）：

    | 类 | 位置 | 处理 |
    | --- | --- | --- |
    | A 取消标志 `let cancelled = false` | `CommandPalette`、`ResourceExplorer`、`StoryNavigator`、`app/useBookProfile`、`app/useBookTitles`（另有取消监听）、`app/useProjectWorkspace`、`chat-window/PluginsBlock`、`useAgentInstructions`、`useConversationSkills`、`useComposerHint`、`WriteBatchCard`（`useWriteBatchPlan`）、`useChatSubmission`（microtask）、`useChatSessionContext` ×3、`editor/VersionHistory`、`editor/useBranchManifest`、`settings/AboutRows` | 改 `useAsyncEffect`，18 处 |
    | A 别名标志 | `chat-window/useChapterCheckHistory` 的 `let active`（同 effect 里另有 AbortController）、`app/useEditorWorkspaceTabs` 的 `let live`、`app/useTauriMenuBridge` 的 `let isCancelled`（另有复位状态与取消监听）、`editor/useMonacoEditor` 的 `let disposed`（rAF 回调过期，另有一串销毁）、`lib/host-close.ts` 三个 `let disposed`（其中两个另有取消宿主事件订阅 / 撤关窗守卫） | 改 `useAsyncEffect`，额外清理原样作为回调返回值，7 处 |
    | A 布局阶段 | `editor/useEditorFileLoader` 的 `let disposed`（`useLayoutEffect`） | 改 `useAsyncLayoutEffect`，1 处；同一判断里的请求号与 `filePathRef` 比对是 C，原样留着（`editor.test.tsx` 也钉着 `loadRequestIdRef.current === requestId`） |
    | A 写成序号 ref | `app/useChapterHandoff` 的 `seqRef`（只在这一个 effect 里加、清理时也加一，等价于取消标志）、`app/useBookOverviewChapters` 的 `generationRef` / `requestRef`（只在这一个 effect 里用，每轮都加，作用就是依赖变了丢旧结果） | 改 `useAsyncEffect`、删掉这三个 ref，2 处 |
    | 不是 A | `lib/smoke-writeback-probe.ts` 的 `let active = true` | 不是 React effect，是冒烟探针「装上到撤下」之间的开关；没迁，守护测试里豁免并写明 |
    | B 挂载 ref（布局阶段） | `editor/useSuggestionState`（经 `SuggestionState` 传给 GuardedSuggestionWrite / Intake / Undo / WholeAccept，传的仍是同一个 ref）、`app/useSessionRestore`、`settings/useModelProfiles` 的 `aliveRef` | 改 `useMountedRef`，3 处；原挂载 effect 里的其余清理（会话恢复代次 +1、关持久化闸、清快照；模型配置读写序号 +1）按原顺序留在紧随其后的布局 effect 里 |
    | B 挂载 ref（被动阶段、初值 true），**没迁** | `app/useNewProject` 的 `mounted`、`chat-window/WriteBatchCard` 的 `mounted`、`chat-window/ModelProfileSelector` 的 `aliveRef`、`chat-window/useAgentRunRecovery` 的 `alive`、`chat-window/useChatTextStream` 的 `alive`（同 effect 里还 `stream.reset()`）、`settings/usePlugins` 的 `aliveRef` | 换成布局阶段的 `useMountedRef`，卸载时置 false 会从被动清理提前到布局清理；两者之间若有在途结果回来，原来照走、现在被挡。其中 `useNewProject` 守的是 `onCreated` 打开新作品、`usePlugins` 守的是丢弃暂存导入，都是副作用，不是纯重构；守护测试里逐个豁免，留给作者定 |
    | C 身份守卫 | agent 运行一批：`useAgentRunAdmission` / `useAgentRunReconciliation` 的 `lifetime`（epoch + active）、`useConversationScope`、`useAgentRunRecovery` 的 `recoveryRevision`、`useChatTextStream` 的 `revision`、`useChatSessionContext` 第一处的 run id 比对、`useWriteBatchScheduler` 的 `owner`；其余：`useObservatory` / `useBookContext` / `useProjectSearch` / `usePlugins` / `useKnowledgeInbox` / `ModelProfileSelector` / `useModelProfiles` 的请求序号（与手动重读共用，「最后一次请求说了算」）、`useBookProfile` 的 `saveLifetimeRef`、`useBookBreakdown` 的 `projectLifetime` / `reportRevision`、`useEditorWorkspaceTabs` 的 epoch / 关闭操作号、`useNewProject` 的 `scope`、`useBranchManifest` 的写入代次、`useEditorFileLoader` 的请求号、`useChapterCheckHistory` 的 owner scope、`VersionHistory` / `useSuggestionState` / `usePatchReviewActions` 的 Symbol 令牌、`Editor` 的 `restoreOperationRef` | 不在本刀：按运行 / 会话 / 文件 / 作品身份防串台，或被 effect 之外的手动调用推进，不是「同一件事的另一种写法」 |
    | D 真取消请求 | `useChapterCheckHistory`（AbortController，A 标志已迁，`controller.abort()` 留在返回的清理里）、`useWriteBatchScheduler`（`owner.abort`）、`editor/useInlineRequest`、`lib/api/agent-delivery.ts` | 不在本刀 |

  - 依赖数组：A 类 28 处一个字都没改（原样传入，触发时机不变）；hook 调用放在原 effect 的位置，effect 注册顺序不变。B 类三处 `useMountedRef()` 也放在原挂载 effect 的位置。`useMountedRef` 给的 ref 对 exhaustive-deps 来说不再是「认得出的 useRef」，照口径把 `mountedRef` / `aliveRef` 补进了 11 个 `useCallback` 依赖数组（稳定对象，不改变回调何时重建）。
  - effect 体挪进共享 hook 后，`react-hooks/set-state-in-effect` 看不到它们了，原来的 5 条豁免指令（`ResourceExplorer`、`StoryNavigator`、`useBookOverviewChapters`、`useBranchManifest`、`useEditorFileLoader`）成了空指令会报 warning，去掉指令、原来的说明留作普通注释（去掉了只为说明豁免的「React18 合法模式」）。
  - prettier 对「带参数的回调 + 非空依赖数组」不再把回调贴着括号排，非空依赖的 21 处调用整段缩进多了两格（`useSessionRestore` / `useSuggestionState` 有两个 `useCallback` 因依赖数组变非空也一样）。所以 `git diff --numstat` 是 +771/−731，`--ignore-all-space --numstat` 是 +289/−249，差的全是缩进，不是行尾。
  - 守护测试并进 `tests/source-standards.test.ts` 两条：
    1. `src/` 里不许出现 `let cancelled|canceled|isCancelled|active|alive|live|disposed|stale|ignore(d)|mounted|unmounted = true|false`（共享模块除外）；豁免只有 `lib/smoke-writeback-probe.ts`。
    2. `…mounted… / …alive…(Ref) = useRef` 只许在共享模块里；豁免上表 6 个被动阶段文件。
    两条都双向核对（豁免的文件不再命中就要从豁免里去掉），并断言共享模块里确实导出了那几个 hook。
  - 共享 hook 单测 `tests/async-guards.test.tsx` 5 条：卸载后回来的结果不写状态；依赖变了旧一轮结果作废、新一轮照写、依赖没变不重跑；额外清理在依赖变化与卸载时都被调用且调用时这一轮已作废；`useAsyncLayoutEffect` 先于同组件先声明的 `useEffect` 跑；`useMountedRef` 渲染时 false、布局阶段起 true、卸载后 false、ref 对象不变。
- 验证：
  - `pnpm lint`：EXIT=0，0 error，2 warning 都在没动过的 `tests/independent-claim-history.test.ts`（原有），本刀 0 新 warning；prettier 全过。改动前单跑 `eslint apps/desktop/frontend/src` 为 0 warning，改后同样 0。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `pnpm --filter @storyforge/engine test`：EXIT=0，111 个文件，14267 passed / 2 skipped；`packages/` 零改动，golden 零变化。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，272 个文件，2777 passed（比上一刀多的 1 个文件 / 7 条是新单测 5 条 + 守护 2 条）。
  - 变异验证（脚本定点打变异 → 单跑对应测试 → 无条件定点改回 → 再跑）：
    - `AboutRows.tsx` 回调里加一行 `let cancelled = false;` → 取消标志守护红 1 条；改回 11 passed。
    - `useSuggestionState.ts` 把 `useMountedRef()` 换回 `useRef(false)` → 挂载 ref 守护红 1 条；改回 11 passed。
    - 共享 hook 清理里去掉 `current = false` → 单测红 2 条（依赖变化丢旧结果、额外清理时已作废）；改回 5 passed。
    - `useAsyncLayoutEffect` 改用 `useEffect` → 单测红 1 条（布局阶段先跑）；改回 5 passed。（第一次还原脚本的替换串不唯一、断言拦下没改回，随即定点改回第 30 行并复核文件内容。）
    - `useMountedRef` 初值改 true → 单测红 1 条；改回 5 passed。
  - 行尾：`useBranchManifest.ts`、`useBookOverviewChapters.ts`、`eslint.config.mjs` 原为 CRLF，改后仍全 CRLF；其余改动文件与两个新文件为 LF（随同目录多数）。
- 未覆盖：
  - 本地未跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），以 CI 为准。
  - 没动 Rust，没跑 Rust 测试与 Tauri 冒烟；`lib/host-close.ts` 的三个宿主事件订阅、`useTauriMenuBridge` 的事件通道探针只有 vitest 覆盖，没在真宿主上点过。
  - 与原来不完全一样的三处（都看过读点，判断为不可观察）：`useModelProfiles` 的 `aliveRef` 初值由 true 变 false（布局 effect 之前没有任何读点，读都在异步回来之后或事件里）；`useBookOverviewChapters` 原来只在依赖变化时作废、现在卸载也作废（只多挡掉对已卸载组件的 setState，React 18 里本就是空操作）；`set-state-in-effect` 对迁走的 28 个 effect 体不再生效（exhaustive-deps 仍经 additionalHooks 照查）。
  - 被动阶段的 6 个挂载 ref 没统一，见上表，要统一得作者接受卸载那一刻提前置 false。
