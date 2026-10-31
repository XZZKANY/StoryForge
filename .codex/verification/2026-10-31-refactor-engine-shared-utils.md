## 2026-10-31 引擎去重：各抄一份的小函数各留一份

- 背景：作者要求「架构与组件统一」，同一件事只留一种做法。本刀是纯机械去重：只合并语义完全相同的副本，有细微差别的一律不合并、记在下面。帧契约、14 个数据形状、golden 都没动（`git diff -- packages/engine/golden` 为空）。
- 改动（引擎 76 个源文件 + 1 个测试文件，新增 `kernel/sha1.ts`）：
  1. **按码点算长度 `cpLen`**：28 份 → 1 份。`cpLen`（13 份）、`length`（11 份）、`codePointLength`（`canonHooksDelta`）、`codePoints`（`generationSources`，名字叫 codePoints 实为求长度）、`proseScan` 的 `length = (text) => points(text).length`，加上 `contextValues` 原有的导出版，统一成 `kernel/pythonText.ts` 的 `cpLen`；`contextValues` 不再导出它，`llmContext` / `llmPromptContext` / `writingContext` 改从 `pythonText` 取。
  2. **按码点截取 `cpSlice`**：10 份 → 1 份。`cpSlice`（`assistant/service`、`agentRuntime`、`chatLoopAdapters`、`patchHandlers`、`deepConsistency`）、`slicePoints`（`canonAssertions`、`canonContext`、`consistencyScan`）、`llm/transport.ts` 的 `truncate`，加上 `contextValues` 原有导出版，统一到 `pythonText.ts`。
  3. **按码点拆数组 `codePoints`**：14 份 `(text) => Array.from(text)`（12 份叫 `points`，2 份叫 `codePoints`）→ `pythonText.ts` 的 `codePoints`。
  4. **`isObj`**：31 份 → 1 份。30 份 `isObj`（连同各自的 `type Obj = { [key: string]: unknown }`）与 `reviseScope.ts` 的 `isObject`（谓词类型叫 `Issue`，结构相同）统一成 `kernel/json.ts` 的 `isObj` / `type Obj`，放在 `isJsonObject` 旁边。
  5. **`stringArgList`**：4 份 → 1 份。`reviseScope`、`runPayloads` 的 `stringArgList` 与 `roleCatalog`、`runtimeArguments` 的 `stringList`（函数体逐字相同）统一到 `pythonText.ts`（它本来就放着同一个 Python `_text` 模块的 `compactText`）；`polishHandlers` 原来从 `runtimeArguments` 取 `stringList`，改从 `pythonText` 取；`catalog.test.ts` 的 golden 用例 `string_list` 改测共享的 `stringArgList`。
  6. **`orderedUnique`**：5 份 → 1 份（`llmContext`、`reviseScope`、`roleCatalog`、`runPayloads`、`polishHandlers` 的 `unique`）→ `pythonText.ts`。
  7. **哈希**：4 份 SHA-1 取 id（`canonDelta.sha1Hex`、`canonGate.issueId`、`observatory.syntheticId`、`promiseScan.issueId`）→ 新文件 `kernel/sha1.ts` 的 `sha1Hex` / `sha1Id(prefix, parts)`，调用处 `sha1Id('canon' | 'prose' | 'promise', …)`，`canonDelta` 仍取 `sha1Hex(...).slice(0, 8)`。`canonStore.ts` 自己用 `crypto.subtle` 写的异步 SHA-256 删掉，改用已有的同步 `sha256Hex`：两者输出都是小写十六进制、逐字节相同（`sha256.test.ts` 在 0 字节到 1 MiB 的 16 个长度上拿 WebCrypto 比对过）；`sha256Hex(string)` 内部就是 `new TextEncoder().encode`，所以最后一行直接传字符串。唯一差别是不再让出事件循环，调用方本来就在 async 函数里、读文件的顺序不变。
  8. **`runEvents.ts` 的 `export { AgentOrchestrationError }`** 删掉（没有文件从这里取），连带删掉只为它存在的导入；这个类现在只剩内核定义 + `runPayloads` 再导出两个入口。
  - 新加的 import 名按字母序插进已有的 import，没重排别的名字；改完对全部改动文件跑过 prettier。

