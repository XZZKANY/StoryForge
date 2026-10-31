## 2026-10-31 按钮只留三种写法：Button / IconButton / PlainButton

- 改动（作者要求「同一件事只留一种做法」）：
  - `components/ui/Button.tsx` 加第三种 `PlainButton`（`ui/index.ts` 导出）：不带任何按钮外观，className 原样接在 `sf-plain-button` 后面；只统一默认 `type="button"`（显式 `type="submit"` 照传）、焦点环、禁用光标；forwardRef，其余 props 全透传。焦点环与 `.sf-button` 同一套——`.sf-button` 自己没写 focus-visible，走的是 `index.css` base 层的全局 `:focus-visible`（2px `--agent` 描边、offset 2px），`PlainButton` 也走它；`.sf-plain-button:disabled` 的光标对齐 `.sf-button:disabled` 的 `not-allowed`。
  - 给 `Button` 加一个尺寸 `mini`：高 20px、左右 6px、字号 `--text-3xs`（10px）、行高 16px、图标与文字间距 4px。理由：观测镜条目旁的小动作（作废、不要、保留已记的、以本章为准、让 AI 查…）原来就是 10px 字、19–21px 高，最小的 `compact`（24px）会把密集列表撑高。按「先保高度」复核后共 8 处用它（Button 6、IconButton 2）。
  - 给 `Button` 加一个变体 `agent-subtle`（追加提交，见文末）：透明底、`--agent` 40% 描边、紫字，悬停 10% 紫底仍是紫字。给原来「紫描边紫字、无底」的 AI 动作用，原来就是紫实底的仍用 `agent`。
  - `src/` 里禁碰文件以外的 147 处手写 `<button` 全部换掉，按目录分提交：

    | 目录 | 换掉 | PlainButton | Button | IconButton |
    | --- | --- | --- | --- | --- |
    | shell/ | 77 | 37 | 29 | 11 |
    | app/ | 17 | 9 | 7 | 1 |
    | settings/ | 12 | 11 | 0 | 1 |
    | editor/ + components 顶层 | 22 | 13 | 7 | 2 |
    | chat-window/（禁碰之外） | 19 | 16 | 3 | 0 |
    | 合计 | 147 | 86 | 46 | 15 |

    （追加提交把速记行的改 / 删两颗从 IconButton 改回 PlainButton，上表已按最终状态。）

  - 守护测试并进 `tests/ui-primitives.test.tsx`：`src/` 里 `components/ui/` 以外的 `.tsx` 不许出现 JSX `<button`（正则先用两条样例自检）。豁免清单旁写明「等 #561 合了再收」。
  - 跟着改的测试（都是因为换了写法、断言要么会红要么会空转）：
    - `tests/new-chapter-defaults.test.tsx`：侧栏「新建文件」换成 IconButton 后不再有原生 `title`（IconButton 不接 title，悬停提示改由 Tooltip 出、文字相同），断言改查 `aria-label`。
    - `tests/version-history.test.tsx`：「恢复」原来查手写的 `bg-accent` 类，改查 `data-variant="primary"`（共享 Button 的 primary 就是强调色），「主操作走强调色、版本历史里没有 AI 紫」的意思不变。
    - `tests/accessibility-guards.test.ts`：「壳子面板的图标-only 按钮带 aria-label」原来只扫 `<button`，换完这些文件里一个都没有、护栏会空转；改成同时扫 `Button` / `PlainButton`（IconButton 的 label 由类型必填）。
    - `tests/agent-steps-panel.test.tsx`：「这行不是可点的 button」的负断言认 `sf-plain-button` 前缀，否则同样空转。
    - `tests/button-primitives.test.tsx`：补 PlainButton 的默认 type、submit、className 拼接、ref、禁用。
  - 禁碰文件一个字节没动：`chat-window/` 的 `WriteBatchPanel.tsx`、`panels.tsx`、`Composer.tsx`、`display-utils.ts`、`ContextPanel.tsx`、`ChatWindowView.tsx`、`write-batch-run.ts`；`ChatSideRail.tsx` / `ContextSummaryPanel.tsx` / `useChatSideRail.ts` / `ComposerDock.tsx` 在 master 上还没有。
  - `components/editor/inline-chat-dom.ts` 在 Monaco 视图区里用 DOM API `createElement('button')` 造按钮，不是 JSX，不在本刀范围，守护只扫 `.tsx` 里的 JSX `<button`。

