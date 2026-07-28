# 验证报告 · 日更摩擦两刀（空文件死锁 / 文件树落点）

时间：2026-07-27

> **提名口径说明**：本刀是**真实写作摩擦提名**——作者当日日更时踩到两件事：①「新建文件没有
> 在对应文件夹下，需要在文件夹右侧加添加文件夹/文件，不能全看右键」；②「agent 有问题，
> 你读写第三章这个 agent 对话」。符合宪法 §08 由真实写作需求提名的口径，不是主动打磨波。

## 诊断（装机版真机证据，非推测）

作者跑的是 NSIS 装机版（`deepseek-v4-flash`）。从 `%LOCALAPPDATA%\com.storyforge.ide\storyforge.sqlite3`
取到 `assistant_sessions` id=14「写第三章」（run 50）的完整证据链：

| seq | 工具 | 结果 |
| --- | --- | --- |
| 3 | `fs.list .` | completed（3 个条目） |
| 4-5 | `fs.read` 第001/002章 | completed |
| 6 | **`file.create` 正文/第003章.md** | **failed —「文件已存在：正文/第003章.md，请改用 file_revise 修订既有文件。」** |
| 7 | `fs.read` 第003章.md | completed，`returned_chars: 0` |
| 8-10 | **`file.revise` ×3** | **全部 failed** |
| 14 | `agent_run_completed` | 正文是一坨 `<｜｜DSML｜｜tool_calls>` 原始标记 |

盘上实测：`D:\连载\末世吞噬\正文\第003章.md` = **0 字节**，创建时间正好在作者发问前 2 秒。

### 根因一：0 字节文件的双向死锁（这是主因）

作者的日更动作是「先建好空的章节文件，再让 agent 写这章」。这条最自然的路径被两条互相
指向对方的错误堵死：

- `fs_tools.resolve_new_project_file` 用裸 `Path.exists()` 判定，**0 字节文件同样算「已存在」**，
  报错文案还指引模型「改用 file_revise」；
- `_file_revise` 用 `_required_string(payload, "content")` 取正文，**空串不过 `value.strip()`**，
  抛「Agent intent 缺少参数：content」。

于是 agent 在第 5/6/7 轮反复重试，一个字也写不进去。**这不是模型不行，是工具契约有环。**

### 根因二：末轮摘工具不通知模型 → 原生工具标记漏成正文

`loop_runtime` 在末轮（第 8 轮）与工具预算耗尽时都会摘掉 `tools`，但**只有预算耗尽那条分支
追加了 system 说明**，末轮是静默摘除。模型这轮仍想调 `file_revise`，手里没有工具调用通道，
就把 DeepSeek 原生的 `<｜｜DSML｜｜tool_calls>` 标记当正文吐了出来。

后果是双重的：作者看到一坨乱码；而模型**真的写好了的第三章全文**，被困在那个从未被解析、
更未被执行的工具参数里。`loop_runtime` 对这种 content 没有任何检测，直接当最终答案交付。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `agent_runs/fs_tools.py` | `resolve_new_project_file` 新增 `_is_blank_placeholder`：空文件 / 纯空白（≤4KB）不算「已存在」，起草可落进去。非空文件仍按原样拒绝。 |
| `agent_runs/tools/runtime_arguments.py` | 新增 `required_text`：要求参数存在且是字符串，但**允许空串**。`required_string` 语义不动。 |
| `agent_runs/patches/runtime_tools.py` | `_file_revise` 的 `content` 改吃 `required_text` —— 空文件的正文本来就是空的，不该被当成缺参数。 |
| `agent_runs/loop_runtime.py` | ①摘工具的两条分支合并，**末轮也追加 system 通知**「工具已不再可用，请直接用自然语言回答」；②新增 `_annotate_unexecuted_tool_markup`，工具标记漏成正文时前置一句如实说明，原文保留供作者判断。 |
| `agent_runs/tools/specs/patch_specs.py` | `file.create` 的 LLM 面描述改为「尚不存在的新文件、**或作者预先建好的空文件**……目标文件**已有正文时**才会失败」，与新行为对齐。 |
| `tests/fixtures/loop_tool_schemas_golden.json` | 随 spec 描述重生（仅该行变化）。 |

