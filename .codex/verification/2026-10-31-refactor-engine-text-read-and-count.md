## 2026-10-31 读文本只留一种解码，正文字数只留一种算法

- 背景：作者要求「架构与组件统一」，同一件事只留一种做法。本刀叠在 `refactor/engine-shared-utils`（#567）上，接它记录里的「第 7 项字数口径」。帧契约、14 个数据形状、golden 都没动（`git diff -- packages/engine/golden` 为 0 行）。

### 一、读文本：解码只在 `readPort.ts` 一处

- 唯一入口放在引擎读口 `packages/engine/src/readPort.ts`（读项目字节的模块都已经从这里取 `ProjectReader`，没新建模块）：
  - `decodeUtf8(bytes, { fatal?, truncated? })`：引擎唯一的 UTF-8 解码。**忠实**——开头的 BOM 保留、换行不动；`fatal` 时非法字节抛 TypeError，否则换成 U+FFFD；`truncated` 表示字节是截断的前缀，末尾半个字符丢掉（内部每次新建解码器，流式状态不会串到下一次）。
  - `stripBom` / `normalizeNewlines`：只拿去解析或计数的调用方在忠实解码之后显式接上。
  - `readProjectText(reader, root, path, maxBytes)`：读 + 忠实解码，超预算为 null，宿主读错照常抛。
  - `readOptionalProjectText(…, cache?)`：可选来源，宿主读错也为 null，给了 cache 同一路径只读一次。
- 引擎 `src/`（不含 `*.test.ts` / `*.test-support.ts`）里的 `new TextDecoder`：21 个文件 24 处 → 只剩 `readPort.ts` 3 处（共享的宽松 / 严格两个实例 + 截断时的临时实例）。模型响应（`llm/transport`、`llm/providerTransport`、`llm/protocol`）、docx 里的 zip 名与 XML 也改走 `decodeUtf8`，选项照原样（原来 fatal 的仍 fatal）。
- 合并的「读文本」小函数：`canonContext.chapterText`、`factLedgerView.readText`、`factBackfill.chapterContent` 三份语义相同（读不到 / 超预算为 null，前两份带缓存）→ `readOptionalProjectText`。`factRecord`、`writeBatchSteps` 的两处读盘改用 `readProjectText`。
- 留着的薄包装（语义不同，内部都走 `decodeUtf8`）：`fsTools.readBoundedText`（fs.read 的预算 / 二进制 / 截断 / 归一换行规则）、`fsProjectTools.readProjectFileRaw`（严格解码、专用错误码、同时交回原始字节）、`json.parseJsonBytes`（拒 BOM、严格）、`authorVoice` / `previousChapter` / `styleBaseline` / `canonFiles` / `bookBreakdown` / `buildBookContext` / `chapterWritingContracts` / `conversationHistory`（要先看字节——超预算、NUL 嗅探、留证据的原始字节——再解码，直接调 `decodeUtf8`）。
- 去 BOM、归一换行各写各的也收掉了：`previousChapter` 自己的 `normalizeNewlines`、`conversationHistory` 内联的去 BOM + 归一、`bookBreakdown.chapterHeadingTitle` 与 `pluginManifest` 的 `/^\uFEFF/` 替换，以及引擎里其余 13 处 `.replace(/\r\n?/g, '\n')`（解码点之外的 `continuation`、`generationSources`、`plugins`、`writingSkills`、`settingSources`、`docx` 解析也在内），全换成同一个 `stripBom` / `normalizeNewlines`；两个函数与原写法逐字等价。引擎里 `/\r\n?/g` 现在只在 `readPort.ts`。
- 两处默认解码（会吞 BOM）逐一看了去向，都不流进修订的改前文本，所以按「忠实解码 + 显式 stripBom」改，行为不变：
  - `loop/conversationHistory.ts::readPatchTarget`：读到的文本只拿去和补丁 before / after 比（`normalizedText` 两边都去 BOM、归一换行）。
  - `loop/writeBatchSteps.ts`：`headingTitleOnDisk` 只取标题（`chapterHeadingTitle` 自己还会再去一次 BOM，现在照样两次）；`fileFingerprint` 只算字数——见下，新字数口径本来就不计 BOM，这里没再加 stripBom。
  - 修订 / 审稿的改前文本走 `agentRuntime` 对 `readProjectFileRaw` 原始字节的严格忠实解码，本来就保留 BOM、不改换行（变异「解码吞 BOM」时 golden `revise-new-session` 等红，见下）。