- 映射口径（原 class → 新写法；追加提交后的最终版）：
  - **尺寸先保高度**：原高度 = 显式 `h-*`，没有就按「行高 + 上下内边距 + 边框」算。行高按继承算：祖先有 `text-xs` 的是 16px，有 `leading-relaxed` 的是字号 × 1.625，都没有的是字号 × 1.5（`text-2xs` / `text-3xs` 自己不设行高）。取高度不低于「原高度 − 1px」的最小一档（1px 内算行高取整误差），所以可点区域不会变小。高度和字号冲突时保高度、字号跟着档走。唯一例外是通知里的动作：原高 20px 按规则该用 `mini`，但那样字号 12 → 10px，在通知里太小，宁可高 4px，用 `compact`（24px、12px 字）。

  | 原高度 | 尺寸 | 用在 |
  | --- | --- | --- |
  | 19–21px | `mini`（20） | 观测镜：作废、补录确认里的取消、保留已记的、以本章为准、不要、让 AI 查（通知里的动作原高也是 20px，按例外用 `compact`） |
  | 22–25px | `compact`（24） | `h-6` 的：拆书「打开 Markdown」「查看 JSON」「放进 写法/」、复制 / 重新生成、作品总览上下文「重试」；10px 字带边框 22px 的：确定补录、补录…、并入、标为已回收；`py-1` 无边框 24px 的：版本「恢复」、分支「恢复到编辑器」、作品库页脚「设置」 |
  | 26–29px | `xs`（28） | `h-7` 的：知识收件箱七颗（编辑 / 审阅 / 拒绝 / 取消 / 关闭 / 保存修改 / 确认写进文件）、拆书「生成拆书报告」「取消」、面板错误与搜索的「重试」、标题栏两颗、决定里的提交；`py-1` 带边框 26px 的：章节索引「重试」、重新读取大纲 / 资料、版本「对比当前」、分支「从此开分支」「对比父版本」；「← 作品总览」（被页签栏撑到 32px，Button 一样被撑开） |
  | 32px | `sm` | 编辑器「重试读取」「重新载入界面」 |
  | 36px | `md` | 继续写第 N 章、AI 起草第 N 章 |

  | 原底色 / 边框 | variant |
  | --- | --- |
  | 无边框无底 | `ghost` |
  | 中性边框（含错误框里红描边的「重试」，重试不是危险操作） | `secondary` |
  | `bg-accent` / `bg-foreground` | `primary` |
  | 紫实底 `bg-agent` | `agent` |
  | 紫描边紫字、无底（`border-agent/40 text-agent`） | `agent-subtle` |
  | 平时灰、悬停变红的「拒绝」 | `danger` |

  - 纯图标 `h-7 w-7` / `h-6 w-6` / `h-5 w-5` → `IconButton` 的 xs / compact / mini（方框尺寸与原来一致）。

  - 只留下布局类（`mt-*`、`ml-auto`、`my-1` 等）放进 Button 的 className；外观类（高、内边距、圆角、字号、颜色、hover）全去掉，由共享尺寸与变体出。图标挪到 `leadingIcon` / `trailingIcon`。
  - IconButton 会把 className 同时给 Tooltip 外壳和按钮本身，所以需要定位或「悬停才显示」的图标钮（搜索框清空、作品库移除、模型套「更多操作」）外面包一层 `<span className="… flex">` 管定位与显隐，IconButton 本身不带 className；原来的 `focus-visible:opacity-100` 相应改成外壳上的 `focus-within:opacity-100`。
  - Tooltip 口径：**纯图标钮一律带悬停提示**，光看图标说不清做什么。原来有 `title` 的，title 原文作 Tooltip（与 aria-label 不同就写 `tooltip=`）；原来只有 aria-label 的（模型套「更多操作」）或只有 title 的（编辑器「…」更多，顺带补上了 aria-label）也加上。本刀没有用 `tooltip={false}` 的地方。
  - PlainButton 用在这些（原 className 原样保留）：列表行 / 卡片 / 树节点 / 折叠行；页签（含页签关闭钮——它的悬停底色专门跟激活页签拉开、脏点叠在上面，是页签的一部分）；菜单项与选项（`role=menuitem/option`，含**菜单里的图标动作**：侧栏作品菜单的「从最近打开移除」、会话菜单的改名 / 移除——Tooltip 自己是一层浮层，焦点落到菜单里的图标钮就会叠到菜单层上，Esc 先关提示、Tab 不再按菜单规则退出，所以菜单内保留原生 title）；速记行的改 / 删（原来是无框 11px 小图标，套 20px 方钮会把速记行撑高，同口径保留原 className、aria-label 与原生 title）；单选块 / 分段切换 / 筛选片 / 可切换标签片 / 开关 / 色板；标签片里的移除叉（套 20px 方框会把标签片撑高）；勾选圈（观测「标记已处理」两处、速记勾选）；文字链接；活动栏图标、标题栏窗口控制钮、标题栏命令面板假搜索框；下拉选择器的触发器（作品切换、ComposerMenuSelect——显示当前值 + ▾，是选择控件不是动作按钮）；对话开场的五个建议片（圆角紫描边药丸，见下「故意没统一」）。

