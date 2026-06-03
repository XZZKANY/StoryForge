# StoryForge 仓库瘦身 Dry-run 报告

生成时间：2026-06-03 23:53:12 +08:00
项目根目录：当前隔离 worktree
当前分支：codex/pruning-dry-run-report
最近提交：93cb6ea 生成仓库瘦身 dry-run 分类数据

## 1. 执行边界

- 本轮为仓库瘦身 dry-run 报告回填任务，仅基于 Task 2 生成的扫描数据生成建议。
- 本任务未对真实项目文件执行删除、移动或归档操作。
- 不修改 `apps/`、`packages/`、`docs/`、`scripts/` 的业务代码。
- 本任务只修改 `.codex/pruning-dry-run-report.md`，并移除 `.codex/pruning-dry-run-data.json` 临时中间数据文件。
- 报告中的路径保持 JSON 输入中的相对路径，便于后续人工复核。

## 2. 工作树摘要

- 扫描文件数：928
- 扫描总大小 MB：6.62
- 扫描总大小字节数：6938199
- 分类数量：必须保留 26，建议归档 202，可删除 0，需人工确认 700。
- 临时中间数据文件已在本任务中移除，最终统计已回填到本报告。

### Top 大文件

| 序号 | 路径 | 修改时间 | 大小 MB | 字节数 | 原因 |
| --- | --- | --- | ---: | ---: | --- |
| 1 | .codex/phase9b-real-llm-smoke-1ch.sqlite | 2026-06-03 22:13:55 | 0.48 | 503808 | 路径涉及 real-llm、BookRun、book-run、judge、repair、audit、openapi 或数据库制品。 |
| 2 | packages/shared/src/contracts/storyforge.openapi.json | 2026-06-03 22:13:57 | 0.35 | 370365 | 命中保护精确路径或 App Router 契约规则。 |
| 3 | .codex/operations-log.md | 2026-06-03 22:13:55 | 0.34 | 352730 | 命中保护精确路径或 App Router 契约规则。 |
| 4 | apps/api/uv.lock | 2026-06-03 22:13:56 | 0.29 | 299347 | 默认保守分类。 |
| 5 | packages/shared/src/generated/api-types.ts | 2026-06-03 22:13:57 | 0.26 | 272635 | 命中保护精确路径或 App Router 契约规则。 |
| 6 | apps/workflow/uv.lock | 2026-06-03 22:13:57 | 0.24 | 250379 | 默认保守分类。 |
| 7 | pnpm-lock.yaml | 2026-06-03 22:13:57 | 0.14 | 149274 | 默认保守分类。 |
| 8 | .codex/verification-report.md | 2026-06-03 22:13:55 | 0.10 | 103990 | 命中保护精确路径或 App Router 契约规则。 |
| 9 | .codex/visual-preview/storyforge-claude-like-preview.png | 2026-06-03 22:13:55 | 0.09 | 93475 | 默认保守分类。 |
| 10 | .codex/visual-preview/next-home-3000-after.png | 2026-06-03 22:13:55 | 0.08 | 86870 | 默认保守分类。 |
| 11 | docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md | 2026-06-03 22:13:57 | 0.06 | 66604 | 默认保守分类。 |
| 12 | .dev_plan.md | 2026-06-03 22:13:55 | 0.04 | 42398 | 命中保护精确路径或 App Router 契约规则。 |
| 13 | apps/api/tests/test_studio_book_list_api.py | 2026-06-03 22:13:56 | 0.03 | 36630 | 默认保守分类。 |
| 14 | apps/api/app/domains/judge/service.py | 2026-06-03 22:13:56 | 0.03 | 35782 | 路径涉及 real-llm、BookRun、book-run、judge、repair、audit、openapi 或数据库制品。 |
| 15 | docs/superpowers/specs/2026-05-31-storyforge-novel-skill-framework-design.md | 2026-06-03 22:13:57 | 0.03 | 34506 | 默认保守分类。 |
| 16 | apps/web/tests/home-page.test.tsx | 2026-06-03 22:13:56 | 0.03 | 33280 | 默认保守分类。 |
| 17 | apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py | 2026-06-03 22:13:56 | 0.03 | 32836 | 默认保守分类。 |
| 18 | docs/superpowers/plans/2026-05-14-storyforge-phase2-engineering-plan.md | 2026-06-03 22:13:57 | 0.03 | 32037 | 默认保守分类。 |
| 19 | docs/superpowers/plans/2026-05-31-storyforge-novel-skill-framework-post-phase1.md | 2026-06-03 22:13:57 | 0.03 | 31338 | 默认保守分类。 |
| 20 | docs/superpowers/plans/2026-05-31-storyforge-novel-skill-framework-claw-borrowing.md | 2026-06-03 22:13:57 | 0.03 | 30015 | 默认保守分类。 |

