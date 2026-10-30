## 2026-10-30 `/写` 批量写章 B 刀：新写的章「疑似没写完」检测

- 背景：作者 10-30 审过 `/写 1-10` 方案（第 1.7、3、6.1 节）。批量写章时每章写完直接写进文件、最后统一审，新写的章被中转掐断却回了「正常结束」时必须拦得住。#503 的截断检测只管修订已有文件（要求「新稿停在半句 + 原文末尾整段不见」）；写章流程 `chapter.write` 此前只有「短到不足下限三成」会被检查拦下。
- 改动：
  - `packages/engine/src/kernel/revisionTruncation.ts`：新增 `newChapterTruncationWarning(content)`，直接复用同文件的 `endsMidSentence`（同一套收句规则：参照前面同类行的多数习惯，列表项本来不带句号不算；停在标题上算没写完），没有另写规则。末行引文抽成 `stoppedQuote`，原 `truncationWarning` 改用它，行为不变。空正文 / 只有空白返回 null（空稿由章节检查的 `draft_empty` 拦）。
  - `packages/engine/src/loop/chapterWritingPipeline.ts`（`draftFromBrief` 出修订那一支）：对最终交出的正文（起草稿，或修过一次后的稿）判定；命中时
    - 修订照交，`agent_result.truncation_warning` 带警告，`agent_result.summary` 末尾接上警告文案（同 #503 的写法）；
    - `requires_confirmation` 与 `requires_user_confirmation` 强制为 true（照「检查器给不出结果」那个先例：`unchecked || truncation !== null || patchRequiresConfirmation(档位)`），自动档 / 完全放行档也一样，run 停在 `permission.confirm`；
    - 运行证据：最终那份检查的 `chapter_check` 产物（流程已在这里记 `attempt` / `repair_count` / `recheck_count`）多记 `truncation_warning`；`proposed_patch` 产物的 `requires_confirmation` 为 true；`permission_required` 事件的 `summary` 带着警告文案。
    - 没出修订（检查拦下）那一支不判定、不带警告。
- 警告字段与形状：沿用 #503 的 `truncation_warning`，同样四个键 `{ message, missing_line_count, missing_headings, ends_mid_sentence: true }`；新章没有原文，`missing_line_count: 0`、`missing_headings: []`。文案：「AI 写的这一章疑似没写完：正文停在半句（「…<末行最后 12 个字>」）。这条修订要你点接受才会写进文件，请先在对比里看看结尾，或让 AI 重写这一章。」
- 不新增模型调用、不改章纲 / 起草 / 检查的提示词（测试钉住写章仍是 3 次 / 修一次时 5 次请求）。

### 核对

- golden：逐个看了所有 golden 文件里写章相关的起草 / 修后回包结尾与 `created_by_tool: chapter.write` 补丁的 `after`（临时扫描脚本，未入库）。补丁 `after` 按文件去重后 3 条（两种正文），全部以「。」收尾；`p3-chapter-writing` 39 个场景、`p3-host` 两个写章场景的起草 / 修稿回包全部收句。判成「停在半句」的只有检查器回包「不是 JSON」与对话循环 / 其他工具的回包，都不是写章正文。**golden 零改动**：`git status --short packages/engine/golden` 为空。
- 帧契约：`agent-ws.schema.json` 里 `agent_result` / `proposed_patch` / 终态 `payload` 都是开放对象，截断警告本来就不在 schema 里，新文件修订带得上。schema 未改。
- 界面（只读核对，未改组件）：
  - 实时结果：`useRunAuthorAgent` → `writableFilePatch`（按结构判定，`before: ''` 的新文件修订照收）→ `emitProposedPatchOutcome` → `truncationWarningFromAgentResult` 直接读 `agent_result.truncation_warning.message` → `PatchReviewPanel` 红色「⚠」提示（渲染条件不区分新文件），且 `useSuggestionWriteback` 的硬闸生效（有截断警告时第一次接受只武装、对话里接受从不直接写）。暂停后恢复的结果（`useAgentRunRecovery`）同一取法。
  - 断线后按事件表重建的结果（`reconstructAgentResultFromEvents`）：结构化警告会丢——重建的 `agent_result` 只有 summary，退路只找 `file.revise` 轨迹；此时红色提示与「武装两次」硬闸都没有，但对话与修订说明里的 summary 带着警告文案，`proposed_patch.requires_confirmation: true` 在 `permission_required` 事件里原样保留，仍要作者点接受。
  - 自动档：界面免点落盘只看 `requiresConfirmation === false`（`shouldAutoAcceptSuggestion`），引擎这里强制为 true，所以退回手动确认；引擎侧 run 停在 `permission.confirm` 而不是 completed。
  - 上面三条用一个临时前端探针（未入库，跑完即删）核过：写章形状的结果经 `emitProposedPatchOutcome` 发出的修订 `truncationWarning` 等于引擎文案、`before` 为空、`shouldAutoAcceptSuggestion` 为 false；按 `permission_required` 事件重建后 `truncationWarningFromAgentResult` 为 null、summary 仍含「疑似没写完」、`requires_confirmation` 仍为 true。2 passed。