- 观感变化明显的点（最终版；第一版里的「紫描边变紫实底」「知识收件箱按钮 28 → 20px」「速记行变高」已在追加提交里修回）：
  - 错误框里的重试由红描边红字变成中性 secondary（重试不是危险操作）：作品总览「章节索引重试」「重新读取大纲」「重新读取资料」。
  - 知识收件箱「拒绝」由平时灰字、悬停才红，变成 danger 常显红描边红字。
  - 通知里的动作（如「撤销」）由紫色加粗文字变成 secondary 描边按钮（通知动作不都是 AI 的事，紫色只给 AI）；尺寸是「保高度」规则的唯一例外：用 `compact`（24px、12px 字），比原来高 4px，字号不变。
  - 保高度带来的字号变化：变大的——知识收件箱七颗、拆书三颗、复制 / 重新生成、确定补录 / 补录… / 并入 / 标为已回收 10 → 12px，分支图节点三个动作、作品总览几颗重试 11 → 12px，编辑器「重试读取」「重新载入界面」12 → 14px；没有变小的。
  - 高度变高 1–4px 的（取不小于原高度的档）：确定补录 / 补录… / 并入 / 标为已回收 22 → 24px，`py-1` 带边框的几颗 26 → 28px。
  - 「继续写第 N 章」「AI 起草第 N 章」去掉了 `font-medium` 和 `interactive-press` 按压回弹（共享 Button 没有这两样）。
  - 标题栏「AI 面板」收起时文字由 foreground 变成 ghost 的 muted；带边框的小按钮都多了 surface 底色；原来 `rounded-sm` 的（观测镜、知识收件箱、通知里的）圆角 4 → 6px。
  - 原来在悬停行上用 `hover:bg-surface` / `hover:bg-background` 拉开层次的图标钮（文件树文件夹行的新建、作品库的移除），换 IconButton 后悬停底色统一成 elevated，在同样是 elevated 的悬停行上看不出底色变化（图标仍会变亮）。

- 故意没统一成 Button / IconButton 的：
  - 对话开场的五个建议片（PartnerOpening）：换 agent 会变成一排紫色实底块，违背「紫色当金子省着用」；它们是一组并排的建议，按「标签片」归 PlainButton。
  - 页签关闭钮、菜单里的图标动作、速记行的改 / 删、标签片里的移除叉、勾选圈：理由见上，都是所属复合控件的一部分，套共享方框会改尺寸或叠浮层。
  - 活动栏和标题栏窗口控制钮：前者要跟同一列的视图图标同尺寸同圆角，后者是贴边的系统控制钮（关闭悬停红底），共享 IconButton 都给不出。

