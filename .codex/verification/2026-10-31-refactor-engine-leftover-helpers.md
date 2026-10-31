## 2026-10-31 引擎去重（续）：剩下的同形小函数各留一份

- 背景：作者要求「架构与组件统一」，同一件事只留一种做法。接 #567（`2026-10-31-refactor-engine-shared-utils.md` 末尾记下的那批），仍是纯机械去重：只合并语义完全相同的副本（边界、null、空串、谓词收窄都一样），有差别的不合并、记在下面。帧契约、14 个数据形状、golden 都没动（`git diff -- packages/engine/golden` 为空）。分支叠在 #580（`fix/receipt-typed-detail`）上开，PR base 仍是 master。
- 改动（引擎 35 个源文件 + 1 个引擎测试文件 + 前端 `tests/source-standards.test.ts`）：
  1. **`isPyInt`**（Python `isinstance(x, int)`，布尔也算）：3 份 → `kernel/json.ts` 1 份。`loop/runPayloads.ts`、`loop/tools/runtimeArguments.ts` 的 `isPyInt`，加上上次没记到的 `loop/savePoints.ts` 的 `pyInt`（名字不同，函数体与谓词类型 `value is number | boolean` 逐字相同）。两处悬空的「Python 的 int 包含 bool」注释随之删掉，`json.ts` 那份沿用 `savePoints` 的注释。
  2. **`strOr`**（`str(x) if x else fallback`）：4 份 → `kernel/json.ts` 1 份（`llm/anthropic.ts`、`llm/contracts.ts`、`llm/gemini.ts`、`llm/payload.ts`）。放 `json.ts` 不放 `pythonText.ts`：它由 `json.ts` 的 `pythonTruthy` / `pythonStr` 拼成，而 `json.ts` 在模块求值时就用 `pythonText` 的 `PYTHON_WHITESPACE` 建正则，放进 `pythonText` 会成环、按加载顺序可能撞 TDZ。`contracts.ts` 不再引 `pythonTruthy`，`payload.ts` 不再引 `pythonTruthy` / `pythonStr`。
  3. **`countOf`**：4 份 → `kernel/pythonText.ts`（`authorEditPolicy`、`polishing`、`proseScan`、`styleBaseline`）。
  4. **`stripNewlines`**（`text.strip('\n')`）：3 份 → `kernel/pythonText.ts`（`assistant/continuation`、`kernel/previousChapter`、`loop/authorView`）。
  5. **「去空白后非空才要的字符串」**：7 份 → `kernel/pythonText.ts` 的 `optionalString`。上次记的 5 份（`runPayloads.optionalString`、`reviseScope.optionalString`、`authorView.text`、`systemJobs.strippedText`、`polishContext.text`），加上复核时找到的 2 份：`kernel/ideCommands.ts` 的 `optionalText` 与 `kernel/llmContext.ts::snapshotRunState` 里的闭包 `stripped`。这两份参数标的是 `PlainJson | undefined`，函数体与返回类型 `string | null` 逐字相同；共享版收 `unknown`，只放宽了入参，调用处一处没改。名字取 `optionalString`：它本来就是 `runPayloads` 导出、被 8 个文件引用的那个名字，原有 44 处调用不用改；这 8 个文件的导入改从 `pythonText` 取。
  6. **`cut`**（按码点超长截断加「……」）：`kernel/plugins.ts`、`kernel/writingSkills.ts` 2 份 → `kernel/pythonText.ts` 的 `clipWithEllipsis`。改名是因为 `cut` 在引擎里另有 7 处是局部变量名，按名字守护会误报。
  7. **`Obj` 同名不同义**：`kernel/contextValues.ts` 的 `Obj`（值是 `PlainJson`）改名 `PlainJsonObject`，只改名不改语义；连带 `llmContext`、`llmPromptContext`、`writingContext`、`loop/bookBreakdownRun` 与 `writingContext.test.ts`。`json.ts` 的 `Obj`（值是 `unknown`）不动。
  8. **`chapterCheckProtocol.ts` 的 `isPyInt` 改名 `isIntNumber`**：它不收布尔、谓词是 `value is number`，和 Python int 不同，所以不合并；为了让 `isPyInt` 全引擎只有一个定义，改了个说实话的名字，加一行注释说明为什么不用共享那份。行为不变。
  9. **守护**：`apps/desktop/frontend/tests/source-standards.test.ts` 加一条「引擎的共享小函数各只定义一次」：在引擎 `src/`（不含 `*.test.ts` / `*.test-support.ts`）里找 `function|const|let|var <名字>`，`isPyInt`、`strOr`、`countOf`、`stripNewlines`、`optionalString`、`clipWithEllipsis` 每个只许出现一次，且就在 `kernel/json.ts` / `kernel/pythonText.ts`。
  - 改完对全部改动文件跑过 prettier（名字变长，几处调用被重新折行）。