### 二、正文字数：`@storyforge/project-core` 的 `countProseChars`

- 新文件 `packages/project-core/src/proseChars.ts`，口径取界面那套：去掉 JS 正则 `\s` 的 25 个码点（Unicode 空白加 BOM）后按码点数。
- 界面 `apps/desktop/frontend/src/lib/text-metrics.ts` 不再自己实现，`export { countProseChars } from '@storyforge/project-core'`（`daily-progress`、`manuscript-stats` 照旧从这里取）。
- 引擎删掉 `chapterCheckProtocol.chapterChars`，「正文字数」用途全部直接调 `countProseChars`：章节检查的严重偏离判定（`chapterCheckProtocol.buildCheck`）、前 20 章字数中位数推章长区间（`chapterWritingContracts.earliestChapterChars`）、修订稿字数提示（`reviseTargetLength.targetLengthHint`）、批量写章结果卡的「N 字」（`writeBatchSteps.fileFingerprint`）。grep 另找到一处：拆书写法数字 `breakdownSkills.craftMetrics` 自己写的 `chars`（与界面算法逐字相同），也换成 `countProseChars`。
- 没动：书的骨架 / 总览章行的 `estimated_chars`（`size_bytes / 3`，`kernel/bookContext.ts`、`buildBookContext.ts`）是性能估算，不是数字；`content_chars` / `supplied_content_chars` 等按码点的长度也不是正文字数口径。
- 行为变化：只对含 U+1680、U+2000–U+200A、U+2028、U+2029、U+202F、U+205F、U+FEFF 的文本，引擎数出来变少，与界面一致。

### golden 零变化的依据

- golden 夹具里**有**这 17 种字符中的几种（临时脚本扫 `packages/engine/golden/`，原样字符与转义写法都数）：U+FEFF 出现在 11 个文件（如 `p1-context.windows.json` 7 处、`p2-assistant-service.windows.json` 8 处、`p1-canon-gate.json` 114 处转义），U+2028 出现在 8 个文件（如 `p2-llm-pure.json` 55 处），U+2007 / U+202F 在 `p1-punctuation.json`。所以不能说「夹具不含」。
- 临时给 `countProseChars` 插桩（同一段文字按旧 8 码点集合再数一遍，不同就把调用栈写到 stderr），跑完整引擎测试（含 golden）：全套只有 1 段文字两种口径不同——`writeBatchSteps.test.ts`「names a chapter by the title in its text heading…」第 5 章以 BOM 开头，经 `fileFingerprint` 计数（插桩口径 12 / 新 11）。而旧代码在那里用默认解码先吞了 BOM，旧值本来就是 11，与新值相同。其余经过字数函数的夹具文本里都没有这 17 种字符。插桩跑完按原字节还原并 `cmp` 确认。
- 结论：golden 零变化是因为到达字数函数的夹具文本里没有这些字符（唯一一处 BOM 旧代码已提前去掉），不是没覆盖到——变异「解码吞 BOM」时 golden 红 30 条。

### 验证

