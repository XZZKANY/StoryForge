## 2026-10-31 从模型回复里取 JSON 只留一个函数

- 背景：作者要求「架构与组件统一」，同一件事只留一种做法。本刀叠在 `refactor/engine-text-read-and-count`（#568，未合）上，PR base 仍是 master。帧契约、14 个数据形状、golden 都没动（`git diff -- packages/engine/golden` 为 0 行）。

### 一、收进来之前各处的规矩（逐处读码 + 对照测试核过）

审查说 7 处，复核时 grep 出第 8 处：`loop/conversationHistory.ts` 的压缩检查点借 `reviewReasoning.stripCodeFence` 剥壳、再用自己的 `repairJsonStrings` 修，一并收进来。所有处都先按 Python 空白去两端。

| 位置 | 去代码块 | 定位兜底 | 修复 | 解析不了时 | 顶层要求 |
|---|---|---|---|---|---|
| A `judge/semantic.ts` 语义评审 | 先整体解析；不成再看「至少两行、首行去空白后恰是 ` ```json ` 或 ` ``` `（不分大小写）、末行恰是 ` ``` `」才剥（行按 Python splitlines 切、`\n` 拼）。别的语言标记不认；前面有说明文字不剥；多个块只删首末两行 | 在**未剥**的整条回复里找第一个 `[` 起括号配平的数组（认字符串与转义） | 无 | 抛 InputDomainError；调用方吞掉所有异常记 failed | 不要求（调用方要数组） |
| B `kernel/bookBreakdown.ts` 拆书分析 | 以 ` ``` ` 开头就删首行（任何语言标记）、末行去空白后以 ` ``` ` 开头也删；单行 ` ```json {…}``` ` 删光成空串；前面有说明文字不剥 | 剥过的文本里第一个 `{` 到最后一个 `}`；找不到抛 BookBreakdownError「不是有效 JSON」，找到但解析失败抛 InputDomainError | 无 | 见左 | 对象，否则「顶层必须是 JSON 对象」（整体解析出非对象直接报，不走定位） |
| C `kernel/breakdownSkills.ts` 写法 skill | 不剥（围栏靠 `{`…`}` 跳过） | 同 B，在去空白的整条回复里找；找不到抛 BreakdownSkillsError | 无 | 同 B | 调用方取 `.skills` |
| D `kernel/reviewReasoning.ts::loadsJsonArray`（审稿三视角 + `crossChapter` 跨章） | 同 B | 第一个 `[` 到最后一个 `]`；找不到就抛整体解析那个错 | 无 | InputDomainError | 调用方要数组 |
| E `loop/chapterWritingContracts.ts` 章纲 | 正则 `/^```(?:json)?\s*([\s\S]*?)\s*```$/i`：整条回复正好是一个块才取块内，块内两端空白按 JS `\s`；只认无标记或 `json`；多个块时从第一个开到最后一个 ` ``` ` 全算内容 | 开头一个完整对象（后面紧跟的 `fact_adjustments` 数组并回）；不成再 `escapeStrayQuotes`（没变化算失败）后整份解析（非对象算失败），仍不成再试修过文本的开头对象 | 在定位链里 | AgentOrchestrationError「不是有效 JSON」 | 对象，否则「必须是 JSON 对象」 |
| F `loop/chapterCheckProtocol.ts` 章节检查 / 补录事实 | 与 E 逐字相同的正则 | 无 | `escapeStrayQuotes` 后再解析一次（重复键拒收） | InvalidCheck（消息取修过后那次解析的报错） | 对象，否则「检查结果不是对象」 |
| G `loop/tools/polishService.ts` 润色 | 与 E 同结构的正则，但空白类是 Python 空白、带 `u` 标志 | 无 | 无 | InvalidPolishModelResponseError | 调用方取 `segments` |
| H `loop/conversationHistory.ts` 压缩检查点 | 同 B（借 D 的函数） | 无 | `repairJsonStrings` | CompactionRejected「不是有效 JSON」 | 调用方要只含 entries 的对象 |

### 二、改成什么

- `kernel/json.ts` 新增 `parseModelJson(raw, { source, fence, uniqueKeys, repair, locate })`：去两端 Python 空白 → 剥代码块 → 解析；失败时先 `repair`（修出变化才再解析），再按 `locate` 找片段。`locate` 内置 `objectSpan` / `arraySpan` / `balancedArray`，也收自定义函数（返回 null 表示没找到）。没找到抛 `ModelJsonNotFound`（InputDomainError 子类，消息沿用整体解析的报错，`name` 仍是 `InputDomainError`）；片段解析失败抛普通 InputDomainError。顶层类型与对外措辞仍由调用方把关。
- 各处换成：
  - A：`parseModelJson(raw, { fence: 'strictLines' })`，失败再 `parseModelJson(raw, { locate: 'balancedArray' })`。
  - B：`{ fence: 'lines', locate: 'objectSpan' }`，`ModelJsonNotFound` → BookBreakdownError。
  - C：`{ locate: 'objectSpan' }`（不剥），`ModelJsonNotFound` → BreakdownSkillsError。
  - D：`loadsJsonArray` 留作一行包装（两个调用方共用同一组选项）：`{ fence: 'lines', locate: 'arraySpan' }`；`stripCodeFence` 删掉。
  - E：`{ fence: 'block', locate: (text) => leadingBriefObject(text) ?? repairedBriefObject(text) }`。章纲特有的回退链（并回 `fact_adjustments`、修过后非对象算失败）原样留在本文件当自定义定位；两个辅助函数的返回类型从 `Obj` 收窄成 `JsonObject`，只是类型。
  - F：`{ fence: 'block', uniqueKeys: true, repair: escapeStrayQuotes }`。
  - G：`{ fence: 'blockPython' }`。
  - H：`{ fence: 'lines', repair: escapeControlCharsAndQuotes }`。
- 用选项保留的差异（都实测过换掉会变，见下「变异」）：5 种剥壳（`none` / `lines` / `strictLines` / `block` / `blockPython`）、3 种内置定位 + E 的自定义、2 个修复器。没取并集：例如 G 换成 `block` 后 ` ```json` 后面紧跟 U+FEFF 的回复会从「不是 JSON」变成能解析，E/F 换成 `blockPython` 则是 U+0085 / U+001C–U+001F 与 `ſ`（`u` 标志下当 `s`）那一侧变。
- 改了结构、靠论证保持一致的地方：
  - A：旧顺序「整体解析 → 剥壳解析 → 在整条回复里找数组」。`strictLines` 剥动了说明回复以 ` ``` ` 开头、整体解析必败，没剥动则两步是同一段文本，所以「先剥壳解析」等价；第二次调用重新解析的是已失败过的同一段文本。旧代码找不到数组时 `parseJson(stripped)` 抛错，现在抛同消息的 `ModelJsonNotFound`，调用方本来就吞所有异常。
  - D：旧条件 `start === -1 || end === -1 || end <= start` 与 `start < 0 || end <= start` 等价；找不到时旧代码抛整体解析那个错对象本身，现在是同消息、同 `name` 的子类实例——上层只用 `instanceof InputDomainError` 判降级、把 `message` 写进 `degraded_reason`。
  - F / H：旧代码无条件解析修过的文本；现在修不出变化就直接抛第一次的错。同一文本、同一 source 与选项，`parseJson` 报错消息相同；H 的调用方只认类型、消息固定。
- 两个修复器没合并：都修字符串里没转义的直引号，但不是同一种修法——`escapeStrayQuotes` 不碰裸控制字符，逗号 / 冒号后面（只跳空格、制表、CR、LF）要像下一个键或值的开头才算字符串结束；`repairJsonStrings` 还把裸控制字符补成 `\u` 转义，逗号 / 冒号 / `}` / `]` / 结尾一律算结束（跳全部 Unicode 空白）。都放在 `kernel/json.ts`，后者改名 `escapeControlCharsAndQuotes`，注释写明比前者宽在哪；新单测给出一条两者结果相反的输入。

### 验证

- 新旧对照（临时，跑完删除）：`git archive HEAD packages/engine/src` 解到 `packages/engine/.old-src-tmp/`，新旧两边把 5 个内部函数临时 `export`，写一个临时测试逐输入比 11 个函数——A 解码、B `parseModelAnalysis`、C `parseBreakdownSkills`、D `loadsJsonArray` / `parseLlmIssues` / `parseCrossChapterFindings`、E `jsonObject`、F `decode` / `parseFactExtraction`、G `parsePolishedResponse`、H `compactionCandidate`。成功比值（连同对象是否无原型、JsonFloat），失败比类名 + `name` + 消息（`ModelJsonNotFound` 按 InputDomainError 比，共折算 215174 次）。
  - 语料 107683 条不重复字符串：手造（63 种正文 × 13 种开围栏 × 7 种分隔 × 7 种闭围栏，正文含对象 / 数组 / 坏 JSON / 直引号 / 字符串里真换行与 U+2028 / 重复键 / 章纲后接 `fact_adjustments` / 说明文字夹括号等）+ 全部 golden 夹具里含 `{` `[` 或反引号的字符串（嵌套 JSON 串递归拆开）+ 60000 条定种子随机拼接（前后缀、U+0085 / U+2028 / U+2029 / U+FEFF / U+001C / U+3000 / VT / FF 等分隔、随机插入引号括号反斜杠）。
  - 结果：11 个函数 0 处不同。
  - 变异（证明对照会抓差异，也证明保留的选项都必要；脚本定点替换、跑完改回，再跑一遍 0 处不同）：8 处剥壳各换成别的一种 → 每处都有差异（A 3358、B 18783、C 18660、D 各 35980、E 4917、F 7571 / 2883、G 3652、H 11537）；A 的 `balancedArray` ↔ D 的 `arraySpan` 互换 → A 14951、D 各 12224；F 与 H 的修复器互换 → F 5814 / 800、H 1971。
  - 收尾：去掉临时 `export`（脚本断言每处恰好一次）、删临时测试与快照，`git status` 只剩本刀改动。
- 新单测 `kernel/json.test.ts` 的 `parseModelJson` 9 条，样本取自 golden（拆书 `parse_model`、审稿 `parse_issues`）与原有测试（直引号、压缩代码块），每组选项对应一处原规矩：两种 block 空白类各自认 / 不认 U+FEFF 与 U+0085、`lines` 单行围栏剥成空串、`arraySpan` 找不到时消息等于整体解析的报错、自定义定位只在整体失败后调用、F 修复失败报的是修过后那次的错、H 的修复器能修真换行而 `escapeStrayQuotes` 不能、两个修复器对「引号后跟逗号」结论相反。
- 守护（`apps/desktop/frontend/tests/source-standards.test.ts`，照上一刀两条引擎守护的写法）：引擎 `src/`（不含测试）里剥 ` ``` ` 的三种写法——正则字面量 `/^````、模板串拼 RegExp 的 `` \`\`\` ``、`startsWith('```')` 与整串 `'```json'` / `'```'` 比较——只许出现在 `kernel/json.ts`。同一正则在 HEAD 上正好命中旧的 6 个文件（semantic、bookBreakdown、reviewReasoning、chapterCheckProtocol、chapterWritingContracts、polishService），不命中 `judge/prompts.ts` 里示范输出格式的 ` ``` ` 与 conversationHistory 的注释。
  - 变异：`polishService.ts` 加一行 `const STRAY_FENCE = /^```json/i;` → 守护红 1 条（列出 `loop/tools/polishService.ts`）；按原字节改回（sha256 前后一致）→ 绿。
- `pnpm lint`：EXIT=0（0 error；2 条 warning 在没动的 `apps/desktop/frontend/tests/independent-claim-history.test.ts`，原来就有）。
- `pnpm --filter @storyforge/engine typecheck`：EXIT=0；`npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
- `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14266 passed、2 skipped（上一刀 14257 + 新增 9 条）。golden 零变化。
- `npm --prefix apps/desktop/frontend run test`：EXIT=0，270 个文件，2752 passed（上一刀 2751 + 守护 1 条）。
- 行尾：改动的 11 个文件原来都是纯 LF，改后仍纯 LF；`git diff --numstat` 与 `--ignore-all-space --numstat` 只差 semantic / chapterCheckProtocol / conversationHistory 各 1–3 行，是空行的对齐不同，不是行尾。

### 未覆盖

- 本地没跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），本机有别的会话在跑 headless Chrome、会互相拖超时，以 CI（`Windows Verify` 的 `pnpm verify`）为准。
- 没动 Rust、没改引擎与宿主之间的接口，没跑 Rust 测试、Tauri 冒烟、真宿主探针；不调真模型。
- 不在本刀范围、没动：工具调用参数的 JSON（`llm/anthropic`、`llm/openaiStream`、`llm/gemini`、`loop/sdkTools`、`loop/chatLoopAdapters`、`loop/chatLoopCheckpoints`）是接口结构化字段，不剥壳不修复。
- 观察（保留原样、没修）：`lines` 剥壳按 Python splitlines 切行再用 `\n` 拼，字符串里原样写的 U+2028 / U+0085 会被换成真换行而解析失败；单行 ` ```json {…}``` ` 会被剥成空串。B / D / H 一直如此，本刀只搬不改。
