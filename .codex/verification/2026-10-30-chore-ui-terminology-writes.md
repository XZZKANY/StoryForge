## 2026-10-30 界面用词第二批：写进文件 / 对比 / 正文与文件

- 改动：作者 10-30 定的第二批界面用词。前端 `src` 里含中文的字符串与 JSX 文字共 105 处改掉（34 个文件，只动字符串，不动标识符与注释；用 TypeScript AST 定位节点，逐条按「出现次数 == 期望」定点替换）：
  - 「写回 / 写盘 / 落盘」当动词改说「写进文件」（后面已有宾语只换动词，如「已写回当前文件」→「已写进当前文件」）；「已阻止写回」→「没有写进文件」；写回回执 / 记录 / 审计 / 操作 / 请求 / 结果 / 证据 / 身份等名词改「写入…」，「原写回」当名词→「原来那次写入」；按钮「撤销写回」→「撤销写入」。
  - 「diff」改说「对比」（如「等待作者在编辑器的对比里确认」「重新生成对比」）；`shell-help.ts` 那一句「可查看的差异」→「可查看的对比」，别处「差异」不动。
  - 「稿件」指章节→「正文」、指当前打开的文件→「文件」；「写进稿子」→「写进文件」。
  - 设置里编辑器自动保存那句「自动写回当前文件」→「自动保存当前文件」（那是保存，不是写回）。
  - 示例作品说明「让对话 agent 帮忙审稿…再确认写回」→「让对话 AI 帮忙审稿…再确认写进文件」。
  - `src/lib/author-loop.ts` 写进磁盘的作者闭环记录行「- 动作：接受 AI 修订并写回正文」→「写进正文」：查过没有代码按这行内容读回解析（恢复只读记录头里的 JSON 语义载荷与摘要；宿主冒烟只查别的字段）。撤销时记的 `note`「用户意图：撤销刚写回的修订」同理改成「写进文件」，前缀「用户意图：」不变。
  - `src/lib/local-conversation-action.ts` 认作者在对话里打的确认话：保留认「写回」，另加认「确认写进 / 就这版写进」和含「写进文件」+确认词的句子；只认「写进文件」不认光「写进」，免得把「把它写进第三章」这类请求当成确认接受。补一条单测（含一条反例）。
  - 守护测试 `tests/ui-terminology.test.ts`：弃用词加上 写回 / 写盘 / 落盘（→写进文件）、稿件 / 稿子（→正文或文件）、整词 diff（→对比）；原来的 `Agent` 改成不分大小写的整词 agent。英文整词定义为前后不挨字母、数字、下划线或连字符，所以 `agent_run`、`.storyforge/agent-instructions.md` 不算。例外从整文件豁免改成「文件 → 豁免词集合」：`writeback-receipt-fixture.ts` 豁免全部词（照抄宿主原话），`local-conversation-action.ts` 豁免「写回」（匹配作者输入），`project/initialize.ts` 豁免「稿子」（示例作品的小说内容）。输出格式不变，显示实际命中的写法（如「Diff」「Agent」）。
- 验证：
  - 改完先跑前端全套（`npx vitest run`）：13 个文件 22 条失败，全是断言旧文案。逐条定点改 14 个测试文件里的 29 处断言（每条核次数），测试标题不改；拿改掉的每句原文在 `tests/` 里搜，把 4 处会因改名永远通过的反向断言改成新说法：`agent-progress-panel` 的 `/直接写盘|…/`→`/直接写进文件|…/`、`inline-chat-lifecycle` 两处 `not.toContain('已写回')`→`'已写进'` 与 `not.toContain('稿件已变化')`→`'文件已变化'`、`inline-editor-writeback-integration` 的 `not.toContain('行间修订已写回当前文件')`→新句。测试替身输入（事件 message、注入的报错文字）不改。
  - 复跑前端全套：EXIT=0，252 个文件 2533 passed。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
  - 根目录 `npx eslint apps/desktop/frontend`：EXIT=0（0 错误，2 条警告在未改动的 `tests/independent-claim-history.test.ts`，原来就有）；`npx prettier --check "apps/desktop/frontend/src/**/*.{ts,tsx}"`：通过；改过的测试文件单独 `prettier --check` 也通过。
  - 守护测试变异验证：把 `proposed-patch-outcome.ts` 的「没有写进文件」改回「已阻止写回」、`agent-permission.ts` 的「在对比里」改成「在 Diff 里」、`project/initialize.ts` 的「对话 AI」改回「对话 Agent」，守护测试红 1 条并逐行指出 `proposed-patch-outcome.ts:38 「写回」改说「写进文件」`、`agent-permission.ts:27 「Diff」改说「对比」`、`initialize.ts:44 「Agent」改说「AI」`；用核次数 == 1 的定点替换还原，复跑绿。
  - 本地对话确认的新单测变异：把 `local-conversation-action.ts` 两处新增还原成旧写法，新单测红（`确认写进文件` 得到 `agent`）；定点还原后 3 passed。
  - 行尾：`git diff --numstat` 与 `--ignore-all-space --numstat` 一致（51 个文件）；按字节数过，改动文件行尾与改前一致，没有 CRCRLF。
- 未覆盖：
  - 没在真宿主上看改后的界面（只有 happy-dom 单测）；按要求没跑完整 `pnpm verify` 与三个浏览器回归。
  - `src/lib/writeback-receipt-fixture.ts` 照抄 Rust 宿主原话仍说「写回…项目」，随宿主那一刀一起改；Rust 宿主报错、引擎提示词与工具反馈（模型会照着说「写盘」「diff」）都没动。
  - 测试替身与测试标题里仍有旧说法（如事件 message「修订已写回」、`patch-review-panel` 注入的「写回失败」），不是界面文案，没改。
  - 两句按规则改完读起来重复：`useRunAuthorAgent.ts`「当前没有可写进文件或可定向修订的文件」、`Editor.tsx`「恢复期间活动文件、模型或文件已变化」，另有「已撤销，文件回到写进文件前」，措辞待编排者定。

## 2026-10-30 编排者审查后改的四句

- 改动：照规则改完后读起来重复或别扭的四句，由编排者定稿：「当前没有可写进文件或可定向修订的文件」→「当前没有打开可修订的文件」；「恢复期间活动文件、模型或文件已变化」→「恢复期间切换了文件、换了模型或文件内容已变化」；「已撤销，文件回到写进文件前」→「已撤销，文件回到这次写入之前」（同步改 `proposal-panel-writeback-integration.test.tsx` 两处断言）；「上次写入已拒绝且未写入」→「上次写入被拒绝，文件没有改动」。
- 验证：见下一节完整门禁。

## 2026-10-30 合入 master 后完整门禁

- 改动：PR #525 合进 master（2d119b02）后，把 origin/master 合进本分支（6fb5545f），无冲突。
- 验证：守护测试在合并后的代码上绿；`pnpm verify` EXIT=0（lint、前端类型检查、project-core 34 passed、引擎 14061 passed / 2 skipped、前端单测 2539 passed、行间续写 / 浏览器冒烟 / Agent 对话三条浏览器回归全过）。
- 未覆盖：没在真宿主上看改后的界面；Rust 宿主报错与引擎喂给模型的词不在这一刀。