- `pnpm lint`：EXIT=0（0 error；2 条 warning 在没动的 `apps/desktop/frontend/tests/independent-claim-history.test.ts`，原来就有）。
- `pnpm --filter @storyforge/engine typecheck`：EXIT=0；`npm --prefix apps/desktop/frontend run typecheck`：EXIT=0；`pnpm --filter @storyforge/project-core typecheck`：EXIT=0。
- `pnpm --filter @storyforge/project-core test`：EXIT=0，5 个文件 48 passed（新增 `proseChars.test.ts` 4 条：em space 缩进、BOM 开头、夹 U+2028、窄不换行空格、增补面汉字按码点算 1、`\s` 的 25 个码点逐个不计、零宽空格与 NEL 照算）。
- `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14257 passed、2 skipped（上一刀 14252 + `readPort.test.ts` 新增 5 条：BOM 与 CRLF 原样保留、stripBom 只去开头一个、非法字节替换 / 严格抛错、截断丢半个字符且两次调用互不串、readProjectText 超预算为 null、readOptionalProjectText 读错为 null 且缓存生效）。golden 零变化。
- `npm --prefix apps/desktop/frontend run test`：EXIT=0，270 个文件，2751 passed（新增 `tests/source-standards.test.ts` 2 条守护）。
- 守护（放在源码标准硬门禁 `apps/desktop/frontend/tests/source-standards.test.ts`，引擎测试不带 Node 类型）：
  - 引擎 `src/`（不含测试）里 `new TextDecoder` 只出现在 `readPort.ts`（断言等于 `['readPort.ts']`，路径写错会变空而红）。
  - 界面 `src/` 与引擎 `src/` 里不许再定义 `chapterChars` / `countProseChars`，也不许出现「去空白正则后 `.length`」的计数写法；`text-metrics.ts` 必须从 project-core 再导出。
- 变异验证（脚本定点替换、跑完无条件按原字节写回并断言一致）：
  - `kernel/json.ts` 加一行 `new TextDecoder('utf-8')` → 守护「引擎只在 readPort.ts 里解码」红 1 条。
  - 界面 `text-metrics.ts` 改回自己实现 `countProseChars` → 守护「正文字数只在 project-core」红 1 条。
  - 引擎 `chapterCheckProtocol.ts` 加回 `export function chapterChars` → 同一守护红 1 条。
  - 引擎 `breakdownSkills.ts` 加回 `Array.from(text.replace(/\s/gu, '')).length` → 同一守护红 1 条。
  - project-core `countProseChars` 的空白集合换成引擎旧的 8 个码点 → `proseChars.test.ts` 红 2 条。
  - `readPort.ts` 的宽松解码器去掉 `ignoreBOM`（吞 BOM）→ 引擎测试红 30 条（含 golden `revise-new-session`、`revise-existing-session`、`previous-bom-newlines` 等）。
  - 全部还原后重跑上面各门，结果同上。
- 行尾：改动文件按原样——`readPort.ts` 是 CRLF（改后 113 行全 CRLF），其余纯 LF；新文件纯 LF。`git diff --numstat` 与 `--ignore-all-space --numstat` 一致。新增的非 ASCII 字符只有中文注释 / 测试字符串（`proseChars.ts` 注释里一个 U+2014 破折号）。

### 未覆盖

- 本地没跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），本机有别的会话在跑 headless Chrome、会互相拖超时，以 CI（`Windows Verify` 的 `pnpm verify`）为准。
- 没动 Rust、没改引擎与宿主之间的接口，没跑 Rust 测试、Tauri 冒烟、真宿主探针；不调模型。
- 字数口径变化只在含那 17 种空白的文本上可见，没在作者真实作品上对比过前后数字。
- 观察（没改）：fs.read（`readBoundedText`）给模型的内容会归一换行，`chapter.polish` 的修订输入走它；界面的整文件漂移闸本来就先归一换行再比（`lib/patch-hunks.ts::isWholeFileDrifted`），所以不会误判漂移。界面自己的 `.replace(/\r\n/g, '\n')`（不处理单独的 CR）有十来处，不在本刀范围。`docx.ts` XML 解析里按下标跳过开头 BOM（`charCodeAt(0) === 0xfeff ? 1 : 0`）是解析器游标，不是去 BOM 的副本，没动。
