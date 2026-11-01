## 2026-10-31 批量写章进度与参考资料收成贴在输入框顶边的小条

- 改动：作者指出输入框上方那几块「应该是附在对话框的一个小行」、现在的设计不好。原来批量写章进度条、参考上下文各是一张悬在输入框上方的圆角卡（各自带边框、间距和一颗大按钮），展开后是一段「上下文 8/8 文件，8575 字符；超出席位 6；作品里：……」的内部用语。现在：
  - `ComposerBox` 加 `dock` 插槽，小条本身是新组件 `ComposerDock.tsx`（`Composer.tsx` 加了插槽后到 510 行，超了源码标准的 500 行上限，把小条拆出去回到 500）：输入框顶边一条窄一圈的小条（上圆角、无下边框，压在输入框上沿），各行之间细分隔线，没有行要显示时整条收起（`empty:hidden`）。
  - 批量写章进度：一行小字 + 紫色小点（AI 在干活）+ 小号「停止」；窄栏放不下时只截后面的用量，「第几章（几 / 共几）」总看得全。文字与测试钉住的原文一字不差。
  - 参考资料：收起时一行「参考资料 · 8 份 · 6 份没带上」，右边小号「添加」；展开后说人话——「这一轮带了 8 份参考资料，共 8575 字」、文件只列名字（悬停看路径）、「另有 6 份没带上：每轮最多带 8 份，想带上哪份就点「添加」固定它」。去掉「超出席位」「字符」「作品里：大纲2…」。份数满了挤掉几份是常态，改成中性灰字；读不出的才亮警告色。展开或打开选择列表时整块限高 40vh，标题行不动、下面一起滚（之前放进小条后会无限长高顶出对话栏，截图时发现后修掉）。
  - 按钮换共享 `Button`（compact / ghost），和统一组件会话已打过招呼（它先不碰这几个文件）。
- 验证：
  - `npm --prefix apps/desktop/frontend run typecheck` 通过。
  - 定向 9 个测试文件（chat-ux-polish / conversation-starters / chat-window-error-states / chat-column-alignment / chat-feedback-gaps / chat-window / write-batch-scheduler / write-batch-review / composer-client-surface）129 passed。改了的测试：措辞断言换成新话（`超出席位 2` → `2 份没带上` 等），`contextBudgetText` 的旧断言拆成对 `contextCoverageWarnings` 文本与色调的断言；「context summary is column-width」换成两条：参考资料与批量写章进度都在 `composer-dock` 里、小条紧贴输入框表单上沿且两行都不自带边框成卡；没有行时小条无子节点。另在整窗测试里补两条接线断言：打开参考资料后 `context-summary` 在 `composer-dock` 里（conversation-starters）、批量写章进行中 `write-batch-progress` 在 `composer-dock` 里（write-batch-scheduler）。
  - 变异验证（脚本逐个改、跑、按原字节还原并断言还原一致）：M1 `ComposerBox` 把各行渲染在小条外 → 3 条红（dock 测试、两条整窗接线）；M2 小条挪到输入框下面 → 1 条红（紧贴上沿）；M3 份数挤掉也亮警告色 → 1 条红；M4 进度行自带 `rounded-lg border` → 1 条红。还原后 `git status` 只剩本分支改动。
  - 观感：用真组件 + 真 `index.css` 搭的临时预览页（不入库）经 Playwright 2 倍截图，暗色、浅色各一组，四种状态（批量写章 + 收起 / 展开 / 有读不出的 / 打开选择列表）。
- 未覆盖：没在真宿主、装机版上看；没跑 Rust 测试与 Tauri 冒烟（没动宿主与引擎接口）。暂停条、权限 / 修订待确认条（`RunActionBar`）仍是输入框上方的独立卡，这次没动。

## 2026-10-31 对话占满中右时右边出侧栏（借桌面 Claude 的右侧面板）

