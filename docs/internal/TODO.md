# StoryForge 待办清单

生成时间：2026-07-02 12:00:00 +08:00

## 当前执行入口

StoryForge 当前处于 Desktop 对话式 Agent 与私测 Alpha 收口阶段。产品契约为：StoryForge = Cursor for Fiction（作者辅助 IDE），`apps/desktop` 是唯一主体验；默认开发入口为 `pnpm dev` / `pnpm desktop:dev`；`apps/web` 已退场（2026-06-21 已完成 `apps/web` 退场收口）。2026-06-30 拍板：交互中枢为 Claude Code/Codex 式对话 agent，批量自动整书不再是主线；长篇、短篇、章节和修订输出统一表达为 Writing Run / 写作任务；BookRun 是 managed full-book run 的内部兼容实现与后台工具，不是主产品控制台。

真实 LLM 1/3/10 章 smoke 已通过记录，其中 10 章 smoke 已完成人工通读；一次 30 章真实长程已跑完并导出制品，但人工通读结论为“退回重跑”；2026-06-30 Q9 16 章真实跑修复门禁丢章四根因并抢救为完整 16 章、人工通读通过。2026-07-01 已合并：UI 单色改版（PR #42）、私测 Alpha 单机 sidecar + BYO-key + NSIS（PR #43/#44）、对话式 Agent + `chat.explain` 接真·LLM（PR #46）。2026-07-02 已合并：事实源刷新（PR #47）；左栏会话历史列表接真后端 + 欢迎页输入框接真发送（PR #48）；Agent loop 三步落地——path-scoped 只读 fs 工具、chat 自由文本 LLM 工具循环、前端流程树全事件驱动（PR #49/#50/#51）。

## 当前事实边界

- 30 章真实长程证据目录：`.codex/real-llm-30ch-mimo25pro-20260611-192356`；运行链路、Markdown、EPUB 和审计报告导出完成，但人工通读退回重跑。
- 30 章退回阻塞：测试痕迹残留、章节结构模板化、重复表达、人物称谓混乱、17/18 章时间线冲突、线索膨胀和结尾收束不足。
- 后续工程修复已覆盖 recap 膨胀、计数失真、collapse_judge 误报、S3 bucket 缺失和 reasoning token 泄漏；Q9 16 章真实跑又修复了门禁丢章四根因（字数容差、judge 误标、grounding 部分提交、缺章护栏）；这些修复需要通过新一轮长程运行与人工通读验证。
- Desktop IDE Agent 已支持后端意图源收口、真实文件修订、多视角审稿、稳定 issue id、修订范围控制、proposed patch、确认写回防重复生成；Tauri 写回护栏已有脚本级 smoke 证据，但完整人工桌面端到端仍待执行。
- 对话式 Agent 现状（2026-07-02，PR #46-#51）：`chat.explain` 已接真·LLM，对话为项目级会话、切换文件不丢；左栏会话历史列表与欢迎页输入框已接真；chat 自由文本走 LLM 工具循环（path-scoped 只读 `fs.list` / `fs.read` / `fs.search`，最多 8 轮，首轮失败回落单轮），前端流程树全事件驱动、预制骨架步骤已删。边界：工具循环只覆盖 chat 自由文本，审稿 / 修订 / 写作任务等显式 intent 仍走固定管线；真·LLM tool-calling headless 实跑已通过（2026-07-02，deepseek-v4-flash，证据 `.codex/real-llm-agent-loop-20260702-165907`，含回落路径实证），真机 GUI 渲染观感未验；写回红线不变，仍走 proposed patch 前端确认。
- 私测 Alpha（2026-07-01，PR #43/#44）：sidecar exe 独立起服、`llm-provider.json` 写盘换模型即生效、NSIS 安装包内嵌 sidecar 均已本机验证；真机 GUI 双击装机端到端未验。
- 第一阶段核心组件链路已经通过本地验证：本地文件审稿 -> 修订 -> diff 确认 -> 写回护栏 -> 版本记录；完整真实 Tauri 桌面端到端仍列为下一步门禁。
- `apps/web` 不再作为主体验、维护入口、调试入口、兼容入口或契约验证入口；BookRun 控制台也不作为主产品入口。

## 下一步优先级

1. Agent loop 显式 intent 并入工具循环：把审稿 / 修订等显式 intent 渐进并入循环（file.review / file.revise 作为循环内工具）；真机 GUI 多轮渲染观感随桌面端到端复验（headless 实跑已通过）。
2. 跑真实 Tauri 桌面端到端（NSIS 安装包双击装机路径）：打开项目 -> 对话（含工具循环流程树、会话历史列表、欢迎页首条 prompt、方向键复验）-> Agent 审稿 -> 指定问题修订 -> diff 确认 -> 真实写回 -> 版本记录。
3. 质量轨（后台）：基于 30 章人工通读意见与 Q9 门禁修复整理策略，重跑真实 3-5 万字长程并执行人工盲评；新一轮长程的 Markdown、EPUB、`audit_report.json`、summary 和人工盲评写入 `.codex/verification-report.md`；Q1-Q8 一致性能力逐步做成 agent 工具挂进循环。
4. 长程通过后，同步 `README.md`、`docs/internal/current-phase.md`、`docs/internal/PROJECT_SUMMARY.md` 和 `docs/internal/dev-plan.md` 的完成边界。

## 本地验证入口

常用本地门禁：

```powershell
cd D:/StoryForge
pnpm.cmd lint
npm --prefix apps/desktop/frontend run typecheck
npm --prefix apps/desktop/frontend run test
pnpm verify
pnpm e2e
pnpm test
pnpm openapi
```

Desktop IDE Agent 定向验证：

```powershell
cd D:/StoryForge/apps/api
uv run pytest tests/test_ide_agent_orchestrator.py -q

cd D:/StoryForge/apps/desktop/frontend
pnpm.cmd run typecheck
pnpm.cmd run test
pnpm.cmd run verify:smoke
pnpm.cmd run verify:agent-conversation
```

真实 LLM 入口只在私有运行时变量已设置时执行，不读取 `.env`，不把 provider 配置或 token 写入仓库：

```powershell
cd D:/StoryForge/apps/api
uv run python -m app.domains.book_runs.book_generation --chapter-count 1 --token-budget 8000
uv run python -m app.domains.book_runs.book_generation --chapter-count 3 --token-budget 24000
```

## 事实来源

- 当前状态以 `docs/internal/current-phase.md` 为准；TODO 只保留下一步执行入口，不作为完整项目总览或历史计划来源。
- `README.md`
- `docs/internal/current-phase.md`
- `docs/internal/PROJECT_SUMMARY.md`
- `.codex/verification-report.md`
- `.codex/operations-log.md`
