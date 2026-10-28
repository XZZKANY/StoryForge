## 2026-10-28 对话栏「上下文」面板：长期规矩 + 这一轮读了

- 改动：
  - 作者拍板：对话头加图标，展开一块，先做「长期规矩」和「这一轮读了」两块（「一直带着的」下一刀）。
  - 对话头：`ConversationHeader`（`panels.tsx`，CRLF，按字节加 3 行）新增 `contextToggle` 插槽；`ChatWindowView.tsx`（CRLF，按字节加 7 行）放「上下文」图标（Lucide `Layers`，`shell-icons.tsx` 补导出），点开在对话头与消息列表之间展开 `ContextPanel`（`max-h-[40%]`，内部滚动），再点收起；默认收起，收起时不读盘。
  - 长期规矩：引擎 `authorVoice.ts` 把截断标记收成模块常量，新增 `describeAuthorInstructions(text)` 拆出正文 / 字数 / 是否截断（截断标记只在引擎里认），`index.ts` 导出它和 `MAX_INSTRUCTION_CHARS`；`readAuthorInstructions` 输出不变。`lib/engine/authorInstructions.ts` 用 `nativeProjectReader` 调同一个 `readAuthorInstructions`，读不到再 inspect 区分「不存在」与「在但带不进去」（读口报错按「在」处理，避免新建覆盖）；`lib/api/author-instructions.ts` 动态引入并给界面状态 missing / unused / active（字数、是否截断、前 4 行）。`useAgentInstructions` 展开时读、按作品存结果，听 `FS_MUTATION_EVENT` 只在这份文件或 `.storyforge` 目录变化时重读；「新建」先 `pathExists`，已在就直接打开不覆盖，否则 `createDir(.storyforge)` 再 `writeFile` 写两行说明（不举例，免得被模型当规矩），然后请求在编辑器打开。
  - 这一轮读了：`AgentStep` 加可选 `sources` / `lookup`；`stepsFromAgentResult` 改为逐条调用 `stepFromToolTraceEvent`，流式与收尾两条路同一份映射。抽取在新文件 `chat-window/context-panel.ts`：只认完成的调用；fs.read 先取 output_summary.path 再取 input_summary.path；project.knowledge 只认 action=read；file.review / file.revise / chapter.polish / prose.continue / project.trim_prose 加目标文件，补丁类工具加 `context_provenance.context_files`，chapter.brief 认摊开的 `context_files`；file.create 的目标不算读过。fs.search / fs.list 记检索词 / 子目录，面板显示「搜过『…』」「看过目录」，不可点。`runContextReads` 跨步骤去重、转项目相对路径，项目外路径照列但不给打开。
  - 打开文件：`lib/assistant-events.ts` 新增 `REQUEST_OPEN_FILE_EVENT` / `emitOpenFileRequest`；`useProjectCommands.ts` 监听，先核对在项目内，再 `onShowEditor()`，已是当前文件就不重开，否则 `openFile`。
  - `tests/project-breakdown-lifecycle.test.tsx` 整体 mock 了 `assistant-events`，补上新常量（CRLF，按字节加 1 行）。
- 验证：
  - `npx tsc --noEmit -p tsconfig.json`（前端）、`npx tsc --noEmit`（引擎）通过。
  - 引擎新增 `src/kernel/authorVoice.test.ts` 3 例（短文本全带、超长只剩尾部且不含标记、作者自己写了像标记的行不误判），连同 `style.test.ts` golden 回放 137 passed。
  - 前端新增 `tests/context-panel.test.ts` 6 例（抽取规则、流式与收尾映射一致、去重与项目内外路径）、`tests/author-instructions-engine.test.ts` 4 例（memoryProject 经 mock 的原生读口：不存在 / 空文件与读口报错算「在但没带上」/ 字数与预览 / 超长截断）、`tests/context-panel-view.test.tsx` 10 例（真 `ChatWindow` 里展开收起与位置、文件可点发打开请求、搜索与目录不可点、空状态、新建先建目录再写且已存在不覆盖、打开编辑、超长提示、unused 不给新建、写盘广播只对这份文件重读、`useProjectCommands` 只开项目内文件并先放出编辑器）。
  - 变异（脚本带 `count==1` 断言，finally 里无条件写回原字节并核对逐字相同）：去掉映射里的 `sources` → 3 例红；去掉打开请求的项目内核对 → 1 例红；`ChatWindowView` 不挂面板 → 1 例红；三次都已还原，`git diff --numstat` 与变异前一致。
  - `pnpm verify` 第一次 EXIT=1：`project-breakdown-lifecycle` 整体 mock 缺新常量，22 例红；补上后重跑 EXIT=0：project-core 14 passed，引擎 94 files / 13821 passed + 2 skipped，前端 244 files / 2451 passed，行间续写 / 浏览器冒烟 / Agent 对话三个浏览器回归通过。
  - CRLF 文件（`panels.tsx`、`ChatWindowView.tsx`、`project-breakdown-lifecycle.test.tsx`）按字节定点改；`git diff --numstat` 与 `--ignore-all-space --numstat` 两组一致。
- 未覆盖：
  - 没在真宿主上看：图标位置与展开后 40% 高度、浅色暖色主题观感、点文件后编辑器真打开 `.storyforge/agent-instructions.md`、「新建」经真 Rust `create_dir` / `write_file` 落盘、在编辑器里保存后面板字数刷新。浏览器回归不点这个面板，单测里读口是 memoryProject、写口是 spy。
  - 「这一轮读了」只看当前这一轮的工具调用；换会话或重启后能不能从历史恢复，取决于那一轮的 agentRun 是否还在，未专门验。
  - 外部编辑器改了规矩文件不会发写盘广播，要收起再展开才重读。
