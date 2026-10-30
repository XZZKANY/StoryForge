# StoryForge 待办清单

更新时间：2026-10-30

## 2026-10-30 当前入口：`/技能名` 已做，下一步插件（作者 10-30 拍板）

作者 10-30 拍板，顺序改成 **`/技能名` → 插件 → `/写 1-10`**：

1. **`/技能名`（本分支 `feat/slash-skills`）**：输入框开头打 `/`（中文输入法的「、」和全角「／」也认）弹出这本书 `技能/` 里的技能，打字筛选、↑↓ 选、Enter / Tab 填入、Esc 关。引擎认消息开头连着的点名（最多 3 个），这一轮把全文作为一段系统消息（`invoked_skills`）放在作者消息前；没点名时消息与来源指纹逐字不变。点名的技能文件进续跑核对的来源指纹。解析在 `packages/project-core` 一处，界面据此在上下文面板标「这一轮点名」。帧契约、数据形状不动。
2. **插件（下一步，动手前把分刀方案再给作者过一遍）**：作者定了——**本机统一一个插件库**（`%APPDATA%\com.storyforge.ide\plugins\`），**按作品启用**（启用记录写作品 `.storyforge/plugins.json`，换机器没装的显示「本机没装」），插件**能带技能、`写法/` 模板和 agent-instructions 片段**，**能导入别人做的插件**。
   - 技能进对话目录，模型用新加的只读工具 `skill.read`（只收技能名、不收路径，要改 golden）读全文；`/插件技能` 走同一套点名。
   - 写法与作品自己的 `写法/` 合进同一目录（共用上限），进章纲来源签名；指令片段放在作者 `agent-instructions.md` 前面，措辞注明「插件的要求，与作者本人冲突以作者为准」，单独限字数。重名时作品优先。
   - 导入：只收 `.md` / `.json` / `.txt` 与图标，程序文件全部跳过并列出；限总大小与文件数；zip 要加 Rust `zip` 依赖并防路径穿越；装前逐份预览全文，重导同名显示差异；Codex 插件格式只取技能部分。插件不能放宽写回红线、权限档位、项目边界。
   - 分刀：宿主插件库与导入 → 引擎技能 + `skill.read` → 引擎写法与指令 → 插件面板 → 内置「起书基础包」（立项流程 / 审稿口径；「本书禁用词」仍是新建模板）。
3. **`/写 1-10`**：照下面「10-29 当前入口」第二部分第 2 条，插件之后做。

## 2026-10-29 夜 当前入口：0.2.3 已出并公开发布，作者装上试用；之后做「/ 指令 + /写 批量写章」

10-30 作者要求公开发布：GitHub Release [StoryForge 0.2.3](https://github.com/XZZKANY/StoryForge/releases/tag/v0.2.3)（tag `v0.2.3` 在 `7aa6a6c8`，附 `StoryForge-IDE_0.2.3_x64-setup.exe`，GitHub 记录的 SHA256 与下面一致），发布说明原文在 `output/release-0.2.3/release-notes.md`，作者过目后由作者执行发布。

0.2.3 安装包 31,282,569 字节，SHA256 `ad5fe0b034237f09c9189175b67d01d230c1a7a879e4e6bfff1a9432fa5a93ce`，另存在 `output/release-0.2.3/`；装前备份在 `output/release-0.2.3/备份/`。出包记录 `.codex/verification/2026-10-29-release-0.2.3.md`。比下面「10-29 晚」多带了 #514 #515 #520（#519：接受过的章不再被当成没写盘）。真机要多看的点照下面第 1 条，再加：接受一章后说「继续」，AI 不应再要求重做上一章。给 Egg 的 #519 / #505 / #492 回复作者已批原文，待发（自动模式拦了 `gh issue comment`）。

## 2026-10-29 晚 当前入口：出 0.2.3（含 skills 一期），然后做「/ 指令 + /写 批量写章」

下面「10-29 当前入口」第一部分的前三条和第二部分的 skills 一期已经做完、合进 master，都还没打包：

- #510 输入框灰字「提示下一句」（规则在 `lib/composer-hint.ts`；「接着写第 N+1 章」只在接受最新一章时出）。
- #511 对话里切模型 + 思考等级：Anthropic 原生改官方现行写法 `thinking:{type:"adaptive"}` + `output_config.effort`（4.6 以前的老模型仍用 `budget_tokens`），Gemini 3 起用 `thinkingLevel`、2.x 用 `thinkingBudget`，OpenAI 兼容 `reasoning_effort` 不变；等级按项目存 localStorage；压缩与语义评审不思考。
- #513 #504 参考上下文：补入取章尾、「超出席位 / 读取失败」分开显示、界面上限与引擎同为 8（常量在 `packages/project-core`）。
- #516 #505 失败归类：`llm/failureMessage.ts` 一处归类，Ctrl+K / 续写 / 修订不再透出响应体。
- #517 skills 一期：作品里 `技能/`，对话每轮带技能目录、用得上再 `fs_read` 全文；上下文面板「技能」块，三个模板（立项流程 / 审稿口径 / 本书禁用词）。作者 10-29 批准方案，「工具持久化」= 技能存进作品文件夹。
- #512 ESLint 忽略 `.claude/`（桌面版把任务卡片的 worktree 建在仓库里，原来会挡 lint）。

1. **出 0.2.3**：照下面「10-29 当前入口」第 4 条与 `docs/operations/release-checklist.md`。真机要多看的：两个新下拉（模型 / 思考）与切换后下一次调用是否生效；中转对思考参数认不认（不认应报 400 的中文说明，调回「关」）；灰字与 Tab；参考面板徽标；技能块与新建模板；失败提示的中文说法。
2. **另开会话在做、等作者审合的**：#514（Anthropic 关思考时只给 4.6 及以前的模型发 temperature）、#515（页面卸载后接受补丁顺带的事实记账不再发通知；做 #504 时整套前端测试暴露出来的时序竞态）。
3. **留下的尾巴（没排期）**：`kernel/crossChapter.ts` 仍把原始 LlmError 文本（含响应体）拼进结果；对话循环里非 provider 的失败（`model_output_truncated`、`tool_call_after_withdrawal`）仍是英文；多视角审稿、跨章一致性、事实补录、拆书也跟着作者选的思考等级走（作者只点名了对话与起草 / 修订，要不要改成不思考待作者定）。
4. **0.2.3 之后**：`/` 指令（含 `/技能名` 强制带全文）与 `/写 1-10` 批量写章，按下面第二部分，动手前先给作者看方案。

## 2026-10-29 当前入口：出 0.2.3，然后做「/ 指令 + skills」

10-28 至 10-29 已处理完作者 0.2.1 试用的 24 条问题与外部贡献（详见下一节「10-28 晚」与各 PR 的验证记录 `.codex/verification/`）。作者已装 0.2.2 在用。master 受分支保护（合并要 1 人批准）：作者授权「门禁 EXIT=0 后用 `gh pr merge --admin` 合」；验证记录每个分支一份（`CONTRIBUTING.md` §4）；GitHub 上的评论 / 关闭 / 合并外部 PR 都要先给作者看原文、作者同意才做。

### 一、进 0.2.3 的（按顺序）

1. **#22 输入框灰字「提示下一句」**（作者 10-29 批准规则，确定性、不调模型）：输入框为空时显示灰字，按 Tab 填入、可再改，直接打字就消失；AI 运行中不提示。
   - 新会话、书是空的 →「先聊聊这本书想写什么」
   - 新会话、已写到第 N−1 章 →「先聊聊第 N 章怎么写」
   - AI 上一句以问句结尾 →「按你的建议来」
   - 刚接受一份设定、还缺主角人物 / 总纲 →「接着建主角人物」/「接着写总纲」
   - 立项齐了、正文没开 →「开写第一章」
   - 刚接受一章正文 →「接着写第 N+1 章」
   - 复用 `lib/chapter-handoff.ts` 的确定性判断与立项检查（#462）的缺项判断；以后由 skills 接管「下一步」。
2. **对话里切模型 + 思考等级**（作者 10-29 拍板）：输入框底部、权限下拉旁加两个下拉。
   - 模型：列出设置里存的几套配置（#497 的 profiles），选了就是**全局切换**当前那套（同设置里点配置卡，宿主命令 `activate_llm_profile`）。
   - 思考等级：关 / 低 / 中 / 高，**对话和起草 / 修订都管**。**按各家官方 API 标准参数做**（作者原话「按照标准做呀 官方 / 中转」）：OpenAI 兼容用 `reasoning_effort`（low/medium/high，关=不传）；Anthropic 原生用官方思考参数按等级给预算；Gemini 用官方思考配置；中转按它模仿的协议走同一套，不做中转专项探测。中转不认时靠 #480 的 HTTP 400 分类报错，作者调回「关」。实现以引擎现有 `llm/openaiCompatible.ts`、`anthropic.ts`、`gemini.ts`、`payload.ts` 与 `ChatRequest.reasoningEffort` 为准。等级存本机（照权限档位按项目存 localStorage 的做法），不写进 `.storyforge/`。
3. **#504 / #505（Egg-33 的 issue，作者 10-29 拍板，两个 issue 下都已留言）**：
   - **#504 参考上下文「已截断」**：我们做 bug 修复——`lib/project/context-files.ts` 补入的文件也走 `excerptForContext`（正文取结尾）、跳过空内容、`missing` 只留补读也失败的；`display-utils.ts` 把「已截断」拆成「超出席位 N / 读取失败 N」，分类计数标明「项目里」；`panels.tsx` 的「本轮实际引用」标题改实。另做**界面 12 份与引擎工具路径 8 份对齐**（`packages/engine` 的 `contextValues.ts` `MAX_CONTEXT_FILES=8`，`llmContext.ts`、`agentRuntime.ts` 只取前 8 份）：面板标出没送到模型的几份，或统一上限。新字段只留前端，不进 `codecs.ts`（files 是严格白名单，加字段 Ctrl+K 会被拒）。「仅摘录」不算警告，免得徽标常亮。「下次优先参考」按钮和详情组件请 Egg 基于最新 master 单独开 PR，作者看过再合。测试：新建 `tests/context-files.test.ts`；`chat-ux-polish.test.tsx`、`conversation-starters.test.tsx` 的徽标断言跟着改。
   - **#505 模型调用失败只给通用提示**：引擎 `providerFailureMessage`（`loop/chatLoop.ts`）补归类：流式建连被重置 / 超时或失败（`llm/transport.ts`）、Anthropic / Gemini 的「流式建连失败」（`llm/providerTransport.ts`）、响应读取或解析失败、返回为空、事件不是合法 JSON；`ProviderError` 走 `provider_*` 时按分类给中文，替代英文「Provider rate limited.」（要动 golden）。**Ctrl+K / 续写**（`assistant/service.ts`）、**显式修订起草**（`loop/tools/patchHandlers.ts`）、**单轮回退**（`agentRuntime.ts`）不再原样透出服务端响应体，统一用同一套归类。已请 Egg 补版本、协议与 `error_message`。
4. **出 0.2.3**：按 `docs/operations/release-checklist.md`。要先请作者关掉 StoryForge 再跑发行版冒烟、`verify:nsis-install`、真宿主探针（`--llm-only` / `--agent-only` / `--assistant-only`）。注意：`.tauri-target-install-smoke/release/bundle/nsis/` 里若残留旧版隔离测试包，安装验证会报「found 2」，挪走即可。装前提醒作者备份 `%APPDATA%\com.storyforge.ide\llm-provider.json` 与引擎库。0.2.3 只给作者自用，公开发布另问。

### 二、0.2.3 之后：「/ 指令 + skills」（作者拍板 0.2.3 之后一起做，动手前先给作者看方案）

1. **skills 装配**：作品里放 skills（每个是一份带说明的 Markdown，如「立项流程」「审稿口径」「本书禁用词」），对话 AI 每轮看说明、用得上再读全文；上下文面板（#496）列出「这一轮用了哪些 skill」。雏形是 #463 的 `写法/` 文件夹。作者的第一个 #8「世界观写完不知道下一步干什么」交给一份「立项流程」skill 约束，不写死在界面里。
2. **批量写章 `/写 1-10`（也认 `/goal`）**：输入框打 `/` 出指令列表。
   - 引擎按章节范围逐章走现有写章流程（章纲 → 起草 → 检查），复用 U-02 的字数钉住、章名统一、#503 截断防护；进度写 `.storyforge/serial-plan.json`，可停可续。
   - **写完就落盘、每章留写前快照可撤销，最后统一审**（出清单：每章字数、检查提示）。
   - **开跑前给预估 token，作者确认后才跑；硬上限 = 预估 × 1.5，超了就停**；检查不过 / 疑似截断 / 断网重试仍失败就停在那一章等作者。不偷加每章模型调用（作者「5 不行」）。
   - 开题时重看「作者辅助 IDE、不是自动长篇生产器」的定位与 BookRun 退役（10-09）的教训。
3. **记下、以后再说**：MCP（要在宿主里起外部进程、管权限与出网，守住「key 只在 Rust 里」）；爱好账的每周时间与金额上限待作者定；#492 的多章批量修订（作者没要）。

### 三、GitHub 现状（10-29）

- 已合：#495 Windows CI（`Windows / pnpm verify`，没设成必过）、#498 删没用的 Tauri 插件。
- #499 已关闭：只收了「报错带系统原因」，由我们在 #507 重做；`STORYFORGE_CONFIG_DIR` 没收，已留言说明。
- #477 开着：#507 已让报错带系统码、读配置写回失败降级；已请 Egg 在出问题的机器上做 `Move-Item` / `cipher /c` / `fltmc` 对照，等回复。
- #492：字数提示已做（#508），多章批量修订不做。可在他回复后关。
- #504、#505：见上文第一部分第 3 条，等 Egg 回复 / 开 PR。

### 四、已知没在真机点穿的（0.2.2 / 0.2.3 共同）

模型配置卡迁移与切换（#497）、修订对比字级深浅与逐处接受挂在改动下方（#487/#488/#494）、上下文面板（#496）、截断警告与就地两步确认（#503）、整份接受重新定位（#506）、配置写盘报错带系统码（#507）、修订字数提示（#508）、全角空格不再加黄框（#502）。作者用的时候遇到问题，照 `reports/storyforge-audit-20261024/measurement/E1/读点-39-40/问题.md` 的做法截图记下。


## 2026-10-28 晚 当前入口：21 条试用问题处理完，出 0.2.2（自用）

0.2.2 安装包已出（32.9 MB（32,864,832 字节），SHA256 `73358f3d3cf3def97a8b2f25e7e974b46c4d4df0f9f848f6c0a533e92948ba6a`，另存在 `output/release-0.2.2/`），只给作者自用，没有公开发布。

1. **作者装上 0.2.2 后要在真宿主上看的**（门禁与单测都过了，但以下几处没在真宿主上点穿）：
   - 第一次打开时，旧模型配置是否变成「默认」配置卡并打勾；点卡片切换后，对话、Ctrl+K、整章润色的下一次调用是否就用新模型；用真 Key 点「获取模型」能否拉到列表（#497）。
   - 修订对比：改动的字是否深色、整行底色是否够淡（#487）；横幅一行、说明折起（#488）；「接受这处」是否正好在改动下方、点得动（#494）。
   - 对话框点「接受」后显示「正在写进稿子」（#483）；选择框第三项直接打字（#493）；上下文面板「长期规矩」新建与「这一轮读了」点开（#496）。
   - 历史到 96 KB 时，压缩发生在下一轮开头，回答写完不再挂着「模型请求」（#486）。
2. **下一步：skills 装配**（作者 10-28 拍板「打完 0.2.2 再做」）：作品里放 skills，对话 AI 按说明取用；第一个 #8「世界观写完下一步干什么」交给一份「立项流程」skill 约束，不写死在界面里。做之前先给作者看方案。
3. **记下、以后再说**：MCP（要在宿主里起外部进程、管权限与出网，等 skills 用顺、真有「让 AI 查外面」的需要再开题）；爱好账的每周时间与金额上限待作者定。

## 2026-10-28 入口：冻结解除，分批修 21 条试用问题（已完成）

测量期 10-28 按作者的决定结案，结论与问题清单见 `docs/internal/measurement-window-2026-10.md` §9。

1. **批一：会出错、挡路的**——拒掉新文件补丁后的残留引用；接受时文件还在打开；失败轮切会话后消失；测试连接与失败原因；回复结束后请求还在跑、补丁晚出；改写大文件流式中断。
2. **批二：观感**——运行状态条、AI 修订横幅（挡字、配色、「接受第 N 处」）、写入提示位置、流程区滚动、修订对比样式、紫色上下框线、输入框高亮。
3. **批三：新功能**——选择框「我来说」与渐进选择、模型服务设置、复制自己发的消息、召回 Agent 对话、agent-instructions 界面、世界观搭完后的下一步引导。设计类的先拿 v1 截图和作者对过再做。
4. **打包**：修完出 0.2.2；公开发布要作者点头。

处理结果：批一 #480 #482 #483 #484（#5 早在 e9e55ebb 修了，#481 修了挡门禁的冷启动超时），#2/#6 #486，#12 #487，#3/#11 #488 #494，#13/#18/#19 #489，#4 #493，#21 #496，#16 #497 #500；#1 #10 #7 与第二个 #8 在 0.2.1 之后的 #451 #452 已修；#17 是正常的焦点提示，没改；第一个 #8 改由 skills 解决（见上一节）。

## 2026-10-25 入口：测量期（10-28 已结案）

规则、解冻编号账、实验登记与判定表见 `docs/internal/measurement-window-2026-10.md`。窗口内每次合并都要作者发出的解冻编号；发现的缺陷只记不修，作者提的新功能记进需求日志。

1. **E0 回放（已跑完）**：第一次没过线；U-02（#474）修了一轮后，在作者模型上重跑，练手书设计点仍不过线（第 1–3 章 10、8、8，要求 ≥13）。按 §5.1 不打包 0.2.2，记为「局部接线在现有结构里修不动」；下一步由作者定。详情见登记文件 §5.1 的「E0 重跑」。
2. **E0 第 1 章的作者答案**：「是不是我们聊的」「想不想往下读（1–5）」两项还没记下。
3. **E1 擂台二（公平版）**：作者模型三臂各两次都写到第 40 章，程序指标已定；读点二（第 39–40 章）作者已打分（W 4、4，现行管线 3、4，精简管线 4、3），盲读部分记「不确定」；最终判定在决策日按 §6 做。**E2 真实写作窗口**照常。
4. **决策日 11-21**：按判定表选路。

## 2026-10-20 入口：出 0.2.1（已完成，10-20 公开发布）

0.2.0 已于 10-17 交付（见 `docs/internal/current-phase.md` 的 10-20 补记）。#379 起合并的修复都还没打包，作者机上仍是 0.2.0。

1. **出 0.2.1**：按 `docs/operations/release-checklist.md` 改版本号（`tauri.conf.json` + `Cargo.toml`）、`pnpm verify` + Rust 测试、`pnpm desktop:build`、安装包另存 `output/release-0.2.1/`；出包前跑一遍真宿主探针（要作者先关掉 StoryForge）。
2. **装上之后**：作者在 0.2.1 上真实写作，第一次真实使用的差异优先修；小说环节的候选（定稿、接受时看事实、规矩进起草）等作者提名。
3. **全项目查缺补漏已收尾**：外部复查五轮读完了生产代码（界面、引擎、Rust、脚本、文档），报出的问题除 F-01（判为理论风险）外都已修（#419 起）。测试代码只读了约 15%，不再专门追。
4. **可以另开的小清理**（不急）：同下面 10-16 入口第 4 条。

## 2026-10-16 入口：出 0.2.0（已完成，10-17 交付）

后端迁移已做完：业务逻辑全部在 `packages/engine`，宿主不起后端，仓库里不再有 Python（#366–#373，删除前最后一版 `5e6f8e58`）。作者拍板不出中间包、不等现场影子数据，一路做到删 Python 再出 0.2.0；装上后出问题没有 Python 可切回，只能修。

1. **出包前补足真机证据（替代原计划里「切默认后真实用一周」）**：真宿主探针 `--agent-only` / `--assistant-only` / `--context-only` / `--reader-only` / `--llm-only`（要作者先关掉 StoryForge，探针拒绝与已有应用并行）、`verify:nsis-install` 隔离安装、发行版 Tauri 冒烟；用作者库的只读副本走一遍旧库导入。
2. **出 0.2.0**：按 `docs/operations/release-checklist.md` 改版本号（`tauri.conf.json` + `Cargo.toml`）、`pnpm verify` + Rust 测试、`pnpm desktop:build`、安装包另存 `output/release-0.2.0/`；提醒作者装前备份 `%LOCALAPPDATA%\com.storyforge.ide\` 下的 `.sqlite3`，首次打开会一次性导入旧库。
3. **装上之后**：第一次真实使用的差异优先修；小说环节的候选（定稿、接受时看事实、规矩进起草）等作者提名。
4. **可以另开的小清理**（不急）：帧契约 schema 里还留着外部写回的等待帧；`.gitignore` 为 pytest 事实源保留跟踪的几个 `.codex` 文件已失去用途；本地 `apps/api/` 下未跟踪的 `.venv` 等残留可手动删。

下面 10-11 以前的段落是迁移前后各轮会话的入口记录，涉及 Python / sidecar / pytest 的命令都已失效，只作历史参考。

## 2026-10-11 至 10-16：后端换 TS（已完成）

完整计划与逐刀进度见 `docs/architecture/ts-engine-migration-plan.md`。P0–P4 逐模块搬进引擎，P5 切默认，P6 拆除 Python（见上面的当前入口）；首刀 #280（总览「接着写」+ 新会话伙伴开场）是纯前端，迁移后原样保留。

## 2026-10-06 下一步入口

Windows 0.1.10 私测候选所需工程/安装主链与单份作者保留反馈已回收，当前闭环/限制以 `docs/internal/current-phase.md` 最新补记为准。第7项源码尚未提交，先核对本次本地提交范围；不继承旧检查点push豁免、不自动上传安装包。未知价格停止真实模型扩批；更多独立作品/作者、完整断电/权限/多窗口与跨版本schema另行验收，不能把“还过得去”推广为整体质量放行。

## 当前执行入口

当前状态以 `docs/internal/current-phase.md` 为准；TODO 只保留下一步执行入口。项目总览见 `docs/internal/PROJECT_SUMMARY.md`，旧执行清单见 [待办历史](../archive/internal-history-2026-09/TODO-history-2026-07-26.md)。

## 下一步优先级

1. **R1–R8 可靠性切片已完成本地集成，先审阅再决定提交。** 当前完整门禁、E2E、API/Desktop 重建、packaged、两条 browser 与两次全新隔离 native GUI 均通过，未提交/发布。后续改动按 [反馈地图](../architecture/authoring-feedback.md) 选最小回归，再过总门禁。文风语料枚举的链接 containment/遍历预算仍是独立安全切片，不混为本轮已解决。
2. **回到真实写作验证。** 接续 n=1 连载前确认仓库外资产现状；记录固定任务的完成时间、改稿保留率、返工和人工偏好。7 月章节数与 S3 手稿保险计划任务状态本轮未复核，不作为今天事实。
3. **按版本执行发布验收。** 指定拟发布构建，运行对应门禁并复验 GUI 保存、diff 确认和权限档位；冻结 sidecar 冒烟不能替代真机 GUI 验收。Windows 原生符号链接可在具备权限的环境补跑，不把 Linux 通过描述成 Windows 原生通过。

## 已实现与待核实

- 2026-09-28 可靠性 R1–R8 已完成当前本地实现与规定的集成验收；原范围、源码/产物绑定和未验收边界见 current-phase 与 verification-report，不等同发版或文学质量验收。
- 2026-09-27 持续演进切片已实施：修订能力/会话分离、固定上下文选择、ToolSpec 策略派生、结算状态/证据原子性、安全 provider 诊断、分阶段性能反馈、第二条润色真实路径矩阵及单项有界读取。已完成本地集成验收，未提交；详细证据以 current-phase 为准，不重复建设 SDK。
- 下列 `fd7a7fa6`、Linux/冻结搜索与旧门禁修复为 2026-09-05 历史成果，不将其数字冒充本轮。

- 文件工具边界与资源限制已提交为 `fd7a7fa6`；Linux 补验 56 passed / 1 skipped，普通符号链接三项及 Project Knowledge 越界链接均通过；Windows junction 与冻结 exe 实际搜索已有通过证据。
- 已修复 intent 测试遗漏 `chapter.polish`、Windows PowerShell 中文脚本解析和拆书报告 effect lint；报告加载已覆盖项目切换与旧响应回流的行为回归。
- 全文搜索、项目/页签/光标恢复已接入 Desktop，不再作为缺失能力提名。
- `chapter.write`、`chapter.polish`、结构化拆书已有代码；不代表质量或用户收益已验收。
- 旧清单的 canon/hook 提案并入、观测已处理状态持久化、改稿锚点稳定性、原生菜单，必须核对当前实现再决定是否立项，不能照抄 7 月结论。
- BookRun 的 Agent 启动工具已退役，后台兼容不是重建桌面自动整书入口的待办。
- 重跑真实 3-5 万字长程不在本轮自动排期，需要独立样本、成本和人工评审方案。

## 本地验证入口

```powershell
cd D:/StoryForge
pnpm.cmd verify                                   # 8 道门
npm --prefix apps/desktop run test:rust
npm --prefix apps/desktop run verify:tauri-smoke
cd apps/desktop/frontend
node scripts/verify-engine-p0-native.mjs --agent-only   # 真宿主探针，先关掉 StoryForge
```

真实 LLM 使用独立授权的本地配置和明确预算，不把密钥或私有小说正文写入报告。


## 2026-10-01 下一入口补充：先完成P1/P2联合验收

idle正常退出/重开、owned dev API丢失后的deadline/持久警告已由真机Tauri/WebView执行；不要再把“缺GUI工具”或这些idle项列为尚未执行。继续进行中单文件写回/明确手动恢复GUI、各交付边界kill/断电及packaged矩阵，并处理已有总门禁阻断。真机写回实验须有独立测试能力来源，不得用环境变量绕过生产release常量。P1/P2完成联合最终验收前，不进入P3多文件/发布，不自动开放功能；当前状态和证据以current-phase最新补充及活动任务research/gui为准。

## 2026-10-02 P2下一入口更新

- [x] debug fixture audit在途正常关闭 / 已写冷恢复继续（零第二写）；空SQLite waiting退出→新API冷发现→明确资格→独立批准→同run完成，最终GUI自动结算。
- [x] Native off-event-loop admission、旧审批隔离、续跑ACK间隙GET轮询及历史delivery防误判；相关回归/契约字节核对。最后历史delivery保护尚未再次GUI。
- [ ] 按用户“全权操控、之后验收”继续P2：自主原生目录选择、最后保护的新构建GUI、各交付强杀/断电及packaged/installed分档；不使用旧hash截图代新构建。
- [ ] 真实provider/权限矩阵与总门禁另行补齐；当前pnpm NO_TTY、root ESLint两个无关bootstrap红项、旧Rustfmt/缺long runner不隐藏。保持P1/P2活动、生产gate关闭，不进P3、不commit/push/archive、不付费。


## 2026-10-02 自主强杀与安装子集后的下一入口

- [x] 最新保护新构建的全自主GUI（无需再请用户选目录）；waiting实际强杀/冷资格/独立批准/同run完成。
- [x] Windows Job OS寿命托管，真实子孙继承与自动清理；body已写/audit在途强杀→仅补audit→独立资格/继续，零第二write/version。
- [x] 当前源码frozen/release/隔离NSIS资源/安装/运行/卸载子集；release启动真实PyInstaller双进程强杀自动清空。不是生产external GUI全验收。
- [x] 定向Native/API/combined/Frontend回归、契约hash、原dirty保护和报告/spec同步；owned服务与专用安装身份收尾。
- [ ] 继续P2剩余：其他交付kill边界/断电、生产external GUI、全权限/多窗口、真实provider（需独立授权预算），以及pnpm NO_TTY、旧whole Rustfmt/缺long runner总门禁。不要再次列已通过waiting/audit强杀或安装烟测为没执行。
- [ ] 联合最终验收前仍保持P1/P2活动与两生产gate关闭，不进入P3，不commit/push/archive或付费。当前证据以gui-job/summary.json与verification-report最新追加为准；不能声称全部改造/发布验收完成。


## 2026-10-02 下一入口追加：GUI结算/冷结果投影两个真实红项

本轮完整逐格矩阵入口：`D:/StoryForge/.trellis/tasks/10-01-agent-host-lifecycle/research/gui-matrix/matrix.md`，机器证据`summary.json`及只读`verify-evidence.py`、复现`reproduction.md`。P1/P2未完成、不进入P3、两处生产release gate仍False/false，不提交/push/archive/付费。

- 新debug-only boundary probe复用原pipeline，不另写手稿/receipt/audit。五个干净SQLite/真实GUI输入实验分别命中snapshot、branch、syncedintent、syncedbody/outcome前、audit完成/ACK前并真实强杀。新APIgeneration冷恢复：snapshot/branch明确资格再独立重批，同run完成（保留原快照+新快照版本2、正文一次）；intent/body未知outcome安全拒绝，DB/所有文件/provider不变；audit_done验证原receipt/audit最多一次反馈，仅独立continue，正文/版本/audit各1、durablehash不变。原run/wait/op/messagesprefix/write_budget1/累计时间/MinGit原56B CRLF已核验。五次kill与五次normalclose captured树/端口自动全空，无harness代清子孙。
- 普通release独立应用标识、embeddedfrontend/frozenAPI/bundledMinGit、正常Native DPAPI/BYOK→生产provideradapter→127.0.0.1 OpenAI-compatible HTTP/SSE合成服务器，零云调用：GUI提案/独立确认/真实单写版本history/正常close/reopen通过文件子集；first wire3、cold0、版本/intent/outcome/audit各1，close983/843ms。生产external真实HTTP409且DBcounts零变化，**不是external生产正例**。
- **新产品红项，尚未修复**：普通legacy文件虽写成功，实际API run仍paused / permission.confirm；coldexternal同run已completed但活动聊天为空，没有结果投影。不能把panel消失/模型总结/单文件成功当完整生产闭环通过。下一优先修复两处结算与投影，再做GUI复验。
- 本轮定向绿：API115、SDK/reader/事务/source99、最终17业务+4CORS联合21（新增full/normal）、actualNativebridge1；Native默认100/4ignored、fixture104/4ignored；Frontendtypecheck与156files/1285passed/1skip；Ruff/直接ESLint/Prettier/定向Rustfmt2021/gitdiffcheck。普通release构建绿，4公共契约相对entry字节不变；无新route/DTO，未将其冒称又跑pnpmopenapi绿。
- 总门禁仍红：pnpmverify/lint NO_TTY；cargo fmt全量既有差异；旧全API缺longrunner的15失败未被本轮定向覆盖洗绿。四权限GUI、多窗口/真实reload/跨项目session、真实云provider/质量/断电与productionexternalpositive仍待验。此前gui-job安装/启动强杀仅其分档，不拿旧构建充本轮GUI。
- 原始失败保留：branch-proof未命中且DB author_rejected；branch-clean因harness错分支path并错误继续，明确无效，独立branch-final新root才计通过。audit首次文件分类错断言后在同一真实停驻内正确强杀，无放行/造账。普通release诊断原rawnull来自harness误读Local，另存Roaming本次close_confirmed，不覆盖原raw。全记录见matrix末节。
- cleanup.json自有GUI/API/WebView/provider/Vite全部已收尾，临时数据/证据保留不删除。工作树保护：入口160中nonowned151精确不变，6本轮源码owned与根3appendonly；原29前缀/10rename、HEAD、Cargo.lock与4公共契约不变，最终核验见preservation-final.json。finish-work因本任务未提交与验收红bailout，仅journal --no-commit。


## 2026-10-02 最新续做入口：对话/决策边界已纠偏

- [x] 右侧 Agent 原会话状态+消息；选择/决定弹窗，稍后/Escape无authority、scope/hide/focus/章纲草稿行为回归。
- [x] cold external完成后活动chat原user+持久assistant真实GUI可见；warm 新session空DB history不抹作者消息；唯一chat/一次write/version/audit、原budget保持，新embedded资产验收。
- [ ] 下一窄切片仍是普通生产legacy写完API原run paused permission.confirm的结算红，不扩大到新架构或恢复退役入口。
- [ ] 四权限GUI/多窗口/真实reload、真实provider/断电、productionexternal正例、完整总门禁；pnpmverify/lint NO_TTY未绕过。gate保持关闭，不提交/归档/P3。

最新证据research/gui-chat；原gui-matrix所有历史原件保持，不覆盖validator/summary。
