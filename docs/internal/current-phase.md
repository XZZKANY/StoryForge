# StoryForge 当前阶段事实源

生成时间：2026-07-02 12:00:00 +08:00

## 事实源职责矩阵

| 文件 | 职责 | 更新规则 |
| --- | --- | --- |
| `docs/internal/current-phase.md` | 当前阶段唯一事实源，记录最新状态、已完成能力、未完成门禁和禁止宣称范围。 | 真实 LLM 长程、人工通读、Desktop IDE 主链路或发布门禁状态变化时必须先更新。 |
| `README.md` | 面向使用者的入口摘要，保留能力边界、本地运行入口和关键证据指针。 | 只摘要当前状态，不复制完整门禁细节；当前事实以 `docs/internal/current-phase.md` 为准。 |
| `docs/internal/TODO.md` | 当前下一步执行入口，记录剩余门禁、优先级和本地验证命令。 | 只保留下一步动作，不承载完整项目总览。 |
| `docs/internal/PROJECT_SUMMARY.md` | 项目总览和验证状态摘要，面向交接和健康概览。 | 同步关键验证状态，但不替代当前阶段判定。 |
| `docs/internal/dev-plan.md` | 历史计划和阶段 DoD，保留 Phase 9 任务拆解与完成条件。 | 可记录阶段完成证据，但不能单独作为最新状态来源。 |
| `docs/superpowers/plans/*` | 历史实施计划归档，保留设计和执行语境。 | 只作追溯参考，不参与当前状态判定。 |

推荐读取顺序：先读 `docs/internal/current-phase.md`，再读 `docs/internal/TODO.md` 获取下一步，按需读 `docs/internal/PROJECT_SUMMARY.md`、`README.md` 和 `.codex/verification-report.md`。

## 当前阶段

StoryForge 当前处于 Desktop 对话式 Agent 与私测 Alpha 收口阶段（当前项目真相边界：2026-07-02）。产品契约为：StoryForge = Cursor for Fiction（2026-06-24 拍板：作者辅助 IDE，不是自动长篇生产器）；`apps/desktop` 是唯一主体验；`pnpm dev` / `pnpm desktop:dev` 启动桌面 IDE 主体验；`apps/web` 已退场（2026-06-21 已完成退场收口），不再作为维护、调试、兼容或契约验证入口。2026-06-30 起交互中枢定向为 Claude Code/Codex 式对话 agent：批量自动整书不再是主线，BookRun 降级为 managed Writing Run 的内部兼容实现与后台工具。

2026-07-01 以来已合并的收口（PR #42-#46）：单色调明暗双主题 UI 改版；私测 Alpha 单机后端（PyInstaller sidecar exe 独立起服、BYO-key、`llm-provider.json` 写盘换模型即生效、NSIS 安装包内嵌 sidecar）；中间交互区收口为对话式 Agent，`chat.explain` 从演示 echo 接上真·LLM，对话从文件级解绑为项目级会话。

2026-07-02 已合并（PR #47-#51）：事实源刷新与 phase9 红测修复；左栏会话历史列表接 `GET /api/assistant/sessions`（`assistant_sessions` 增 `project_path`）+ 欢迎页输入框接真发送；Agent loop 三步落地——path-scoped 只读 fs 工具（`fs.list` / `fs.read` / `fs.search`，越界防护）、chat 自由文本走 LLM 工具循环（最多 8 轮、工具输出预算、失败回落单轮、逐调用证据链）、前端流程树全事件驱动（删预制骨架步骤）。注意边界：工具循环入口是 chat 自由文本；审稿 / 修订 / 新文件起草 / 一致性观察已作为循环内工具并入（`file.review` / `file.revise` / `file.create` / `project.consistency`，一次对话最多一个待确认补丁，写回红线不变），显式按钮路径仍走固定管线（可回退）；chapter.review / bookrun.* 绑定 DB 实体且 BookRun 已定位后台工具，不并入循环（2026-07-02 记为决定，如需可再议）；真·LLM tool-calling headless 实跑已于 2026-07-02 通过（deepseek-v4-flash，证据 `.codex/real-llm-agent-loop-20260702-165907` 等四个目录），真机 Tauri GUI 多轮渲染观感未验。

