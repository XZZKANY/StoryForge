## 2026-10-31 引擎去重：`AgentOrchestrationError` 与内核模型端口类型各留一份

- 背景：作者要求「架构与组件统一」，同一件事只留一种做法；本刀只处理引擎里两处「同一个东西定义了好几份」。字数函数、哈希、读文本、取模型 JSON、工具参数校验的去重是后面几刀，本刀没碰。帧契约、14 个数据形状、golden 都没动（`git status --short packages/engine/golden` 为空）。
- 改动：
  1. **`AgentOrchestrationError` 只留内核那份**（`kernel/reviseDelivery.ts`）。`loop/runPayloads.ts` 删掉自己的同名类，改为从内核导入再导出，13 个 loop 文件的 import 不用动；`loop/runEvents.ts` 原有的再导出（没有文件从它取这个类）没动。
  2. **内核模型端口合成一个 `LlmPort`**（新文件 `kernel/llmPort.ts`，取并集 `{ content: unknown; latency_ms?: unknown }`）。删掉 `bookBreakdown.ts` 的 `BreakdownLlmPort`、`crossChapter.ts` 的 `CrossChapterLlmPort`、`reviewReasoning.ts` 的 `ReviewLlmPort`，三处改用 `LlmPort`；`index.ts` 去掉三个旧名、改导出 `LlmPort`。三个旧名在前端（`apps/desktop/frontend/src`、`tests`、`scripts`）没有引用，不用改调用方；前端 `lib/engine/ideCommands.ts` 用的是 `BreakdownModel`，它的 `callLlm` 返回值类型只是多了可选的 `latency_ms`，原有实现照样能赋值（前端类型检查通过）。
  3. 加一条守护测试（`loop/contracts.test.ts`「内核修订范围抛的编排错误，loop 的 instanceof 也认得」）：让 `composeScopedInstruction` 超指令预算抛错，断言 `toThrow` 的是 loop 从 `runPayloads` 取到的 `AgentOrchestrationError`。

### 两个类分开时有没有真 bug：查了，走不到

- 内核那份只在三处抛：`verifyReviewSource`（审稿来源缺失 / 不是当前版本）、`resolveReviseScope`（选中的审稿问题不存在）、`composeScopedInstruction`（经 `scopedReviseInstruction`，超指令 / 证据预算）。loop 里唯一调它们的是 `loop/tools/patchContext.ts::prepareRevisionScope`，只被 `file.revise` 处理器调用。`assistant/` 与前端都没有按类名或 `instanceof` 认这个错。
- 这条路只有两种走法，两种都不会让内核那份原样落到 `agentRuntime.ts` 的 `executeAgentUserMessageRun`（`if (error instanceof AgentOrchestrationError) throw new AgentRuntimeError(...)`）：
  - 对话循环里调 `file.revise`：`chatLoopAdapters.ts::executeLoopTool` 把除 `RunInterrupted` 外的任何错误都转成工具失败回给模型，不看类。golden `p3-patch-tools` 里「选中的审稿问题不存在」「审稿报告不是当前文件的当前版本」两条就是这样记成 `status: failed` 的。
  - 固定管线（显式 intent `file.revise`）：在 `AgentRuntime.runUserMessage` 的 try 里跑，它的 catch 对任何不是 loop 那份的错误都 `throw new AgentOrchestrationError(message)`（loop 那份）重新包一次，所以到外层时 `instanceof` 已成立。`runControlChannel.ts` 的两处续跑也走 `executeAgentUserMessageRun` → `runUserMessage`，同一个 try。try 之后的 `finalize` / `recordPlan` / 隐藏任务不调上述三个函数。
- 实测（改动前，临时单测，跑完已删、不入库）：拿 golden `p3-fixed-pipelines` 的 `revise-fixed-offered-review` 场景，把作者原话改成「按审稿意见修改第9条」（报告只有 1 条）走 `agentRunReplay`：抛的是 `AgentRuntimeUserMessageError`，消息「选中的审稿问题不存在，请按当前报告重新选择；未生成修订。」；同时 `kernel 类 === loop 类` 为 false。也就是两个类确实不同，但被那层兜底包装掩盖了，用户可见行为没错。本刀因此不改 `agentRuntime.ts` 的兜底。

### 验证

- 守护测试的变异验证：把 `runPayloads.ts` 的导入临时换回一个本地同名类 → `npx vitest run src/loop/contracts.test.ts` 红 1 条（新加的这条，其余 18 条绿）；定点换回导入 → 19 passed。
- `pnpm lint`：EXIT=0（0 error；2 条 warning 在没动的 `apps/desktop/frontend/tests/independent-claim-history.test.ts`，原来就有）。
- `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
- `pnpm --filter @storyforge/engine typecheck`：EXIT=0。
- `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14252 passed、2 skipped。golden 文件零变化。
- `npm --prefix apps/desktop/frontend run test`：第一次全量 1 条超时红（`tests/write-batch-grant.test.tsx`「只有批量写章调度器发授权、把授权带进运行」，扫前端源码文件的测试，5 秒超时）；单跑该文件 10 passed；再跑全量 EXIT=0，269 个文件，2732 passed。判为满载超时，与本刀无关（该测试不经过引擎）。
- 行尾：改动的 6 个文件与新文件都是纯 LF，与改前一致；`git diff --numstat` 与 `--ignore-all-space --numstat` 一致。

### 未覆盖

- 本地没跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），本机有别的会话在跑 headless Chrome、会互相拖超时，以 CI（`Windows Verify` 的 `pnpm verify`）为准。
- 没动 Rust、没改引擎与宿主之间的接口，没跑 Rust 测试、Tauri 冒烟、真宿主探针；不调模型。
- 引擎里其他同形的模型调用类型没并进 `LlmPort`：`loop/factBackfill.ts` 的 `FactModel`（返回 `{ content: string }`）、`loop/tools/execution.ts` 的 `complete`（返回整个对象）、`assistant/service.ts` 的 `call` / `callStreamed`，返回形状不同，不在本刀范围。
