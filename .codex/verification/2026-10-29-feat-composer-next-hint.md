## 2026-10-29 对话输入框空着时显示「下一句」灰字，Tab 填入（作者内部记 #22）

- 改动：
  - 原因：作者 10-29 批准，输入框为空、AI 没在跑时，把占位文字换成一句「下一句可以说什么」；按 Tab 填进输入框（光标在末尾，可再改），直接打字灰字自然消失。确定性规则、不调模型。
  - 规则全在 `apps/desktop/frontend/src/lib/composer-hint.ts`（纯函数），从上到下取第一个命中的，都不命中用原占位文字：
    1. AI 运行中（`agentBusy`）→ 不提示。
    2. 本会话刚接受了一份补丁（之后作者没再发一句、没切会话）：a. 接受的是第 N 章正文 →「接着写第 N+1 章」；b. 接受的是立项文件、还没有正文、立项还缺总纲或人物 → 按引擎 `SETUP_KINDS` 顺序「接着写总纲」/「接着建主角人物」（只缺世界规则不出这一类）；c. 立项已齐、还没有正文 →「开写第一章」。
    3. AI 最后一条回复去掉末尾空白、Markdown 符号（星号、下划线、反引号、波浪号、井号）、右引号 / 右括号后以 `？` / `?` 结尾 →「按你的建议来」。
    4. 立项已齐、还没有正文 →「开写第一章」。
    5. 新会话、书是空的（没有正文、三类立项文件一份都没有）→「先聊聊这本书想写什么」。
    6. 新会话、已写到第 N−1 章 →「先聊聊第 N 章怎么写」，N 取 `chapter-handoff` 的 `resolveHandoffChapters(...).next.chapterOrdinal`（最后一章空着时 N 就是那个空章）。
  - 事实来源：章序用 `book.context` 章节（与作品总览「接着写」、新会话开场同一份，经 `chapter-handoff`）；正文章节判断用 `lib/api/manuscript-paths.ts` 的 `countsAsChapter`；立项事实由引擎新函数 `projectSetupFacts`（`packages/engine/src/kernel/projectSetup.ts`）给出 `{ hasManuscript, missing }`，与 #462 立项检查同一套判断（把原循环抽成内部 `missingSetupKinds`，`missingSetupBeforeFirstChapter` 语义与调用方不变）；立项文件归类用引擎新函数 `setupKindOfPath`（同一张目录表 + 同一组文本后缀）。前端入口照 `author-instructions` 那条链：`lib/api/project-setup.ts` → `lib/engine/projectSetup.ts`。读不出返回 null，不给依赖立项的提示，不报错。
  - 接线：`components/chat-window/useComposerHint.ts`。「刚接受」挂在对话里「已写进…」用的同一个写回成功信号（`AUTHOR_LOOP_RESULT_EVENT`，`completed` + `revision_accepted`）上，会话归属判断与 `useAgentRunControls` 里那段相同；记下接受时的会话生命周期（`conversationScope`）和作者已发几句，任一变了就作废。立项事实在打开 / 切换会话、接受成功、一轮结束（`agentRun` 状态变化且不在跑）时各读一次，按键不读。
  - 输入框（`Composer.tsx`）：新增 `hint` 属性；灰字 = 提示句 + `　· Tab 填入`；Tab 只在输入框为空、有提示、不在输入法组字、没有 @ 提及菜单或上下文选择打开、没按 Shift/Ctrl/Alt/Meta 时接管，填的是提示句本身；其他情况 Tab 照旧。没打开项目时仍是禁用占位文字。
- 验证：
  - 引擎 `npx vitest run src/kernel/projectSetup.test.ts`：9 passed（新增 `projectSetupFacts` 3 条：空书、与立项检查一致、有正文后照实列缺口而立项检查保持沉默；`setupKindOfPath` 1 条：两种分隔符、非文本后缀、非立项目录、正文路径）。
  - 前端 `npx vitest run tests/composer-hint.test.ts`：28 passed（每条规则命中；运行中压过一切；刚接受压过问句；立项已齐的「开写第一章」压过问句；问句尾巴 `？」`、`?**`、带空白换行、引用块、全角括号、反引号；不算问句的 4 种；章节列表还没刷新到刚接受那章时不编章号；空章时 N 取空章、只有一个空章不出规则 6）。
  - 前端 `npx vitest run tests/composer-next-hint.test.tsx`：9 passed（真 `ChatWindow` 挂载：新会话空输入框显示「先聊聊第 6 章怎么写　· Tab 填入」、Tab 填入、有字时 Tab 不接管；运行中不显示、Tab 不接管；刚接受第 5 章 →「接着写第 6 章」、打字三次立项事实读取次数不变、作者再发一句即失效；切到新会话作废；写回失败与导出不算。`ComposerBox` 直挂：Shift+Tab、输入法组字、上下文选择打开时不接管；没打开项目时禁用占位）。
  - 接线变异（各打一处、跑 `composer-next-hint.test.tsx` 确认变红，脚本先备份再用带 `count==1` 断言的定点替换，finally 里无条件还原并比对字节一致；没用 git checkout / stash）：
    - `ChatWindowView` 不把提示传给输入框 → 2 条红。
    - Tab 接管不看输入框是否为空 → 2 条红。
    - 刚接受不看作者已发几句 → 1 条红。
    - Tab 接管不看上下文选择是否打开 → 1 条红。
    - 「刚接受」不看写回是否成功 / 是否接受 → 1 条红。
  - 相关旧测试：`composer-client-surface`、`partner-opening`、`source-standards` 与上面两份同跑 5 个文件 63 passed。
  - 行尾：`Composer.tsx`、`ChatWindowView.tsx` 是 CRLF，改后仍全 CRLF；其余是 LF。`git diff --numstat` 与 `--ignore-all-space --numstat` 只在 `projectSetup.ts` 有差（抽函数后循环少一层缩进），其余逐文件一致。`useAgentRunControls.ts` 没动（495 行）；`Composer.tsx` 411 行。
  - `pnpm verify` EXIT=0（日志 `grep '^EXIT=0$'` 命中）：lint 与前端类型检查通过；project-core 14 passed；引擎 98 个文件 13903 passed + 2 skipped（golden 契约无改动）；前端 247 个文件 2494 passed；行间续写、浏览器冒烟、Agent 对话三个浏览器回归通过（浏览器回归里引擎读口不可用，立项事实读失败按设计静默，没有多出 console error）。
- 未覆盖：
  - 没在真机装机版上点穿：灰字观感（长句在窄栏里会不会被截断）、Tab 在真 WebView 里的焦点行为、接受补丁后「接着写第 N+1 章」出现的时机都没看过。没跑 Tauri 冒烟与真宿主探针，立项事实走真原生读口没在真宿主里验过（浏览器回归里引擎读口不可用，这几条提示按设计不出现）。
  - 刚接受一份正文后，`book.context` 章节列表要等写盘防抖（约 1.2 秒）刷新到这一章，期间不出「接着写」那一条。
  - 规则 2a 照批准原文：接受的是前面某一章（后面章节已存在）时也说「接着写第 N+1 章」。
