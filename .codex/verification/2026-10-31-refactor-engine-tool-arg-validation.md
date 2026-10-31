## 2026-10-31 工具参数校验：钉住「模型参数只在 SDK 边界校验」，删 `ToolDefinition` 上两个死字段

- 背景：作者要求「架构与组件统一」。审查说工具参数有「两套校验」（对话循环按 `loop_schema` 校验、固定管线不校验，处理器里又手写一堆）。本刀先摸底（下面五节），结论是：**审查时说的「两套校验」实为两份约定、各自已单入口，故不合并**——`loop_schema` 管模型看到的参数形状，只在 SDK 边界校验一次；处理器入参是后端拼的另一份形状，处理器经 `runtimeArguments` 读取。硬把 `loop_schema` 套到公共入口，会拒掉固定管线现有的每一次审稿 / 修订 / 润色。摸底后停下回报，作者选了方案 A（见「方案与取舍」）。分支起点 `origin/refactor/engine-model-json`（#570 未合并），PR base 仍是 master。
- 改动（方案 A）：
  1. 删 `ToolDefinition`（`loop/tools/execution.ts`）上从没人读、也不进任何输出的 `input_schema` / `output_schema` 两个副本字段（类型与 `toolDefinitionFromSpec` 各 2 行）。工具声明 `AgentRuntimeToolSpec` 上的同名字段与 golden `p3-tool-catalog.json` 里那份不动。
  2. 在 `LoopToolSchema` 类型定义处（`loop/tools/specModels.ts`）加一行注释：只描述模型看到的参数形状、只在 SDK 边界校验；处理器入参是后端拼的另一份形状，由 `runtimeArguments` 读取。
  3. 加守护测试（`loop/chatLoop.test.ts`「模型参数在 SDK 边界按 loop_schema 校验」）：真跑 `runChatLoop`，模型第一轮对每个交给它的工具各发一条不合 `loop_schema` 的调用（有必填就全不给，没必填就把第一个字段给成错类型），外加一条合法的 `fs_list` 作对照；断言处理器只被调了 `fs.list` 一次，每条非法调用回给模型的都是「工具参数解析失败：Tool arguments do not match the declared schema: …」，并核对交给模型的工具覆盖了全部循环工具（`skill.read` 按有无插件技能决定给不给，不算在内）。
  4. 处理器里的手写校验一条没删（理由见摸底三）；两个结果类型不合并（理由见摸底五）。

### 摸底一：对话循环的校验做了什么

- 位置：`loop/sdkTools.ts::parseToolArguments`，由 `loop/sdkLoop.ts::prepareAndExecuteCall` 在权限策略、预算检查和 `tool_started` 之前调用。校验的是**模型原样给的参数**，按 `loop_schema.parameters` 走（`chatLoopAdapters.ts::buildStoryforgeToolRegistry` 把它装进 `ToolSpec.inputSchema`）。
- 管的东西（`validateJsonSchema`）：JSON 能否解析、是不是对象、`enum`、`type`、`required`、嵌套 `properties` / `items`、`minLength` / `maxLength`、`minimum` / `maximum`。**不管**：`minItems` / `maxItems`（`knowledge.propose` 声明了 1–5 条，SDK 不拦，实际由内核 `buildKnowledgeProposalGroup` 拦）；多余字段（29 个声明里没有一个写 `additionalProperties: false`）；字符串非空白。
- 受保护键（`PROTECTED_LOOP_TOOL_ARGUMENT_KEYS`，含 `confirmed` / `user_confirmed`）：**不拒，静默剥掉**。schema 校验时它们算多余字段、放行；之后 `sanitizeLoopToolArguments` 在四处剥：`agentRuntime.ts` 的循环执行器（进处理器前）、`StoryForgeRuntimePolicy.decideTool`（权限门输入）、`safeArguments`（处理器前失败的证据）、`executeLoopTool`（证据摘要）。
- 失败时：`RuntimeToolResult.failure('invalid_arguments', 'Tool arguments do not match the declared schema: required@path')`；回给模型的是 `{"error":"工具参数解析失败：Tool arguments do not match the declared schema: …"}`，证据与流程树记的是「工具参数解析失败：工具参数不是有效 JSON 对象或不符合 ToolSpec。」。两种文字都进了 golden（`p3-chat-loop.windows.json` 12 处、`p3-sdk-runtime.json` 79 处）。

### 摸底二：固定管线给处理器的参数