Desktop IDE Agent 验收链路固定为：本地文件审稿 -> 修订 -> diff / patch 审阅 -> 冲突保护 -> 用户确认真实写回 -> 版本记录与 author-loop 记录。长篇、短篇、章节和修订输出统一表达为 Writing Run / 写作任务；BookRun 只作为 managed full-book run 的内部兼容实现，保留长程生成、审计和导出能力，但不作为主产品控制台。

真实 LLM 1 章、3 章和 10 章 smoke 已完成脱敏验证，10 章 smoke 已通过人工通读。一次 30 章真实长程运行已经完成，链路、Markdown、EPUB 和审计报告导出成立，但人工通读结论为“退回重跑”。因此当前只能证明真实长程运行链路可达，不能宣称真实 3-5 万字长程质量验收通过，也不能宣称稳定生产级长篇生产闭环。2026-06-30 的 Q9 16 章真实跑（`.codex/real-llm-q9-flash-16ch-20260630-155026`）定位并修复了门禁丢章四根因（字数容差、judge 误标、grounding 部分提交、缺章护栏，PR #40/#41），抢救为完整 16 章并通过人工通读；该证据说明门禁链路修复有效，但不替代 3-5 万字长程质量验收。

当前架构重构总计划已完成当前合理边界：`agent_runs/runtime.py`、BookRun/Judge/StoryMemory/IDE/Studio/Retrieval/Workflow/Prompt/Desktop 客户端等 god-file 拆分不再作为当前主线待办。后续只接受由真实行为缺口或新护栏驱动的小步结构调整，不再做纯机械拆分。

## 已完成的能力边界