**写回红线不变**：后端仍不写项目文件，`file.create` 落进空占位走的还是 proposed patch +
前端确认；新增测试显式断言确认前占位文件字节不变。

## 第二刀：文件树落点（文件夹行内新建按钮）

作者原话：「新建文件没有在对应文件夹下，需要在文件夹右侧加添加文件夹/文件，不能全看右键。」

### 诊断

新建入口此前是**分裂**的，且**唯一认目录的那条藏在右键里**：

| 入口 | 落点 | 实现 |
| --- | --- | --- |
| 侧栏头部 FilePlus 按钮 | **永远是项目根** | `useProjectCommands.handleNewFile` |
| 欢迎页「新建文件…」 | **永远是项目根** | 同上 |
| 文件树右键菜单 | 右键命中的目录 | `useFileTreeActions.onNewFile/onNewFolder` |

树里既没有「当前选中文件夹」这个状态，也没有任何 hover 行内动作 —— 作者要把文件建进
`正文/`，只有右键一条路，而右键是需要先知道它存在才会去点的交互。

### 改了什么

- `ResourceExplorer`：文件夹行从「整行一个 `<button>`」拆成「行容器 `div` + 展开按钮 + 行内
  动作区」（button 不能嵌套 button），右侧加 hover / focus-within 才显形的
  **「新建文件」「新建文件夹」** 两个图标按钮，直接复用右键菜单同一套 `fileActions`。
  点了自动展开该文件夹 —— 新建的东西必须看得见。
- `SidePanel` 头部：FilePlus 旁补一个 FolderPlus（根目录新建文件夹），并把 FilePlus 的
  title 改成「在项目根目录新建文件」，让「根 vs 当前文件夹」的落点在 UI 上自解释。
- `shell-icons`：新增 `FolderPlus` 导出（lucide-react 仍只在这一处 import）。

**刻意没做**：不动 `handleNewFile` 的根目录语义（头部按钮就该建在根），也不引入
「当前选中文件夹」状态——那会让落点变成隐式的、比现在更难预测。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `cd apps/api && uv run pytest` | **1109 passed / 3 skipped / 0 failed**（新增 5 条） |
| `cd apps/api && uv run ruff check .` | All checks passed |
| `npm --prefix apps/desktop/frontend run test` | **376 passed / 64 files**（新增 5 条） |
| `npm --prefix apps/desktop/frontend run typecheck` | 绿 |
| `pnpm.cmd lint` | 绿 |

**可证伪性实证**：把 `fs_tools.py` + `patches/runtime_tools.py` 两处修复 `git stash` 掉后重跑，
两条新的场景测试立刻红（`AssertionError: assert ['failed'] == ['completed']`），
证明它们钉的是真实缺陷而不是同义反复。

后端新增测试：
- `test_chat_loop_file_create_fills_author_placeholder_file` —— 复现作者现场：空占位文件存在时
  `file_create` 照样起草补丁，且确认前不写盘；
- `test_chat_loop_file_revise_accepts_empty_file` —— 空文件走 `file_revise` 出补丁而非报缺参数；
- `test_chat_loop_final_round_tells_model_tools_are_withdrawn` —— 末轮 `tools is None` 且 system
  消息含撤下通知，倒数第二轮工具仍在；
- `_annotate_unexecuted_tool_markup` 的命中 / 不命中两条纯函数测试（正常回话不加噪）。

前端新增测试（`tests/resource-explorer-new-entry.test.tsx`，真 DOM 挂载 + 点击）：
落点是所在文件夹而非项目根、两个按钮各自对应 `onNewFile` / `onNewFolder`、多个文件夹行
互不串目录、点按钮不触发折叠、无 `fileActions` 时不渲染按钮。

## 未联通 / 未验证的能力

- **真机未验，归 E2E-1**：本刀改的是 sidecar 后端，作者手上的 0.1.4 装机包里跑的仍是旧
  逻辑。要在真机看到效果，必须**重建 NSIS 装机包**（PyInstaller sidecar 重打）后再试一次
  「建空章节文件 → 写这章」。在那之前，作者的临时绕法是：**别预先建空文件**，直接让 agent
  写，或者往空文件里先敲一个字再让它改。
