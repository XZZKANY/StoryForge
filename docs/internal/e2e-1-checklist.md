# E2E-1 真机 GUI 端到端首轮验收清单

> 蓝图里程碑 `arch-review-blueprint-2026-07-03.md` §110。**只能人工在真机跑**，Claude 无法代跑。
> 本清单一次性折叠 W1 / W2 / W5 / W7 + Alpha A2 + Agent loop 攒下的全部真机验收点；
> 结果同时充当 W4 手测冒烟与 W6 WS 重构的回归基线。
>
> **用法**：逐项做，勾 `[x]`，在「观察」写实际现象，失败项贴证据路径。跑完把结论摘要回填
> `.codex/verification-report.md`（命令 / 现象 / 未通项）。判定语言：`PASS` / `FAIL` / `N/A`。
>
> **前提**：验的是**当前 master 构建**。你正在重做 UI 壳子——UI chrome（Part 7）与部分 agent-loop
> 界面（流程树 / 会话列表 / 欢迎页）依赖当前壳子；若新壳改了这些，行为项照验、观感项以新壳为准并回跑。
> **BYO-key**：真 key 在 `%APPDATA%\com.storyforge.ide\llm-provider.json`（`.env.local` 的 key 已失效 401）。

---

## Part 0 — 构建与安装

- [ ] **0.1 构建安装包**：`pnpm desktop:build`（= `build:api-sidecar` 打冻结 sidecar exe → `tauri build` 出 NSIS）。
  产物：`apps/desktop/src-tauri/target/release/bundle/nsis/*.exe`。
  预期：构建绿、sidecar exe 已内嵌。观察：______  → `PASS/FAIL`
- [ ] **0.2 SHA256**：`Get-FileHash <installer>.exe -Algorithm SHA256`，记录哈希入分发说明。哈希：______
- [ ] **0.3（可选）干净 Windows + Defender/SmartScreen**：在默认 Defender 开启的干净机装一遍，验「更多信息 → 仍要运行」路径可通过；记录是否被拦、拦截文案。观察：______  → `PASS/FAIL/N/A`
- [ ] **0.4 安装**：双击 NSIS 装机，装到默认路径，启动。观察：______  → `PASS/FAIL`

---

## Part 1 — 起服 / 单机后端（Alpha A2 · W1 版本握手 · W2 schema）

- [ ] **1.1 sidecar 独立起服**：启动后 `/health/ready` 就绪（可看日志或稍等窗口可用）。sqlite 库自建于用户目录。观察：______  → `PASS/FAIL`
- [ ] **1.2 BYO-key 写盘换模型即生效**：改 `llm-provider.json` 的 `STORYFORGE_LLM_MODEL`（或 provider）→ 发一条 chat → 回话用的是新模型（对话可自报 / 看证据链 model 字段）。观察：______  → `PASS/FAIL`
- [ ] **1.3（W2）存量库换新 exe**：若有**旧版本装机遗留的 sqlite 库**，用新 exe 起服 → 起服成功、**左栏会话史完整无丢**（schema 由 alembic `upgrade head` 纳管，非重建）。无旧库则 `N/A`。观察：______  → `PASS/FAIL/N/A`
- [ ] **1.4（W1 版本握手）覆盖安装不串旧孤儿**：装一版 → 起着 → 覆盖安装**新版本** → 新前端起服时比对 `/health/ready` 的 `app_version` 不符 → **强杀旧孤儿 sidecar（taskkill）+ 拉起新 sidecar**。任务管理器确认无双 sidecar 残留、连的是新版。观察：______  → `PASS/FAIL`

---

## Part 2 — 对话式 Agent 基础（PR #46–#58）

- [ ] **2.1 打开项目**：打开一个本地小说项目 → 文件树 / Monaco 正常。观察：______  → `PASS/FAIL`
- [ ] **2.2 欢迎页首条 prompt**：欢迎页输入框直接发第一条 → 真发送、建会话、进对话。观察：______  → `PASS/FAIL`
- [ ] **2.3 会话历史列表**：左栏列出历史会话，可**切换**、可**新建**。观察：______  → `PASS/FAIL`
- [ ] **2.4 项目级会话（切文件不丢）**：对话中切换右侧打开的文件 → 消息**不丢**（会话绑项目非文件）。观察：______  → `PASS/FAIL`
- [ ] **2.5 工具循环流程树全事件驱动**：问一个需要读文件的问题（如「项目写到哪了」）→ 流程树**随后端 plan/tool_trace 事件逐步长出**（fs.list / fs.read 步骤显现），无预制骨架步骤。观察：______  → `PASS/FAIL`
- [ ] **2.6（W1 F11）关键词表下线**：发一句含旧关键词但意图是闲聊的自由文本（如「帮我看看这段冲突写得怎样，随便聊聊」）→ **走 chat.explain 工具循环**，不被中文关键词误判进固定审稿/修订管线。观察：______  → `PASS/FAIL`
- [ ] **2.7 方向键复验**：composer 里方向键 / 历史 prompt 导航正常（不误触发送 / 不卡）。观察：______  → `PASS/FAIL`

---

## Part 3 — 审稿 → 修订 → diff → 写回 → 版本（核心闭环 · W7 写回安全）