## 3. 总体统计

| 分类 | 文件数 | 大小 MB | 字节数 |
| --- | ---: | ---: | ---: |
| 必须保留 | 26 | 1.17 | 1231630 |
| 建议归档 | 202 | 0.79 | 828725 |
| 可删除 | 0 | 0.00 | 0 |
| 需人工确认 | 700 | 4.65 | 4877844 |
| 合计 | 928 | 6.62 | 6938199 |

## 4. 必须保留

- 文件数：26
- 大小 MB：1.17
- 字节数：1231630
- 处理建议：保持现状，不纳入清理候选。

| 序号 | 路径 | 修改时间 | 大小 MB | 字节数 | 原因 |
| --- | --- | --- | ---: | ---: | --- |
| 1 | packages/shared/src/contracts/storyforge.openapi.json | 2026-06-03 22:13:57 | 0.35 | 370365 | 命中保护精确路径或 App Router 契约规则。 |
| 2 | .codex/operations-log.md | 2026-06-03 22:13:55 | 0.34 | 352730 | 命中保护精确路径或 App Router 契约规则。 |
| 3 | packages/shared/src/generated/api-types.ts | 2026-06-03 22:13:57 | 0.26 | 272635 | 命中保护精确路径或 App Router 契约规则。 |
| 4 | .codex/verification-report.md | 2026-06-03 22:13:55 | 0.10 | 103990 | 命中保护精确路径或 App Router 契约规则。 |
| 5 | .dev_plan.md | 2026-06-03 22:13:55 | 0.04 | 42398 | 命中保护精确路径或 App Router 契约规则。 |
| 6 | apps/web/app/runs/page.tsx | 2026-06-03 22:13:56 | 0.02 | 21340 | 命中保护精确路径或 App Router 契约规则。 |
| 7 | apps/web/app/ide/page.tsx | 2026-06-03 22:13:56 | 0.01 | 14723 | 命中保护精确路径或 App Router 契约规则。 |
| 8 | apps/web/app/evaluations/page.tsx | 2026-06-03 22:13:56 | 0.01 | 12297 | 命中保护精确路径或 App Router 契约规则。 |
| 9 | apps/web/app/retrieval/page.tsx | 2026-06-03 22:13:56 | 0.01 | 11337 | 命中保护精确路径或 App Router 契约规则。 |
| 10 | apps/web/app/worldbuilding/page.tsx | 2026-06-03 22:13:56 | 0.01 | 8660 | 命中保护精确路径或 App Router 契约规则。 |
| 11 | README.md | 2026-06-03 22:13:55 | 0.01 | 7748 | 命中保护精确路径或 App Router 契约规则。 |
| 12 | TODO.md | 2026-06-03 22:13:55 | 0.00 | 2281 | 命中保护精确路径或 App Router 契约规则。 |
| 13 | current-phase.md | 2026-06-03 22:13:57 | 0.00 | 2226 | 命中保护精确路径或 App Router 契约规则。 |
| 14 | apps/web/app/refinery/page.tsx | 2026-06-03 22:13:56 | 0.00 | 1477 | 命中保护精确路径或 App Router 契约规则。 |
| 15 | apps/web/app/book-runs/page.tsx | 2026-06-03 22:13:56 | 0.00 | 1318 | 命中保护精确路径或 App Router 契约规则。 |
| 16 | apps/web/app/assets/page.tsx | 2026-06-03 22:13:56 | 0.00 | 971 | 命中保护精确路径或 App Router 契约规则。 |
| 17 | apps/web/app/jobs/page.tsx | 2026-06-03 22:13:56 | 0.00 | 909 | 命中保护精确路径或 App Router 契约规则。 |
| 18 | apps/web/app/page.tsx | 2026-06-03 22:13:56 | 0.00 | 761 | 命中保护精确路径或 App Router 契约规则。 |
| 19 | apps/web/app/book-runs/[id]/audit/page.tsx | 2026-06-03 22:13:56 | 0.00 | 709 | 命中保护精确路径或 App Router 契约规则。 |
| 20 | apps/web/app/providers/page.tsx | 2026-06-03 22:13:56 | 0.00 | 665 | 命中保护精确路径或 App Router 契约规则。 |
| 21 | apps/web/app/layout.tsx | 2026-06-03 22:13:56 | 0.00 | 621 | 命中保护精确路径或 App Router 契约规则。 |
| 22 | apps/web/app/blueprints/page.tsx | 2026-06-03 22:13:56 | 0.00 | 567 | 命中保护精确路径或 App Router 契约规则。 |
| 23 | apps/web/app/api/provider-models/route.ts | 2026-06-03 22:13:56 | 0.00 | 371 | 命中保护精确路径或 App Router 契约规则。 |
| 24 | apps/web/app/studio/page.tsx | 2026-06-03 22:13:56 | 0.00 | 266 | 命中保护精确路径或 App Router 契约规则。 |
| 25 | apps/web/app/artifacts/page.tsx | 2026-06-03 22:13:56 | 0.00 | 141 | 命中保护精确路径或 App Router 契约规则。 |
| 26 | apps/web/app/settings/page.tsx | 2026-06-03 22:13:56 | 0.00 | 124 | 命中保护精确路径或 App Router 契约规则。 |