- **DSML 标记泄漏的兜底只覆盖「已知标记」**：`_TOOL_MARKUP_MARKERS` 是按实际观测到的
  DeepSeek DSML 加上几种常见形态列的白名单，换 provider 后若出现新形态仍会漏。根治靠的是
  末轮通知，兜底只是让失败可见。
- **`llm_client` 仍不读 `finish_reason`**：服务商侧截断与正常完成无法区分。本刀没动这条，
  它是独立缺陷，等有真实证据再说。
- **第三章正文没有被抢救**：那段被困在标记里的初稿属于作者的创作资产，本刀只修管道，
  不代作者决定要不要用它。
- **文件树按钮的真机观感未验**（26px 行高里塞两个 20px 按钮的挤压感、hover 出现的时机、
  长文件夹名截断后按钮是否还够点）：happy-dom 只能证明行为对，证明不了手感。归 E2E-1。
- **触屏 / 纯键盘路径未验**：按钮靠 hover 与 focus-within 显形，触屏设备上没有 hover。
  桌面 IDE 场景下不是当前优先级，但记一笔。

---

# 2026-07-28 按宪法 §06 八个写作时刻修 agent 三条不适配（PR #214 / #215 / #216）

诊断起点：agent 的词汇层与工具层已高度适配小说，但**工作形状层仍是「代码 agent 的骨架套
小说的皮」**，对照 §06 八个写作时刻只真正服务 04（章末检查）与 05（修订比较）。

## 第一刀（PR #214）：每轮注入作者当前视图

此前循环每轮只注入文件路径不注入内容，选区根本进不了循环——前端把整篇正文塞进
`content` / `context` / `selection` 三个同值键，后端只读 `project_path` 与 `file_path`。

- 新增 `loop/author_view.py`（纯函数、无 IO）：`AuthorView.from_payload` 走 typed 契约
  （`run_chat_loop` 体内禁裸 `.get()` 是源码标准硬门禁），行号越界夹取不抛错；选区优先，
  无选区取光标前 1500 / 后 600 字窗口并按段落边界收口；内容取自前端已发 `content` 不额外读盘。
- 作者 @ 钉的 `context_bundle` 摘录一并进循环（此前只有回落单轮对话在用）。
- 事件表摘要只落形状与量，选区 / 窗口正文不进事件表。删掉 `context` / `selection` 两个同值键。

命令与结果：`uv run pytest -q` → **1121 passed / 3 skipped**（新增 12）；
`npm run test` → **377 passed**（新增 2、修正 2 条陈旧断言）；ruff / lint / typecheck 全绿。

## 第二刀（PR #215）：prose.continue 循环工具

此前 16 个循环工具只有 3 个产字，全是「改已有」或「起草新文件」；作者说「接着写」，
模型只能拿 `file_revise` 重写整篇。

- 新增 spec `prose.continue`（`write_pending`）+ `tools/prose_continue_runtime.py` 作为第 5 张
  handler map。自动落进 `_PATCH_TOOLS`，单补丁闸零改动。
- 落点优先级 显式 `anchor_line` > 作者光标（来自第一刀）> 文件末尾，并跳过作者停笔时连敲的空行。
- 新增非流式 `draft_continuation`，与流式 `/assistant/continue` 共用同一套纯函数，只换传输。
- 插入是纯新增；后端只出 `proposed_patch`，落盘仍走作者确认。
- 顺带补 system prompt 里从未提及的 `project_promise_check` / `project_hooks_delta`。

命令与结果：`uv run pytest -q` → **1130 passed / 3 skipped**（新增 9、修正 2 条工具集枚举）；
ruff 绿；OpenAPI 无漂移；golden fixture 从 spec 重生 **+31 行 / 零删除**。

## 第三刀（PR #216）：修一句谎 + 最小并入

`hooks_delta` 的 summary 与 spec 描述都指示模型「确认后使用 `canon_store.write_hooks` 写入」，
而该工具 / IDE 命令 / 路由**均不存在**——模型每次被告知一个不存在的下一步。已改为如实说明。

新增 `lib/canon-merge.ts` + 提案卡「并入」按钮：读盘 → 追加 → 原子写回，作者点击触发，
后端红线不动。并入写后端原样全字段（mapper 追加 `raw` 透传）；同 id / 同内容不重复追加；
canon.json 缺失或损坏按空骨架起头；写盘触发重扫后该条从后端差集自然消失（自愈）。

