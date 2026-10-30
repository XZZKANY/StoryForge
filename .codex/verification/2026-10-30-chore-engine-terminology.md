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
