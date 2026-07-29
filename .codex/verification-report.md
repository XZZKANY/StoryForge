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

# 2026-07-28 审稿判据：给检查侧装判断标准（PR #221）

## 提名口径

承 PR #220（场景纪律进产字路径）之后的第五刀，作者拍板「继续做乙丙丁」中的乙：
**打捞退役批量管线里的 10 维评稿 rubric，装进真正跑的三个 LLM 审稿子代理**。

## 诊断台账（本刀落地前的实测）

| 项 | 实测 | 位置 |
| --- | --- | --- |
| 三个 LLM 审稿子代理的**全部**判断标准 | `ReviewSkill.focus` 一句，合计 **37 字** | `ide/review_skills.py:32-34` |
| 同期产字侧创作知识（PR #220 后） | 522 字 | `common/craft.py` |
| 10 维评分表（含 `narrative_collapse`）实际调用方 | **零** | `book_runs/prompts/builder.py:316-328` |
| 三档修订策略实际调用方 | **零** | `book_runs/prompts/builder.py:369-373` |

即：检查侧此前是**流程重、判据空**——13 个检查类工具、7163 字工具纪律，但「什么算好、什么
算坏」只有 37 字。子代理没有判据可依，只能凭通用语感报「感觉平淡」。

## 改了什么

### 一、打捞判据（10 维 → live 三视角）

`app/common/craft.py` 新增 `REVIEW_RUBRICS` + `review_rubric_clause(key)`。判据**放 craft.py
而不是 review_skills.py**，是为了让写与审物理同源：

- plot 组的承重条由 `SCENE_DISCIPLINE_ITEMS` **派生**（不是抄一份），末条**就是**
  `SCENE_COLLAPSE_TEST` —— 写侧被要求满足的那把尺子，审侧用同一把验。
- prose 组的套话表直接拼 `CLICHE_PHRASES`，审侧点名的词就是写侧禁的词。

| 视角 | focus | + 判据 | system prompt |
| --- | --- | --- | --- |
| plot | 14 字 | 192 字 | 91 → 283 字 |
| character | 13 字 | 135 字 | 95 → 230 字 |
| prose | 10 字 | 218 字 | 88 → 306 字 |
| **合计判断标准** | **37 字** | | **→ 582 字** |

### 二、修一个真 bug：套话被当成「有冲突」的证据

`ide/review_skills.py` 的两张「缺席即问题」词表都含 `忽然`，而 `忽然` 同时在
`CRAFT_GUIDELINES` 的软禁用套话表里：

- 写侧告诉作者：避免滥用陈词套话——忽然、仿佛、不禁……
- 审侧：`忽然` ∈ `conflict_markers` ∧ `忽然` ∈ `hook_markers`

后果是**假阴性**：一段全是套话、毫无真实阻碍与悬念的文字，只要写了「忽然」，
`plot.conflict_signal_missing`（high）与 `plot.ending_hook_weak` 两条检查同时被骗过去，
稿件"干净通过"。

修法不是手工删词，而是构造期过滤 `_absence_markers()`：字面量保留历史词条，运行期剔掉与
`CLICHE_PHRASES` 的交集。**过滤器承重**——删掉它测试即红，手工删词做不到这点。三张
「缺席即问题」词表（conflict / ending_hook / motivation）统一走这条。
`telling_markers` 那种「命中即问题」的与套话表同向，刻意不处理。

## 一条刻意的类型适配

原 `narrative_collapse` 维的原文是「是否落入到新地点、问询、取得物证、收好、转向下一处的
**默认调查模板**」——那是推理小说的形状。本项目 n=1 是末世 / 系统 / 进化流，照搬会
把正常的战斗与升级场按「不是调查流程」放过、把赶路场按模板误伤。故改写成不认题材的判据
（场景推进 / 承重结构 / 钩子强度 / 承重判据），并以
`test_plot_rubric_carries_no_genre_specific_template` 钉死「物证 / 问询 / 调查」不得出现。

与 PR #220 的「落差不写更糟」同一条取舍：**打捞的是判据结构，不是原管线的题材假设。**

## 刻意不做

- **continuity 视角不装判据**：它是纯启发式关键词扫描（`review_report.py:148-161`），不走
  LLM，给它 prompt 判据没有落点。
- **`chapter.review` / BookRun 侧不动**：`build_multi_agent_review_report_with_executor` 是
  共用入口，走它的路径自动吃到；不另开分支。
