# StoryForge 当前阶段事实源

生成时间：2026-06-23 00:33:51 +08:00

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

StoryForge 当前处于真实长程验收整改阶段；Cursor for Fiction Phase 1 最小闭环和 Phase 2 Agent 协作增强均已通过本地验证。产品契约为：StoryForge = Cursor for Fiction，`apps/desktop` 是唯一主体验；`pnpm dev` / `pnpm desktop:dev` 启动桌面 IDE 主体验；`apps/web` 已退场，不再作为维护、调试、兼容或契约验证入口。

Desktop IDE Agent 验收链路固定为：本地文件审稿 -> 修订 -> diff / patch 审阅 -> 冲突保护 -> 用户确认真实写回 -> 版本记录与 author-loop 记录。长篇、短篇、章节和修订输出统一表达为 Writing Run / 写作任务；BookRun 只作为 managed full-book run 的内部兼容实现，保留长程生成、审计和导出能力，但不作为主产品控制台。

真实 LLM 1 章、3 章和 10 章 smoke 已完成脱敏验证，10 章 smoke 已通过人工通读。一次 30 章真实长程运行已经完成，链路、Markdown、EPUB 和审计报告导出成立，但人工通读结论为“退回重跑”。因此当前只能证明真实长程运行链路可达，不能宣称真实 3-5 万字长程质量验收通过，也不能宣称稳定生产级长篇生产闭环。

## 已完成的能力边界

- **managed Writing Run / BookRun 兼容实现**：本地 deterministic/mock provider 可从 Blueprint 章节计划驱动 managed full-book run，并导出 `book.md` 与 `audit_report.json`；当前 BookRun 兼容实现已具备 checkpoint resume、token/时间/章节预算暂停、provider 连续降级暂停和成本摘要，但不作为主产品入口。
- **长程质量增强**：Story Memory 注入/抽取、Character Bible、Timeline Guard、Style Guard、章节 pacing、叙事 gate、思维链泄漏剥离和审计页已纳入本地测试或真实 run 验证。
- **真实长程链路证据**：30 章真实长程完成运行与制品导出，但人工通读退回重跑；该证据不得外推为质量通过。
- **出版制品**：BookRun 可生成 Markdown、EPUB 与审计报告制品索引；S3/MinIO 真路径已有 client 层建桶、上传、presigned URL 集成测试证据，导出失败仍可降级到 `memory://`。
- **Desktop IDE 主体验**：`apps/desktop` 是唯一主体验；Tauri/Vite/React/Monaco 桌面 IDE 已形成项目库、文件树、编辑器、版本记录、命令面板、无边框窗口和 Rust `get_api_config` 注入。
- **Desktop IDE Agent Phase 1**：后端 IDE Agent Orchestrator 已支持自然语言意图路由、真实 LLM 文件修订、多视角 file.review 推理缝、稳定 issue id、范围控制、待确认 proposed patch 和确认写回防重复生成；前端已接入对话、步骤树、待确认 diff 和本地确认写回事件。
- **Desktop IDE Agent Phase 2**：Agent WebSocket 支持 `agent_run_started` / `agent_step` / `tool_trace` / `agent_result` / `error` 事件流；Desktop 前端支持显式上下文选择、pin/unpin、预算和缺失提示；审稿 issue 支持多选、按 category 过滤和定向修订；`PatchReviewPanel` 展示 patch id、文件、增删行、模型、session 和 issue scope，并在接受前阻止旧 patch 覆盖已变化稿件；写回后的 `.storyforge/versions` 与 `.storyforge/author-loop` 可追溯 patch id、assistant session、issue ids 和 context files；managed Writing Run 以预检/确认方式投影轻量进度，不新增 BookRun 主控制台。

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

30 章退回的主要阻塞包括测试痕迹残留、章节结构模板化、重复表达、人物称谓混乱、17/18 章时间线冲突、线索膨胀和结尾收束不足。后续修复中又通过真实 run 与 golden 回测定位并修复了 recap 膨胀、计数失真、collapse_judge 误报、S3 bucket 缺失和 reasoning token 泄漏等工程问题；这些修复改善链路可信度，但仍不能替代新一轮长程人工通读。

## 当前门禁状态

- `pnpm.cmd lint`：2026-06-20 本轮已通过；仍有 4 个非阻断 warning，分别为 IDE prototype/use-fetch 的 hook warning 和 `home-page.test.tsx` 未使用变量 warning。
- Desktop frontend typecheck/unit/smoke：2026-06-23 本轮通过；`npm --prefix apps/desktop/frontend run test` 为 20 passed。
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py tests/test_ide_run_events.py -q`：2026-06-23 本轮 24 passed，覆盖 IDE Agent 编排、事件流、审稿范围控制、BookRun 预检/确认和 run events。
- `npm --prefix apps/desktop/frontend run verify:agent-conversation`：2026-06-23 本轮通过，覆盖流式事件、上下文 pin/budget、Agent payload 和 issue 多选修订。
- `node apps/desktop/scripts/verify-tauri-smoke.mjs`：2026-06-23 本轮通过，覆盖真实 Tauri proposed patch 未确认不写盘、拒绝不写盘、旧 patch 冲突保护、确认写回、版本 Agent meta 和 author-loop meta。
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`：2026-06-23 本轮通过。
- 上一次记录的远端 `master` E2E run `26944063055`（2026-06-04T09:45:05Z，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`）已成功；这是已记录证据，不代表 2026-06-20 最新远端状态。

## 仍未完成的验收项

- 基于 30 章人工通读意见整改后，重跑真实 3-5 万字长程。
- 对新一轮长程产物执行 Markdown、EPUB、`audit_report.json` 登记核对和人工通读。
- 将人工通读记录写入 `.codex/verification-report.md`，并确认无明显人物、世界观或时间线矛盾。
- 视需要补齐生产级对象存储签名下载、多租户认证、真实 provider 长会话探针和 Desktop 内更长会话交互打磨。

## 禁止宣称范围

在上述未完成项补齐前，只能宣称 StoryForge 已具备本地可验证的最小整书闭环、真实 LLM 10 章 smoke 验收证据、一次 30 章真实长程链路与制品导出证据，以及 Cursor for Fiction Phase 1/Phase 2 的 Desktop IDE Agent 本地验收证据；不能宣称真实 3-5 万字长程质量验收通过，也不能宣称具备稳定生产级长篇生产闭环。不得把 `apps/web` 或 BookRun 控制台描述为主产品入口。

## 证据源

- `.codex/verification-report.md`：本地测试、红绿记录、真实 LLM 证据、Desktop IDE Agent 记录和未联通能力。
- `README.md`：面向使用者的能力边界摘要。
- `docs/internal/TODO.md`：当前下一步执行入口。
- `docs/internal/dev-plan.md`：Phase 9 历史计划和完成判定。
