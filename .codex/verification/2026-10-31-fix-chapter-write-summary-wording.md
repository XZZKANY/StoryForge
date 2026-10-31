# fix/chapter-write-summary-wording 验证记录（2026-10-31）

## 2026-10-31 写章结果说明按要不要作者点分两种说法，写章流程给作者看的 brief 改说章纲

- 改动：`/写` 真模型试跑里，章节按授权自动写进文件之后，对话里那句结果说明仍是「章节草稿已通过 brief 检查，生成 正文/第013章.md 的待审阅修订。」——已经写进了还说待审阅，而且 brief 是英文。
  - `packages/engine/src/loop/chapterWritingPipeline.ts`：检查通过出修订的结果说明按 `requiresConfirmation` 分两种。引擎不知道最后写没写进文件（界面另补「已写进 …」），所以不用点的只说按权限直接写进：
    - 不用点（自动 / 完全放行档，或批量写章按作品权限跑）：「{头}通过了章纲检查，修订按这部作品的权限直接写进 {relative}。」
    - 要点（询问档、疑似没写完）：「{头}通过了章纲检查，生成了 {relative} 的修订，请看过对比再决定是否接受。」
    - {头} = 章纲带章号（连载计划里的下一章）时是「第 N 章的草稿」，没有就是「章节草稿」（章号只取章纲的 `chapter_ordinal`，不从文件名猜）。后面照旧接 `programAdvisoryNote`（内容没动）；疑似没写完照旧在后面空一格接截断警告原文。
    - 检查器给不出结果（unchecked）那句原样不动：它本来就没有英文，而且只会在要作者点时出现，「待审阅」属实。
  - 写章流程里其余给作者看的 brief / Chapter Brief 换成章纲（见下面的候选清单）。
  - 节选分界：会话里那句「Chapter Brief 已准备：…」改成「章纲已准备：…」，它同时是下一章读对话节选的分界（`briefConversation`）。分界改认新旧两种开头（`isBriefReady`），旧会话里留着的旧句子照样截断；`BRIEF_READY_PREFIX` 现在是新说法，旧说法收成模块内常量。
  - 前端：流程树等待步骤「等待作者确认 Chapter Brief」→「等待作者确认章纲」，总览状态「等待章节 Brief 确认」→「等待章纲确认」（两处都只在旧版停下等确认章纲的 run 上出现）。前端没有按旧句子做匹配的代码，不需要兼容分支；照抄引擎原话的两份测试输入改成新说法。
  - 没动：给模型的提示词、artifact kind / 字段名 / 工具名 / 事件类型、帧契约 schema（`agent-ws.schema.json` 逐字节不变）、`writeBatch*`。

### 改之前列的候选句子

给作者看、这次改了的（旧 → 新）：