- **不动 10 维里的三档修订策略**（`line_edit` / `scene_patch` / `regenerate`）：那是修订侧
  契约，与本刀的评审侧不同向，要打捞得另开一刀。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `uv run pytest tests/test_review_rubric_reach.py -q` | **11 passed** |
| `uv run pytest -q` | **1191 passed / 3 skipped**（基线 1180，+11 为本刀护栏） |
| `uv run ruff check .` | All checks passed |
| `git diff --numstat` vs `--ignore-all-space --numstat` | 逐行相同，无行尾噪音 |

真 bug 的**非空洞性实证**：对测试用例文本 `"他忽然站了起来，忽然又坐下。" * 20`，
按修复前的词表 `any(marker in prose)` 对 conflict 与 hook 均为真 → 两条检查都不报；
修复后两条都报。护栏 `test_cliche_alone_no_longer_passes_as_conflict_or_hook_evidence`
在修复前必红。

## 未联通 / 未验证

- **质量未验**：本刀是 prompt 内容与词表改动，护栏只证明**触达**与**词表不自相矛盾**。
  「装了判据之后审稿报得更准」需真实 LLM 对照实跑才能说，未跑，不得当作质量结论。
- **判据本身未经真实语料校准**：四组判据是从退役管线打捞 + 按类型适配推出来的，不是从作者
  已写稿件上量出来的。连载跑起来后应回看哪一条最常误报。
- **`plot.ending_hook_weak` 的「章尾」定义仍是「文件最后一个段落」**
  （`review_skills.py:85`）——产品不知道章边界在哪，一章分两个文件即失效。属诊断 ④ 范畴，
  本刀不解决。
- **真机观感未验，归 E2E-1**：需重建 NSIS 装机包才能在作者机上生效。

# 2026-07-28 章序判据：非正文文件不再占章号（PR #222）

## 提名口径

作者拍板「继续做乙丙丁」中的**丁**（继续诊断诊断 ④「文件对象模型」）。诊断过程逮到一个
live 真 bug，本刀先修 bug，诊断结论另行汇报。

## 真 bug：产品自带示例项目的第 1 章被算成第 3 章

后端此前对「哪些 `.md` 是正文」**没有任何概念**。章序直接取
`fs_tools.iter_project_files` 的路径序，`canon_rebuild._chapter_ordinals` 的 `glob="*.md"`
拦不住任何东西——`Path.match("*.md")` 只比对**文件名**，不看目录。

产品「新建项目」实际落盘三个文件（`initialize.ts:43/56/66`）：

```
大纲/总纲.md      人物/主角.md      正文/第01章.md
```

按 `as_posix()` 码点序排：人物(U+4EBA) < 大纲(U+5927) < 正文(U+6B63)。

实测（修复前，临时项目跑真代码）：

```
第 1 章  <-  人物/主角.md
第 2 章  <-  大纲/总纲.md
第 3 章  <-  正文/第01章.md
promise_check 当前进度 = 3      # 作者只写了 1 章
```

修复后同一项目：

```
第 1 章  <-  正文/第01章.md
promise_check 当前进度 = 1
```

**下游伤害面**（全部吃这个数）：`canon_context` 注入产字 prompt 的「本文件 = 第 N 章」锚点、
`canon_gate` 的 lifespan 退场闸（`occ["chapter"] > exits_after`）、`promise_scan` 的伏笔到期
判定、`entity_budget_scan` 的第 20 / 25 / 30 章硬阈值。即：**确定性 canon 链——产品宣称的
差异化资产——从新项目第一天起就按虚高两章的坐标跑。**

## 改了什么

新增无依赖叶子 `app/common/manuscript.py`：`NON_MANUSCRIPT_DIRS` + `is_manuscript_path()`。

**目录约定不是本刀发明的**——前端 `lib/project/semantics.ts` 的 `DIR_KIND` 早就声明了同一套
（正文 / draft / manuscript / chapters → 正文；大纲 / 人物 / 设定 / 时间线 / 伏笔 / 质量 /
导出 → 非正文）。此前只有前端认、后端不认，本刀是把后端接上同一套。放 `app/common` 是因为
`style_baseline` 在 common、不得 import domains。

三个落点：

| 位置 | 此前 | 现在 |
| --- | --- | --- |
| `canon_rebuild._chapter_ordinals` | `Path.match("*.md")`，全项目 .md 都算章 | 另判 `is_manuscript_path` |
| `entity_budget_scan._chapter_ordinal` | `_iter_project_files(root).index()` —— **零过滤**，图片和 json 都占章号 | 同一判据，且非正文 target 明确抛 `FsToolError` |
| `style_baseline._iter_manuscript_files` | 非 dot 目录下全部 `.md` | 排非正文目录 |

