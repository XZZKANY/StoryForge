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