### 故意没合并的（有差别，或类型不同）

- 码点长度：`kernel/authorEditPolicy.ts` 的 `codePointLength` 先删掉 FILLER 再数；`kernel/breakdownSkills.ts` 的 `chars` 先删空白再数；`loop/agentHost.ts` 的 `codePoints(text: unknown)` 收任意值并 `String()`。
- 码点截取：`loop/authorView.ts` 的 `cpSlice(text, start, end?)` 是三参数版；`kernel/plugins.ts` 与 `kernel/writingSkills.ts` 的 `cut` 超长时加「……」（这两份彼此相同，但不在本刀清单里，见下）。
- `isObj`：`kernel/contextValues.ts` 的 `isObj` 运行时相同，但谓词收窄到 `{ [key: string]: PlainJson }`，`llmContext` 等靠这个类型，合并要加强转，留着；`loop/conversationHistory.ts` 还排除 `JsonFloat` 与 `Map`，`loop/toolFeedback.ts` 与 `llm/usage.ts` 还排除 `JsonFloat`（后者还是 readonly）。
- `stringList`：`kernel/llmContext.ts` 的 `stringList` 收 `PlainJson[] | null` 并去重，不是同一个函数。
- 路径三对都不等价，一个没动（逐字照抄后跑例子核对过）：
  - `kernel/fsTools.ts::normalizeProjectRelativePath`（抛错）与 `kernel/llmContext.ts::normalizedRelativeContextPath`（返回 null）**规则并不相同**：盘符判断前者是「第一段里有冒号就拒」，后者是「整串第 2 个码点是冒号才拒」。`ab:c.md`：前者拒，后者返回 `ab:c.md`；`./C:/x.md`：前者拒，后者返回 `C:/x.md`。其余（去空白、反斜杠、`.`、`..`、空）一致。抽公共核心会改其中一边的行为，所以没抽。
  - `llmContext.ts::normalizeSelectedPath` 比 project-core 的 `normalizePathForMatch` 多去首尾空白、多去结尾斜杠：` A/B/ ` → `a/b` 对 ` a/b/ `。
  - `loop/tools/patchHandlers.ts` 的 `basename` 不滤空段：`a/b/` → 空串；project-core 的 `projectBasename` → `b`。
- 审查时顺带看到、但不在本刀清单里的同形小函数（没动，供后面定）：`cut` ×2、「去空白后非空才要的字符串」×5（`authorView.text`、`runPayloads.optionalString`、`systemJobs.strippedText`、`polishContext.text`、`reviseScope.optionalString`）、`countOf` ×4、`isPyInt` ×3、`truthy` ×3、`strOr` ×4、`optional`（项目读错误判断）×4、`stripNewlines` ×3、`objects` ×3、`utf8Length` ×2、`objectOf` ×2、`isCount` ×2 等。

### 只查不改：界面与引擎的「正文字数」口径

- 界面 `apps/desktop/frontend/src/lib/text-metrics.ts::countProseChars`：`Array.from(text.replace(/\s+/g, '')).length`，JS 的 `\s` 共 25 个码点（含 U+1680、U+2000–U+200A、U+2028、U+2029、U+202F、U+205F、U+FEFF）。
- 引擎 `packages/engine/src/loop/chapterCheckProtocol.ts::chapterChars`：逐码点数，只跳过 `kernel/quoteLocation.ts` 的 `QUOTE_WHITESPACE` 8 个码点（U+0020、U+0009、U+000A、U+000D、U+000C、U+000B、U+3000、U+00A0）。
- 两边函数逐字照抄后穷举 BMP：引擎的集合是界面的子集，判定不同的恰好 17 个码点——U+1680、U+2000–U+200A、U+2028、U+2029、U+202F、U+205F、U+FEFF；它们界面不计、引擎计。所以同一段文字**引擎数出来只会大于等于界面**。例子（界面 / 引擎）：
  - 段首用 em space 缩进两格的「\u2003\u2003他走了。」：4 / 6。全角空格 U+3000 缩进两边都不计，一致。
  - 文件以 BOM 开头：「\uFEFF第一章\n他走了。」7 / 8。引擎这边还取决于解码：`chapterWritingContracts.ts` 用 `TextDecoder(..., { ignoreBOM: true })` 保留 BOM（会多数 1），`writeBatchSteps.ts` 用默认解码会先去掉 BOM（不多数）。
  - 粘贴进来的行分隔符 U+2028「他走了。\u2028她来了。」：8 / 9；窄不换行空格「100\u202Fkm」：5 / 6。
  - 零宽空格 U+200B 两边都计，一致。