第三处是独立的第二个真 bug：文风基线此前把 `大纲/`、`人物/`、`设定/` 的条目式文本当语料，
量出的句长与对白密度会被无对白的条目列表拉偏——**而这套数字是要写进产字 prompt 当
「作者文风」的**。

## 取黑名单而非白名单

不是「只认 `正文/`」。章节直接放项目根的布局仍然可用，作者不必先重组目录才能让 canon 算对
章号。代价是根目录下的杂项 `.md` 仍占章号——由作者的目录习惯兜住。护栏
`test_root_level_chapters_still_count` 钉死这条取舍。

## 一条跨栈防漂移闸

`test_backend_and_frontend_share_one_directory_convention` 直接读
`apps/desktop/frontend/src/lib/project/semantics.ts`，正则解出 `DIR_KIND`，断言其中**非
draft** 的条目集合与 `NON_MANUSCRIPT_DIRS` 逐项相等。前端加一个非正文目录而后端没跟上，
本闸即红——否则作者在文件树里看到的分类会与 canon 算的章号再次错开。

（闸自带非空转断言：解析不出条目即 fail，不会因正则失效而静默放行。）

## 一个测试在编码这个 bug（已修正，不是回归）

`test_chat_loop_promise_check_feeds_summary_only_without_writing_canon` 此前断言
`current_chapter == 2`，而 `novel_project` fixture 只有**一个**正文文件
（`正文/第01章.md` + `设定/人物.md`）——那个 2 正是 `设定/人物.md` 被误计为第 2 章得来的，
`due_chapter=1` 的伏笔也因此才显得「超窗」。已补一章真正文让超窗名副其实，用例覆盖面不变。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `uv run pytest tests/test_manuscript_chapter_ordinals.py -q` | **8 passed** |
| `uv run pytest -q` | **1199 passed / 3 skipped**（本刀前 1191，+8） |
| `uv run ruff check .` | All checks passed |
| `git diff --numstat` vs `--ignore-all-space --numstat` | 逐行相同，无行尾噪音 |

## 未联通 / 未验证

- **只修了「正文 vs 非正文」，没有建立章节对象**。产品仍不知道「这是第几章」的**真值**——
  章序依然是路径序推断，不解析 `第NNN章` 文件名。故仍脆在：补零位数不一致即错序
  （产品示例项目自己用的是**两位** `第01章.md`，作者约定是三位）、`正文/` 下的非章文件仍占
  章号、前端 `localeCompare` 与后端码点序在中文 locale 下可能给出不同顺序。
- **章内位置仍然不存在**：`continuation.py` 依旧无条件禁止收束句。诊断 ④ 的核心未解决。
- **存量项目需重跑 canon**：`presence.json` 等派生缓存是按旧章序算的，下次 rebuild 自愈
  （canon 链本就设计成可弃缓存），但未在真机验证过存量项目的这次自愈。
- **真机观感未验，归 E2E-1**。

# 2026-07-29 补丁蒸发：agent 主动产字的落地率从 0 修到 1（PR #224）

时间：2026-07-29

> **提名口径说明**：本刀由 ultracode 多路诊断提名、作者拍板。40 条候选经「代码事实 + 写作价值」
> 双透镜对抗核查后 22 条被驳回，本条是幸存的 10 条之一（双透镜均判 high）。

## 诊断

后端有三个工具会产出**可写回正文**的补丁，payload 完全同形（`file_path` + `before` + `after`
+ `approval_action: desktop.confirm_file_writeback`），只有 audit 字段不同：

| kind | 产出者 | 位置 |
| --- | --- | --- |
| `file_revision` | `file.revise` / `file.create` | `patches/runtime_tools.py:87,:172` |
| `prose_trim` | `project.trim_prose` | `tools/project_canon_runtime.py:160` |
| `prose_continue` | `prose.continue` | `tools/prose_continue_runtime.py:76` |

前端 `agent-result.ts:12` 一句 `patch.kind !== 'file_revision'` 把后两种**静默丢弃**。

伤害不止是「功能没生效」，而是**产品在骗作者**：`prose_continue_runtime.py:89` 的 summary 写死

```
已在第 {anchor_line} 行之后续写约 {inserted_chars} 字，等你确认后才会写盘。
```