命令与结果：`uv run pytest -q` → **1131 passed / 3 skipped**（新增 1）；
`npm run test` → **384 passed**（新增 7、修正 1 条 mapper 形状断言）；lint / typecheck / drift 全绿。

## 刻意不做（收窄记录）

第三刀原计划含整套 canon/hooks IO 层、稳定 key 派生、localStorage 忽略态、hooks 提案落盘与
并入，约三百余行。中途拍板撤掉：那是**为省作者一次手改 JSON 而堆基础设施**，不产字，
不属于「改变模型看到什么 / 能做什么」这一类。不要的提案留着不动即可；若真实连载被这一步
卡住，按宪法 §08 由写作摩擦再提名。

单补丁闸未放宽；跨会话长期记忆与摘要回灌未动（`system_jobs` 刻意不回灌是另一条决定）；
`chapter.review` / `bookrun.*` 仍不进循环（已记录的决定）。

## 未联通 / 未验证的能力

- **全部三刀的真机观感未验，归 E2E-1**：改的是 sidecar 后端与前端源码，作者手上的 0.1.5
  装机包跑的仍是旧逻辑。要在真机看到效果必须**重建 NSIS 装机包**（PyInstaller sidecar 重打）。
- **续写质量未做真实稿件对照**：`prose.continue` 只验证了管道正确（落点、纯新增、不写盘），
  没有验证「模型续出来的那一段是否像作者的手笔」。这要靠 dogfood，不是测试能证明的。
- **注入的窗口尺寸未经真实语料校准**：前 1500 / 后 600 字是估的，不是量出来的。
- **提案「并入」与编辑器脏缓冲的竞争未设闸**：作者若正在编辑器里手改 canon.json 且未保存，
  其后续保存仍会以缓冲覆盖。与既有补丁写回对已打开文件的行为一致，属已知边界。
- **`hooks_delta` 的提案仍不落盘**：修谎后模型会如实把清单报给作者，但作者要记进伏笔账
  仍需手改 `hooks.json`。这是上面「刻意不做」的直接代价。

# 2026-07-28 触达三刀：让产字路径真的拿到「作者是谁、什么算好句子」（PR #217 / #218 / …）

> **提名口径**：作者问「我怎么感觉现在的小说 ide 名不副实」。诊断结论不是功能缺失，是
> **触达缺失**——四条真正产出文字的路径（`file.revise` / `file.create` / `prose.continue` /
> chat 循环）各自带着自己的 system prompt，创作准则只进了其中一条、作者自定义指令一条都没进。
> 功能看着像生效、结构上不可能生效。本波三刀只修触达，不新增能力。

## 诊断台账（改前实测，非推测）

| 产字路径 | 创作准则 | 作者声明的文风 |
| --- | --- | --- |
| `prose.continue` / Ctrl+Shift+K | ✅ 全量 `CRAFT_GUIDELINES` | ❌ |
| `file.revise`（`service.py:202`） | ❌ | ❌ |
| `file.create`（`service.py:720`） | ❌ | ❌ |
| chat 循环（`prompt_context.py`） | ❌ | ✅ 仅此一条 |

创作准则触达 **1/4**，且是前一天刚建的那条。作者指令触达 **0/4**：它落在 chat 循环上，
而循环自己不产字——循环产字靠调上面那三条工具，每条都用自己的 system prompt 且不带指令。
`read_author_instructions` 改前只有一个调用者。

`_REVISE_SYSTEM_PROMPT` 全文是「严格按指令修订、未点名的段落逐字保留、不要扩大改动范围」——
一段标准的**最小 diff 重构提示词**。对代码是对的，对正文意味着作者最常按的那个工具被要求
保留一切没被点名的东西，却从未被告知什么是好句子。「代码 agent 骨架套小说皮」这句诊断，
最硬的证据就在这一段里。

## 第一刀（PR #217）：创作准则进四条路径

