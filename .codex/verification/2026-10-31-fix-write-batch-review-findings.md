## 2026-10-31 `/写` 批量写章：真模型试跑（G 刀 real-1）发现的 5 个问题

- 背景：G 刀用作者的模型在练手书副本上真跑 `/写 11-13`（试跑报告在仓库外 `output/write-batch-g/runs/real-1/REPORT.md`）。作者 10-31 定：5 条都修，章名用正文的。本分支从 `origin/feat/write-batch-review`（F 刀 PR #554，已合 master，`433eae18`）切出。帧契约、golden、写章固定流程、引擎的事实抽取都没动（`git status --short packages/engine/golden` 为空）；`chapterWritingPipeline.ts` 没碰。不调模型。
- 改动：
  1. **一条新事实都没记下要提醒**（`write-batch-view.ts`、`WriteBatchResultCard.tsx`）：写进文件的章、新记下的事实（含待定）为 0 条时，那一行多一行警示色的「这章没抽出新事实，事实台账可能漏了这章的内容。」（样式照对不上的标注）；有待定的、旧记录里没有条数的（显示「—」）、没写进文件的都不提醒。
  2. **撤销了的那一行不再报事实条数**（`write-batch-view.ts`）：`factsOf` 只给写进文件的章；撤销了的章那一行只剩「已撤销」（连同上面的提醒一起没了），用量照旧列着（钱是真花了的）。
  3. **章名用正文的**（引擎）：`kernel/bookBreakdown.ts` 加 `chapterHeadingTitle`——取正文第一个非空行，是 Markdown 标题才算，去掉 `#`（含收尾的 `#`）后用拆书认章的同一个正则 `CHAPTER_RE` 去掉「第 N 章 / N 章 / Chapter N」，再去掉章号后的分隔符；什么都不剩为 null。`loop/writeBatchSteps.ts` 的 `readWriteBatch`：正文在的章（写进文件的读 `target_path`，其余按正文认出的路径）读时取这个章名，读不到、开头不是标题、文件不在时退回连载计划里的标题；不存进记录。确认卡（`planWriteBatch`）和调度器发给 AI 的那句话（`nextWriteBatchStep` 的 `title`）照旧用计划标题。
  4. **撤销后观测重扫**（`lib/write-batch-undo.ts`）：删掉了至少一章，就在恢复台账之前清掉正文派生的 canon 缓存（`.storyforge/canon/derived/` 下 `presence.json`、`observations.json`、`dossier.md`、`report.json`，与宿主写进文件后清的是同一张单子，`proposals.json` 不动），删章触发的观测重扫再按现在的正文重建。清不掉不挡撤销（那次重扫照样会覆盖）。原因见下。
  5. **两步确认挤出视野**（`WriteBatchResultCard.tsx`）：第二步不再一半在行尾、一半在行底，改成那一行里的一块——台账说明在上，紧挨着「确认撤销第 k 章？」「取消」；展开时这一块 `scrollIntoView({ block: 'nearest' })` 滚进视野。行尾的「撤销这章及之后」在这一行确认时收起。
  - 方案文档 §7 F 刀「每章一行」补了一句：章名已写的章用正文标题，没写的用计划标题。

### 第 1 条：第 11 章为什么一条事实都没抽出来（只查原因，引擎抽取逻辑没改）

- 证据位置（仓库外，只读副本在 `%TEMP%/sf-wbr-db/`，原文件没动）：`output/write-batch-g/runs/real-1/local-data/storyforge-engine.sqlite3`，运行 `1793432100013-79vwwsbkf6`（`agent_runs.id = 1`）。
  - `agent_artifacts` id 5（`model_request_evidence`，step `chapter.check`）：检查请求里有抽事实的指令（「另输出 new_facts 数组……最多 15 条，没有就返回 []」），正文与 brief 完整附上。
  - `assistant_tool_calls` id 3（这次检查调用）：`reply_chars` 238、`completion_tokens` 112，`finish_reason` stop。
  - `agent_artifacts` id 7（`chapter_check`）：`new_facts: []`、`new_facts_received: 0`、`findings_received: 0`、`status: pass`、`checker_reply_excerpt: null`。