- 改动：作者看了对话占满中右（Ctrl 3）的截图说「左右两边空空的」，在三个方案里选了「阅读宽度不变、右边放东西」，并要求借桌面 Claude 右侧面板的样子。现在：
  - 对话占满中右且对话区够宽（≥ 1000px，`useChatSideRail` 用 ResizeObserver 量）时，对话右边出一张 18rem 的侧栏卡（`ChatSideRail.tsx`），从上到下：批量写章（进行中才有）→ 参考资料 → 长期规矩 / 技能 / 插件 / 这一轮读了（就是对话头「上下文」浮窗里那份 `ContextPanel`，加了 `scrollClassName` 让侧栏自己滚）。
  - 批量写章一块：标题行带「停止」，「第 12 章（2 / 10）· 已用 / 上限」，细进度条，每章一行（✓ 已写进带字数、● 正在写、○ 待写、已有正文、停在这里等）。每章去向用引擎记录里的 `state`（调度器在开跑和每次 `onRecorded` 时把记录交给进度，`WriteBatchProgress.chapters`），章名用开跑时计划里的标题；写进了的章点了打开文件。界面只把「调度器正在发起的那章」标成正在写，不自己判定写没写。
  - 有侧栏时不重复放：输入框顶边小条不再放批量写章进度和参考资料说明；对话头那颗「上下文」按钮换成收起 / 展开侧栏（收起记在本机 `storyforge:chat-side-rail`），收起后一切回到小条和浮窗。
  - 截图时发现的问题一起改了：侧栏模式下点输入框的「+」，选择列表原本会出在右上角侧栏里，离按钮很远。参考资料拆成独立文件 `ContextSummaryPanel.tsx`（从冻结的旧账 `panels.tsx` 里搬出来，`panels.tsx` 1026 → 748 行），分三种摆法：dock（小条一行，同前）、rail（侧栏里的说明，不含选择列表，有过一轮参考资料就一直列着）、picker（有侧栏时输入框顶边只放选择列表）。
- 验证：
  - `pnpm verify` EXIT=0（前端单测 270 文件 2739 条，含新文件 `tests/chat-side-rail.test.tsx` 6 条；三个浏览器回归全绿）。
  - 变异验证（脚本逐个改、跑、按原字节还原，并逐个 grep 确认原句还在）：M5 去掉「只在对话占满时」→ 起初没红（平衡档首次渲染量不到宽度，等价存活），据此补「从对话占满切回平衡侧栏就收走」一条后变红；M6 有侧栏时小条照旧放进度 → 2 条红；M7 有侧栏时不在输入框上方放选择列表 → 1 条红；M8 认不出正在写的章 → 1 条红；M9 收起不记在本机 → 1 条红。
  - 观感：拿浏览器回归的隔离替身（`verify-agent-conversation.mjs` 的副本，临时放在 scripts/ 下、用完移出仓库）在 1400×760 下走真界面：开作品 → 审稿一轮 → Ctrl 3 → `/写 1-3` 开始写（替身把写章请求压 30 秒，好截到「正在写」），截了侧栏展开、点「+」选资料、收起侧栏三张。替身没有 Tauri 宿主，侧栏里长期规矩 / 技能 / 插件三块显示「读不到…only available inside the Tauri desktop runtime」，是替身环境所致。
- 未覆盖：没在真宿主、装机版上看；侧栏宽度阈值 1000px 按 1400×760 窗口定，没在更窄、带左栏的真实窗口里调过；浅色主题只核了用的都是现有色板 token，没截到浅色（主题由 CSS 变量注入，改 `data-theme` 截不到）。

## 2026-10-31 暂停条、待确认条也收进输入框顶边小条

- 改动：作者要求暂停条和确认条也改成一样的。`RunActionBar` 的三种样子（暂停：恢复 / 停止；结果未知：核对状态 / 请求暂停 / 请求停止；要作者拍板：允许 / 不允许，或接受写进文件 / 拒绝 / 拒绝并告诉 AI 怎么改）不再各自是带边框、自占一条栏的卡，改成 `ComposerDock` 里的一行，按钮换 compact 尺寸；`DecisionChoices` 的高亮行底色从 `bg-elevated` 换成 `bg-background`（小条底色就是浅灰，原色看不出来）。有侧栏时它们也留在小条里，紧挨输入框，不进侧栏。轻状态条（「本轮已由你停止」「重试本轮」）和章纲确认卡没动。
- 验证：
  - `pnpm verify` EXIT=0（前端 270 文件 2738 条，三个浏览器回归全绿）。原来三条「操作条是栏里的一张卡」的测试改成「是小条里的一行、外层不带 border / rounded-lg / 不自占栏」；整窗测试在待确认时断言 `run-action-bar` 在 `composer-dock` 里。
  - 变异：M10 暂停行又加回 `rounded-lg border` → 1 条红；M11 操作条整个不渲染 → 1 条红；M12 操作条渲染在小条外（输入框上方）→ 1 条红。均按原字节还原。
  - 观感：真组件 + 真 CSS 临时预览页（用完删除）截了暂停（叠在批量写章进度下）、写进文件确认、要权限、结果未知四种。