`CRAFT_GUIDELINES` 下沉 `app/common/craft.py` 作单一事实源（下沉 common 而非留 book_runs
是触达边界所迫：源码标准硬门禁禁止 `agent_runs/loop/*.py` import `domains.book_runs`）。
`craft_prompt_clause()` 出扁平子句形态供三条对话侧单段式 prompt 复用，整书管线仍用多行
section，两种形态共用同一份文本。`file.revise` 额外加界：准则只约束本次落笔改写的句子，
不构成扩大改动范围的理由——否则最小改动会退化成整篇重写、毁掉补丁可审性。

护栏 `tests/test_craft_guidelines_reach.py`（11 项）：四条 prompt 逐条含全部准则与陈词条目、
必须含 `craft_prompt_clause()` 原文（手抄改词即红）、book_runs 与 common 同一对象。
改前 8 red / 3 passed，改后 11 passed；全量 1142 passed / 3 skipped；ruff 绿。

## 第二刀（PR #218）：作者自定义指令进三条生成调用

新增 `app/common/author_voice.py`（同样的无 domains 依赖叶子；`assistant` 不得顶层 import
`agent_runs`，会成环）。`prompt_context.py` 原实现整体下沉、原处留薄转发，既有 patch 该
符号的测试与调用点零改动。

- **措辞刻意分两档**：对话路径沿用「尽量遵循」，产字路径改「逐条遵循，与通用创作准则冲突时
  以作者本人的要求为准」。生成时作者指令是硬约束（「这个人物不说某个词」必须照办），沿用
  对话档的「尽量」会让模型把作者的硬要求当可选偏好。
- **注入位置在 system prompt 末尾**：近因位置对生成影响最强，排在通用准则之后。
- `AssistantReviseRequest` / `AssistantDraftRequest` 加 `project_root`；三个循环内调用点
  （`patches/runtime_tools.py` ×2、`tools/project_canon_runtime.py` ×1）与前端 Ctrl+K
  直连路径（`useInlineChat.ts`）逐一接线。

**顺带逮到一个真 bug**：`conversation_runtime.py` 为防注入丢弃 LLM 传入的 `project_root`，
再按分支回填——而 `prose.continue` 落在「设 file_path / content」那条分支里，**从不回填**。
于是循环内续写静默丢掉 canon 硬约束与作者指令，而 Ctrl+Shift+K 直连路径反而两者都有：
同一个功能走对话进去和走快捷键进去，喂给模型的东西不一样。已改为 `setdefault` 兜底。

护栏 `tests/test_author_instructions_reach.py`（13 项）+ `test_agent_loop_prose_continue.py`
新增 1 项。可证伪性实测：`git stash` 掉 `conversation_runtime.py` 与 `service.py` 两个改动后，
新增断言转红（`test_author_instructions_reach.py:113` AssertionError）。

## 验证命令与结果（第二刀）

- `uv run pytest -q` → **1156 passed / 3 skipped**（第一刀基线 1142，+14 即本刀新增）
- `uv run ruff check .` → All checks passed
- `pnpm openapi` → 两个 schema 各 +1 字段，`api-types.ts` 同步；drift 绿
- `npm --prefix apps/desktop/frontend run typecheck` → 无错；`run test` → **384 passed / 65 files**
- 行尾：`git diff --numstat` 与 `--ignore-all-space --numstat` 逐文件一致（混合 CRLF 的两个
  文件改用字节级写入规避 Edit 归一）

## 未联通 / 未验证的能力（第二刀）

- **真机观感未验，归 E2E-1**：改的是 sidecar 后端与前端源码；作者手上 0.1.5 装机包跑旧逻辑，
  要真机看到效果必须重建 NSIS（PyInstaller sidecar 重打）。
- **注入生效 ≠ 模型照办**：测试只能证明作者指令进了 system prompt，证明不了模型逐条遵守。
  「写出来是否像作者的手笔」只能靠 dogfood。
- **`project_root` 现在是客户端传入值**：读取面被硬钉死在 `<root>/.storyforge/agent-instructions.md`
  这一个相对路径上（不接受任何外部拼接），但目录本身来自请求体。单机 sidecar 单客户端下
  可接受，多租户部署下需要改回服务端解析。
- **无缓存**：每次生成重读该文件（写盘即生效是刻意选择），高频调用下是重复 IO。

## 第三刀（PR #219）：文风指纹从本地正文复活