对话里这么说、流程树也亮着「等待作者在编辑器里确认 diff」，作者去编辑器找那个 diff——不存在。
那段正文只活在一次性的 SSE 事件里，刷新即永久丢失，重来要再付一次 token。

这是全部四条通道里**唯一「agent 主动产字」**的能力，落地率 0。

后端其实早就预备好了：`patches/types.py:48-55` 的 `_default_tool_name` 给 `prose_trim` /
`prose_continue` 都写了工具名映射——typed 模型预期这两种 kind，只有前端在门口挡掉。

## 改了什么

把判定从 **kind 白名单**换成**结构判定**：带 `file_path` + `before` + `after` 三个字符串字段的
补丁一律可写回。函数随之更名 `fileRevisionPatch` → `writableFilePatch`（旧名字正是这个 bug
能活下来的原因之一）。

选结构判定而不是把两种 kind 加进白名单，是因为**白名单漏一种就重演一次静默丢弃**——后端每加
一个产字工具都要记得回来改这里。结构判定下新工具只要 payload 同形就自动接得住。

`repair_patch` 不会被误收：它顶层没有这三个字段（`runtime_arguments.py:209-222`），走
`repairPatchApproval` 自己的通道。

两个消费点（live 的 `useRunAuthorAgent` 与断线重连的 `useAgentRunRecovery`）共用这一个函数，
改一处两条路径同时通；下游 `emitFileSuggestion` 只吃 `{id, file_path, before, after}`，零改动。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run test -- tests/chat-window.test.ts` | **29 passed**（+2 新增） |
| `npm run test`（前端全量） | **386 passed / 65 files**（本刀前 384，+2） |
| `npm run typecheck` | 通过 |
| `pnpm lint` | eslint + prettier 全绿 |
| **可证伪验证** | 临时把判定改回 `kind !== 'file_revision'` 后重跑，新增用例**如期挂掉**；恢复后转绿 |

新增两条用例：①三种 kind 都必须能进待确认面板（旧逻辑下必挂）；②`repair_patch` 与缺 `after`
的残缺补丁必须拒收（防止结构放宽把不该收的收进来、拿 undefined 覆盖作者正文）。

## 未联通 / 未验证

- **真机未验**。本刀只在 vitest 里证明补丁能被接住，「作者在对话里说『接着往下写一段』→ 编辑器
  真的弹出绿块 diff → 接受后正文多出那段 → `versions/` 有写前快照」这条完整链路需重建装机包后
  在真机点穿，归 E2E-1。
- **卡片文案未分档**。三种 kind 现在共用同一套卡片文案，续写与压缩显示的都是后端给的 summary
  （backend 各自的 summary 已经描述准确），但 `useRunAuthorAgent.ts:376` 的兜底文案仍写死
  「Agent 已生成修订建议。」——续写时若后端没给 summary 会显示得不准。属边缘情况，未改。
- **`continue_audit` / `trim_audit` 未被前端使用**。后端带了锚点行号、插入字数、压缩百分比，
  前端目前一概不显示。要不要在卡片上露出这些，等真机 dogfood 提名。

# 2026-07-29 发版记录：0.1.6 装机包重建（送达 PR #214-#222 与 #224）

时间：2026-07-29

## 为什么这次发版是必要的，而不是例行

诊断发现作者机器上跑的是 **0.1.4**（`storyforge-desktop.exe` FileVersion=0.1.4，构建于 07-27
12:23），而 master 早已到 0.1.5 + 19 个提交。也就是说下面这十项创作能力**写完测完合并完、
一次也没服务过唯一的真实作者**：

PR #211（空章节文件写入死锁）、#214（作者视图注入）、#215（prose.continue 循环工具）、
#216（canon 提案并入）、#217（创作准则触达四条产字路径）、#218（作者指令触达三条生成调用）、
#219（文风指纹复活）、#220（场景纪律）、#221（评稿 rubric）、#222（章序判据）。

更要命的是：**0.1.5 的 NSIS 早在 07-27 15:01 就打好躺在 `bundle/nsis/`**，只是从没被安装。
所以「后端修完 → 打了包 → 作者能用」这条链上，断的是**最后一环**。

结论沉淀：**打了包 ≠ 装了包，是两件独立的事，都要查**。此后诊断「某能力有没有生效」，
第一步是查装机版本而不是查代码：

```powershell
Get-ChildItem "$env:LOCALAPPDATA\StoryForge IDE" -Recurse -Include *.exe |
  ForEach-Object { $_.VersionInfo.FileVersion }
