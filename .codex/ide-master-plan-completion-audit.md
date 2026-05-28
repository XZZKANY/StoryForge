# StoryForge VS Code IDE 总计划完成度审计

生成时间：2026-05-29 03:33:01 +08:00

## 审计范围

依据 `D:\StoryForge\.codex\storyforge-vscode-ide-master-plan.md` 的 P0-P7 阶段退出标准，核对当前仓库 `D:\StoryForge\1-renovel-ai-ai-rag-tavern` 中的实现、测试、脚本与本地运行结果。本文件用于最终判断目标是否已完成；所有“已证明”均需要对应当前证据。

## 阶段验收矩阵

| 阶段 | 明确验收要求 | 当前状态 | 当前证据 | 审计结论 |
|---|---|---|---|---|
| P0 IDE 壳层与现有页面嵌入 | `/ide` 立起来；5 个旧页面以子视图形式进入；旧 5 页全部可在 `/ide` 内访问；首屏 TTI 记录基线；URL 可分享与回退；旧路由 308 | 已证明 | `apps/web/app/ide/page.tsx`；`apps/web/components/ide/shell/EditorArea.tsx` legacy 子视图；`apps/web/tests/ide-components.test.tsx` 的 legacy 5 页测试；`apps/web/tests/ide-url-state.test.ts`；`.codex/ide-performance-baseline.json`；`apps/web/scripts/verify-legacy-redirects-http.mjs` 真实 HTTP 308 smoke | 满足。 |
| P1 章节编辑器 + Problems + Repair Diff | 打开 → Judge → Problems → 跳转 → Repair → Diff → Approve；Repair Diff 可视；写回有 audit_event；1 万字章节和 1000 Problems 性能预算 | 已证明 | `ChapterEditor.tsx`、`ProblemsPanel.tsx`、`DiffViewer.tsx`、`JudgeRepairWorkbench.tsx`；`apps/api/app/domains/ide/service.py` 持久写入 `EventLog`；`apps/api/tests/test_ide_command_registry.py`、`test_ide_commands.py`；`apps/web/components/ide/performance/budgets.ts`；`apps/web/tests/ide-performance-budget.test.tsx` | 满足。性能为本地预算/组件契约基准，不是真实浏览器基准；但当前计划落地采用本地可重复验证。 |
| P2 Context Inspector | Context Compiler 结果可视化、可回放；任意 ModelRun 可一键进入 Inspector；展示 injected/dropped 数量、原因、token 预算；快照缺失显式提示 | 已证明 | `apps/web/components/ide/views/ContextInspector.tsx`；`apps/web/app/ide/page.tsx` 读取 `/api/ide/context-snapshot/{id}`；`apps/api/tests/test_ide_context_snapshot.py`；`apps/web/tests/ide-components.test.tsx` 和 `ide-page.test.tsx` 覆盖 Inspector 与 evicted | 满足。 |
| P3 Story Memory Explorer | 长效记忆可浏览、可过滤、可冲突仲裁；按 entity / fact_type / 章节区间过滤；阻塞级冲突仲裁并写 audit_event | 已证明 | `apps/web/components/ide/views/StoryMemoryExplorer.tsx`；`apps/web/tests/ide-components.test.tsx` 与 `ide-page.test.tsx` 覆盖过滤/冲突队列；`apps/api/tests/test_ide_command_registry.py` 使用 `memory.resolve_conflict` 验证命令审计 | 满足。 |
| P4 BookRun Run Panel | BookRun 可在 IDE 内启动、暂停、恢复、审计；SSE `/ide/runs/{id}/events`；SSE p95 < 500ms；checkpoint 跳转准确；blocked chapter 一键打开 | 已证明 | `BookRunPanel.tsx`、`BookRunEventsPanel.tsx`、`BookRunEventsClient.tsx`；`apps/api/app/domains/book_runs/service.py`；`apps/api/tests/test_ide_run_events.py`、`test_ide_sse_latency_budget.py`；`.codex/ide-sse-latency-baseline.json`；`apps/web/scripts/verify-bookrun-eventsource-reconnect.mjs` | 满足。SSE 重连为本地协议 smoke，不依赖浏览器测试框架。 |
| P5 Command Registry + Agent Sidebar | 100% 写操作经 CommandRegistry；Agent 任意写操作可在 audit 中追溯 | 已证明 | `apps/web/components/ide/commands/registry.ts`、`registerBuiltinCommands.ts`、`AgentSidebar.tsx`；`apps/web/tests/ide-command-registry.test.tsx` 写操作按钮扫描门禁；`apps/api/app/domains/ide/service.py` 对 IDE 命令写入 `EventLog` | 满足。扫描门禁为静态启发式，但结合后端命令审计测试覆盖当前写路径。 |
| P6 Artifact / Export Viewer | 制品在 IDE 内预览、对比、追溯；从制品反向跳转到 BookRun → ModelRun → Approve 全链路 | 已证明 | `apps/web/components/ide/views/ArtifactViewer.tsx`；`apps/web/tests/ide-components.test.tsx` trace 机器可读属性；`apps/web/tests/ide-page.test.tsx` Artifact Preview 页面读取；`apps/api/tests/test_ide_artifact_preview.py` 使用真实样例制品验证版本、下载摘要与 BookRun/ModelRun/JudgeReport/Approve 链路 | 满足。 |
| P7 主题 / 多窗口 / 个性化 | 键位自定义、主题切换、布局持久化、多窗口；用户布局、键位、主题持久化；编辑器可拆到新窗口 | 已证明 | `apps/web/components/ide/personalization/preferences.ts`；`PersonalizationControls.tsx` 任意键位写入；`IdeShellPreferencesHydrator.tsx`；`createEditorPopoutUrl()`；`apps/web/tests/ide-personalization.test.tsx` | 满足。 |

## 当前必须验证命令

- Web 契约：`pnpm --filter @storyforge/web test -- ide-components ide-personalization phase1-navigation ide-page ide-command-registry ide-url-state ide-performance-budget ide-build-budget`
- Web 类型检查：`pnpm --filter @storyforge/web lint`
- P0 HTTP smoke：`node scripts/verify-legacy-redirects-http.mjs --port 3187 --timeout-ms 120000`
- P4 SSE reconnect smoke：`node scripts/verify-bookrun-eventsource-reconnect.mjs --timeout-ms 10000`
- API 契约：`uv run pytest tests/test_ide_command_registry.py tests/test_ide_commands.py tests/test_ide_run_events.py tests/test_ide_artifact_preview.py tests/test_ide_sse_latency_budget.py tests/test_ide_context_snapshot.py tests/test_ide_diagnostics.py -q`
- API lint：`uv run ruff check app/domains/ide app/domains/book_runs tests/test_ide_command_registry.py tests/test_ide_commands.py tests/test_ide_run_events.py tests/test_ide_artifact_preview.py tests/test_ide_sse_latency_budget.py tests/test_ide_context_snapshot.py tests/test_ide_diagnostics.py`
- Diff 检查：`git diff --check`

## 当前结论

按当前文件证据，P0-P7 明确退出标准均已有对应实现与本地验证入口。仍需在本轮重新运行上方“当前必须验证命令”，全部通过后才可进入 `update_goal complete` 判定。