「事后检出漂移 → 生成前对齐」的前馈闭环**早已建成**（`judge/style_fingerprint.py` +
`prompts/context.py` 把 StyleFingerprint 映射成 StyleDirective 目标，`prompts/models.py:68`
的注释写明意图就是前馈）。问题是它锚在 `Chapter.status == "approved"` 与 `Scene.content` 上——
那是 BookRun 的 DB 实体，桌面产品从不创建。**学习闭环整个搁浅在退役的批量管线后面**，
而纯函数 `_style_fingerprint(content)` 只吃一个字符串、根本不需要 DB。

- 纯计算下沉 `app/common/style_fingerprint.py`（markers + StyleFingerprint + 切句 + 计数），
  judge 侧改吃 common 并保留别名再导出，`judge/service.py` 的 facade 一行不改。
  **不下沉就会有两份切句实现**：检查器与生成器各按各的尺子说话，正是 craft 下沉要根除的病。
- 新增 `app/common/style_baseline.py`：按 canon 同一套约定枚举正文（非 dot 目录下 `*.md`、
  路径序即阅读序），取最近 10 个文件、每块 ≥400 字。

### 为什么带置信区间而不是算个平均数就喂（本刀的核心）

诊断阶段标过一条风险：**两章语料算出的「平均 24.3 字/句」是噪声穿了测量的外衣**。
作者句长本就逐章起伏，样本少时章间方差会把均值推得到处跑，而模型会把喂进去的数字当硬
目标照做——等于用随机数去规训作者自己的文风。

故此处不设「够几章就开」的拍脑袋阈值，而是**量出这个数有多准**：按文件切块算块间标准误，
t 分布 95% 置信区间半宽超过容差的维度直接不注入（句长 ±2 字、对白标记占比 ±0.01），
块数 <3 无法估方差则整体沉默。闸的实测效力（`uv run python` 探针）：

| 语料 | 逐章句长 | 无闸会喂出 | 95%CI 半宽 | 实际 |
| --- | --- | --- | --- | --- |
| 句长起伏剧烈 | 1.0 / 34.0 / 10.0 | 「约 15 字/句」 | **42.4 字** | 不注入 |
| 句长一致（5 章） | 9.0 ×5 | 「约 9 字/句」 | 0.0 字 | 注入 |

### 顺带堵死一个会主动伤稿的洞

`dialogue_ratio` **只数「」，弯引号“”是 judge 侧刻意排除的**（`test_judge_style_guard.py:70`
明写为决定，本刀不动它）。于是用“”写作的手稿会稳稳测出 `0.00` 且半宽为 `0`——**恰好穿过
纯精度闸**，然后给生成器注入「目标对白密度 0.00」，即命令它别写对白。已加零值守卫：
测得 0 一律当口径不匹配处理，闭嘴。护栏含正反两例（用“”不注入 / 用「」注入）。

### 分层顺序即优先级

`author_voice.build_generation_system_prompt()` 是三条产字路径 system prompt 的**唯一组装点**：
通用创作准则 → 量自正文的文风基线 → 作者声明的指令（最后＝最强）。**声明高于测量**——
作者说「这段要短句」必须压过历史平均句长。顺序写在一个函数里而不是散在四个调用点，
是为了不让某处把层序拼反；护栏直接断言三段在 prompt 里的先后位置。

聊天循环**不注入**文风基线（它不直接产字，注入只是稀释工具纪律）。

## 验证命令与结果（第三刀）

- `uv run pytest -q` → **1170 passed / 3 skipped**（第二刀基线 1156，+14 即本刀新增）
- `uv run ruff check .` → All checks passed
- `node scripts/check-openapi-drift.mjs` → 无漂移（本刀不动契约）
- 行尾：`git diff --numstat` 与 `--ignore-all-space --numstat` 逐文件一致

## 未联通 / 未验证的能力（第三刀）

- **阈值本身未经真实语料校准**：容差 ±2 字 / ±0.01、最近 10 文件、每块 ≥400 字都是按
  「说出口才有意义」推的，不是量出来的。真实连载跑起来后应回看：闸是过紧（一直沉默）
  还是过松（起伏期就开口）。
- **只有两个维度出口**：`exposition_density` / `restraint_density` 刻意不注入——
  它们只数几个关键词（「克制」「沉默」…），拿这种量当目标就是本刀要防的那件事。