- 由代码拼：`fixedPipelines.ts` 与 `chapterWritingPipeline.ts` 把前端命令的 `args` 原样展开，再叠上一个工具的输出（`{ ...args, ...context.output }`），直接调 `agentRuntime.ts::executeTool`，不做任何 schema 校验。
- 实测（临时在 `agentRuntime.ts::executeTool` 里插桩，对每次调用按该工具的 `loop_schema` 跑一遍 `validateJsonSchema` 只记不拦，跑引擎全套 111 个文件、14266 passed；插桩已用定点替换删掉，`git diff` 为空）：

  | 来源 | 工具 | 调用次数 | 按 loop_schema 的结果 |
  | --- | --- | --- | --- |
  | 固定管线 | file.review | 44 | 全部 `required@path` |
  | 固定管线 | file.revise | 20 | 全部 `required@path, required@instruction` |
  | 固定管线 | chapter.polish | 14 | 全部 `required@path` |
  | 固定管线 | context.load / judge.run / chapter.brief / draft / check / repair | 598 | 没有 loop_schema |
  | 对话循环（变换后） | file.review / file.revise / chapter.polish / file.create / prose.continue / project.trim_prose | 152 | 全部 `required@path`（`path` 已被换成 `file_path` + `content`） |
  | 对话循环（变换后） | fs.* / knowledge.propose / cross_chapter / deep_consistency | 150 | 通过 |

- 也就是：**loop_schema 描述的是模型看到的形状（相对路径 `path`、必填 `instruction`），处理器收的是后端形状**（`file_path` 绝对路径、`content` 正文、`project_root`；`file.revise` 的指令缺省取作者原话 `context.userMessage`）。把 loop_schema 套到固定管线上，现有每一次审稿 / 修订 / 润色都会被拒。
- 固定管线合法地带着受保护键：`_agent_intent`、`content`、`file_path`、`context_bundle`、`llm_context_snapshot`、`llm_prompt_context_bundle`、`use_main_model`、`online_enabled`、`project_root`。

### 摸底三：处理器里的手写校验逐条分类

约 60 处（含语义校验），按能否被 schema 覆盖分：

- **后端注入字段必填（30 处，留）**：`file_path` / `content` / `project_root` 的 `requiredString` / `requiredText` / `typeof`（fsHandlers 7、checkHandlers 7、canonHandlers 3、patchHandlers 9、polishHandlers 2、skillHandlers 1、deepConsistency 1）。这些键是受保护键，模型给不了、loop_schema 里没有，schema 覆盖不了。golden `p3-patch-tools` 录了 4 条「Agent intent 缺少参数：content。」、`p3-tool-handlers` 录了 1 条。
- **模型字段非空白（9 处，留）**：fs.read `path`、fs.search `query`、project.knowledge 按 action 条件必填的 `path` / `query`、三个检查工具的 `path`、skill.read `name`、deep_consistency `path`。schema 只写了 `type: string`，不拦空串和全空白；golden 录了「缺少参数：path / query」各一条（全空白输入）。
- **范围（3 处，留）**：prose.continue `target_chars` 80–1200、trim_prose `target_percent` 1–50、promise_check `stale_after_chapters ≥ 1`。loop_schema 里没写 `minimum` / `maximum`，补上会改 golden 里逐字节比对的 `loop_schemas_wire`。
- **宽容换算（3 处，留）**：`fsIntArg`（offset / limit，非法回退默认）、`optionalInt(anchor_line)`。不是拒绝。
- **被 SDK schema 完全覆盖、且工具只走对话路径的类型校验（13 处）**：collapse_check 的 `beats` / 三个字符串 / `deletable`，entity_budget_check 的 6 个列表 / 8 个整数，plan_update 的 `chapters` / `arcs` / `remove_ordinals`，cross_chapter_check 的 `paths`，canon_delta 的 5 个对象数组，hooks_delta 的 `observed_hooks`，project.knowledge 的 `action` 必填与未知 action 分支。生产里走不到（SDK 先拦），但**其中 12 处的报错文字被 golden `p3-tool-handlers.windows.json` 钉住**（Python 预言机直接调处理器录的，如「beats 必须是字符串数组。」），SDK 入口出的是英文 `type@beats`。按规矩保留。唯一没被 golden 钉住的是 `project.knowledge` 的 `requiredString(action)`（fsHandlers 145 行），它和被钉住的未知 action 分支连在一起，单删收益 1 行，没删。
- **语义（留）**：路径越界 / 文件存在 / 隐藏路径、每 run 一组知识提议、plan_update 至少一项、技能不存在、润色目标在作品内、正文为空等。

### 摸底四：`input_schema` / `output_schema`

- `AgentRuntimeToolSpec` 上的两个字段 29 个全是 `{}`，生产代码没人读：不进发给模型的工具列表（`buildLoopToolSchemas` 只用 `loop_schema`）、不进帧、前端没有引用。
- 但它们**进了 golden**：`p3-tool-catalog.json` 的 `specs[*]` 逐字段录了 `"input_schema": {}` / `"output_schema": {}`，`catalog.test.ts`「28 个工具声明逐字段一致」用 `toEqual(golden.specs)` 比。删字段或改成引用 `loop_schema.parameters` 都会让这条 golden 测试红，所以没动。
- `ToolDefinition`（`tools/execution.ts`）上那两个是 `toolDefinitionFromSpec` 拷过去的副本，没人读、也不进任何序列化输出（golden 里没有 `ToolDefinition` 形状）。本刀删了这两个。
- 另：SDK 的 `RuntimeTool.outputSchema` 是另一回事（StoryForge 工具注册时不传，恒为 `{}`，`sdkLoop.ts` 遇空跳过），只在 SDK 自己的 golden 用例里用到。