| 位置 | 显示在哪 | 旧 | 新 |
| --- | --- | --- | --- |
| `chapterWritingPipeline.ts` `draftFromBrief` | 结果说明（对话里那句） | 章节草稿已通过 brief 检查，生成 {rel} 的待审阅修订。 | 见上，按要不要点分两种 |
| `chapterWritingPipeline.ts` `startChapterWriting` | 开跑时的结果说明 | 正在整理 Chapter Brief。 | 正在整理章纲。 |
| `chapterWritingContracts.ts` `BRIEF_READY_PREFIX` | 写进会话的那句（会话历史里看得到） | Chapter Brief 已准备：{goal}。 | 章纲已准备：{goal}。 |
| `chapterWritingPipeline.ts` 计划步骤 | 流程树 | 作者已确认 Chapter Brief。 / Chapter Brief 已确认。 / 已生成 Chapter Brief。 / 已按 brief 起草正文。 / 按 brief 起草正文。 | 作者已确认章纲。 / 章纲已确认。 / 已生成章纲。 / 已按章纲起草正文。 / 按章纲起草正文。 |
| `chapterWritingPipeline.ts` `resumeChapterWriting` | 运行失败原话 | 目标章节在 brief 确认期间发生变化，请重新生成 brief。 / Chapter Brief 缺少可信上下文快照，请重新生成。 | 目标章节在章纲确认期间发生变化，请重新生成章纲。 / 章纲缺少可信上下文快照，请重新生成。 |
| `chapterWritingContracts.ts` `confirmBrief` | 运行失败原话 | 确认写章前需要提交结构化 Chapter Brief。 / Chapter Brief 已过期，请重新生成后再确认。 / Chapter Brief 字数范围无效。 | 确认写章前需要提交结构化章纲。 / 章纲已过期，请重新生成后再确认。 / 章纲字数范围无效。 |
| `chapterSourceGuard.ts` | 运行失败原话 | Chapter Brief 的来源在确认期间已变化，请重新生成 Brief 后再确认。 / Chapter Brief 来源超过校验上限，请缩小材料后重新生成。 / 事实台账超过校验上限，请缩小后重新生成 Brief。 / Chapter Brief 来源无法读取或验证，请重新生成。 / Chapter Brief 缺少来源版本，请重新生成。 / Chapter Brief 来源版本无法验证，请重新生成。 / Chapter Brief 的来源路径无法验证，请重新生成。 | 同句，Chapter Brief / Brief → 章纲 |
| `kernel/writingContext.ts` `writingContextFromGuardedBundle`（只有章节来源守卫调用） | 运行失败原话 | Chapter Brief 的资料投影已变化，请重新生成。 | 章纲的资料投影已变化，请重新生成。 |
| 前端 `agent-step-mapping.ts` | 流程树等待步骤 | 等待作者确认 Chapter Brief | 等待作者确认章纲 |
| 前端 `overview-activity.ts` | 作品总览状态 | 等待章节 Brief 确认 | 等待章纲确认 |

列出但没改的：

- 给模型的提示词（不改）：`briefPrompt`「把作者的写章要求整理成 Chapter Brief…」；`REPAIR_INSTRUCTION_PREFIX`「按已确认 Chapter Brief 修复以下硬失败…」（修复步骤喂给修订链路的指令，也是节选过滤的识别前缀）；`draftInstruction` 的兜底「按已确认 brief 写作」；`chapterCheckProtocol.ts` 检查提示词里的 brief。
- 界面上看不到的：`chapterCheckProtocol.ts` 的 `InvalidCheck('检查源版本或摘要不匹配，请重新检查当前正文和 brief。')`（被收成统一的「检查结果无效、未绑定当前来源或证据无法核实」再给作者）；`tools/specs/chapter.ts` 四条工具说明（工具目录与证据，界面不显示）。
- 给作者看、但不在这一刀范围的英文：计划步骤「生成待审阅 proposed patch。」「检查通过后生成 proposed patch。」——「proposed patch」在别的固定管线计划步骤里也是同一说法，要改就一起改，单列给编排者。
- 设计记录 `docs/internal/write-batch-plan-2026-10.md` 里引用的旧句子没改（当时的代码快照）。

## 验证