- **正文语料判别沿用 canon 的路径约定**：非 dot 目录下的 `*.md` 一律当正文。作者若把设定
  / 大纲放在非 dot 目录，会被算进文风基线。与 canon 同错同修，但这是已知边界。
- **每次生成重扫不缓存**：写盘即生效是刻意选择，代价是每次生成读最多 10 个文件。
- **共用 fingerprint 后 judge 行为零变化已由既有测试守住**，但 judge 的漂移检出本身仍只在
  BookRun 后台链上跑，桌面路径不经过它。
- **真机观感未验，归 E2E-1**：同前两刀，需重建 NSIS 装机包才能在作者机上生效。

# 2026-07-28 场景纪律：给 Writer 装内部结构（PR #220）

> **提名口径**：作者诊断提名。作者给出「小说 IDE 名不副实」四条——①缺乏创作知识
> ②缺乏记忆机制 ③比例倒置（注意力全给检查不给生产）④基于文件的对象模型（自评为下游
> 症状）。三路并行盘点后作者拍板走 ①③ 的合流处：**给 Writer 装内部结构**。

## 诊断台账（改前实测，非推测）

三路盘点（创作知识素材 / 工具生产-检查比例 / 跨会话记忆）的可复算结论：

| 面 | 检查侧 | 产字侧 | 倍数 |
| --- | --- | --- | --- |
| 循环工具数 | 13 | 4 | 3.3× |
| 工具 spec 字数 | 7,163 | 1,501 | 4.8× |
| 单次调用的 LLM 深度 | `file.review` = 4 个 reviewer 子代理 | 四条全是 1 次直出 | 4× |
| 每轮固定 prompt：工具纪律 vs 创作指导 | 10,190 | 310 | **33×** |

**全系统创作技艺知识去重后 = 335 字**（`CRAFT_GUIDELINES` 6 条 + 2 个例句，实测
`sum(len(g)) + len(BAD) + len(GOOD) == 335`），在四条产字路径里逐字复制四份。覆盖的实质
只有一个母题（show don't tell）+ 两个数字配额（两种感官、对白 4:6）+ 一张 10 词陈词黑名单。
**结构层为零**：场景开场、对白潜台词、信息释放节律、章节钩子结构、节奏调度——五项全无。

于是最常见的坏产出不是句子难看，而是「这一场删掉也不影响主线」——而判定这件事的判据
**仓库里本来就有**：`book_runs/prompts/_sections.py:155-159`「生成前先在内部确认：误判、
主动阻碍、代价、旧线索重释和不可逆变化都已成立」，以及 `builder.py:316-328` 含
`narrative_collapse` 的 10 维评稿 rubric。该批 7 个构建器**全仓零生产调用方**
（`build_critique_prompt` / `build_revision_prompt` / `build_chapter_plan_prompt` …），
唯一活着的 `build_draft_prompt_from_state` 只通向桌面从不创建的 BookRun。PR #217 从这座岛上
只搬走了 `CRAFT_GUIDELINES` 一个常量，同文件里的结构知识原地留下。

**结论：#1 不是「缺」，是「搬了一个常量就收工」。** 知识在仓库里，只是在一条桌面永远走
不到的路上。

## 改了什么

- `app/common/craft.py` 新增 `SCENE_DISCIPLINE_ITEMS`（视角 / 目标与阻力 / 代价与不可逆 /
  落差，名与释分开存）+ `SCENE_COLLAPSE_TEST`（承重判据）+ 两个措辞函数。去重原文 187 字，
  产字路径的技艺知识总量 335 → 522。
- `scene_discipline_clause()`（350 字）→ `_DRAFT_SYSTEM_PROMPT`(481→825)、
  `CONTINUE_SYSTEM_PROMPT`(395→739)。
- `scene_discipline_guard_clause()`（94 字）→ `_REVISE_SYSTEM_PROMPT`(473→567)。
- 新增护栏 `tests/test_scene_discipline_reach.py`（10 条）。

**零额外 LLM 调用**：这一刀只改 system prompt 内容，不加规划轮次、不加工具、不动契约。

## 为什么分两种措辞（本刀最容易做坏的地方）