- **managed Writing Run / BookRun 兼容实现**：本地 deterministic/mock provider 可从 Blueprint 章节计划驱动 managed full-book run，并导出 `book.md` 与 `audit_report.json`；当前 BookRun 兼容实现已具备 checkpoint resume、token/时间/章节预算暂停、provider 连续降级暂停和成本摘要，定位为后台工具，不作为主产品入口。
- **长程质量增强**：Story Memory 注入/抽取、Character Bible、Timeline Guard、Style Guard、章节 pacing、叙事 gate、思维链泄漏剥离和审计页已纳入本地测试或真实 run 验证。
- **真实长程链路证据**：30 章真实长程完成运行与制品导出，但人工通读退回重跑；Q9 16 章真实跑完成门禁丢章修复并通过人工通读；上述证据不得外推为 3-5 万字长程质量通过。
- **出版制品**：BookRun 可生成 Markdown、EPUB 与审计报告制品索引；S3/MinIO 真路径已有 client 层建桶、上传、presigned URL 集成测试证据，导出失败仍可降级到 `memory://`。
- **Desktop IDE 主体验**：`apps/desktop` 是唯一主体验；Tauri/Vite/React/Monaco 桌面 IDE 已形成项目库、文件树、编辑器、版本记录、命令面板、无边框窗口和 Rust `get_api_config` 注入；2026-07-01 完成单色语义 token + 明暗双主题改版。
- **Desktop IDE Agent Phase 1**：后端 IDE Agent Orchestrator 已支持自然语言意图路由、真实 LLM 文件修订、多视角 file.review 推理缝、稳定 issue id、范围控制、待确认 proposed patch 和确认写回防重复生成；前端已接入对话、步骤树、待确认 diff 和本地确认写回事件。
- **Desktop IDE Agent Phase 2**：Agent WebSocket 支持 `agent_run_started` / `agent_step` / `tool_trace` / `agent_result` / `error` 事件流；Desktop 前端支持显式上下文选择、pin/unpin、预算和缺失提示；`PatchReviewPanel` 展示 patch id、文件、增删行、模型、session 和 issue scope，并在接受前阻止旧 patch 覆盖已变化稿件；写回后的 `.storyforge/versions` 与 `.storyforge/author-loop` 可追溯 patch id、assistant session、issue ids 和 context files。
- **Desktop 对话式 Agent（2026-07-01，PR #46）**：对话为项目级会话（按项目路径存 session，切换文件不丢对话，消息持久化于 `assistant_sessions` / `assistant_messages`）；`chat.explain` 调 `assistant_service.chat_reply` 走真·LLM 并落 `assistant.chat` 工具调用证据链，LLM 未配置或失败时明确回话、不伪造；勾选式 issue 面板已删除，修订呈现收敛为 PatchReviewPanel diff 确认。
- **私测 Alpha 单机后端（2026-07-01，PR #43/#44）**：sidecar exe 可脱离 docker/venv 独立起服（sqlite 自建 45 表、health ready）；BYO-key；`llm-provider.json` 写盘即生效、无需重启；`tauri build` NSIS 安装包正确内嵌 sidecar，release 默认拉起打包后端。
- **会话历史与欢迎页接真（2026-07-02，PR #48）**：左栏展开项目即从 `GET /api/assistant/sessions?project_path=` 拉真实会话历史列表，可切换 / 新建会话；欢迎页中央输入框绑定 state 真发送，打开项目后自动发出首条 prompt。
- **Agent loop（2026-07-02，PR #49/#50/#51）**：path-scoped 只读 `fs.list` / `fs.read` / `fs.search`（`../`、绝对路径、符号链接逃逸一律拒绝，无写接口）；chat 自由文本走 LLM 工具循环（OpenAI tool-calling，最多 8 轮 + 60K 工具输出预算，未知工具 / 参数错误 / 工具异常作为观测反馈不中断，首轮失败静默回落单轮，逐调用落 `assistant_tool_calls` 证据）；前端流程树全事件驱动，预制骨架步骤已删除；`verify-agent-conversation` 真浏览器门禁修复并复绿。写回红线不变：后端不写项目文件，修订仍走 proposed patch 前端确认。
- **审稿 / 修订并入工具循环（2026-07-02）**：`file.review` / `file.revise` 作为循环内工具（LLM 自主决策调用）；后端从盘上按 path-scoped 读稿，LLM 传入的 content / file_path 一律丢弃；审稿反馈只回灌精简 issue 要点、整包 report 落 artifact；修订生成待确认补丁即挂 `permission.confirm` 暂停（`permission_required` 事件、`writeback_blocked_until_user_confirms`），一次对话最多一个待确认补丁，修订反馈不携带全文防模型把未确认补丁当已写回；前端 PatchReviewPanel 契约复用、零前端改动。
- **一致性观察工具挂进循环（2026-07-02）**：`project.consistency` 作为循环内工具（Q1-Q8 一致性能力工具化第一步）——给定人物 / 设定词条返回各文件出现分布（含缺席词条）、全书时间标记罗列、跨文件重复子句；path-scoped 只读、纯机械观察不下「冲突 / 违规」结论，由 LLM 结合原文抽查推理结论，避免未验证误报率的硬判定误导作者。
- **写作任务循环化：新文件起草（2026-07-02）**：`file.create` 作为循环内工具——为尚不存在的文件起草初稿（`assistant.draft` 走真·LLM + 证据链），产出 `before=""` 的待确认补丁（`created_by_tool=file.create`，路径越界 / 已存在一律拒绝），与 `file.revise` 共享「一次对话一个补丁」守卫与 `permission.confirm` 暂停；前端配套：Agent 补丁指向未打开（或尚不存在）文件时 App 自动打开目标文件、补丁经待领取缓冲进入 PatchReviewPanel（同时修复了循环修订未打开文件时补丁不显示的缺口），编辑器对不存在文件按新文件空内容打开，写盘时 Tauri 自动建父目录。

## 真实 LLM 证据

真实 provider 配置必须来自本机私有运行时环境变量，不要把 API key、token、secret 或 password 写入仓库、日志或验证报告。

```powershell
cd apps/api
uv run python -m app.domains.book_runs.book_generation --chapter-count 1 --token-budget 8000
uv run python -m app.domains.book_runs.book_generation --chapter-count 3 --token-budget 24000
```

已落盘的脱敏验证样例：

