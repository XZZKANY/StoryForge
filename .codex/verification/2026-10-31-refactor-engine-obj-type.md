## 2026-10-31 引擎去重（收尾）：本地 `Obj` 类型与 `strOrNull` 各留一份

- 背景：作者要求「架构与组件统一」，同一件事只留一种做法。接上一刀（`2026-10-31-refactor-engine-leftover-helpers.md`「不在本刀清单」里记下的两处），纯机械去重，行为不变。帧契约、14 个数据形状、golden 都没动（`git diff -- packages/engine/golden` 为空）。分支叠在 #582（`refactor/engine-leftover-helpers`）上开，PR base 仍是 master。
- 改动（引擎 23 个源文件 + 前端 `tests/source-standards.test.ts`）：
  1. **本地 `type Obj`**：值为 `unknown` 的 `type Obj = { [key: string]: unknown };` 本地定义 16 份，逐字与 `kernel/json.ts` 导出的 `Obj` 相同（键 `string`、值 `unknown`、都不是 readonly），全部删掉、改从 `kernel/json.ts` `import type`：`assistant/service`、`judge/semantic`、`llm/observation`、`loop/chapterCheckProtocol`、`loop/chapterWritingContracts`、`loop/chatLoop`、`loop/chatLoopContext`、`loop/conversationHistory`、`loop/factBackfill`、`loop/factRecord`、`loop/runControl`、`loop/toolFeedback`、`loop/tools/chapterWritingTools`、`loop/tools/deepConsistency`、`loop/tools/execution`、`loop/tools/polishService`。
  2. **`store/runs.ts` 导出的 `Obj`**：同样逐字相同，删掉；`runs.ts` 自己改从 `json.ts` 取。唯一外部引用是 `store/sqlRuns.ts`，改为从 `json.ts` 取。`index.ts` 本来就没转出这个名字，引擎对外接口不变。
  3. **`loop/authorView.ts` 的 readonly 版**（`{ readonly [key: string]: unknown }`）语义不同，不合并，只改名 `ReadonlyObj`（4 处），消除同名。
  4. **`strOrNull`**：3 份 → `kernel/json.ts` 1 份，放在 `strOr` 后面。任务里写的是 `llm/anthropic.ts` 与 `llm/gemini.ts` 两份（逐字相同，入参 `JsonValue | undefined`）；动手时又找到第三份 `llm/openaiCompatible.ts`，函数体相同、只是入参标 `unknown` 并在调用 `pythonStr` 时 `as JsonValue`。它的调用处传的是 `StreamFrame` 的 `unknown` 字段，所以共享版取 `unknown` 入参（照上一刀 `optionalString` 的做法：只放宽入参，返回 `string | null` 不变），三处调用一处没改。不合这第三份的话，「只定义一次」的守护也立不住。
  5. **守护**（前端 `tests/source-standards.test.ts`）：
     - 「引擎的共享小函数各只定义一次」那条加上 `strOrNull: 'kernel/json.ts'`；
     - 新加一条：引擎 `src/`（不含 `*.test.ts` / `*.test-support.ts`）里 `type Obj =` 或 `interface Obj` 只许出现在 `kernel/json.ts`。
  - `factRecord.ts`、`openaiCompatible.ts` 的导入加名字后超过 100 列，prettier 折成多行。

### 没合的（及原因）

- **测试文件里的 `Obj`**：不在本刀范围、守护也不管测试。其中 32 份是值为 `any` 的版本（带 `eslint-disable` 注释，按预言机 JSON 形状随意读），和 `unknown` 版不同；`llm/llmPure.test.ts` 的值是 `JsonValue`；另有 3 份与 `json.ts` 逐字相同的 `unknown` 版（`loop/chapterCheckFacts.test.ts`、`loop/sdkRuntime.test.ts`、`loop/tools/handlers.test.ts`），没动。
- **`authorView` 的 readonly 版**：只改名，见上。

### 顺带看到、没动的（不在本刀清单）

- `loop/conversationHistory.ts` 与 `loop/toolFeedback.ts` 各有一个本地 `isObj`，和 `json.ts` 的 `isObj` 不同：都多排除了 `JsonFloat`，前者还多排除 `Map`。`toolFeedback` 那份运行时等同 `json.ts` 的 `isJsonObject`，但收窄出的类型是 `Obj` 而不是 `JsonObject`。
- 另起名字、形状相同的类型别名：`kernel/canonGate.ts` 的 `CanonIssue`、`kernel/reviewSkills.ts` 的 `ContextFile`、`kernel/reviseDelivery.ts` 与 `kernel/reviseScope.ts` 的 `Issue`（都是 `{ [key: string]: unknown }`，名字带领域含义）；`llm/usage.ts` 的 `JsonRecord` 与 `ReadonlyObj` 同形（readonly）。
- 同名不同义：`kernel/pluginManifest.ts` 有个本地 `type JsonObject = { [key: string]: unknown }`，和 `json.ts` 导出的 `JsonObject`（值是 `JsonValue`）同名不同义。

### 验证

- `pnpm lint`：EXIT=0（0 error；2 条 warning 在没动的 `apps/desktop/frontend/tests/independent-claim-history.test.ts`，原来就有）。
- `pnpm --filter @storyforge/engine typecheck`：EXIT=0。
- `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
- `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14268 passed、2 skipped（与上一刀相同）。golden 零变化（`git diff -- packages/engine/golden` 0 行）。
- `npm --prefix apps/desktop/frontend run test`：EXIT=0，271 个文件，2789 passed（上一刀 2788，多的 1 条是新守护）。
- 守护的变异验证（脚本改完跑 `tests/source-standards.test.ts`，结束后无条件按原字节写回并断言一致）：
  - `kernel/math.ts` 末尾加一份 `type Obj = { [key: string]: unknown };` → 红 1 条，多出 `kernel/math.ts`；
  - `loop/runControl.ts` 末尾加 `interface Obj { … }` → 红 1 条，多出 `loop/runControl.ts`；
  - `authorView.ts` 的 `ReadonlyObj` 定义改回 `Obj` → 红 1 条，多出 `loop/authorView.ts`；
  - `llm/gemini.ts` 末尾抄回一份 `const strOrNull` → 红 1 条，多出 `llm/gemini.ts: strOrNull`；
  - 把 `json.ts` 的 `strOrNull` 改名 → 红 1 条，缺 `kernel/json.ts: strOrNull`；
  - 还原后重跑 11/11 绿。
- 共享函数的覆盖（同样定点改、跑引擎全套、无条件还原）：`strOrNull` 的空值分支返回 `'None'` 而不是 `null` → 红 8 条，全在 `llm/native.test.ts`（Anthropic / Gemini 回放）。OpenAI 兼容那一路的空值分支没有测试接住；那份原本的函数体与共享版逐字相同（含 `as JsonValue`），合并对它只是换了定义位置。
- 行尾：改动文件全是纯 LF，与改前一致；`git diff --numstat` 与 `--ignore-all-space --numstat` 合计都是 51/50。

### 未覆盖

- 本地没跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），本机有别的会话在跑 headless Chrome、会互相拖超时，以 CI（`Windows Verify` 的 `pnpm verify`）为准。
- 没动 Rust、没改引擎与宿主之间的接口，没跑 Rust 测试、Tauri 冒烟、真宿主探针；不调模型。
- `Obj` 守护只认 `Obj` 这个名字：换个名字再定义一份同形类型（如上面列的 `Issue`、`ContextFile`），它拦不住。