- 验证：
  - `pnpm lint`：EXIT=0（eslint 0 error，2 条既有 warning 在 `tests/independent-claim-history.test.ts`；prettier 全部通过；改过的测试文件另跑 `prettier --check` 通过）。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14251 passed / 2 skipped；`packages/` 无改动，golden 零变化。
  - `npm --prefix apps/desktop/frontend run test`（前端 vitest 全套）：EXIT=0，270 个文件，2747 passed（改前 2745，多的 2 条是 PlainButton 行为与守护）。每换完一个目录都跑过一次全套。
  - 开分支时 #564 还没合，按约定从 `origin/refactor/ui-single-icon-source` 开；推送前 #564 已合进 master，于是 rebase 到 `origin/master`（`eb3ea379`，无冲突）后四道门复跑：`pnpm lint` EXIT=0（同样 2 条既有 warning）、typecheck EXIT=0、引擎 EXIT=0（111 个文件，14252 passed / 2 skipped，golden 零变化）、前端 EXIT=0（270 个文件，2751 passed，含 master 新合进来的用例）。rebase 后的合并树里，`components/ui/` 以外只有豁免的 4 个文件还有 `<button`。
  - 变异验证（每次单跑对应测试文件，打完按字节定点改回，`git diff` 确认与提交一致后复跑变绿）：
    1. `MessageActions.tsx` 塞回一个手写 `<button type="button">` → ui-primitives 守护红（1 failed / 9 passed，点名该文件）；改回 10 passed。
    2. `Titlebar.tsx` 最小化钮（PlainButton）去掉 `aria-label` → 可达性护栏红（点名这枚 PlainButton）；改回 8 passed。说明护栏扩到 PlainButton 后不再空转。
    3. `PlainButton` 默认 `type` 改成 `'submit'` → button-primitives 的 PlainButton 用例红（1 failed / 2 passed）；改回 3 passed。
    4. `AgentStepsPanel.tsx` 不可点的那行 `<div>` 换成 PlainButton → agent-steps-panel 的负断言红（1 failed / 12 passed）；改回 13 passed。
  - 自查：对比改前改后每个文件，被删掉的属性行只有两类——Button 被 prettier 收成一行（逐条核过还在）、图标钮的 `title` / `aria-label` 变成 `label` / `tooltip`；`data-testid`、`aria-*`、事件处理、`disabled`、`ref`、`role`、`tabIndex` 都在。`src/` 里没有表单内不写 type 的按钮（唯一的表单 NewProjectDialog 已用 Button），所以默认 `type="button"` 不改提交行为。
  - 行尾：改过的文件都保持原样（CRLF 的 `EditorTabs.tsx`、`Titlebar.tsx`、`index.css`、`ui/index.ts`、`button-primitives.test.tsx`，其余 LF）；`git diff --numstat` 628/638，`--ignore-all-space` 613/623，差的是外包 span 后的缩进。本记录随同目录用 LF。

- 豁免（守护测试里的 `BUTTON_EXEMPT`，等 #561 合了再收）：`chat-window/` 的 `panels.tsx`（现有 10 处）、`Composer.tsx`（4）、`ContextPanel.tsx`（3）、`ChatWindowView.tsx`（2）、`WriteBatchPanel.tsx`（0），以及 #561 新加的 `ChatSideRail.tsx`（它的分支上 1 处）、`ContextSummaryPanel.tsx`（3）、`ComposerDock.tsx`（0）——先列上，免得两个 PR 谁先合都把对方的 CI 打红。

- 未覆盖：
  - 没在真宿主或浏览器里看观感，上面的变化是按 class 与共享尺寸推出来的（原高度按继承行高手算），不是截图对照；尤其通知动作变描边按钮、错误框重试变中性，需要作者看一眼。
  - IconButton 的 Tooltip 在两个边角没真机点过：通知里的关闭钮在有模态弹窗时悬停、菜单触发钮（编辑器润色 / 更多、模型套更多操作）在菜单开着时悬停——提示层会叠在最上，Esc 先关提示。
  - 本地未跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），以 CI `Windows Verify` 的 `pnpm verify` 为准。
  - 未跑 Rust 测试与 Tauri 冒烟（本刀不动宿主）。

## 2026-10-31 追加：修三处统一带来的观感回退（同一分支，#566 合之前）