- 未覆盖：没在真界面里走到暂停 / 待确认（替身没有这两种回放），没在装机版上看。

## 2026-11-01 合 master（#559–#586「架构与组件统一」那一串）

- 改动：作者 11-01 定「先合 #561」。在另一个工作区从 `origin/ui/composer-dock` 开 `composer-dock-merge`，`git merge origin/master`（不 rebase、不 force push），合并提交 `74eb4a42`，推回 `ui/composer-dock` 是快进。
  - 没有文字冲突。两边都改过的只有 `DecisionChoices.tsx`，自动合并后两边的意图都在：本分支把高亮行底色换成 `bg-background`，master 把行里的按钮换成共享 `Button` / `PlainButton`。
  - 为过新守护改的文件：无。合进来的守护（`tests/ui-primitives.test.tsx`、`tests/source-standards.test.ts`、`tests/tauri-fs.test.ts`）在合并后的树上全绿；本分支新增 / 改动的文件里没有豁免以外的违规：没有直引 `lucide-react`、手写 `<svg>`、`animate-spin`、`role="dialog"` / 遮罩、手写取消标志、`storyforge:` 事件名字面量（`storyforge:chat-side-rail` 是 localStorage 键，守护按设计不算）、`@tauri-apps` 直引、按分隔符手拼路径、重名组件函数；行数都在上限内（`Composer.tsx` 正好 500、`ContextSummaryPanel.tsx` 440、`ChatWindowView.tsx` 391；`panels.tsx` 742 在冻结豁免里）。
  - 守护给本分支的临时豁免（`BUTTON_EXEMPT` 里的手写 `<button>`，`ContextPanel.tsx` 的 `role="menuitem"` 与菜单外框，`panels.tsx` 的悬停显现与行数）这一步不撤，留给下一刀。
  - 设计与行为没动；合并后没有因 master 那边的改动而红的测试，测试一条没改。
- 验证（合并后的树）：
  - `pnpm lint` EXIT=0（0 error；2 条 `no-explicit-any` warning 在 `tests/independent-claim-history.test.ts`，master 上就有）。
  - `npm --prefix apps/desktop/frontend run typecheck` EXIT=0。
  - `npm --prefix apps/desktop/frontend run test` EXIT=0：274 文件 2822 条全过。另单跑守护与本分支的测试 10 个文件（ui-primitives / source-standards / tauri-fs / chat-side-rail / chat-column-alignment / chat-ux-polish / conversation-starters / write-batch-scheduler / chat-feedback-gaps / chat-window-error-states）120 条全过。
  - `pnpm --filter @storyforge/engine run typecheck` EXIT=0；`pnpm --filter @storyforge/engine test` EXIT=0：111 文件 14271 passed / 2 skipped（含 golden）；`git diff origin/master -- packages/engine/golden` 为空。
  - `pnpm --filter @storyforge/project-core test` EXIT=0：5 文件 48 条。
  - 变异（确认合进来的守护真的扫到本分支新加的文件）：把 `ChatSideRail.tsx`「正在写」小点的 `animate-pulse` 改成 `animate-spin` → `ui-primitives` 的「animate-spin 只出现在 components/ui 里」红 1 条、点名 `ChatSideRail.tsx`；脚本按原字节还原并断言一致，`git status` 干净。
- 未覆盖：本地没跑三个浏览器回归（本机有别的会话在跑 headless Chrome，会互相拖超时），以 CI `Windows Verify` 的完整 `pnpm verify` 为准；没跑 Rust 测试与 Tauri 冒烟（合并没动宿主与引擎接口）；没在真宿主、装机版上看。