```

## 产物

| 项 | 值 |
| --- | --- |
| 路径 | `apps/desktop/src-tauri/target/release/bundle/nsis/StoryForge IDE_0.1.6_x64-setup.exe` |
| 大小 | 49.79 MB |
| SHA256 | `D2E0B13B8BED61D3F1DE2BB1966319013148F6CBC0BEFCDDD2A50EBC057FECE2` |
| 构建时刻 | 2026-07-29 22:19:24 |
| 内含 | master `9c142693`（PR #223 bump + PR #224 补丁蒸发修复 + 此前全部已合并工作） |

用 `pnpm desktop:build` 而非 `tauri build`——后者会静默把 `src-tauri/binaries/` 里的旧 exe
打进包。**出包后已核对 sidecar 时间戳：22:16:00，与本次构建同批，不是复用旧产物。**

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `uv run pytest tests/test_version_alignment.py` | 2 passed |
| `pnpm verify` | 全绿：API **1199 passed / 3 skipped**、前端 384、shared / project-core 通过、sidecar daily 冒烟 OK、**OpenAPI 零漂移** |
| `pnpm desktop:build` | exit 0，产物见上表 |
| `node scripts/sidecar-smoke.mjs --packaged --skip-build` | **packaged(冻结 exe) 冒烟全绿**：`/health/ready` 就绪 7316ms、assistant 会话往返、Agent SSE 2 帧、control REST 往返、alembic managed=true、分层 prompt 已随 exe 打包 |
| 定向断言：起冻结 exe 读 `/health/ready` | **`app_version = 0.1.6`、`status = ready`** —— 冻结 exe 自报版本与 bump 一致 |

## 未联通 / 未验证

- **作者尚未安装**。本记录只证明产物已构建并通过冻结 exe 冒烟；覆盖安装、以及安装后
  「十项能力是否真的在真机生效」全部未验，归 E2E-1。
- **PR #224 的完整链路真机未点穿**：对话说「接着往下写一段」→ 编辑器弹出绿块 diff →
  接受后正文多出那段 → `versions/` 有写前快照。vitest 只证明了补丁能被接住。
- 版本五处中 `Cargo.toml` 与 OpenAPI `info.version` 仍无护栏，靠人记得跑 `pnpm openapi`。
  本次没漏，但护栏缺口未修。

# 2026-07-29 七刀一轮做完：诊断里等提名的缺口全部实装（PR #226-#230）

时间：2026-07-29 / 07-30

作者下「将剩下的刀都干了，再打包」。指的是 07-28 ultracode 诊断里通过双透镜核查、
按宪法 §08 一直等提名的 7 条。本轮一次做完并合并，随后 bump 0.1.7 重建装机包。

## 动手前的复核：两条与原诊断不符

旧诊断动手前先验（上一轮踩过 stale memory 的坑）。四路只读复核的结论里有两条要改方向：

- **「别名进不了 canon」基本不成立**。aliases 在 canon 里本就是一等字段（presence 重建、
  退场闸、dossier、前端光标联动全吃它），并入时也原样透传。真正的漏点是另外两处：
  硬约束头只推 `canonical_name`、`project.consistency` 的 terms 完全靠模型自己列。
- **「Ctrl+K 改一句整章重写」的重伤已被修掉**。commit `f2ab7113` 引入的
  `planAnchoredInlineDiff` 把写回夹到锚定行，整章不会落盘。剩下的是 token 成本与
  drift 被静默丢弃。

照原诊断硬做会做错方向，这两条按修正后的形状实装。

## 七刀

| PR | 内容 |
| --- | --- |
| #226 | 上下文跟着连载走：前端按章序取 + 正文取**结尾**；后端 `previous_chapter_tail` 进续写 prompt |
| #227 | canon 硬约束进整章产字（此前只有 300 字续写有） |
| #228 | 跨会话记忆落地：`agent-instructions.md` 对作者和 agent 同时可见 |
| #229 | canon 提案不被下次调用抹掉 + 伏笔账写入口 + 别名推得到模型 |
| #230 | Ctrl+K 只送锚点附近的窗口 |

### PR #226 上下文触达

全仓上下从前端请求体到后端十条 prompt 组装点，**没有任何一处把「上一章正文」放进过模型
上下文**。作者新建空的 `第005章.md` 说「接着往下写」时，续写 prompt 里还字面写着
「这份稿件当前还是空的，你要写的是开头」——不是缺上下文，是主动给了错误前提。

`app/common/manuscript.py` 从布尔判据扩成正文阅读序的单一真源（`iter_manuscript_files`
从 `style_baseline` 上移，避免两份阅读序；`previous_chapter_tail` 取上一章尾 1200 字）。
章序 = 路径序，与 `canon_rebuild.chapter_ordinals` 同口径，不解析文件名数字。

前端 `context-bundle.ts` 此前正文一律字典序取前 8 个、每个取**开头** 1200 字——连载写到
第 30 章喂的永远是第 1-8 章开头。改为按与当前章的距离排序、上一章提到仅次于大纲、
正文摘录取结尾。

### PR #227 canon 进整章产字

`build_scene_constraint_block` 全仓只有两个调用点：`prose.continue` 和不产字的 chat 循环。
`file.revise` / `project.trim_prose` / `file.create` 一个都没接——**越需要设定约束的地方
越没有**。结构性根因：`app/common` 不得 import domains、assistant 不得顶层 import
agent_runs（`file.create` 反向依赖会成环），canon 进不了 `build_generation_system_prompt`
那个统一组装点，只能每条路径各自延迟导入。提成共用的 `_scene_constraints`。

### PR #228 跨会话记忆

上下文严格等于「本会话最后 12 条消息」，换个会话偏好归零。而唯一每轮无条件重读、与
session id 无关的载体一直就在那儿：`.storyforge/agent-instructions.md`。它进不了作用是
因为三处同时把它藏了起来——`fs_tools._is_skipped`（agent 看不见）、前端
`entry-visibility.ts` 白名单（作者看不见，且建了就从树上消失）、system prompt 只字未提。
三处一起补，路径常量下沉 `author_voice.RELATIVE_PATH`。system prompt 给**双向**判据：
长期偏好才提议追加，一次性要求不许写。写回红线不变（后端不写盘，走确认补丁）。

### PR #229 canon 写回三件

提案接回上一轮未并入的条目（此前第二次调用永久抹掉，且因提案由模型按本轮章节传入而
**不会自愈**）；`promise_claims` 复用既有提案 → 并入通道给伏笔账开写入口（不新建写路径）；
硬约束头改推「陈默（又称 老陈 / 默哥）」、consistency terms 自动并入 canon 表面形。

### PR #230 Ctrl+K 切窗

切窗 → LLM → 拼回整文 → 交给原来的 `planAnchoredInlineDiff`，**整文件 diff 契约不变**，
夹紧/陈旧判定/写盘一字未动。短文件整篇送出，风险只落在长章节。后端
`_build_revise_prompt` 里「以下是文件的当前全文」同步改口，否则与节选说明打架。

## 验证

| 命令 | 结果 |
| --- | --- |
| `uv run pytest tests/` | **1217 passed / 3 skipped** |
| `npm run test`（前端全量） | **397 passed / 65 files** |
| `npm run typecheck` | 绿 |
| `uv run ruff check app/` / `prettier` | 绿 |

新增护栏四份：`test_canon_reach.py`(4)、`test_author_memory_reach.py`(4)、
`test_canon_writeback_reach.py`(7)、以及 `test_manuscript_chapter_ordinals.py` /
`project-context.test.ts` / `inline-chat.test.ts` / `resource-explorer.test.ts` 各补数条。

**可证伪逐条实证**（变异实现 → 对应用例变红 → 恢复即绿）：canon 块条件改 `if False`、
`_is_skipped` 豁免改 `if False`、提案接回改 `if False`、显示名改回只推本名、
terms 展开改 `pass`、切窗条件改恒真。

## 两次假绿，记一笔

1. **变异根本没匹配上**：heredoc 里的 `\\n` 转义被吃掉，`replace` 命中 0 次，测试照绿。
   我差点把「没跑」当成「验过」。此后变异必须先打印 count 并 grep 确认落进文件。
2. **变异了实现、测试仍绿**：consistency terms 那条只测了纯函数、没测它被接进 handler。
   补一条走真实 handler 的用例才红。本轮反复在抓的正是「写好了但没接线」，测试自己
   踩进去一次。

## 老坑复现

- **混合行尾**：`tools/` 三个文件在 HEAD 是 CRLF+LF 混合，Edit 全量归一造出约 110 行
  空白噪音。用 difflib 对 `equal` 块拷回 HEAD 的行尾修复，最终 `--numstat` 与
  `--ignore-all-space --numstat` 一致。
- **改 spec 描述必刷 golden**：`tests/fixtures/loop_tool_schemas_golden.json`（CRLF，
  `json.dumps(indent=2)`，无尾换行）。首次全量跑因此红过一次。

## 未联通 / 未验证

七刀**全部未经真机点穿**，一律归 E2E-1：

- 新建空章说「接着往下写」→ 续出来的字真的接得上上一章结尾；
- canon.json 声明的退场 / 唯一持有约束，在起草整章时真的被模型遵守；
- 对话里说一句长期偏好 → agent 提议改 `agent-instructions.md` → 确认 → **新建会话**后仍生效；
- agent 读完一章 → 提出伏笔 → 观测镜「并入」→ `promise_check` 记得上账；
- 长章节里选一句按 Ctrl+K → 绿块只出现在那一句上 → 接受后其余段落逐字未动。

`project.deep_consistency` 与各 advisory 工具的结论口径不变：参考信号，不是质量判定。

# 2026-07-30 发版记录：0.1.7 装机包重建（送达 PR #226-#230 七刀）

时间：2026-07-30

## 产物

| 项 | 值 |
| --- | --- |
| 路径 | `apps/desktop/src-tauri/target/release/bundle/nsis/StoryForge IDE_0.1.7_x64-setup.exe` |
| 大小 | 49.80 MB |
| SHA256 | `6451E555C035EEEE191A3ADA34BD416709251A090931EF8B8FB6021E90F6364F` |
| 构建时刻 | 2026-07-30 00:39:32 |
| 内含 | master `9e56dde1`（七刀 PR #226-#230 + bump #231） |

用 `pnpm desktop:build` 而非 `tauri build`。sidecar 时间戳 16:35 与本次构建同批，
体积 48,249,419 字节（0.1.6 那版是 48,241,049），已核对不是复用旧产物。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `pnpm verify` | 全绿：API **1217 passed / 3 skipped**、前端 **397 passed / 65 files**、shared 与 project-core 契约通过、lint + prettier + typecheck 绿、sidecar daily 冒烟 OK、**OpenAPI 零漂移** |
| `pnpm desktop:build` | exit 0，产物见上表 |
| `node scripts/sidecar-smoke.mjs --packaged --skip-build` | **packaged(冻结 exe) 冒烟全绿**：`/health/ready` 就绪 7336ms、assistant 会话往返、Agent SSE 2 帧、control REST 往返、alembic managed=true、分层 prompt 已随 exe 打包 |
| 定向断言：起冻结 exe 读 `/health/ready` | **`app_version = 0.1.7`、`status = ready`** |

## 构建期两处插曲

1. **首次 `pnpm desktop:build` 失败在 `EBUSY`**：一个残留的孤儿 sidecar 进程锁着
   `binaries/storyforge-api-x86_64-pc-windows-msvc.exe`，PyInstaller 编译成功但复制失败。
   杀掉孤儿进程后重建通过。注意该进程路径在**仓库构建产物**下，不是装机版。
2. **`pnpm verify` 曾红一次**：`test_acceptance_wrapper_probe_only_passes_with_local_provider`
   缺 `chat_probe: ok` 行（而 `connectivity_probe_exit_code: 0`、`gate: pass_probe_only`
   说明探针本身通过）。单独复跑 4 次全绿；该用例有去 flaky 前科（commit `20ae68f4`），
   且本轮七刀完全没碰探针 / 验收链。判为满载下的既有 flaky，已重跑整条门禁取得干净绿。

## 未联通 / 未验证

- **作者尚未安装，且当前装的仍是 0.1.4**（`storyforge-desktop.exe` FileVersion=0.1.4）——
  连 0.1.6 也从没装过。**这是「打了包 ≠ 装了包」第二次复现**：本轮七刀 + 上轮十刀，
  作者机器上一条都没生效过。
- 七刀的真机点穿全部未做，归 E2E-1（清单见上一节「未联通 / 未验证」）。

# 2026-07-30 作品底座：让对话 agent 知道自己在管一本书（PR 待编号）

## 提名与诊断

作者原话：「怎么是选择一文件 对应改 agent 参考 不应该 agent 统御这整个作品吗」。

先排除误会：**会话确实是项目级的**——`chat-window/session-guard.ts` 的会话身份 key 里没有
file 维度，切文件的 effect（`useChatSessionContext.ts`）只清参考包、不动 `setMessages`。
不存在「一个文件一个 agent」。

「选文件改参考」确实存在但只是表层：`lib/project/context-bundle.ts` 把当前文件剔出参考包
（它已作为全文单发）、把**上一章提权到优先级 0.5 排在人物(1)/设定(2) 之前**、再按
`maxFiles = 8` 硬截断——于是邻章会挤占人设名额。

**真正的病在后端**：`loop_runtime.run_chat_loop` 每回合拼进 system 的只有静态创作准则、
作者自定义指令、最近 12 条历史、canon 硬约束头、作者手钉文件、光标窗。唯一的全书事实源是
canon 硬约束头，**而作者没在 `canon.json` 声明 invariants 时它整块返回 `None`
（`canon_context.py:140-141`），一个字都不注入**。文件树、人物设定、章节摘要、
canon dossier 正文、全书章数字数、上一章结尾、文风基线全部不在 prompt 里，全靠模型
自己想起来调工具去捞。

一句话：它不是「被一个文件绑住了」，是**「从来没被交代过这是一本书」**——一个空降的
通用 agent，手里恰好攥着一份文件。

## 本刀做了什么

新增 `app/domains/agent_runs/book_context.py`（确定性、无 LLM、无 key），每个用户回合往
system 里注入一块「作品底座」，并在 `loop_runtime` 接线（净 3 行）：

| 段 | 内容 | 取数方式 |
| --- | --- | --- |
| 阅读序坐标 | 全书 N 章 · 约 X 万字 · 平均每章 · 当前是第 k 章 | `canon_rebuild.chapter_ordinals`（**与 canon 硬约束头同口径**）+ `stat` 估算 |
| 骨架索引 | 大纲 / 人物 / 设定 / 时间线 / 伏笔的路径 + 体量 | `iter_project_files` + `is_manuscript_path` 取反 |
| 实体台账 | 本名（又称 别名）· 第 a–b 章在场 | `canon.json` + **已落盘**的 `presence.json` 缓存 |
| dossier 指针 | `.storyforge/canon/derived/dossier.md` 可直接 `fs_read` | 文件存在才给 |
| 上一章结尾 | 阅读序上一章尾 600 字 | `manuscript.previous_chapter_tail` |

三条刻意的取舍：

1. **章序复用 canon 的同一口径**。底座若自己扫一遍，会出现底座说「第 12 章」、硬约束头说
   「第 13 章」——两个打架的数字比没有数字更糟。
2. **字数按字节估算、不逐篇读盘**，一律带「约」字交付；逐篇读要 O(全书正文) 的 IO，每轮
   对话都做不划算。
3. **台账不触发重扫**：`presence.json` 缓存没落盘时只给名字与别名，绝不在对话路径上调
   `rebuild_presence`（那要扫全书正文）。

dossier 指针是补「发现不了」而不是补「读不到」：`fs_list` / `fs_search` 跳过 `.storyforge/`
（`fs_tools.py:16,58`），但 `fs_read` 并不过滤该目录，知道路径就能读。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `uv run pytest tests/test_agent_book_context.py -q` | **12 passed** |
| `uv run pytest -q`（全量） | **1229 passed / 3 skipped**（= 上一波 1217 + 本刀 12，零回归） |
| `uv run ruff check`（新增 + 改动文件） | All checks passed |

**变异验证（打在接线上，不是只测纯函数）**：

| 变异 | 结果 |
| --- | --- |
| 从 `run_chat_loop` 的 messages 里摘掉底座块 | **红** — `test_book_context_block_reaches_the_llm_messages` 逮住 |
| 底座章号 +1（与 canon 硬约束头错开） | **红** — `test_chapter_ordinal_matches_canon_constraint_header` 逮住 |

改了一条既有断言：`test_chat_loop_without_author_instructions_injects_no_extra_system` 原先拿
「system 总条数 == 1」当「没有作者指令块」的代理，作品底座合法占位后该代理失效。改为直接断言
「没有以 `_AUTHOR_INSTRUCTIONS_PREFIX` 开头的 system 块」——测的是原本的意图，且更难假绿。

## 未联通 / 未验证

- **真机未验**：底座在真实 provider 下的实际观感（模型是否真的据此改变回答口径）归 E2E-1；
  本刀只有 headless 断言证明「块确实发出去了」，没有证据证明「模型因此答得更像总编」。
- **token 成本未实测**：底座每回合约 1–3k 字符，长书下的实际 prompt_tokens 增量未在真跑中量过。
- 前端 `context-bundle.ts` 的 8 文件配额未动——邻章仍可能挤占人设名额，这条留作后续。
- 作者机器仍停在 0.1.4，本刀与此前所有刀一样**未送达**，需重建 NSIS 才能生效。