- 改动（协调方审 #566 后要求；上文映射表、目录表、观感清单已同步成最终版）：
  1. 紫描边被换成紫实底：`Button` 加变体 `agent-subtle`（`ui/Button.tsx` 的 `ButtonVariant` 与 `index.css` 各加一处，写法照现有 `.sf-button[data-variant=...]`：透明底、`border-color: rgb(var(--agent) / 0.4)`、`color: rgb(var(--agent))`，悬停 `background: rgb(var(--agent) / 0.1)` 仍是紫字）。在本 PR 的 diff 里 grep 原来带 `border-agent` / `text-agent` 的按钮，被映射成 `agent` 实底的只有两处，都改用 `agent-subtle`：作品总览「AI 起草第 N 章」、观测镜检查器「让 AI 查」。原来就是紫实底的知识收件箱「确认写进文件」仍是 `agent`；通知动作原来是紫字无底，但当初映射成 secondary 不是 agent，按要求先不动；其余 3 处 `variant="agent"`（ChapterBriefCard、WriteBatchCard、WriteBatchResultCard）是本 PR 之前就有的。
  2. 尺寸先保高度：规则改成上文「尺寸先保高度」，逐颗复核 46 处 Button（原高度按继承行高手算），改了 22 处：
     - `mini` → `xs`（原 `h-7`）：知识收件箱 编辑 / 审阅 / 拒绝 / 取消 / 关闭 / 保存修改 / 确认写进文件（7）。
     - `mini` → `compact`（原 `h-6`）：拆书「打开 Markdown」「查看 JSON」「放进 写法/」、复制、重新生成（5）。
     - `mini` → `compact`（10px 字带边框，原 22px）：确定补录、补录…、并入、标为已回收（4）。
     - `compact` → `xs`（`py-1` 带边框，原 26px）：章节索引「重试」、重新读取大纲、重新读取资料、版本「对比当前」、分支「从此开分支」「对比父版本」（6）。
     - 通知动作（原 20px：通知容器 `text-xs` 行高 16 + `py-0.5`）：一度按规则改成 `mini`，复核后协调方定为规则的唯一例外，仍用 `compact`——`mini` 会让字号 12 → 10px，通知里太小，宁可高 4px。所以实际改动是 22 处。
     - 不用动的另外 24 处（含上面的通知动作）：观测镜 作废 / 取消 / 保留已记的 / 以本章为准 / 不要 / 让 AI 查（19–21px，mini）；其余 `h-6`、`h-7`、`h-8`、`h-9` 和 `py-1` 无边框 24px 的本来就按高度对上了。纯图标钮的方框尺寸原来就和 `h-*` / `w-*` 一致，不用改。
  3. 速记行的改 / 删：从 IconButton（20px 方钮 + 外包 span）改回 PlainButton，原 className（`mt-[2px] … opacity-40 … group-hover:opacity-100`）、`aria-label`、原生 `title` 原样，`data-testid="book-note-edit"` 还在。和菜单里的图标动作同一口径。
  - `tests/ui-primitives.test.tsx` 加一条：`ButtonVariant` 的 6 个变体、除默认 `sm` 外的 5 个尺寸，在 `index.css` 里都有 `.sf-button[data-…='…'] {` 这条基础规则。

- 验证：
  - `pnpm lint`：EXIT=0（2 条既有 warning，prettier 通过）。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14252 passed / 2 skipped；`packages/` 相对 master 无改动，golden 零变化。
  - `npm --prefix apps/desktop/frontend run test`：EXIT=0，270 个文件，2752 passed（多的 1 条是变体 / 尺寸样式那条）。
  - 变异验证：把 `index.css` 里 `.sf-button[data-variant='agent-subtle'] {` 改名成 `agent-soft` → 新那条红（只剩悬停规则时也拦得住，因为断言带 ` {`）；按字节改回后 11 passed，`git diff` 里 `index.css` 只剩新增的两段规则。
  - 行尾：`index.css` 仍是纯 CRLF（1275 行），其余改过的文件仍是纯 LF；本记录 LF。

- 未覆盖：同上文——没截图看观感；本地未跑三个浏览器回归，以 CI 为准；未跑 Rust 测试与 Tauri 冒烟。

## 2026-10-31 追加：通知动作保字号（「保高度」规则的唯一例外）

- 改动：`shell/ToastHost.tsx` 的通知动作改回 `size="compact"`（24px、12px 字）。按「保高度」它该是 20px 的 `mini`，但那样字号 12 → 10px，在通知里太小，宁可高 4px。上文映射口径、观感清单与追加说明已同步注明这是唯一例外；`mini` 现在 8 处在用。
- 验证：`pnpm lint` EXIT=0（2 条既有 warning，prettier 通过）；`npm --prefix apps/desktop/frontend run test -- tests/toast.test.tsx tests/ui-primitives.test.tsx` EXIT=0，2 个文件 32 passed。推送时 pre-push 钩子另跑前端全套与引擎。
- 未覆盖：同上文。
