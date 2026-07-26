# 验证报告 · 光标处续写（写作时刻 03 首次有 agent 参与）

时间：2026-07-27
分支（均已合并 master，最终 `a7fe4319`）：

| PR | 分支 | 主题 |
| --- | --- | --- |
| #206 | `feat/prose-continue-backend` | 流式出网通道 + `/assistant/continue` |
| #207 | `feat/prose-continue-frontend` | Ctrl+Shift+K 续写、流式绿块、确认写回 |

> **提名口径说明**：本刀是**真实作者提名**——作者原话「肯定要能续写」，回应的是「agent
> 是否适配小说编辑器」的诊断结论。符合宪法 §08 由真实写作需求提名的口径，不是主动打磨波。

## 诊断（决定为什么做这一刀）

问「agent 是否适配小说编辑器」，摸完三块事实（宪法 §06 原文、后端循环真实形状、桌面端
交互面）后的结论：**词汇层和工具层高度适配，工作形状层还是「代码 agent 的骨架套小说的皮」**。

三条结构性缺口，本刀只解决第一条：

1. **它是审校 agent 不是写作 agent**。16 个循环工具只有 3 个产字（`file.revise` /
   `file.create` / `project.trim_prose`），全是「改已有」或「起草新文件」，没有「在光标处
   接着往下写」；前端零个「写」的按钮；Ctrl+K 的契约明文禁止扩写。
   → agent 只服务写作时刻 04 章末检查与 05 修订比较，**03 连续起草完全缺席**。
2. **上下文注入是代码 agent 的形状**。每轮只注入文件路径不注入内容；选区进不了循环
   （`request-payload.ts:22-24` 把整篇正文塞进 `content`/`context`/`selection` 三个同值键，
   后端 `conversation_runtime.py:141,207` 只读 `project_path` 和 `file_path`，三个全丢）。
3. **记忆等于零**。历史只留最后 12 条 × 4000 字，无跨会话记忆，摘要不回灌。唯一持久记忆
   是 canon.json / hooks.json，但写回闭环两端断开——**agent 能读自己的记忆，不能写**。

注：§06.03 的定义原文是「编辑器保持安静，后台能力不抢焦点」，所以**起草时 agent 不主动
插嘴是宪法立场不是缺陷**。缺的是「按需续写」——按需触发不抢焦点，与 §03 不冲突。

## 三项拍板（作者选定）

| 决策 | 选定 | 说明 |
| --- | --- | --- |
| 触发方式 | 按需快捷键 | 不做 ghost text：符合 §06.03，也不在思考停顿时偷烧 BYO-key |
| 续写长度 | 一段（约 300 字） | 生成快、好判断、不合意重来不心疼 |
| 是否流式 | 逐字流式 | 作者选了更难的一条；代价是要在唯一出网通道里新开流式旁路 |

## 续写工艺的来源与法律边界

调研了同类长篇写作工具的公开做法。**整条 lorebook / Author's-Note-at-depth 血脉的实现
（SillyTavern、KoboldAI 全系、mikupad、textgen）全部是 AGPL-3.0，一律没读**——读了再写
属于污染路径。只从非 copyleft 来源取技术：

- Character Card V3 规范（**MIT**）：把 `scan_depth` / `token_budget` / `insertion_order` /
  `@@depth` 写成了文字规范，可实现可自选许可。
- Kobold 的**公开 wiki 文档**（非代码）：预算顺序 memory → world info → author's note →
  prompt → history，生成配额先扣。
- AgentWrite / LongWriter（**Apache-2.0**）：`prompts/write.txt` 的续写语义。
- Re3 / DOC（**MIT**）：每步重建 prompt、只取相关切片。

落到实现的三条：

1. **操舵指令贴近尾部**。canon 硬约束（唯一持有 / 已退场 / 活跃伏笔 / 本章伏笔计划）与
   本次要求排在**上文之后、prompt 最末**，不塞进 system——近因位置对下一段的影响远大于
   开头。测试 `test_steering_sits_after_the_manuscript` 钉死这个顺序。
2. **显式禁止收尾**。分段续写的头号病是每段都想写个总结或悬念钩子式收束。
3. **防重复靠 prompt + 确定性后处理，不碰采样惩罚**。作者在用的兼容端点文档明写
   `frequency_penalty` / `presence_penalty` 已移除、传了也不生效；另有生产复盘实测调参对
   重复「零到负效果」。故用 `strip_repeated_prefix`（掐掉模型重抄的那截上文，`min_overlap`
   防「他」这类短串误伤）+ `trim_to_sentence_end`（裁到完整句末，丢弃过半时放弃裁剪）。

## 刀 1 · 后端（PR #206）

**`llm_client` 加流式旁路 `stream_chat_completions`**，不动 `call_llm` / `call_llm_messages`：

- **重试只包住建连**。一旦开始吐字就不再重连——重连会让作者眼前重复出现半段正文，比直接
  失败更糟。读流中途故障直接 `LLMError` 并带上已输出字数。
- **`stream_options` 自愈**：兼容端点回 400 时摘掉该字段重发（不消耗重试次数），usage 回落
  既有字符估算。既拿得到精确 usage，又不会因一个可选字段在首次真用时炸给作者。
- 三个 per-call 覆盖（`stream` / `temperature` / `max_completion_tokens`）均 keyword-only
  带默认值；有一条测试钉死**不传时请求体与现状逐字节一致**。