### 摸底五：两个结果类型

- `ToolResult`（`tools/execution.ts`）是 StoryForge 处理器的契约：`trace`、带 `requires_confirmation` 的产物、`patch_proposal`、`summary` / `payload` / `metrics`，固定管线直接读它。
- `RuntimeToolResult`（`sdkTools.ts`）是从 Python 搬来的通用 SDK 的结果：成功 / 失败、`errorCode`、`retryable`（重试策略用）、带 `reference` 的产物，SDK 自己有 golden（`p3-sdk-runtime.json`）。
- `chatLoopAdapters.ts::executeLoopTool` 把前者转成后者（反馈文字、产物映射、异常转 `storyforge_tool_error`）。这是内部契约与 SDK 之间的适配层，合理分层，不是重复，不该合并。

### 方案与取舍（作者选 A）

- **A（已做，零行为变化、零 golden 变化）**：承认是两份契约、各自已经只有一个入口——模型参数只在 SDK 边界按 `loop_schema` 校验（现状），处理器入参由代码拼、处理器经 `runtimeArguments` 的 `requiredString` / `requiredText` 读（现状）。只做：删 `ToolDefinition` 上的两个死副本；加一条守护测试钉住「对话路径里不合 `loop_schema` 的调用在 SDK 边界被拒、处理器没被调用」，并在 `loop_schema` 声明处写明它只描述模型形状、不要拿去校验固定管线。
- **B（真统一处理器入参，不推荐）**：给 29 个工具补处理器形状的 `input_schema`，在 `agentRuntime.ts::executeTool` 统一校验、用来源参数区分受保护键，再删处理器形状校验。代价：`p3-tool-catalog` golden 变；`p3-tool-handlers` / `p3-patch-tools` 里约 25 条形状类处理器报错文字要么保留（那就删不掉），要么让入口拼出同样的中文（等于另起一套映射）；固定管线开始拒前端的畸形参数（行为变）。
- **C（只删那 12 处被覆盖的类型校验）**：处理器 golden 测试改为先过 SDK 同一个校验函数，把那 12 条 golden 记录改判为「在入口被拒」。golden 文件字节不动，但等于放宽 Python 预言机比对，需要作者点头。收益约 checkHandlers / canonHandlers 共 -30 行。

### 验证

- 摸底实测：临时在 `agentRuntime.ts::executeTool` 插桩跑引擎全套（111 个文件，14266 passed、2 skipped，插桩只写 stderr、不拦），插桩已定点删掉，`git diff` 为空。
- 守护测试变异验证（都用带 `assert count==1` 的定点替换打、再定点换回）：
  - 打在校验本身：`sdkTools.ts::parseToolArguments` 的 `validateJsonSchema(...)` 换成空数组 → 新测试红（处理器被调了 23 次：22 条非法 + 1 条对照），同文件 golden 回放 `invalid-and-unknown` 也红；换回后新测试绿。
  - 打在接线上：`chatLoopAdapters.ts::buildStoryforgeToolRegistry` 交给 SDK 的 schema 换成 `{ type: 'object' }` → 同文件 35 条红（含新测试；其余是 golden 回放，因为发给模型的工具 schema 也变了）；换回后 `git status` 只剩本刀改动。
- `pnpm lint`：EXIT=0（0 error；2 条 warning 在没动的 `apps/desktop/frontend/tests/independent-claim-history.test.ts`，原来就有）。
- `pnpm --filter @storyforge/engine typecheck`：EXIT=0。
- `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0。
- `pnpm --filter @storyforge/engine test`（含 golden）：EXIT=0，111 个文件，14267 passed、2 skipped（比改前多 1 条，即新守护测试）。`git status --short packages/engine/golden` 为空，golden 零变化。
- `npm --prefix apps/desktop/frontend run test`：EXIT=0，270 个文件，2752 passed。
- 行尾：改动的 3 个源文件与本记录都是纯 LF，与改前一致；`git diff --numstat` 与 `--ignore-all-space --numstat` 一致。

### 未覆盖

- 本地没跑三个浏览器回归（行间续写 / 浏览器冒烟 / Agent 对话），本机有别的会话在跑 headless Chrome、会互相拖超时，以 CI（`Windows Verify` 的 `pnpm verify`）为准。
- 没动 Rust、没改引擎与宿主之间的接口，没跑 Rust 测试、Tauri 冒烟、真宿主探针；不调模型。
- 没做的：处理器形状校验（方案 B / C）、给 `validateJsonSchema` 补 `minItems` / `maxItems`、给 `loop_schema` 补非空白或上下限——都会改行为或 golden，留作者另定。