## 5. 建议归档

- 文件数：202
- 大小 MB：0.79
- 字节数：828725
- 处理建议：后续如执行真实清理，应先确认归档目标、恢复路径和责任人。

仅展示前 80 条，共 202 条。

| 序号 | 路径 | 修改时间 | 大小 MB | 字节数 | 原因 |
| --- | --- | --- | ---: | ---: | --- |
| 1 | .codex/context-summary-performance-optimization.md | 2026-06-03 22:13:55 | 0.03 | 29667 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 2 | .codex/context-summary-project-review.md | 2026-06-03 22:13:55 | 0.01 | 11782 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 3 | .codex/context-summary-storyforge-assistant-workflow.md | 2026-06-03 22:13:55 | 0.01 | 8563 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 4 | .codex/dev-start.log | 2026-06-03 22:13:55 | 0.01 | 7940 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 5 | .codex/context-summary-assistant-session-persistence.md | 2026-06-03 22:13:55 | 0.01 | 7938 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 6 | .codex/context-summary-ph2-plan.md | 2026-06-03 22:13:55 | 0.01 | 7755 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 7 | .codex/context-summary-storyforge-master-replan.md | 2026-06-03 22:13:55 | 0.01 | 7587 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 8 | .codex/context-summary-project-health.md | 2026-06-03 22:13:55 | 0.01 | 7345 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 9 | .codex/context-summary-creative-tool-registry.md | 2026-06-03 22:13:55 | 0.01 | 7231 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 10 | .codex/context-summary-phase2.md | 2026-06-03 22:13:55 | 0.01 | 7214 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 11 | .codex/context-summary-local-e2e-browser-gate.md | 2026-06-03 22:13:55 | 0.01 | 7024 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 12 | .codex/context-summary-dev-plan.md | 2026-06-03 22:13:55 | 0.01 | 6963 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 13 | .codex/context-summary-foreshadow-lifecycle.md | 2026-06-03 22:13:55 | 0.01 | 6750 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 14 | .codex/context-summary-runtime-gate.md | 2026-06-03 22:13:55 | 0.01 | 6708 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 15 | .codex/context-summary-assistant-session-detail-restore.md | 2026-06-03 22:13:55 | 0.01 | 6673 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 16 | .codex/context-summary-assistant-continuous-session.md | 2026-06-03 22:13:55 | 0.01 | 6657 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 17 | .codex/context-summary-novel-skill-framework.md | 2026-06-03 22:13:55 | 0.01 | 6628 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 18 | .codex/context-summary-工作流审查.md | 2026-06-03 22:13:55 | 0.01 | 6565 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 19 | .codex/context-summary-runtime-contract-governance.md | 2026-06-03 22:13:55 | 0.01 | 6373 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 20 | .codex/context-summary-phase8-runtime-rc-freeze.md | 2026-06-03 22:13:55 | 0.01 | 6264 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 21 | .codex/context-summary-ph5-ph6-closure.md | 2026-06-03 22:13:55 | 0.01 | 6142 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 22 | .codex/context-summary-legacy-fixes.md | 2026-06-03 22:13:55 | 0.01 | 6137 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 23 | .codex/context-summary-assistant-chapter-review-natural-target.md | 2026-06-03 22:13:55 | 0.01 | 5894 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 24 | .codex/context-summary-module-isolation.md | 2026-06-03 22:13:55 | 0.01 | 5861 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 25 | .codex/context-summary-end-to-end-closure.md | 2026-06-03 22:13:55 | 0.01 | 5807 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 26 | .codex/context-summary-workflow-resume-budget.md | 2026-06-03 22:13:55 | 0.01 | 5778 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 27 | .codex/context-summary-merge-ph2.md | 2026-06-03 22:13:55 | 0.01 | 5776 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 28 | .codex/context-summary-memory-extract-bridge.md | 2026-06-03 22:13:55 | 0.01 | 5718 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 29 | .codex/context-summary-runtime-diagnostics.md | 2026-06-03 22:13:55 | 0.01 | 5715 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 30 | .codex/context-summary-workflow-api-adapter.md | 2026-06-03 22:13:55 | 0.01 | 5711 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 31 | .codex/context-summary-assistant-artifact-export-p0.md | 2026-06-03 22:13:55 | 0.01 | 5697 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 32 | .codex/context-summary-uiux.md | 2026-06-03 22:13:55 | 0.01 | 5692 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 33 | .codex/context-summary-novel-quality-total.md | 2026-06-03 22:13:55 | 0.01 | 5639 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 34 | .codex/context-summary-creative-tool-visibility.md | 2026-06-03 22:13:55 | 0.01 | 5522 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 35 | .codex/context-summary-storyforge-vscode-ide-p3-story-memory.md | 2026-06-03 22:13:55 | 0.01 | 5482 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 36 | .codex/context-summary-phase7-full-closure.md | 2026-06-03 22:13:55 | 0.01 | 5467 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 37 | .codex/context-summary-assistant-browser-session.md | 2026-06-03 22:13:55 | 0.01 | 5436 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 38 | .codex/context-summary-p2-longform-readiness-gate.md | 2026-06-03 22:13:55 | 0.01 | 5361 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 39 | .codex/context-summary-phase9c-4.md | 2026-06-03 22:13:55 | 0.01 | 5309 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 40 | .codex/context-summary-studio-flow.md | 2026-06-03 22:13:55 | 0.01 | 5307 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 41 | .codex/context-summary-P8-010-provider-fallback.md | 2026-06-03 22:13:55 | 0.01 | 5305 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 42 | .codex/context-summary-assistant-recent-sessions.md | 2026-06-03 22:13:55 | 0.01 | 5273 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 43 | .codex/context-summary-task-2.md | 2026-06-03 22:13:55 | 0.01 | 5248 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 44 | .codex/context-summary-settings-browser-interaction.md | 2026-06-03 22:13:55 | 0.00 | 5199 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 45 | .codex/context-summary-run-novel-now.md | 2026-06-03 22:13:55 | 0.00 | 5188 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 46 | .codex/context-summary-story-memory-guard.md | 2026-06-03 22:13:55 | 0.00 | 5112 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 47 | .codex/context-summary-provider-api-key-settings.md | 2026-06-03 22:13:55 | 0.00 | 5090 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 48 | .codex/context-summary-storyforge-vscode-ide-final.md | 2026-06-03 22:13:55 | 0.00 | 4993 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 49 | .codex/context-summary-p2-manual-read-gate-evidence.md | 2026-06-03 22:13:55 | 0.00 | 4977 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 50 | .codex/context-summary-p8-009-workflow-runner-sink-isolation.md | 2026-06-03 22:13:55 | 0.00 | 4947 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 51 | .codex/context-summary-timeline-events.md | 2026-06-03 22:13:55 | 0.00 | 4920 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 52 | .codex/context-summary-foreshadow-read-side.md | 2026-06-03 22:13:55 | 0.00 | 4879 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 53 | .codex/context-summary-hardening.md | 2026-06-03 22:13:55 | 0.00 | 4860 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 54 | .codex/context-summary-storyforge-vscode-ide-p1-real-commands.md | 2026-06-03 22:13:55 | 0.00 | 4804 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 55 | .codex/context-summary-manual-read-gate.md | 2026-06-03 22:13:55 | 0.00 | 4746 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 56 | .codex/context-summary-storyforge-vscode-ide-p15-entry-links.md | 2026-06-03 22:13:55 | 0.00 | 4741 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 57 | .codex/context-summary-ph7.md | 2026-06-03 22:13:55 | 0.00 | 4736 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 58 | .codex/context-summary-storyforge-vscode-ide-p7-personalization.md | 2026-06-03 22:13:55 | 0.00 | 4679 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 59 | .codex/context-summary-studio-approve-execution.md | 2026-06-03 22:13:55 | 0.00 | 4674 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 60 | .codex/context-summary-task-1.md | 2026-06-03 22:13:55 | 0.00 | 4639 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 61 | .codex/context-summary-task-7-genre-skill-pack.md | 2026-06-03 22:13:55 | 0.00 | 4551 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 62 | .codex/context-summary-task-4.md | 2026-06-03 22:13:55 | 0.00 | 4544 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 63 | .codex/context-summary-项目体检.md | 2026-06-03 22:13:55 | 0.00 | 4525 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 64 | .codex/context-summary-phase9b.md | 2026-06-03 22:13:55 | 0.00 | 4514 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 65 | .codex/context-summary-storyforge-vscode-ide-runtime-budgets.md | 2026-06-03 22:13:55 | 0.00 | 4494 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 66 | .codex/context-summary-phase9c.md | 2026-06-03 22:13:55 | 0.00 | 4428 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 67 | .codex/context-summary-step-a-2.md | 2026-06-03 22:13:55 | 0.00 | 4424 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 68 | .codex/context-summary-provider-resolution-progress.md | 2026-06-03 22:13:55 | 0.00 | 4362 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 69 | .codex/context-summary-storyforge-vscode-ide-p1-frontend-real-loop.md | 2026-06-03 22:13:55 | 0.00 | 4254 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 70 | .codex/context-summary-竞品架构横评.md | 2026-06-03 22:13:55 | 0.00 | 4198 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 71 | .codex/context-summary-step-f-1.md | 2026-06-03 22:13:55 | 0.00 | 4184 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 72 | .codex/context-summary-storyforge-vscode-ide.md | 2026-06-03 22:13:55 | 0.00 | 4151 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 73 | .codex/context-summary-storyforge-vscode-ide-p2-trace-context-links.md | 2026-06-03 22:13:55 | 0.00 | 4102 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 74 | .codex/context-summary-storyforge-vscode-ide-sse-p95.md | 2026-06-03 22:13:55 | 0.00 | 4068 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 75 | .codex/context-summary-task-6-web-skill-chain.md | 2026-06-03 22:13:55 | 0.00 | 4065 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 76 | .codex/context-summary-storyforge-vscode-ide-p2-inspector-load.md | 2026-06-03 22:13:55 | 0.00 | 4039 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 77 | .codex/context-summary-step-d-1b.md | 2026-06-03 22:13:55 | 0.00 | 4002 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 78 | .codex/context-summary-assistant-artifact-export.md | 2026-06-03 22:13:55 | 0.00 | 3995 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 79 | .codex/context-summary-上线前终审报告.md | 2026-06-03 22:13:55 | 0.00 | 3979 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |
| 80 | .codex/context-summary-docker-prod-compose.md | 2026-06-03 22:13:55 | 0.00 | 3969 | 命中 .codex 历史截图、日志、smoke、llm 或上下文摘要归档规则。 |

