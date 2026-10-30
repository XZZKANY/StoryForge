## 2026-10-30 引擎喂给模型的词与界面消息改成作者定的说法

- 改动：AI 在对话里说「补丁尚未写盘，请在界面核对 diff」，是照着引擎喂的词说的。这一刀把 `packages/engine/src` 里喂给对话模型的中文（对话循环 system prompt、对话路径的作者指令前缀、工具说明、工具反馈与工具报错、对话检查点与历史前缀）和会显示在界面上的中文（计划步骤、摘要、提示与报错）按 CONTEXT.md「界面用词」改：补丁 → 修订，写盘 / 落盘 / 写回 → 写进文件（名词复合词用「写入」），diff → 对比，项目 → 作品（目录叫作品文件夹），句子里的 Agent / Assistant → AI，稿件 / 稿子按句义改成正文或文件。共 46 个源文件、160 条句子（186 处），只换中文文本，工具名、id、JSON 键、事件类型、帧 schema 不动。
  - 没改的提示词：产字与评稿链不改（CLAUDE.md §4，没有对比证据）——`kernel/craft.ts`、`assistant/continuation.ts`、`assistant/revision.ts`、`assistant/prompts.ts`（`CHAT_SYSTEM_PROMPT` / `buildChatPrompt` 经 `chatReply` 也是章纲与章节检查的提示词，起草提示词同文件）、`kernel/reviewReasoning.ts`、`kernel/settingSources.ts`、`loop/chapterWritingContracts.ts` 里的章纲提示词。`kernel/authorVoice.ts` 只改 `CONVERSATION_PREFIX`（只进对话循环），产字路径的 `GENERATION_PREFIX` 没动。
  - 识别作者输入：`loop/runPayloads.ts` 的「确认写回」判定旧词全留，补认「写进文件」（加一条单测）。
  - 没改的内部文本：带代码实体名的运行日志与开发者报错（`AgentRun …`、`Root Agent …`、`Agent role catalog …`、`Agent intent / skill / Runtime …`、角色目录说明）、`docx.ts` 的「zip 补丁」（ZIP 格式术语）、「手稿」（不在这次的映射里）。
  - 测试跟着改：引擎测试与测试替身里照抄的原话（projectTree、agentHost、polish、trimNoop、sqlAssistant、会话存储替身），前端 4 个跑引擎的测试与真宿主探针脚本里断言的会话存储报错原话。
- 验证：
  - golden：31 份样本更新；p5 影子档两份（已无测试消费）与帧 schema 逐字节不变。证明脚本（仓库外 `%TEMP%\sf-engine-term\golden_proof.py`）：HEAD 版样本经变换 T 后与新样本逐字节相等，T 只由「旧句 → 新句」对照表派生——字符串子串替换；被压成 `{sha256, length}` 的长串与改动过的哈希用 HEAD 代码回放时 `sha256Hex` 导出的原文还原后替换重算；由被替换文本派生的 `content_chars`、`tool_output_chars` 重数；回放规范化里从 ≤400 长到 >400 码点的 18 个字符串改记摘要；4 份 base64 写盘内容解码替换再编码。改动过的 755 个哈希全部在新代码回放导出里找到，且新代码当时哈希的原文与「HEAD 原文按表替换」逐字相同。导出钩子用完已从 HEAD 还原 `kernel/sha256.ts`。
  - `pnpm run test:engine`：类型检查通过，104 个文件 14046 passed / 2 skipped，EXIT=0。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0；`apps/desktop/frontend` 下 `npx vitest run`：252 个文件 2532 passed，EXIT=0。
  - `npx eslint packages/engine`：EXIT=0；`npx prettier --check "packages/engine/src/**/*.ts"`：全部符合。
  - 行尾：`git diff --numstat` 与 `git diff --ignore-all-space --numstat` 一致（90 个文件）。
- 未覆盖：没跑真模型（改了喂给模型的词，模型实际怎么说未验）；没跑完整 `pnpm verify`、Rust 测试、Tauri 冒烟与真宿主探针（`verify-engine-p0-native.mjs` 只改了断言原话，没跑）；p5 影子档样本里录的旧 prompt 没改（已无测试消费）。

## 2026-10-30 第二轮：合进 master，补 AgentRun / 手稿，前端替身跟原话