`project.trim_prose` 没有自己的 system prompt——它按百分比压缩，复用的正是
`revise_file_content` / `_REVISE_SYSTEM_PROMPT`（`project_canon_runtime.py:127-129`）。
若图省事把 compose 版灌进 `build_generation_system_prompt` 一次通吃，就等于命令压缩工具
「落笔前先把四项定死、全部成立再动笔」——它会为补齐结构反向加字，**压缩工具越压越长**。

故改写侧只用 guard 版：四项是既有稿件的**承重结构，不得抽掉**，并明说「删字、并句、砍
副词都可以…宁可多留几个字」，与 `_REVISE_SYSTEM_PROMPT` 既有的最小改动纪律同向。
两版共用同一份 `SCENE_DISCIPLINE_ITEMS`，护栏断言同源（避免写与改各按各的尺子说话）。

## 一条刻意的类型适配

第 4 项「落差」措辞是**方向中立**的：「收场时的处境相比开场必须变了（变好变坏都算）」。
照搬西方剧作的 *things get worse* 会在本项目 n=1 的类型（末世 / 系统 / 进化流）里稳定判错，
把正常的升级场当过场毙掉。同理第 3 项「不可逆」显式容纳「得到某样再也退不回去的东西」。
护栏 `test_value_shift_is_direction_neutral` 断言 `"更糟" not in compose`。

## 刻意不做（收窄记录）

- **聊天循环不注入**：循环自己不产字（靠调工具产字），其 system prompt 已有 1574 字工具
  纪律，注入只会稀释。与文风基线同一条判据。护栏 `test_chat_loop_deliberately_stays_out`
  把这条钉成显式决定而非遗漏。
- **不加规划轮次**：没有把「先出场景卡 → 再写正文」做成两次 LLM 调用。本刀先验证
  prompt 层的内部规划够不够；不够再谈加轮次。
- **不打捞 10 维 rubric 与三档修订策略**：`builder.py:316-328` / `:369-373` 仍在坟里。
  它们是**评稿**知识，属于检查侧，与本刀（生产侧）不同向。
- **`_CHAT_SYSTEM_PROMPT` 不动**：全仓唯一一条既无准则也无作者指令也无基线的裸调用
  （`service.py:251-256`），但它不产字。

## 验证命令与结果

- `cd apps/api && uv run pytest -q` → **1180 passed / 3 skipped**（第三刀基线 1170，+10 即本刀新增）
- `uv run pytest tests/test_scene_discipline_reach.py tests/test_style_baseline_reach.py tests/test_author_instructions_reach.py -q` → 37 passed
- `uv run ruff check .` → All checks passed
- `pnpm verify` → 所有本地核心门禁通过（含 sidecar-smoke daily 档：`sqlite schema managed=true`、
  `分层 prompt 构建器已随 exe 打包`；`check-openapi-drift` → 无漂移）
- 行尾：`git diff --numstat` 与 `--ignore-all-space --numstat` 逐文件一致（三个改动文件全 CRLF）
- 契约零变更：本刀不动路由与工具 spec，OpenAPI 与 `loop_tool_schemas_golden.json` 均不受影响

## 未联通 / 未验证的能力

- **产出质量未验**：这是 prompt 内容改动，「加了场景纪律之后产出是否真的变了」需要真实
  LLM 对照实跑才能说，本刀只证明了触达。**不得把护栏绿当作质量结论。**
- **四项内容未经真实语料校准**：视角 / 目标与阻力 / 代价与不可逆 / 落差是打捞 + 类型适配
  推出来的，不是从作者已写的三章里量出来的。连载跑起来后应回看哪一项在真实稿件上最常失守。
- **`prose.continue` 的适配是措辞级的**：续写一次只产 ~300 字（一个节拍），不是一整场。
  compose 版靠「上文若已在一场戏中间，就从上文读出前两项」和「只写其中一段时也必须朝
  第 3、4 项推进一格」两句兜住，**但模型是否真能从 3000 字上文窗读准这一场的目标与阻力，
  未验**。
- **产品仍不知道「我在章内哪个位置」**：故章末钩子结构依然无法注入——`continuation.py:78`
  还在无条件禁止收束句（对段中续写正确，对章末错误）。这是作者诊断 ④「文件对象模型」的
  实证，本刀不解决。
- **真机观感未验，归 E2E-1**：需重建 NSIS 装机包才能在作者机上生效。