## 6. 可删除

- 文件数：0
- 大小 MB：0.00
- 字节数：0
- 隔离 clean worktree 未发现明确缓存或临时调试文件，真实主工作树清理前仍需另行扫描。

本类无匹配文件。

## 7. 需人工确认

- 文件数：700
- 大小 MB：4.65
- 字节数：4877844
- 处理建议：需要负责人确认用途、保留价值和处置方式后再进入后续流程。

仅展示前 80 条，共 700 条。

| 序号 | 路径 | 修改时间 | 大小 MB | 字节数 | 原因 |
| --- | --- | --- | ---: | ---: | --- |
| 1 | .codex/phase9b-real-llm-smoke-1ch.sqlite | 2026-06-03 22:13:55 | 0.48 | 503808 | 路径涉及 real-llm、BookRun、book-run、judge、repair、audit、openapi 或数据库制品。 |
| 2 | apps/api/uv.lock | 2026-06-03 22:13:56 | 0.29 | 299347 | 默认保守分类。 |
| 3 | apps/workflow/uv.lock | 2026-06-03 22:13:57 | 0.24 | 250379 | 默认保守分类。 |
| 4 | pnpm-lock.yaml | 2026-06-03 22:13:57 | 0.14 | 149274 | 默认保守分类。 |
| 5 | .codex/visual-preview/storyforge-claude-like-preview.png | 2026-06-03 22:13:55 | 0.09 | 93475 | 默认保守分类。 |
| 6 | .codex/visual-preview/next-home-3000-after.png | 2026-06-03 22:13:55 | 0.08 | 86870 | 默认保守分类。 |
| 7 | docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md | 2026-06-03 22:13:57 | 0.06 | 66604 | 默认保守分类。 |
| 8 | apps/api/tests/test_studio_book_list_api.py | 2026-06-03 22:13:56 | 0.03 | 36630 | 默认保守分类。 |
| 9 | apps/api/app/domains/judge/service.py | 2026-06-03 22:13:56 | 0.03 | 35782 | 路径涉及 real-llm、BookRun、book-run、judge、repair、audit、openapi 或数据库制品。 |
| 10 | docs/superpowers/specs/2026-05-31-storyforge-novel-skill-framework-design.md | 2026-06-03 22:13:57 | 0.03 | 34506 | 默认保守分类。 |
| 11 | apps/web/tests/home-page.test.tsx | 2026-06-03 22:13:56 | 0.03 | 33280 | 默认保守分类。 |
| 12 | apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py | 2026-06-03 22:13:56 | 0.03 | 32836 | 默认保守分类。 |
| 13 | docs/superpowers/plans/2026-05-14-storyforge-phase2-engineering-plan.md | 2026-06-03 22:13:57 | 0.03 | 32037 | 默认保守分类。 |
| 14 | docs/superpowers/plans/2026-05-31-storyforge-novel-skill-framework-post-phase1.md | 2026-06-03 22:13:57 | 0.03 | 31338 | 默认保守分类。 |
| 15 | docs/superpowers/plans/2026-05-31-storyforge-novel-skill-framework-claw-borrowing.md | 2026-06-03 22:13:57 | 0.03 | 30015 | 默认保守分类。 |
| 16 | docs/superpowers/plans/2026-06-01-bookrun-workflow-adapter-skill-runs.md | 2026-06-03 22:13:57 | 0.03 | 29763 | 路径涉及 real-llm、BookRun、book-run、judge、repair、audit、openapi 或数据库制品。 |
| 17 | apps/api/app/domains/studio/service.py | 2026-06-03 22:13:56 | 0.03 | 29024 | 默认保守分类。 |
| 18 | AGENTS.md | 2026-06-03 22:13:55 | 0.03 | 28941 | 默认保守分类。 |
| 19 | apps/api/tests/test_book_runs.py | 2026-06-03 22:13:56 | 0.03 | 28708 | 默认保守分类。 |
| 20 | apps/web/tests/ide-components.test.tsx | 2026-06-03 22:13:56 | 0.03 | 27701 | 默认保守分类。 |
| 21 | apps/api/app/domains/book_runs/service.py | 2026-06-03 22:13:56 | 0.03 | 27553 | 默认保守分类。 |
| 22 | apps/api/app/domains/ide/service.py | 2026-06-03 22:13:56 | 0.03 | 27272 | 默认保守分类。 |
| 23 | docs/superpowers/plans/2026-05-17-storyforge-master-replan.md | 2026-06-03 22:13:57 | 0.03 | 26699 | 默认保守分类。 |
| 24 | docs/superpowers/plans/2026-05-30-novel-quality-total-implementation.md | 2026-06-03 22:13:57 | 0.03 | 26593 | 默认保守分类。 |
| 25 | docs/superpowers/specs/2026-05-12-dual-mode-ai-novel-platform-design.zh-CN.md | 2026-06-03 22:13:57 | 0.02 | 25833 | 默认保守分类。 |
| 26 | apps/api/alembic/versions/20260528_0001_backfill_current_orm_schema.py | 2026-06-03 22:13:55 | 0.02 | 25225 | 默认保守分类。 |
| 27 | docs/superpowers/plans/2026-05-12-storyforge-phase1-engineering-plan.md | 2026-06-03 22:13:57 | 0.02 | 24387 | 默认保守分类。 |
| 28 | apps/api/app/domains/retrieval/service.py | 2026-06-03 22:13:56 | 0.02 | 24204 | 默认保守分类。 |
| 29 | apps/workflow/tests/test_runtime_runner.py | 2026-06-03 22:13:57 | 0.02 | 24146 | 默认保守分类。 |
| 30 | apps/api/app/domains/story_memory/service.py | 2026-06-03 22:13:56 | 0.02 | 23821 | 默认保守分类。 |
| 31 | apps/web/app/studio/page-content.tsx | 2026-06-03 22:13:56 | 0.02 | 22945 | 默认保守分类。 |
| 32 | apps/workflow/storyforge_workflow/runtime/runner.py | 2026-06-03 22:13:56 | 0.02 | 20909 | 默认保守分类。 |
| 33 | apps/web/tests/phase1-navigation.test.tsx | 2026-06-03 22:13:56 | 0.02 | 20807 | 默认保守分类。 |
| 34 | apps/workflow/storyforge_workflow/runtime/checkpoints.py | 2026-06-03 22:13:56 | 0.02 | 20054 | 默认保守分类。 |
| 35 | apps/workflow/storyforge_workflow/prompts/builder.py | 2026-06-03 22:13:56 | 0.02 | 19921 | 默认保守分类。 |
| 36 | apps/api/tests/test_scene_packet.py | 2026-06-03 22:13:56 | 0.02 | 19453 | 默认保守分类。 |
| 37 | apps/web/scripts/phase1-contract-test.mjs | 2026-06-03 22:13:56 | 0.02 | 19394 | 默认保守分类。 |
| 38 | apps/api/tests/test_retrieval_embedding.py | 2026-06-03 22:13:56 | 0.02 | 18992 | 默认保守分类。 |
| 39 | .codex/real-llm-smoke/book.md | 2026-06-03 22:13:55 | 0.02 | 18913 | 路径涉及 real-llm、BookRun、book-run、judge、repair、audit、openapi 或数据库制品。 |
| 40 | apps/workflow/tests/test_skill_audit_summary.py | 2026-06-03 22:13:57 | 0.02 | 18765 | 路径涉及 real-llm、BookRun、book-run、judge、repair、audit、openapi 或数据库制品。 |
| 41 | apps/api/app/domains/model_runs/service.py | 2026-06-03 22:13:56 | 0.02 | 18118 | 默认保守分类。 |
| 42 | apps/api/tests/test_model_runs.py | 2026-06-03 22:13:56 | 0.02 | 17155 | 默认保守分类。 |
| 43 | apps/workflow/storyforge_workflow/runtime/provider_adapter.py | 2026-06-03 22:13:56 | 0.02 | 16703 | 默认保守分类。 |
| 44 | AI_ITERATION_GUIDE.md | 2026-06-03 22:13:55 | 0.02 | 16601 | 默认保守分类。 |
| 45 | apps/api/tests/test_book_run_workflow_dispatch.py | 2026-06-03 22:13:56 | 0.02 | 16090 | 默认保守分类。 |
| 46 | docs/superpowers/plans/2026-06-03-codex-pruning-dry-run.md | 2026-06-03 22:13:57 | 0.02 | 15746 | 默认保守分类。 |
| 47 | docs/architecture/phase6-workbench-contract.md | 2026-06-03 22:13:57 | 0.01 | 15575 | 默认保守分类。 |
| 48 | apps/workflow/storyforge_workflow/tools/registry.py | 2026-06-03 22:13:56 | 0.01 | 15548 | 默认保守分类。 |
| 49 | docs/superpowers/plans/2026-06-01-project-health-assessment.md | 2026-06-03 22:13:57 | 0.01 | 15426 | 默认保守分类。 |
| 50 | MODULE_ISOLATION_SCORECARD.md | 2026-06-03 22:13:55 | 0.01 | 15344 | 默认保守分类。 |
| 51 | apps/workflow/storyforge_workflow/skills/definitions.py | 2026-06-03 22:13:56 | 0.01 | 15001 | 默认保守分类。 |
| 52 | .codex/project-health-assessment.md | 2026-06-03 22:13:55 | 0.01 | 14643 | 默认保守分类。 |
| 53 | apps/web/tests/assistant-chapter-review-actions.test.ts | 2026-06-03 22:13:56 | 0.01 | 14270 | 默认保守分类。 |
| 54 | apps/web/components/home/AssistantConversation.tsx | 2026-06-03 22:13:56 | 0.01 | 13940 | 默认保守分类。 |
| 55 | apps/workflow/tests/test_prompt_builder.py | 2026-06-03 22:13:56 | 0.01 | 13936 | 默认保守分类。 |
| 56 | apps/web/components/home/assistant-chapter-review-actions.ts | 2026-06-03 22:13:56 | 0.01 | 13883 | 默认保守分类。 |
| 57 | apps/api/alembic/versions/71dfabf6badf_创建_phase_1_领域模型.py | 2026-06-03 22:13:55 | 0.01 | 13631 | 默认保守分类。 |
| 58 | scripts/verify-local.ps1 | 2026-06-03 22:13:57 | 0.01 | 13496 | 默认保守分类。 |
| 59 | apps/workflow/storyforge_workflow/quality/prose_static_check.py | 2026-06-03 22:13:56 | 0.01 | 13183 | 默认保守分类。 |
| 60 | tests/e2e/phase5-runtime-diagnostics.spec.ts | 2026-06-03 22:13:57 | 0.01 | 13048 | 默认保守分类。 |
| 61 | docs/superpowers/plans/2026-05-17-storyforge-phase4-engineering-plan.md | 2026-06-03 22:13:57 | 0.01 | 12997 | 默认保守分类。 |
| 62 | docs/superpowers/specs/2026-06-01-home-input-first-uiux-design.md | 2026-06-03 22:13:57 | 0.01 | 12931 | 默认保守分类。 |
| 63 | apps/web/tests/ide-page.test.tsx | 2026-06-03 22:13:56 | 0.01 | 12925 | 默认保守分类。 |
| 64 | apps/api/tests/test_phase9b_real_llm_smoke.py | 2026-06-03 22:13:56 | 0.01 | 12359 | 默认保守分类。 |
| 65 | apps/api/app/domains/exports/book_markdown_exporter.py | 2026-06-03 22:13:56 | 0.01 | 12312 | 默认保守分类。 |
| 66 | apps/web/components/ide/views/BookRunPanel.tsx | 2026-06-03 22:13:56 | 0.01 | 12267 | 路径涉及 real-llm、BookRun、book-run、judge、repair、audit、openapi 或数据库制品。 |
| 67 | apps/web/app/book-runs/audit.tsx | 2026-06-03 22:13:56 | 0.01 | 12253 | 路径涉及 real-llm、BookRun、book-run、judge、repair、audit、openapi 或数据库制品。 |
| 68 | apps/web/tests/assistant-artifact-export-actions.test.ts | 2026-06-03 22:13:56 | 0.01 | 12185 | 默认保守分类。 |
| 69 | docs/superpowers/plans/2026-05-15-storyforge-phase2-engineering-plan.md | 2026-06-03 22:13:57 | 0.01 | 11987 | 默认保守分类。 |
| 70 | apps/api/tests/test_story_memory_contract.py | 2026-06-03 22:13:56 | 0.01 | 11681 | 默认保守分类。 |
| 71 | apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py | 2026-06-03 22:13:56 | 0.01 | 11595 | 默认保守分类。 |
| 72 | apps/api/tests/test_ide_commands.py | 2026-06-03 22:13:56 | 0.01 | 11594 | 默认保守分类。 |
| 73 | .codex-fix-phase9b-complete.local.patch | 2026-06-03 22:13:55 | 0.01 | 11119 | 默认保守分类。 |
| 74 | .codex-fix-phase9b-complete.patch | 2026-06-03 22:13:55 | 0.01 | 11119 | 默认保守分类。 |
| 75 | apps/workflow/tests/test_generation_graph.py | 2026-06-03 22:13:56 | 0.01 | 10923 | 默认保守分类。 |
| 76 | apps/web/scripts/verify-settings-browser.mjs | 2026-06-03 22:13:56 | 0.01 | 10893 | 默认保守分类。 |
| 77 | .codex/fix-phase9b-complete.patch | 2026-06-03 22:13:55 | 0.01 | 10860 | 默认保守分类。 |
| 78 | docs/superpowers/plans/2026-06-01-bookrun-production-dispatch.md | 2026-06-03 22:13:57 | 0.01 | 10800 | 路径涉及 real-llm、BookRun、book-run、judge、repair、audit、openapi 或数据库制品。 |
| 79 | apps/api/tests/test_approval_writeback.py | 2026-06-03 22:13:56 | 0.01 | 10696 | 默认保守分类。 |
| 80 | apps/api/tests/test_retrieval_real_providers.py | 2026-06-03 22:13:56 | 0.01 | 10663 | 默认保守分类。 |

