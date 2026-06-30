# StoryForge 待办清单

生成时间：2026-06-23 00:33:51 +08:00

## 当前执行入口

StoryForge 当前处于真实长程验收整改与 Desktop IDE Agent 收口阶段；Cursor for Fiction Phase 1 最小闭环和 Phase 2 Agent 协作增强已通过本地验证。产品契约为：StoryForge = Cursor for Fiction，`apps/desktop` 是唯一主体验；默认开发入口为 `pnpm dev` / `pnpm desktop:dev`；`apps/web` 已退场。长篇、短篇、章节和修订输出统一表达为 Writing Run / 写作任务；BookRun 是 managed full-book run 的内部兼容实现，不是主产品控制台。

真实 LLM 1/3/10 章 smoke 已通过记录，其中 10 章 smoke 已完成人工通读；一次 30 章真实长程已跑完并导出制品，但人工通读结论为“退回重跑”。2026-06-21 本轮正在执行 `apps/web` 退场收口，默认开发、验证、容器编排和 CORS 均转向 Desktop/API/Workflow。

## 当前事实边界

- 30 章真实长程证据目录：`.codex/real-llm-30ch-mimo25pro-20260611-192356`；运行链路、Markdown、EPUB 和审计报告导出完成，但人工通读退回重跑。
- 30 章退回阻塞：测试痕迹残留、章节结构模板化、重复表达、人物称谓混乱、17/18 章时间线冲突、线索膨胀和结尾收束不足。
- 后续工程修复已覆盖 recap 膨胀、计数失真、collapse_judge 误报、S3 bucket 缺失和 reasoning token 泄漏；这些修复需要通过新一轮长程运行与人工通读验证。
- Desktop IDE Agent 已支持后端意图源收口、真实文件修订、多视角审稿、稳定 issue id、修订范围控制、proposed patch、确认写回防重复生成；Tauri 写回护栏已有脚本级 smoke 证据，但完整人工桌面端到端仍待执行。
- Desktop IDE Agent Phase 2 已完成本地验收：WebSocket 事件流、显式上下文 pin/budget、审稿 issue 多选/分类修订、PatchReviewPanel 冲突保护、版本/author-loop 元数据追踪，以及 managed Writing Run 预检/确认/轻量进度投影。
- 第一阶段核心组件链路已经通过本地验证：本地文件审稿 -> 修订 -> diff 确认 -> 写回护栏 -> 版本记录；完整真实 Tauri 桌面端到端仍列为下一步门禁。
- `apps/web` 不再作为主体验、维护入口、调试入口、兼容入口或契约验证入口；BookRun 控制台也不作为主产品入口。

## 下一步优先级

1. 跑真实 Tauri 桌面端到端：打开文件 -> Agent 审稿 -> 指定问题修订 -> diff 确认 -> 真实写回 -> 版本记录。
2. 基于 30 章人工通读意见整理重跑策略，重跑真实 3-5 万字长程并执行人工通读。
3. 将新一轮长程的 Markdown、EPUB、`audit_report.json`、summary 和人工盲评写入 `.codex/verification-report.md`。
4. 继续将 BookRun 保持为 managed Writing Run 的内部兼容实现：可由 Agent 发起、解释预算和展示 tool trace，但不抢占 Desktop IDE 主界面。
5. Phase 2 之后的可选增强应聚焦真实 provider 探针、交互打磨和更长会话稳定性，不改变 Desktop-first 产品方向。
6. 长程通过后，同步 `README.md`、`docs/internal/current-phase.md`、`docs/internal/PROJECT_SUMMARY.md` 和 `docs/internal/dev-plan.md` 的完成边界。

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
