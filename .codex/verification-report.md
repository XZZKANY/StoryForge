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