## 8. 风险与保护规则

- dry-run 分类只提供处置建议，不代表已经执行仓库清理。
- `必须保留` 命中保护路径或契约规则，应保持现状。
- `建议归档` 适合进入后续归档方案设计，但执行前必须确认归档位置、恢复方式和验证步骤。
- `需人工确认` 包含数据库制品、锁文件、生成物、截图和默认保守分类项，不能仅凭大小处置。
- 本次隔离 worktree 的 `可删除` 数量为 0，不能推断主工作树不存在缓存或临时文件。
- 后续真实操作前必须重新扫描目标工作树，并保留可复核的变更清单。

## 9. 下一步执行选项

1. 只审阅：保留本报告作为 dry-run 结果，人工确认高风险路径。
2. 归档预案：针对 `建议归档` 清单制定归档目录、回滚方式和验证命令。
3. 主工作树复扫：在真实主工作树重新执行扫描，重点确认缓存、临时调试文件和本报告未覆盖的本地制品。
4. 执行前门禁：真实操作前先生成待处理清单、人工确认、备份或归档位置，并通过本地验证。

## 10. 本地验证记录

执行时间：2026-06-04 08:00 +08:00

### 10.1 前置状态

- 命令：`git status --short`
  - 结果：无输出。
  - 结论：工作树干净，可以开始 Task 4。