### 验证

- 新测试：
  - `kernel/revisionTruncation.test.ts`「新写一章的截断检测」：停在半句带警告且四个键与 #503 一致；句号 / 问号 / 省略号 / 破折号 / 对话收引号 / 直角引号 / 括号收句不报；对话行引号没收报；结尾是本来不带句号的列表不报、同类列表项都收句只有最后一项没收才报；空正文与只有空白不报；只有标题（`# 第三章 入城`、单行章题）与停在空节标题上算没写完。
  - `loop/chapterDraftTruncation.test.ts`（用 `p3-chapter-writing` 的场景改回包重放）：起草稿停在半句——自动档也 `requires_confirmation: true`、停在 `permission.confirm`、`permission_required` 一条、`chapter_check` 产物记警告、请求仍 3 次；询问档同样带警告；修后稿停在半句同样拦（请求 5 次）；起草稿停在半句但修后稿收句——不报、自动档照常免点；检查器给不出结果 + 停在半句——两条提示都在；检查拦下没出修订——不带警告；收句的新章不带警告、确认照档位（自动 false / 询问 true）；对话行 / 不带句号的列表结尾不误判、自动档免点。
- #503 原有测试照旧：`kernel/revisionTruncation.test.ts` 原 7 条、`loop/revisionTruncation.test.ts` 3 条全过。
- 引擎：`npx vitest run`（packages/engine）109 files、14133 passed + 2 skipped；`tsc --noEmit` 通过。
- 前端类型检查：`npm --prefix apps/desktop/frontend run typecheck` 通过。
- `pnpm verify`：第一遍 EXIT=1，唯一红的是前端 `tests/focus-styles.test.ts`（编译 Tailwind 样式表，满载下超 5000ms 超时；本分支没碰前端与样式），门禁在这一道停下、后面的浏览器回归没跑；单跑该文件 5 passed（3.7 秒）；失败后查看本机没有别的 node / chrome 进程（跑的当时有没有不确定），没有结束任何进程。整套重跑 **EXIT=0**：lint、前端类型检查、project-core 34、引擎 14133 passed + 2 skipped、前端 254 files / 2575 passed、行间续写 / 浏览器冒烟 / Agent 对话三个浏览器回归全过。
- 变异（脚本在不入库的 `output/b-cut/mutate.py`：定点替换、先断言目标串恰好 1 次、无条件按字节还原并校验，跑 4 个相关测试文件）：
  - M1 去掉检测（判定空串）：4 红（起草稿 / 询问档 / 修后稿 / 检查器无结果）。
  - M2 去掉强制确认：2 红（自动档下起草稿、修后稿）。
  - M3 只看起草稿不看修后稿：2 红（修后稿停在半句、起草稿半句修后收句）。
  - M4 证据不记判定：4 红（产物里没有 `truncation_warning`）。
  - M5 内核不看收句一律报：33 红（内核收句 / 列表不误判 8 条、流程测试 5 条、写章 golden 回放 19 个场景 + 自动档免点用例 1 条）。
  - 全部还原，`ALL RESTORED`。
- 行尾：四个改动 / 新增文件都是 LF、无 CR；`git diff --numstat` 与 `--ignore-all-space --numstat` 只有 `chapterWritingPipeline.ts` 不同（summary 那段挪成局部变量后缩进变了），没有行尾变化。

### 未覆盖

- 没用真模型、没在真宿主上点穿；新章修订上红色截断提示与「武装两次」硬闸只按代码与临时探针核过，没看真界面。
- 断线按事件表重建后，结构化警告会丢（见上），界面只剩 summary 里的文案，没有红色提示和硬闸；补要改界面（`chat-window/review.ts` 的退路只找 `file.revise` 轨迹），本刀不改。
- 规则沿用 #503 的收句判断，没为新章调过：末行是 `---` 分隔线、「完」「未完待续」（不带括号）之类会被判成停在半句，只会多一次手动确认、不拦稿；正文很短、前面同类行里不带句号的章题占多数时可能漏判（真实章节正文行多，影响小）。
- 「命中后批量随之停下」属于批量那一刀，本刀只保证这一章的修订强制等作者点。