- [ ] **3.1 审稿**：打开一份正文 → 让 Agent 审稿 → **多视角 file.review**、issue 清单 + 稳定 issue id。观察：______  → `PASS/FAIL`
- [ ] **3.2 指定问题修订**：针对某条 issue 让 Agent 修订（file.revise）→ 生成 **proposed patch** → diff 面板可见 before/after。观察：______  → `PASS/FAIL`
- [ ] **3.3 diff 确认写回**：接受补丁 → 真实写回文件 → **版本记录**新增一条快照。观察：______  → `PASS/FAIL`
- [ ] **3.4 确认写回防重复**：同一补丁再点接受 / 重复触发 → 不重复生成、不重复写。观察：______  → `PASS/FAIL`
- [ ] **3.5 新文件起草**：让 Agent 起草一个新文件（file.create）→ proposed patch → **自动打开目标新文件** → 确认写回。观察：______  → `PASS/FAIL`
- [ ] **3.6（W7 ①）before 漂移拒写**：生成补丁后，**手动在编辑器改动该文件并保存** → 再点接受补丁 → **拒写**并提示「内容已变化，请重新生成 / 手动处理冲突」，不覆盖你的新改动。观察：______  → `PASS/FAIL`
- [ ] **3.7（W7 F26）切会话不污染**：发起一轮较慢的修订 run，**趁 run 未完成切到另一个会话** → 原 run 完成后**不强切回旧会话、不把回复串进当前会话、不弹旧会话的补丁建议**。观察：______  → `PASS/FAIL`
- [ ] **3.8（W7 F27 快照失败阻断）**：构造快照写入失败（如把项目版本快照目录设为只读 / 占满）→ 接受补丁 → **写回被阻断、正文未被覆盖**、报错可见（而非「快照悄悄失败但正文照写」）。难构造则记 `N/A` 并说明。观察：______  → `PASS/FAIL/N/A`
- [ ] **3.9（W7 F27 原子写）崩溃不留截断**：对一份较大正文触发写回，**写盘瞬间强杀进程**（多试几次）→ 重启后该文件**要么是旧内容要么是完整新内容，绝不是截断/空文件**。观察：______  → `PASS/FAIL`

---

## Part 4 — W1 live 循环控制（真机验收必撞点）

- [ ] **4.1 点停止**：一轮工具循环 run 进行中点「停止」→ **事件表无后续 tool_trace**（不再烧新一轮 BYO-key）、run 状态落 `stopped`、不 append/不 complete。用 `/api/agent-runs/<id>/events` 或界面确认。观察：______  → `PASS/FAIL`
- [ ] **4.2 点暂停**：进行中点「暂停」→ 状态 `paused`、循环收尾不 complete、可恢复。观察：______  → `PASS/FAIL`
- [ ] **4.3 超时转后台轮询**：run 进行中制造前端超时 / 断 socket（如临时断网再恢复）→ 前端**不硬 reject**，转后台**轮询事件表重建终态** → 最终仍取回结果。观察：______  → `PASS/FAIL`
- [ ] **4.4 起服收尸孤儿 run**：run 进行中**强杀 sidecar 进程** → 重启 → 之前非终态的 run 被**收尸为 `failed`（reason=process_restart）**，界面无僵尸「running」。观察：______  → `PASS/FAIL`

---

## Part 5 — W5 bookrun.start 装配（装机 exe 内可达）

- [ ] **5.1 bookrun.start prompt 装配**：若 UI/命令可触发 managed BookRun（后台工具）→ 起一个最小 run（deterministic/mock 或真 key 小规模）→ **prompt 装配不炸**（旧版会因 workflow 桥在装机 exe 内不存在而 `ModuleNotFound`，现随 `collect_submodules('app')` 打包，起服日志应见 `prompt_layer_bundled`）。
  无 UI 入口则记 `N/A`——packaged sidecar-smoke 已证 exe 内装配可达（`分层 prompt 构建器已随 exe 打包`）。观察：______  → `PASS/FAIL/N/A`

---

## Part 6 — 循环内一致性工具（advisory，非质量验收）

- [ ] **6.1 project.consistency（机械观察）**：触发一致性观察 → 出机械观察信号（不下结论）。观察：______  → `PASS/FAIL/N/A`
- [ ] **6.2 project.deep_consistency（深度一致性）**：本地人物/设定文件作 Character Bible → 深度一致性 → 出 **advisory issue**（仅参考信号，不是质量判定；隐性/跨章召回率未验，别当验收结论）。观察：______  → `PASS/FAIL/N/A`

---

## Part 7 — UI 观感（PR #42；正在重做壳子则以新壳为准）

- [ ] **7.1 明暗双主题**：切换主题 → 全局 `data-theme` 生效、**Monaco 跟随**换色。观察：______  → `PASS/FAIL/N/A`
- [ ] **7.2 单色语义 token**：hover/elevated 等状态用 token 不写死 hex，观感一致。观察：______  → `PASS/FAIL/N/A`

---

## 收尾 — 门禁判定

- [ ] **G.1** Part 1–4 全 `PASS`（起服 / 对话 / 写回闭环 / live 控制是硬门禁）。
- [ ] **G.2** 失败项已记录现象 + 证据路径，可复现。
- [ ] **G.3** 结论摘要回填 `.codex/verification-report.md`（含 SHA256、未通项、环境）。
- [ ] **G.4** 若 Part 1–4 全绿：E2E-1 首轮验收 **PASS** → 解锁 W6（WS 契约化 + ToolSpec + 权限四轨 F25/F24）。

**总判定**：`PASS / FAIL（附未通项）` = ______