- 结论：**模型给了 `new_facts` 字段、但是空数组；引擎没有解析丢东西。**
  - `new_facts_received` 是校验前的原始条数（`chapterCheckProtocol.ts` 的 `extractNewFacts` 取 `items.length`）；回复里没有这个字段时是 null，有字段而条目被逐字核对刷掉时会大于 0。这里是 0。
  - 回复原文不入库（取证只存请求），但长度对得上：只回协议要求的三个摘要字段 + `findings: []` + `new_facts: []` 的最小 JSON，按缩进 2 或单行加代码围栏排版恰好 238 字；不带 `new_facts` 字段的同样内容是 202–231 字，没有 238。112 个输出 token 也只够这些（两个 64 位摘要就占了大半）。
  - 对照：同一次试跑第 12 章检查回 904 字 / 466 token、记了 3 条，第 13 章回 651 字 / 407 token、记了 1 条。
  - 也就是这次检查模型（gpt-6.1-terra，temperature 0.7）照「没有就返回 []」交了空数组。要不要改抽取（比如检查器回空时补抽一次、或改提示词）要先定方案：不在本刀。界面上现在至少会提醒；观测镜里的「补录」也能对这一章补抽。

### 第 4 条：「观测重扫失败：派生缓存来源已变化或无法确认」的原因

- 这句报错出自引擎 `canonFiles.ts` 的 `requireSourceRevision`：观测重扫开头记下派生缓存的「来源版本」（`canonStore.ts` 的 `captureCanonSourceRevision`，只算写入回执 `.storyforge/writeback-receipts/*` 与 `canon.json`、`hooks.json` 的字节），写缓存前再算一次，对不上就拒写并抛这句；界面 `useObservatory.ts` 把它当重扫失败打到控制台。
- **不是撤销引起的，是撤销以外也有的老问题**：重扫进行中有一章带回执写进文件（写进文件会新增一对回执，来源版本就变了），这一次重扫就拒写、报这句；同一次写进文件触发的下一次重扫会成功，观测镜最后是新的，只是控制台多一条错。证据：
  - G 刀 E 版假模型 `runs/fake-e552-3` 没做撤销，也报了一次同样的错（`evidence.json` 的 notes）；F 版两次带撤销的运行（`fake-f554-1`、`real-1`）各两次。
  - real-1 书副本的时间戳：回执目录最后一次变动 07:42:10.24（第 13 章写进文件），`canon.json` 07:34:53 以后没动；撤销在 07:42:22–27（删文件、计划退回、台账恢复、记撤销）；之后派生缓存在 07:42:29–31 按当时的来源版本重新写出。撤销这一路不写回执、不改 `canon.json`，来源版本不会变，自己触发不了这句报错。
  - 临时实验（引擎单测形式，跑完已删，不入库）：内存作品上跑 `runObservatoryScan`，扫描途中写进一对回执 → 抛这句；扫描途中删一章、改 `facts.json`、改连载计划 → 扫描成功。
- 撤销这一路真正缺的一块：删章不经回执，来源版本不变，删之前写的派生缓存（还算着删掉的章，如 `presence.json` 的章数）删之后照样被认作最新（同一个实验：删章前后来源版本相同，`readDerived('presence.json')` 删后仍返回删前那份）。观测镜自己每次都全量重建、不受影响，但 `project.canon_delta` 与上下文里的出场跨度会读这份缓存，在下一次重扫写完之前读到旧的。所以撤销删掉章以后照写进文件那样先清缓存（改动 4）。
- 没修的（照任务书只修到撤销这一路）：重扫途中写进文件导致的这条控制台报错（批量写章、作者手动接受修订都会碰上）；作者手动删章、编辑器通知里的「撤销（删除该文件）」同样不清派生缓存。修法可以是 `useObservatory` 认出这种「来源已变化」就当被后一次重扫顶替、不报错（后一次重扫已经排上了），以及删文件那几条路都清缓存——要编排者 / 作者定。

### 验证