### 故意没合并的（有差别，或不是独立的函数副本）

- `isPyInt` 一类：`loop/chapterCheckProtocol.ts`（不收布尔，见上）；`loop/runEvents.ts` 的 `intOrNull` 返回值本身或 null，是另一个函数；`kernel/llmContext.ts` 第 485 行附近是循环里的内联判断。
- 「去空白后非空」一类：`contextValues.artifactKind`、`promiseScan` 的 `promiseId` / `title` 是读字段的函数里内联了同一个表达式，不是独立副本；`llmContext.stringOrDefault` 失败时返回 fallback 而非 null；`llm/config.ts::envValue` 先按真值判断、失败返回空串；`crossChapter` 两处 `options.model && …` 同样先按真值；其它名叫 `optionalText` 的（`canonDelta`、`knowledgeEntries`、`pluginManifest`、`writeBatchSteps`、`store/sqlAssistant`）多带 label / secrets / 长度上限参数，会抛错或脱敏，不是同一个函数；`loop/tools/patchContext.ts` 用 JS `trim()`（空白集合不同）且返回未去空白的原值。
- `stripNewlines` 一类：`kernel/buildBookContext.ts` 第 68 行内联同一正则；`kernel/generationSources.ts` 有个模块常量 `PYTHON_STRIP_NEWLINES` 内联使用。都不是函数副本，没动。
- 截断加「……」一类：`loop/chapterWritingContracts.ts` 第 348 行内联同一逻辑；`conversationSkills`、`settingSources` 截断后补的是另一段提示语。
- 不在本刀清单、顺带看到的：`strOrNull` 在 `llm/anthropic.ts` 与 `llm/gemini.ts` 各一份、逐字相同；值为 `unknown` 的 `type Obj = { [key: string]: unknown }` 还有 16 份本地定义（`assistant/service`、`judge/semantic`、`llm/observation`、`loop/chapterCheckProtocol`、`loop/chatLoop`、`loop/conversationHistory` 等）外加 `store/runs.ts` 导出的一份，与 `json.ts` 的 `Obj` 相同；`loop/authorView.ts` 的 `Obj` 是 readonly 版。

### 验证

- `pnpm lint`：EXIT=0（0 error；2 条 warning 在没动的 `apps/desktop/frontend/tests/independent-claim-history.test.ts`，原来就有）。
- `pnpm --filter @storyforge/engine typecheck`：EXIT=0。
- `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
- `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14268 passed、2 skipped。golden 零变化（`git diff -- packages/engine/golden` 0 行）。
- `npm --prefix apps/desktop/frontend run test`：EXIT=0，271 个文件，2788 passed。
- 守护的变异验证（脚本改完跑 `tests/source-standards.test.ts`，结束后无条件按原字节写回并断言一致）：
  - 在 `kernel/math.ts` 末尾再抄一份 `export const countOf` → 红 1 条，多出 `kernel/math.ts: countOf`；
  - 把 `pythonText.ts` 的 `clipWithEllipsis` 改名 → 红 1 条，缺 `kernel/pythonText.ts: clipWithEllipsis`；
  - 还原后重跑 10/10 绿。
- 共享函数的覆盖（同样的定点改、跑引擎全套、无条件还原）：`isPyInt` 去掉布尔分支 → 红 14 条；`strOr` 的 fallback 改空串 → 红 5 条；`countOf` 的 `- 1` 改 `- 2` → 红 26 条；`stripNewlines` 只去开头 → 红 105 条；`optionalString` 不去空白 → 红 15 条；`clipWithEllipsis` 的「……」改「…」→ 红 3 条。六处都被 golden / 单测覆盖到。
- 去重后再扫引擎源码（不含测试）：上面六个名字各只剩共享那一份定义；同形函数体只剩上面「故意没合并」列出的内联处。
- 行尾：改动文件全是纯 LF，与改前一致。`git diff --numstat` 与 `--ignore-all-space --numstat` 只有 `writingContext.test.ts` 不同（26/18 对 19/11），是 prettier 因类型名变长把两处 `admitWritingRequest(...)` 调用重新折行，不是行尾变化。

### 未覆盖

- 本地没跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），本机有别的会话在跑 headless Chrome、会互相拖超时，以 CI（`Windows Verify` 的 `pnpm verify`）为准。
- 没动 Rust、没改引擎与宿主之间的接口，没跑 Rust 测试、Tauri 冒烟、真宿主探针；不调模型。
- 守护只按名字认：将来有人换个名字再抄一份同样的函数体，它拦不住。