- 1 章 smoke：`.codex/real-llm-1ch-20260603-142925`，BookRun completed，已补人工通读。
- 3 章 smoke：`.codex/real-llm-3ch-20260603-173932`，BookRun completed，实际 3 章，tokens_used=14158，`book.md` 与 `audit_report.json` 已落盘，人工通读完成。
- 10 章 smoke：`.codex/real-llm-10ch-20260604-110831`，BookRun completed，实际 10 章，tokens_used=145668，10 章 smoke 人工通读完成，最终门禁 `gate: pass_for_real_10ch_final_acceptance`。
- 30 章长程：`.codex/real-llm-30ch-mimo25pro-20260611-192356`，运行链路与制品导出完成，人工通读退回重跑。
- Q9 16 章：`.codex/real-llm-q9-flash-16ch-20260630-155026`，门禁丢章四根因修复后抢救为完整 16 章，人工通读通过（评价“还行”）。
- Agent loop 实跑：`.codex/real-llm-agent-loop-20260702-165907`，真实 WS + deepseek-v4-flash：4 轮 / 4 工具与 2 轮 / 3 工具（含模型自主正则检索）回答全部接地、行号引用真实；事件渐进到达；`assistant_tool_calls` 证据链完整；另含无效 key 401 下回落单轮、如实报错不伪造的回落路径实证。
- 循环内审稿 / 修订实跑：`.codex/real-llm-agent-loop-intents-20260702`，单条消息 3 轮 / 3 工具（file.review → fs.read → file.revise，55s）；补丁待确认、run 暂停在 permission.confirm、跑完盘上原文未动（写回红线实证）；模型回话明确「确认后才会写盘」。真机 GUI 补丁确认观感不在本证据范围。
- 循环内一致性观察实跑：`.codex/real-llm-agent-loop-consistency-20260702`，单条消息 5 轮 / 7 工具（读设定 → project.consistency → 回原文抽查，27.8s）；正确区分「裴少卿 / 裴砚」为合理称谓分工而非冲突误报，时间线与重复扫描结论经人工核对属实、无伪造问题。
- 循环内新文件起草实跑：`.codex/real-llm-agent-loop-create-20260702`，单条消息 8 轮 / 12 工具（读大纲设定前两章 → file.create 起草 488 字第三章 → 自主 project.consistency 复核，52.1s）；守住大纲约束（后幕身份未提前揭晓）；双重红线实证——盘上不落新文件，且模型两次尝试读未确认新文件均被拒绝。真机 GUI 自动打开新文件与补丁确认观感不在本证据范围。

30 章退回的主要阻塞包括测试痕迹残留、章节结构模板化、重复表达、人物称谓混乱、17/18 章时间线冲突、线索膨胀和结尾收束不足。后续修复中又通过真实 run 与 golden 回测定位并修复了 recap 膨胀、计数失真、collapse_judge 误报、S3 bucket 缺失和 reasoning token 泄漏等工程问题；这些修复改善链路可信度，但仍不能替代新一轮长程人工通读。

## 当前门禁状态

- `pnpm.cmd lint`：2026-07-01 PR #46 收口时通过（0 error，prettier 通过；剩 `Editor.tsx` 1 个先前存在的 exhaustive-deps warning）。
- Desktop frontend typecheck/unit/smoke：2026-07-01 通过；`npm --prefix apps/desktop/frontend run test` 为 93 passed，typecheck 干净。
- `cd apps/api && uv run pytest`：2026-07-01 全量 767 passed / 3 skipped / 1 failed；唯一失败为 `test_phase9_fact_sources.py` 将运维手册“更新时间”日期钉死导致的文档日期漂移，2026-07-02 已改为日期格式校验并复绿。
- `npm --prefix apps/desktop/frontend run verify:agent-conversation`：2026-06-23 本轮通过，覆盖流式事件、上下文 pin/budget、Agent payload 和 issue 多选修订。
- `node apps/desktop/scripts/verify-tauri-smoke.mjs`：2026-06-23 本轮通过，覆盖真实 Tauri proposed patch 未确认不写盘、拒绝不写盘、旧 patch 冲突保护、确认写回、版本 Agent meta 和 author-loop meta。
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`：2026-06-23 本轮通过；2026-07-01 `tauri build` release 全链路通过（NSIS 安装包产出）。
- 上一次记录的远端 `master` E2E run `26944063055`（2026-06-04T09:45:05Z，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`）已成功；这是已记录证据，不代表 2026-06-20 最新远端状态。

## 仍未完成的验收项