- 命令：`git log -1 --oneline`
  - 结果：`0d1086b 修正 dry-run 报告清单字段`
  - 结论：当前提交符合 Task 4 前置要求。

### 10.2 最终验证命令

- 命令：`Test-Path .codex\pruning-dry-run-report.md`
  - 结果：`True`
  - 结论：dry-run 报告存在。
- 命令：`Select-String -Path .codex\pruning-dry-run-report.md -Pattern "必须保留|建议归档|可删除|需人工确认|下一步执行选项"`
  - 结果：命中第 21、53、54、55、56、59、95、187、196、291、292、293、294、297、300、322、324 行。
  - 结论：必要分类、章节与下一步执行选项均可搜索到。
- 命令：`$dangerPattern = ("已" + "删除") + "|" + ("已" + "移动") + "|" + ("已" + "归档"); Select-String -Path .codex\pruning-dry-run-report.md -Pattern $dangerPattern`
  - 结果：无输出。
  - 结论：危险措辞检查无命中。
- 命令：`Test-Path .codex\pruning-dry-run-data.json`
  - 结果：`False`
  - 结论：临时中间数据文件不存在，符合 Task 4 要求。
- 命令：`git status --short`
  - 结果：初始执行无输出；回填本节后复验为 ` M .codex/pruning-dry-run-report.md`。
  - 结论：仅报告文件发生变更，符合 Task 4 修改边界。

### 10.3 暂存与提交前检查

- 命令：`git add -- .codex/pruning-dry-run-report.md`
  - 结果：命令成功。
  - 结论：仅暂存 dry-run 报告。
- 命令：`git diff --cached --check`
  - 结果：无输出。
  - 结论：缓存区补丁未发现空白错误。
- 命令：`git diff --cached --name-only`
  - 结果：`.codex/pruning-dry-run-report.md`
  - 结论：缓存区只包含允许修改的报告文件。
- 命令：`git commit -m "记录 dry-run 报告验证结果"`
  - 结果：命令成功。
  - 结论：提交信息符合 Task 4 要求。