- 改动：
  - 合进 origin/master（`38a5bb85`，含 #532 插件技能、#534 界面第二批用词、写章拟完章纲直接起草）：引擎源码自动合并；冲突只在 p3-chapter-writing、p3-host 两份 golden，取 master 样本再套第一轮变换（master 代码回放导出原文，第一轮表）。合并后引擎全套 106 个文件 14074 passed。master 新进的引擎代码（`specs/skill.ts`、`skillHandlers.ts` 等）按同一套映射扫过，没有要改的中文。
  - 会显示给作者或进对话检查点的运行原话，AgentRun → AI：权限批准 / 拒绝的终态原话（`runControlChannel.ts`，拒绝改为「作者拒绝了权限请求，AI 已停止。」）、找不到运行的报错（`runEvents.ts`，「找不到这次 AI 运行。」，控制失败与读事件 / 存档点时显示）、中断摘要「AI 已在 … 边界暂停 / 停止 / 中断」（进对话检查点；界面另有翻译）、完成兜底「AI 已完成。」（`runEvents.ts`、`systemJobs.ts`）、暂停 / 恢复 / 停止 / 重试的控制原话（`runPayloads.ts`）、「每次 AI 运行最多生成一组 Project Knowledge 提议。」（工具报错，`fsHandlers.ts`）。
  - 「手稿」只当左栏视图名：工具说明里指章节文字的 7 处改「正文」（`specs/projectCanon.ts`、`specs/projectQuality.ts`），dossier 头注「不是作者的正文。」（`canonDossier.ts`，写进派生文件）。
  - 留着不改的（只给开发看）：`Root Agent …` 运行日志（产出 artifact、接收目标、创建计划三条事件原话，不进检查点、界面不显示）、角色目录与校验报错、`Agent intent / skill / Runtime …` 与 `Agent user_message 不能为空。` 这类只有程序传错参数才会出现的报错、`Agent 用户请求` 占位标题。产字 / 评稿提示词照旧不动，「Desktop」不改。
  - 测试跟着改：`agentHost.test.ts` 断言找不到运行的原话；前端照抄引擎原话的输入数据改成新原话——`agent-progress-panel:147`、`assistant-suggestions:7`、`chat-window`（对比提示与中断摘要两处）、`agent-text-stream`（中断摘要三处）。
- 验证：
  - golden：相对 origin/master，31 份样本有变化，p5 两份与帧 schema 逐字节不变。证明脚本同上（第一轮表 160 条、第二轮表 19 条依次套用；基线换成 master 样本与 master 代码回放导出）：T(master golden) 与新样本逐字节相等；改动过的 761 个哈希在新代码回放导出里逐字核对；第二轮 18 个去重旧句全部在 golden 里命中。两次挂在 `kernel/sha256.ts` 的导出钩子用完都已从 HEAD 还原。
  - `pnpm run test:engine`：类型检查通过，106 个文件 14074 passed / 2 skipped，EXIT=0。
  - `npm --prefix apps/desktop/frontend run typecheck`：EXIT=0；`apps/desktop/frontend` 下 `npx vitest run`：254 个文件 2575 passed，EXIT=0。
  - `npx eslint packages/engine` 与改过的 4 个前端测试：EXIT=0；`npx prettier --check "packages/engine/src/**/*.ts"`：全部符合。
  - 行尾：本轮 `git diff --numstat` 与 `--ignore-all-space --numstat` 一致（31 个文件）。
- 未覆盖：同上一节——没跑真模型、完整 `pnpm verify`、Rust 测试、Tauri 冒烟与真宿主探针。

## 2026-10-30 编排者审查与集成

- 改动：第二轮措辞照代理提议接受。合入 origin/master（3b6dba8b，含 #535 / #536 / #537，无冲突）；合并前后各扫一遍引擎非测试源码，旧词命中都是 42 处、master 新代码没带进新命中，42 处逐条核过属于产字 / 评稿提示词、开发向日志与角色目录、作者输入匹配、ZIP 术语。`CONTEXT.md` 用词表记下引擎已改、产字提示词不动。
- 验证：编排者独立复跑 `golden_proof.py`，结论「T(基线 golden) == 新 golden（逐字节）」；基线 golden 在 38a5bb85、d8f380fb、2162ec1a 三处相同。前端守护测试绿。`pnpm verify` EXIT=0（project-core 34、引擎 14075 passed / 2 skipped、前端单测 2576 passed、三条浏览器回归全过）。
- 未覆盖：没跑真模型（会花钱）与真宿主探针；只改文字，没动引擎与宿主之间的接口。