- golden：3 份有变化，其余 42 份逐字节不变（含帧 schema 与 p5 两份影子档）。
  - 做法照 #540：先在基线（`origin/master` = `ad4c6374`）上给 `sha256Hex` 挂临时导出钩子跑引擎全量（`--testTimeout=600000`，111 个文件 14227 passed），导出 3747 条含中文的哈希原文；钩子用逆替换还原（没用 git checkout），`git status` 确认 `kernel/sha256.ts` 无改动。再用变换 T 从基线样本写出新样本。脚本在 `output/chapter-summary-wording/`（不入库）：`golden_wording.py`（T 的唯一定义）、`golden_update.py`（写样本）、`golden_proof.py`（核对）。
  - T 只有两条规则：规则一是上表里与上下文无关的旧句 → 新句子串替换；规则二是结果说明，按场景取「要不要点」与章号——取自同一场景里带这句摘要的 `agent_result`（`requires_user_confirmation`、`chapter_brief.chapter_ordinal`），并断言与场景里 `chapter.write` 修订的 `requires_confirmation` 一致、一个场景只有一种取值。派生改动（哈希重算、`content_chars` / `tool_output_chars` 重数、跨 400 码点改记）的逻辑照 #540 留着，这次都是 0。
  - `golden_proof.py` 输出摘要：
    - `p2-writing-context.windows.json`：1 处文本替换（「Chapter Brief 的资料投影已变化」1）。
    - `p3-chapter-writing.windows.json`：299 处文本替换——「按 brief 起草正文。」137（含「已按 brief 起草正文。」26）、结果说明 81、「Chapter Brief 已准备：」33、「已生成 Chapter Brief。」27、来源变化报错 11、「Chapter Brief 已过期」4、「字数范围无效」2、「作者已确认 Chapter Brief。」2、「Chapter Brief 已确认。」2。
    - `p3-host.windows.json`：42 处文本替换——结果说明 18、「按 brief 起草正文。」15、「Chapter Brief 已过期」4、「Chapter Brief 已准备：」3、「已生成 Chapter Brief。」2。
    - 结果说明：自动档场景（`write-auto-profile`）9 处换成「修订按这部作品的权限直接写进」，其余 14 个场景 90 处换成「生成了 … 的修订，请看过对比再决定是否接受」；golden 里的章纲都不带章号，所以都是「章节草稿」开头。
    - 差异叶子全部是「文本替换」；长串重算 0、计数重数 0、改动的哈希 0。旁证：旧代码导出的原文里带旧句的 8 条，哈希都不在基线 golden 里。
    - 结论：T(基线 golden) 与新 golden 逐字节相等，行尾照旧（全是 LF，Python 数字节确认）。
  - 新 golden 由 T 写出，所以「T(基线)＝新 golden」本身是构造出来的；真正的佐证是下面的引擎全量：回放把新代码的实际输出与新 golden 逐项比，全部通过，即新代码输出 ＝ T(基线)。
- `pnpm --filter @storyforge/engine run typecheck`：EXIT=0。
- `pnpm --filter @storyforge/engine test`：111 个文件 14234 passed / 2 skipped，EXIT=0（基线 14227，新增 7 条）。
  - 新增：`chapterWriting.test.ts`「结果说明跟着要不要作者点」5 条（自动档说直接写进、询问档说看过对比；带连载计划时两档都说「第 3 章的草稿」；会话里那句是「章纲已准备：…」）；`briefConversation.test.ts` 分界认新旧两种开头 2 条。改了照抄原话的 3 个测试常量（来源变化报错）。
- `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
- 前端相关 15 个文件（`ui-terminology`、`source-standards`、`overview-activity`、`pending-new-file-tabs`、`agent-run-events`、`behavior/auto-writeback`、`proposed-patch-outcome`、`chapter-brief`、`agent-step-labels`、`agent-steps-panel`、`chat-window`、`agent-engine-chat-window`、`book-overview`、`book-overview-app`、`agent-checkpoint-recovery`）：176 passed；前端全量 `npx vitest run`：267 个文件 2690 passed，EXIT=0。
- `pnpm run lint`：第一次 prettier 报 `chapterWriting.test.ts` 格式，`prettier --write` 后重跑 EXIT=0。
- 三道浏览器回归单跑：`verify:inline-continuation` EXIT=0、`verify:smoke` EXIT=0、`verify:agent-conversation` EXIT=0。
- 行尾：改动文件都是 LF、没有 CRCRLF；`git diff --numstat` 与 `--ignore-all-space --numstat` 一致（17 个文件）。
- 变异（定点替换，先断言目标串只出现 1 次，跑完无条件还原；跑 `chapterWriting` / `briefConversation` / `chapterDraftTruncation` / `agentHost` 四个文件）：
  - M1 说法不分档（`passedSummary` 的条件改成恒为要点）：3 红——golden 回放 `write-auto-profile`、「不用点说直接写进」、「带章号（auto）」。
  - M2 分界不认旧句（`isBriefReady` 只认新开头）：1 红——「旧会话里的旧说法」那条分界。
  - 还原后四个文件 208 passed。

## 未覆盖

- 没跑真模型、真宿主探针、Tauri 冒烟、Rust 测试；没打包。没跑完整 `pnpm verify`（它的各道门除 project-core 外都单跑过，project-core 没动）。
- 新说法在对话里的观感、界面另补的「已写进 …」与这句连在一起读是否顺，没在真机上看。
- 计划步骤里的英文「proposed patch」没改（见上）。