**`llm_http` 加 `StreamingReasoningFilter`**：`strip_reasoning_leak` 的增量等价物。流式不能
回看全文再决定切哪里，故在判定开头不是 think 块之前一律缓冲；标签被切成半截送达
（`"<th"` / `"ink>"`）是流式常态，不能因一次 feed 看不全就误放行。

**`POST /api/assistant/continue`（SSE）**：帧 `start` → `delta`（原始增量，仅供观感）→
`done`（`text` 是经确定性后处理的权威结果）/ `error`。LLM 未配置在建流前抛 422，不裹进流里
以 200 送出。

**创作准则不复制**：经 `book_generation` 门面共用整书管线那一份，避免两处陈词表各自漂移。

### 过程中撞红两次源码标准门禁，均改自己未放宽门禁

1. `test_live_consumers_use_book_runs_public_modules` — 我从 `book_runs.prompts._sections`
   （私有模块）导入。
2. `test_book_runs_private_cross_module_access_is_zero` — 改成 `book_generation.py` 引
   `_sections` 后，**book_runs 内部私有跨模块访问也必须为零**。

最终走 `prompts/__init__.py` 公开 `CRAFT_GUIDELINES` → `book_generation` 门面转出 → 续写引
门面。三段都无下划线，门禁绿。

## 刀 2 · 前端（PR #207）

**`planCursorInsertion`（新纯函数）**：续写落点已知，不走 LCS 猜。**刻意不复用
`planAnchoredInlineDiff`**——那条路会把新段跟上文做 diff，而 `buildPatchHunks` 会把段间空行
当可匹配单元吃进公共前缀，纯新增的 `afterLineNumber` 落到 `lineHunkOverlapsAnchor` 的容忍
窗口（**只有 0 行余量**）之外就被当 drift 静默丢弃。而「光标停在段末空行按键」正是续写最
典型的起手式，走老路 = 整段续写凭空消失。返回类型沿用 `AnchoredInlineDiff`，绿块渲染层
零改动。（丢弃行为在侦察阶段真跑 6 组数据实测过，测试里也钉了一条。）

**`useInlineChat` 加 continue 模式**，与 revise 共用整套 view zone / 接受写回：

- 拆出 `renderPlan`，`renderDiff` 退化为「先夹到锚定行再交给它」。
- 不设空行闸（revise 那道闸只对 revise 生效）；指令可留空 = 就接着写。
- 落点往上跳过连续空行：作者写完一段习惯连敲两下回车再停手。
- 接受后光标停在新段末尾而非锚定行。
- 流式区高度重排按帧节流：每 token 都 `layoutZone` 会让编辑器整页抖动。
- 新段一律另起段落（锚定行非空时补空行分隔），不改动作者已写下的任何一个字。

**前端不把 delta 拼起来当结果**：delta 只供观感，权威结果是 `done.text`。

`Ctrl+Shift+K` 已登记 `shortcuts.ts`（`scope: 'editor'`），否则快捷键护栏会真去按它而报红。

## 红线不变

后端不写盘。接受走既有 `writeAcceptedSuggestion` → `performGuardedWriteback`（快照 → 分支
推进 → 原子写 → 版本记录），与 Ctrl+K、补丁面板同一条路径。发起到接受之间作者改了文件的
话，`isInlineEditStale` 拦下整块写回。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `cd apps/api && uv run pytest` | **1104 passed / 3 skipped / 0 failed**（新增 29 条） |
| `cd apps/api && uv run ruff check .` | All checks passed |
| `npm --prefix apps/desktop/frontend run test` | **371 passed / 63 files**（新增 17 条） |
| `npm --prefix apps/desktop/frontend run typecheck` | 绿 |
| `pnpm.cmd lint` | 绿（`useInlineChat.ts` 走过一次 `prettier --write`） |
| `pnpm.cmd verify` | **全绿**，含 daily 档 sidecar 冒烟 + OpenAPI 零漂移 |
| `pnpm.cmd openapi` | 快照**纯新增 130 行，零删除** |

新增测试覆盖：增量剥离 6 种分块形状、上文取窗夹取与预算截断、掐重复开头、裁完整句、
**流式吐字后不得重连**、`stream_options` 400 自愈、SSE 端点证据链落库、422 在建流前、
模型只复述时报错而非回空补丁；前端插入计划 7 / 落点推导 4 / SSE 帧解析 6。

## 未联通 / 未验证的能力

- **真机观感全部未验，归 E2E-1**：流式跟手度、流式区（agent 色）到成品绿块（success 色）
  的视觉切换、绿块与红标的 CJK 同栈对齐、IME 输入法下回车发送、接受后光标落点。
- **真实 provider 的 SSE 帧格式未验**：测试用的是构造的 OpenAI 兼容帧。真实端点若有心跳帧
  或非标准分块，解析层的容错（跳过坏 JSON 而不打断流）尚未在真 key 下跑过。
- **`stream_options` 自愈路径未在真端点触发过**：不知道作者当前 provider 认不认这个字段。
- **续写质量未评估**：prompt 工艺来自公开工艺的移植，没有在真实稿件上做过质量对照。
  这一条只能靠作者 dogfood 提名下一刀。
- 诊断里的另两条结构性缺口（选区进不了循环、canon 记忆只读不可写）**本刀未动**，
  等真实写作摩擦提名。