- 各自用在哪：
  - 界面 `countProseChars`：`lib/daily-progress.ts::writebackDelta`（`Editor.tsx` 保存 / 写回时记日更进度，`BookProfileView` 显示）、`lib/manuscript-stats.ts::scanManuscriptTotals`（`useBookProfile` → 作品档案的全书字数与字数目标进度）。只给界面显示，不发给模型。
  - 引擎 `chapterChars`：`chapterCheckProtocol.ts` 章节检查的「正文 N 字，严重偏离 a–b 字」判定（低于下限三成为硬失败，进检查结果给作者看）；`chapterWritingContracts.ts` 取全书前 20 章字数中位数推出本书章长区间（进写章约定，间接发给模型）；`reviseTargetLength.ts::targetLengthHint` 修订稿字数偏离目标的提示；`writeBatchSteps.ts` 批量写章每章结果卡上的「N 字」（界面显示）。
  - 另有第三套：书的骨架 / 总览章行的 `estimated_chars` 是 `size_bytes / 3` 的估值（`kernel/bookContext.ts`、`buildBookContext.ts`），不是数字。
- 本刀不改，由作者定怎么统一。

### 验证

- `pnpm lint`：EXIT=0（0 error；2 条 warning 在没动的 `apps/desktop/frontend/tests/independent-claim-history.test.ts`，原来就有）。
- `pnpm --filter @storyforge/engine typecheck`：EXIT=0。
- `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
- `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14252 passed、2 skipped。golden 零变化（`git diff -- packages/engine/golden` 0 行）。
- `npm --prefix apps/desktop/frontend run test`：EXIT=0，270 个文件，2749 passed。
- 变异验证（脚本定点替换、跑完无条件按原字节写回并断言一致）：`sha1Id` 的 `slice(0, 12)` 改 11 → 引擎测试红 123 条；`isObj` 去掉「排除数组」→ 红 3 条；`cpLen` 改成 UTF-16 `text.length` → 红 35 条；`orderedUnique` 改成不去重 → 红 3 条。四处都还原后重跑引擎测试全绿（同上数字）。说明共享函数确实被 golden / 单测覆盖到。
- 去重后再扫一遍引擎源码（不含测试）：上面合并的几类同形定义只剩共享那一份；`crypto.subtle` 只剩 `kernel/sha1.ts`。
- 行尾：改动文件与新文件都是纯 LF，与改前一致；`git diff --numstat` 与 `--ignore-all-space --numstat` 一致。新增的非 ASCII 字符只有 `json.ts` 那一行注释。

### 未覆盖

- 本地没跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），本机有别的会话在跑 headless Chrome、会互相拖超时，以 CI（`Windows Verify` 的 `pnpm verify`）为准。
- 没动 Rust、没改引擎与宿主之间的接口，没跑 Rust 测试、Tauri 冒烟、真宿主探针；不调模型。
- `canonStore` 由异步 WebCrypto 换成同步 JS 实现后，大 `canon.json`（上限 `MAX_READ_BYTES`）上的耗时没在装机版里量；同一个 `sha256Hex` 已用于其它整文件指纹。
- 测试文件里的同形帮手（如 `chatLoop.test.ts` 的 `cpLen`）没动。