- 合 master：从 `origin/feat/write-batch-review` 切出后合 `origin/master`，`tests/behavior/auto-writeback.test.tsx`（CRLF）有冲突，两边的用例都保留；编排者随后推了同样解法的 `433eae18`，本分支对齐到它（树完全相同），再在上面改。
- 引擎（`packages/engine` 下）：`npx tsc --noEmit` EXIT=0；`npx vitest run` 全量 111 个文件 14244 passed / 2 skipped，EXIT=0（含 golden 契约测试）。`writeBatchSteps.test.ts` 新加 1 条：已有正文跳过的章、写进文件的章取正文标题（`第N章：`、`Chapter N -`、开头 BOM + CRLF + 收尾 `#`），只有章号的、开头不是标题的退回计划标题；作者改了标题跟着变；撤销后文件没了退回计划标题；记录里不存章名。
- 前端：`npm --prefix apps/desktop/frontend run typecheck` EXIT=0；根 `eslint .` EXIT=0（2 条既有 warning 在无关的 `independent-claim-history.test.ts`）、`prettier --check` 通过。
- 相关前端测试一起跑：15 个文件 164 passed，EXIT=0（`source-standards`、`ui-terminology`、`write-batch-*` 全部 12 个、`behavior/auto-writeback`、`fact-write-restore`）。`write-batch-review.test.tsx` 新加 5 条（零条提醒与不提醒的几种；撤销后那一行只说已撤销；第二步在那一行的同一块里、行尾按钮收起、展开时滚进视野且换行确认时滚那一行；删掉了章清派生缓存、顺序在删章之后恢复台账之前、不碰 `proposals.json`；一章没删成不动缓存），改了 1 条旧期望（清单各列多一列提醒）。
- 浏览器回归（`apps/desktop/frontend` 下各自单跑）：`verify:inline-continuation` EXIT=0；`verify:smoke` EXIT=0「Desktop frontend smoke passed」；`verify:agent-conversation` EXIT=0「Agent conversation verification passed」。
- 截图核对第 5 条（一次性脚本，由 Agent 对话浏览器回归派生，放在仓库外 `output/write-batch-review-findings/`，不入库）：打开作品时出写完三章的清单，在 1400×900 与 1400×759 下分别对第 13 章（最后一行）和第 11 章（第一行）点「撤销这章及之后」，台账说明短句（`unchanged`）与完整警告（`changed`）各一遍，共 8 张图。每张量了：确认、取消、台账说明都在清单滚动区和窗口之内，说明底边到确认按钮顶边 4px，三者都在同一行里——8 张全部「ALL VISIBLE」。截图在 `output/write-batch-review-findings/shots/`。
- 变异（脚本在仓库外 `%TEMP%/sf-wbr-scripts/mutate.py`：先断言目标串恰好 1 处再替换，跑对应测试，无条件按原字节还原并核对；跑完 `git status` 只有本刀改动）8 处全红：
  - M1 零条不提醒（`=== 0` 改 `< 0`）→ review 3 条红。M2 撤销后仍报条数（`factsOf` 放回 `undone`）→ review 1 条红。
  - M3 `readWriteBatch` 章名退回计划标题 → 引擎 1 条红。M3b 不去章号（`match[3]` 改整行）→ 引擎 1 条红。
  - M4 撤销不清派生缓存 → review 1 条红。M4b 一章没删也清缓存 → review 1 条红。
  - M5 确认展开不滚进视野 → review 1 条红。M5b 台账说明不在确认块里 → review 4 条红。
- 行尾：改动的 8 个文件与本记录全 LF、无 BOM。`--numstat` 与 `--ignore-all-space --numstat` 只在 `WriteBatchResultCard.tsx`（确认块搬家）和 `write-batch-view.ts`（`map` 改成块体后整体缩进一层）上不同，没有行尾翻转。写源码时工具把转义写成了真 BOM 字符（`bookBreakdown.ts` 正则与测试字符串各一处），已按字节换回 `\uFEFF` 转义并扫过没有别的不可见字符。

### 未覆盖

- 真宿主上没点撤销（不编 Rust、不起装机版）；第 5 条的截图是浏览器回归环境里的真界面（替身引擎），不是装机版。
- 正文标题解析的边角：「第十一章雾港来信」这种章号和标题之间没有分隔的，拆书的认章规则不认（章号后面紧跟汉字），会整串当章名显示；标题写在第二行以后（第一行是正文）的不认，退回计划标题。
- 第 1 条只查了原因，抽取没改；第 4 条里重扫与写进文件相撞的控制台报错、手动删章不清缓存没修（见上）。