- 跑通完整真实 Tauri 桌面端到端（现在入口是 NSIS 安装包双击装机路径）：打开项目 -> 对话（含工具循环流程树、会话历史列表、欢迎页首条 prompt、方向键复验）-> Agent 审稿 -> 指定问题修订 -> diff 确认 -> 用户确认真实写回 -> 版本记录。现有 smoke 已覆盖写回护栏和版本元数据，但不能替代人工桌面端到端验收。
- Agent loop 收口：深度一致性（Character Bible / 语义 judge）做成工具循环内工具——语义 judge 现直读 `os.getenv`、不吃 `llm-provider.json` 覆盖链，需先迁 `resolved_llm_env` 再挂循环；chapter.review / bookrun.* 维持固定管线与后台定位不进循环（如需可再议）；真机 GUI 多轮渲染、自动打开新文件与补丁确认观感随桌面端到端复验（审稿 / 修订 / 起草 / 一致性观察的循环内 headless 实跑均已通过，见真实 LLM 证据）。
- 质量轨（后台）：基于 30 章人工通读意见与 Q9 门禁修复重跑真实 3-5 万字长程并执行人工盲评（DoD 见下）；对新一轮长程产物执行 Markdown、EPUB、`audit_report.json` 登记核对，人工通读记录写入 `.codex/verification-report.md`；Q1-Q8 一致性能力逐步做成 agent 工具挂进循环。
- 视需要补齐生产级对象存储签名下载、多租户认证、真实 provider 长会话探针和 Desktop 内更长会话交互打磨。

## 禁止宣称范围

在上述未完成项补齐前，只能宣称 StoryForge 已具备本地可验证的最小整书闭环、真实 LLM 10 章 smoke 验收证据、一次 30 章真实长程链路与制品导出证据、Q9 16 章门禁修复与人工通读证据，以及 Cursor for Fiction Phase 1/Phase 2、对话式 Agent 收口与 Agent loop（chat 工具循环）的 Desktop 本地验收证据；不能宣称真实 3-5 万字长程质量验收通过，也不能宣称具备稳定生产级长篇生产闭环。chat 工具循环、循环内审稿 / 修订 / 新文件起草与一致性观察已有真·LLM headless 实跑证据（单 provider），但不得据此宣称真机桌面端多轮渲染、自动打开新文件与补丁确认已验收；chapter.review / bookrun.* 未循环化（已记为决定而非缺口）；`project.consistency` 只产出机械观察信号，不得宣称其具备语义一致性判定能力；不得把 `apps/web` 或 BookRun 控制台描述为主产品入口。

## 证据源

- `.codex/verification-report.md`：本地测试、红绿记录、真实 LLM 证据、Desktop IDE Agent 记录和未联通能力。
- `README.md`：面向使用者的能力边界摘要。
- `docs/internal/TODO.md`：当前下一步执行入口。
- `docs/internal/dev-plan.md`：Phase 9 历史计划和完成判定。

## 下一步计划与重跑 DoD（2026-06-29 锚点，2026-07-02 更新）

完整下一步路线图见 `docs/internal/next-step-plan.md`（2026-07-02 起产品轨顺序改为：对话体验收口 -> Agent loop -> 真机安装包端到端；质量轨保持后台）。30 章退回的结构化诊断见 `.codex/real-llm-30ch-mimo25pro-20260611-192356/readthrough-findings.md`。

下一轮真实长程**重跑验收 DoD**（固化判据，避免再次只做链路演示）：

- 规模：约 4 万字 / 16-18 章 / 每章 2000-2500 字 band。
- 题材：换非 demo 题材（不得沿用林岚/灯塔/审计链）。
- 入口：走 CLI 长程路径，不走 `le=6` 的 HTTP `/start` 路径。
- 盲评：`ManualReadReview(blind=true)`，评审人不看自动分，按 6 维（narrative_quality / character_consistency / world_consistency / timeline_consistency / style_consistency / system_reliability）各 1-5 评分。
- 通过判据：每维 ≥3 且 overall ≥3.5 且零硬失败（时间线矛盾 / 测试痕迹残留 / 缺章 / 结尾未收束 / 未回收伏笔任一即退回）。
- 制品：`book.md` / `book.epub` / `audit_report.json` / `summary.json` / `run-metadata.json` 附 sha256 并校验完整性。
- 证据：人工盲评结论写入 `.codex/verification-report.md`；结论以人工通读为准，不以 golden/judge pass 替代。

**重跑前根因修复状态（2026-07-02）**：真实逐章事实抽取、去 demo premise、收紧 fast-judge、`_call_llm` 有界重试均有第一版本地验证；门禁丢章四根因（字数容差、judge 误标、grounding 部分提交、缺章护栏）已在 Q9 16 章真实跑中修复并验证。仍需新一轮 3-5 万字长程 + 人工盲评做最终判定。

**本轮不交付的已知缺口**（登记备查，非遗漏）：多人实时协作、多租户认证、生产级对象存储签名下载、完整 Studio 编排器、持久化异步任务队列。
