# 批次 A：上下文摘要归档待移动清单

生成时间：2026-06-04 02:47:02

## 1. 执行边界

- 本文档是待移动清单，不是归档执行记录。
- 本轮只扫描 `.codex/context-summary-*.md`。
- 本轮不创建归档目录，不移动文件，不删除文件。
- 真实归档前必须由用户确认本文档中的待移动清单。

## 2. 默认暂缓规则

- `git status` 标记为未跟踪或已有改动的上下文摘要暂缓。
- 最近 7 天内更新的上下文摘要暂缓，按日期边界计算。
- 文件名命中 `real-llm`、`judge`、`bookrun`、`timeline`、`audit`、`openapi`、`sqlite`、`repair`、`项目剪枝` 的上下文摘要暂缓。
- 未命中暂缓规则的旧上下文摘要进入待用户确认移动清单。

## 3. 扫描统计

- 上下文摘要总数：229
- 待用户确认移动：108
- 暂缓或人工确认：121

## 4. 待移动清单

以下条目只是建议移动清单。用户确认前不得执行表格中的任何移动。

| 序号 | 源路径 | 建议目标路径 | 修改时间 | 字节数 | 理由 | 回滚命令 |
| --- | --- | --- | --- | ---: | --- | --- |
| 1 | .codex/context-summary-20w-mystery-chain.md | .codex/archive/context-summaries/context-summary-20w-mystery-chain.md | 2026-05-24 04:11:38 | 1370 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-20w-mystery-chain.md' -Destination '.codex/context-summary-20w-mystery-chain.md' |
| 2 | .codex/context-summary-api-model-run-failure.md | .codex/archive/context-summaries/context-summary-api-model-run-failure.md | 2026-05-27 00:03:25 | 3239 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-api-model-run-failure.md' -Destination '.codex/context-summary-api-model-run-failure.md' |
| 3 | .codex/context-summary-batch-refinery.md | .codex/archive/context-summaries/context-summary-batch-refinery.md | 2026-05-16 00:28:14 | 2906 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-batch-refinery.md' -Destination '.codex/context-summary-batch-refinery.md' |
| 4 | .codex/context-summary-code-review.md | .codex/archive/context-summaries/context-summary-code-review.md | 2026-05-24 21:44:40 | 3160 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-code-review.md' -Destination '.codex/context-summary-code-review.md' |
| 5 | .codex/context-summary-compiled-contexts-persistence.md | .codex/archive/context-summaries/context-summary-compiled-contexts-persistence.md | 2026-05-19 19:17:15 | 3927 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-compiled-contexts-persistence.md' -Destination '.codex/context-summary-compiled-contexts-persistence.md' |
| 6 | .codex/context-summary-context-pipeline-refactor.md | .codex/archive/context-summaries/context-summary-context-pipeline-refactor.md | 2026-05-24 21:44:40 | 3107 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-context-pipeline-refactor.md' -Destination '.codex/context-summary-context-pipeline-refactor.md' |
| 7 | .codex/context-summary-creative-tool-registry.md | .codex/archive/context-summaries/context-summary-creative-tool-registry.md | 2026-05-27 00:02:47 | 7231 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-creative-tool-registry.md' -Destination '.codex/context-summary-creative-tool-registry.md' |
| 8 | .codex/context-summary-creative-tool-visibility.md | .codex/archive/context-summaries/context-summary-creative-tool-visibility.md | 2026-05-27 00:03:24 | 5522 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-creative-tool-visibility.md' -Destination '.codex/context-summary-creative-tool-visibility.md' |
| 9 | .codex/context-summary-docker-prod-compose.md | .codex/archive/context-summaries/context-summary-docker-prod-compose.md | 2026-05-26 23:17:23 | 3969 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-docker-prod-compose.md' -Destination '.codex/context-summary-docker-prod-compose.md' |
| 10 | .codex/context-summary-end-to-end-closure.md | .codex/archive/context-summaries/context-summary-end-to-end-closure.md | 2026-05-21 00:58:22 | 5807 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-end-to-end-closure.md' -Destination '.codex/context-summary-end-to-end-closure.md' |
| 11 | .codex/context-summary-four-risk-closure.md | .codex/archive/context-summaries/context-summary-four-risk-closure.md | 2026-05-20 19:23:56 | 3351 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-four-risk-closure.md' -Destination '.codex/context-summary-four-risk-closure.md' |
| 12 | .codex/context-summary-github-publish.md | .codex/archive/context-summaries/context-summary-github-publish.md | 2026-05-16 01:51:24 | 951 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-github-publish.md' -Destination '.codex/context-summary-github-publish.md' |
| 13 | .codex/context-summary-hardening.md | .codex/archive/context-summaries/context-summary-hardening.md | 2026-05-21 19:03:08 | 4860 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-hardening.md' -Destination '.codex/context-summary-hardening.md' |
| 14 | .codex/context-summary-legacy-fixes.md | .codex/archive/context-summaries/context-summary-legacy-fixes.md | 2026-05-21 17:35:39 | 6137 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-legacy-fixes.md' -Destination '.codex/context-summary-legacy-fixes.md' |
| 15 | .codex/context-summary-module-isolation.md | .codex/archive/context-summaries/context-summary-module-isolation.md | 2026-05-24 21:44:40 | 5938 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-module-isolation.md' -Destination '.codex/context-summary-module-isolation.md' |
| 16 | .codex/context-summary-p8-009-workflow-runner-sink-isolation.md | .codex/archive/context-summaries/context-summary-p8-009-workflow-runner-sink-isolation.md | 2026-05-26 23:16:37 | 4947 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-p8-009-workflow-runner-sink-isolation.md' -Destination '.codex/context-summary-p8-009-workflow-runner-sink-isolation.md' |
| 17 | .codex/context-summary-P8-010-provider-fallback.md | .codex/archive/context-summaries/context-summary-P8-010-provider-fallback.md | 2026-05-26 23:17:35 | 5305 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-P8-010-provider-fallback.md' -Destination '.codex/context-summary-P8-010-provider-fallback.md' |
| 18 | .codex/context-summary-p8-011-p8-012-web-polling-evaluations.md | .codex/archive/context-summaries/context-summary-p8-011-p8-012-web-polling-evaluations.md | 2026-05-26 23:18:06 | 3422 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-p8-011-p8-012-web-polling-evaluations.md' -Destination '.codex/context-summary-p8-011-p8-012-web-polling-evaluations.md' |
| 19 | .codex/context-summary-performance-optimization.md | .codex/archive/context-summaries/context-summary-performance-optimization.md | 2026-05-20 15:12:55 | 29667 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-performance-optimization.md' -Destination '.codex/context-summary-performance-optimization.md' |
| 20 | .codex/context-summary-ph5-ph6-closure.md | .codex/archive/context-summaries/context-summary-ph5-ph6-closure.md | 2026-05-20 17:46:41 | 6142 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-ph5-ph6-closure.md' -Destination '.codex/context-summary-ph5-ph6-closure.md' |
| 21 | .codex/context-summary-ph7.md | .codex/archive/context-summaries/context-summary-ph7.md | 2026-05-20 18:23:37 | 4736 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-ph7.md' -Destination '.codex/context-summary-ph7.md' |
| 22 | .codex/context-summary-phase2.md | .codex/archive/context-summaries/context-summary-phase2.md | 2026-05-15 23:13:32 | 7214 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase2.md' -Destination '.codex/context-summary-phase2.md' |
| 23 | .codex/context-summary-phase3-acceptance.md | .codex/archive/context-summaries/context-summary-phase3-acceptance.md | 2026-05-16 22:03:53 | 2533 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase3-acceptance.md' -Destination '.codex/context-summary-phase3-acceptance.md' |
| 24 | .codex/context-summary-phase4-planning.md | .codex/archive/context-summaries/context-summary-phase4-planning.md | 2026-05-17 18:18:40 | 3641 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase4-planning.md' -Destination '.codex/context-summary-phase4-planning.md' |
| 25 | .codex/context-summary-phase6-contract-index-and-data-link.md | .codex/archive/context-summaries/context-summary-phase6-contract-index-and-data-link.md | 2026-05-27 00:03:25 | 2457 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase6-contract-index-and-data-link.md' -Destination '.codex/context-summary-phase6-contract-index-and-data-link.md' |
| 26 | .codex/context-summary-phase6-real-data-contract.md | .codex/archive/context-summaries/context-summary-phase6-real-data-contract.md | 2026-05-27 00:03:24 | 2564 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase6-real-data-contract.md' -Destination '.codex/context-summary-phase6-real-data-contract.md' |
| 27 | .codex/context-summary-phase6-registry-trace.md | .codex/archive/context-summaries/context-summary-phase6-registry-trace.md | 2026-05-19 19:17:15 | 3162 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase6-registry-trace.md' -Destination '.codex/context-summary-phase6-registry-trace.md' |
| 28 | .codex/context-summary-phase6-single-source-spike.md | .codex/archive/context-summaries/context-summary-phase6-single-source-spike.md | 2026-05-19 19:17:15 | 3085 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase6-single-source-spike.md' -Destination '.codex/context-summary-phase6-single-source-spike.md' |
| 29 | .codex/context-summary-phase-6-studio.md | .codex/archive/context-summaries/context-summary-phase-6-studio.md | 2026-05-27 00:03:24 | 3932 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase-6-studio.md' -Destination '.codex/context-summary-phase-6-studio.md' |
| 30 | .codex/context-summary-phase6-studio-chapter-goals.md | .codex/archive/context-summaries/context-summary-phase6-studio-chapter-goals.md | 2026-05-27 00:03:24 | 3648 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase6-studio-chapter-goals.md' -Destination '.codex/context-summary-phase6-studio-chapter-goals.md' |
| 31 | .codex/context-summary-phase6-studio-scene-packet.md | .codex/archive/context-summaries/context-summary-phase6-studio-scene-packet.md | 2026-05-27 00:03:25 | 3540 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase6-studio-scene-packet.md' -Destination '.codex/context-summary-phase6-studio-scene-packet.md' |
| 32 | .codex/context-summary-phase7-full-closure.md | .codex/archive/context-summaries/context-summary-phase7-full-closure.md | 2026-05-27 00:03:25 | 5539 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase7-full-closure.md' -Destination '.codex/context-summary-phase7-full-closure.md' |
| 33 | .codex/context-summary-phase7-release-governance.md | .codex/archive/context-summaries/context-summary-phase7-release-governance.md | 2026-05-20 00:48:05 | 3479 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase7-release-governance.md' -Destination '.codex/context-summary-phase7-release-governance.md' |
| 34 | .codex/context-summary-phase8-dev-plan-review.md | .codex/archive/context-summaries/context-summary-phase8-dev-plan-review.md | 2026-05-26 22:55:10 | 3301 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase8-dev-plan-review.md' -Destination '.codex/context-summary-phase8-dev-plan-review.md' |
| 35 | .codex/context-summary-phase8-runtime-rc-freeze.md | .codex/archive/context-summaries/context-summary-phase8-runtime-rc-freeze.md | 2026-05-25 15:12:48 | 6264 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase8-runtime-rc-freeze.md' -Destination '.codex/context-summary-phase8-runtime-rc-freeze.md' |
| 36 | .codex/context-summary-phase-closure-20260518.md | .codex/archive/context-summaries/context-summary-phase-closure-20260518.md | 2026-05-19 19:17:15 | 3767 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-phase-closure-20260518.md' -Destination '.codex/context-summary-phase-closure-20260518.md' |
| 37 | .codex/context-summary-project-analysis.md | .codex/archive/context-summaries/context-summary-project-analysis.md | 2026-05-21 11:11:49 | 2456 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-project-analysis.md' -Destination '.codex/context-summary-project-analysis.md' |
| 38 | .codex/context-summary-ProviderGateway配置真实化.md | .codex/archive/context-summaries/context-summary-ProviderGateway配置真实化.md | 2026-05-27 00:03:25 | 3799 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-ProviderGateway配置真实化.md' -Destination '.codex/context-summary-ProviderGateway配置真实化.md' |
| 39 | .codex/context-summary-retrieval-refresh-realization.md | .codex/archive/context-summaries/context-summary-retrieval-refresh-realization.md | 2026-05-27 00:03:24 | 3561 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-retrieval-refresh-realization.md' -Destination '.codex/context-summary-retrieval-refresh-realization.md' |
| 40 | .codex/context-summary-run-full-flow.md | .codex/archive/context-summaries/context-summary-run-full-flow.md | 2026-05-27 00:03:24 | 3870 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-run-full-flow.md' -Destination '.codex/context-summary-run-full-flow.md' |
| 41 | .codex/context-summary-runtime-contract-governance.md | .codex/archive/context-summaries/context-summary-runtime-contract-governance.md | 2026-05-25 13:47:38 | 6373 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-runtime-contract-governance.md' -Destination '.codex/context-summary-runtime-contract-governance.md' |
| 42 | .codex/context-summary-runtime-diagnostics.md | .codex/archive/context-summaries/context-summary-runtime-diagnostics.md | 2026-05-25 03:43:15 | 5715 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-runtime-diagnostics.md' -Destination '.codex/context-summary-runtime-diagnostics.md' |
| 43 | .codex/context-summary-runtime-gate.md | .codex/archive/context-summaries/context-summary-runtime-gate.md | 2026-05-25 04:40:57 | 6708 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-runtime-gate.md' -Destination '.codex/context-summary-runtime-gate.md' |
| 44 | .codex/context-summary-ScenePacket接入ContextCompiler.md | .codex/archive/context-summaries/context-summary-ScenePacket接入ContextCompiler.md | 2026-05-19 19:17:15 | 2706 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-ScenePacket接入ContextCompiler.md' -Destination '.codex/context-summary-ScenePacket接入ContextCompiler.md' |
| 45 | .codex/context-summary-step-1-1a.md | .codex/archive/context-summaries/context-summary-step-1-1a.md | 2026-05-26 15:31:51 | 3833 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-1-1a.md' -Destination '.codex/context-summary-step-1-1a.md' |
| 46 | .codex/context-summary-step-a-1.md | .codex/archive/context-summaries/context-summary-step-a-1.md | 2026-05-25 21:40:48 | 2260 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-a-1.md' -Destination '.codex/context-summary-step-a-1.md' |
| 47 | .codex/context-summary-step-a-2.md | .codex/archive/context-summaries/context-summary-step-a-2.md | 2026-05-25 22:37:49 | 4424 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-a-2.md' -Destination '.codex/context-summary-step-a-2.md' |
| 48 | .codex/context-summary-step-a-3a.md | .codex/archive/context-summaries/context-summary-step-a-3a.md | 2026-05-25 23:24:07 | 2627 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-a-3a.md' -Destination '.codex/context-summary-step-a-3a.md' |
| 49 | .codex/context-summary-step-a-4.md | .codex/archive/context-summaries/context-summary-step-a-4.md | 2026-05-26 00:06:52 | 1373 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-a-4.md' -Destination '.codex/context-summary-step-a-4.md' |
| 50 | .codex/context-summary-step-a-5.md | .codex/archive/context-summaries/context-summary-step-a-5.md | 2026-05-26 00:14:41 | 1068 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-a-5.md' -Destination '.codex/context-summary-step-a-5.md' |
| 51 | .codex/context-summary-step-a-6b.md | .codex/archive/context-summaries/context-summary-step-a-6b.md | 2026-05-26 00:40:59 | 1120 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-a-6b.md' -Destination '.codex/context-summary-step-a-6b.md' |
| 52 | .codex/context-summary-step-a-7.md | .codex/archive/context-summaries/context-summary-step-a-7.md | 2026-05-26 00:55:59 | 3498 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-a-7.md' -Destination '.codex/context-summary-step-a-7.md' |
| 53 | .codex/context-summary-step-b-1a.md | .codex/archive/context-summaries/context-summary-step-b-1a.md | 2026-05-27 00:03:24 | 3152 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-b-1a.md' -Destination '.codex/context-summary-step-b-1a.md' |
| 54 | .codex/context-summary-step-b-1b.md | .codex/archive/context-summaries/context-summary-step-b-1b.md | 2026-05-27 00:03:24 | 2035 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-b-1b.md' -Destination '.codex/context-summary-step-b-1b.md' |
| 55 | .codex/context-summary-step-b-2.md | .codex/archive/context-summaries/context-summary-step-b-2.md | 2026-05-27 00:02:47 | 1654 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-b-2.md' -Destination '.codex/context-summary-step-b-2.md' |
| 56 | .codex/context-summary-step-b-3.md | .codex/archive/context-summaries/context-summary-step-b-3.md | 2026-05-27 00:03:24 | 2003 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-b-3.md' -Destination '.codex/context-summary-step-b-3.md' |
| 57 | .codex/context-summary-step-c-1.md | .codex/archive/context-summaries/context-summary-step-c-1.md | 2026-05-27 00:03:25 | 2598 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-c-1.md' -Destination '.codex/context-summary-step-c-1.md' |
| 58 | .codex/context-summary-step-c-2.md | .codex/archive/context-summaries/context-summary-step-c-2.md | 2026-05-27 00:03:25 | 1767 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-c-2.md' -Destination '.codex/context-summary-step-c-2.md' |
| 59 | .codex/context-summary-step-d-1a.md | .codex/archive/context-summaries/context-summary-step-d-1a.md | 2026-05-27 00:02:47 | 2108 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-d-1a.md' -Destination '.codex/context-summary-step-d-1a.md' |
| 60 | .codex/context-summary-step-d-1b.md | .codex/archive/context-summaries/context-summary-step-d-1b.md | 2026-05-26 02:05:37 | 4003 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-d-1b.md' -Destination '.codex/context-summary-step-d-1b.md' |
| 61 | .codex/context-summary-step-d-2.md | .codex/archive/context-summaries/context-summary-step-d-2.md | 2026-05-26 02:16:51 | 3228 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-d-2.md' -Destination '.codex/context-summary-step-d-2.md' |
| 62 | .codex/context-summary-step-e-1.md | .codex/archive/context-summaries/context-summary-step-e-1.md | 2026-05-26 02:33:13 | 2979 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-e-1.md' -Destination '.codex/context-summary-step-e-1.md' |
| 63 | .codex/context-summary-step-e-2a.md | .codex/archive/context-summaries/context-summary-step-e-2a.md | 2026-05-27 00:03:25 | 3670 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-e-2a.md' -Destination '.codex/context-summary-step-e-2a.md' |
| 64 | .codex/context-summary-step-e-2b.md | .codex/archive/context-summaries/context-summary-step-e-2b.md | 2026-05-27 00:03:25 | 3911 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-e-2b.md' -Destination '.codex/context-summary-step-e-2b.md' |
| 65 | .codex/context-summary-step-e-3.md | .codex/archive/context-summaries/context-summary-step-e-3.md | 2026-05-27 00:03:24 | 3232 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-e-3.md' -Destination '.codex/context-summary-step-e-3.md' |
| 66 | .codex/context-summary-step-f-1.md | .codex/archive/context-summaries/context-summary-step-f-1.md | 2026-05-27 00:03:24 | 4184 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-f-1.md' -Destination '.codex/context-summary-step-f-1.md' |
| 67 | .codex/context-summary-step-f-2.md | .codex/archive/context-summaries/context-summary-step-f-2.md | 2026-05-27 00:03:24 | 3779 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-f-2.md' -Destination '.codex/context-summary-step-f-2.md' |
| 68 | .codex/context-summary-step-g-1.md | .codex/archive/context-summaries/context-summary-step-g-1.md | 2026-05-27 00:03:25 | 3125 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-g-1.md' -Destination '.codex/context-summary-step-g-1.md' |
| 69 | .codex/context-summary-step-g-2.md | .codex/archive/context-summaries/context-summary-step-g-2.md | 2026-05-26 14:43:51 | 3615 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-step-g-2.md' -Destination '.codex/context-summary-step-g-2.md' |
| 70 | .codex/context-summary-storyforge-master-replan.md | .codex/archive/context-summaries/context-summary-storyforge-master-replan.md | 2026-05-17 18:35:41 | 7587 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-storyforge-master-replan.md' -Destination '.codex/context-summary-storyforge-master-replan.md' |
| 71 | .codex/context-summary-story-memory-persistence.md | .codex/archive/context-summaries/context-summary-story-memory-persistence.md | 2026-05-19 19:17:15 | 2333 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-story-memory-persistence.md' -Destination '.codex/context-summary-story-memory-persistence.md' |
| 72 | .codex/context-summary-studio-approve-execution.md | .codex/archive/context-summaries/context-summary-studio-approve-execution.md | 2026-05-21 00:17:01 | 4674 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-studio-approve-execution.md' -Destination '.codex/context-summary-studio-approve-execution.md' |
| 73 | .codex/context-summary-studio-book-list-api.md | .codex/archive/context-summaries/context-summary-studio-book-list-api.md | 2026-05-19 19:17:15 | 3540 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-studio-book-list-api.md' -Destination '.codex/context-summary-studio-book-list-api.md' |
| 74 | .codex/context-summary-studio-flow.md | .codex/archive/context-summaries/context-summary-studio-flow.md | 2026-05-27 00:03:24 | 5379 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-studio-flow.md' -Destination '.codex/context-summary-studio-flow.md' |
| 75 | .codex/context-summary-studio-governance-garble-guard.md | .codex/archive/context-summaries/context-summary-studio-governance-garble-guard.md | 2026-05-21 10:33:14 | 3128 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-studio-governance-garble-guard.md' -Destination '.codex/context-summary-studio-governance-garble-guard.md' |
| 76 | .codex/context-summary-studio-server-action-closure.md | .codex/archive/context-summaries/context-summary-studio-server-action-closure.md | 2026-05-21 10:22:33 | 3808 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-studio-server-action-closure.md' -Destination '.codex/context-summary-studio-server-action-closure.md' |
| 77 | .codex/context-summary-studio-summary.md | .codex/archive/context-summaries/context-summary-studio-summary.md | 2026-05-20 19:08:30 | 2899 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-studio-summary.md' -Destination '.codex/context-summary-studio-summary.md' |
| 78 | .codex/context-summary-task-1.md | .codex/archive/context-summaries/context-summary-task-1.md | 2026-05-27 00:03:25 | 4639 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-task-1.md' -Destination '.codex/context-summary-task-1.md' |
| 79 | .codex/context-summary-task-2.md | .codex/archive/context-summaries/context-summary-task-2.md | 2026-05-27 00:02:47 | 5248 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-task-2.md' -Destination '.codex/context-summary-task-2.md' |
| 80 | .codex/context-summary-task-3.md | .codex/archive/context-summaries/context-summary-task-3.md | 2026-05-12 23:41:02 | 3244 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-task-3.md' -Destination '.codex/context-summary-task-3.md' |
| 81 | .codex/context-summary-task-4.md | .codex/archive/context-summaries/context-summary-task-4.md | 2026-05-13 00:51:30 | 4544 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-task-4.md' -Destination '.codex/context-summary-task-4.md' |
| 82 | .codex/context-summary-task-5.md | .codex/archive/context-summaries/context-summary-task-5.md | 2026-05-13 01:47:50 | 3068 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-task-5.md' -Destination '.codex/context-summary-task-5.md' |
| 83 | .codex/context-summary-task-6.md | .codex/archive/context-summaries/context-summary-task-6.md | 2026-05-13 02:47:24 | 3936 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-task-6.md' -Destination '.codex/context-summary-task-6.md' |
| 84 | .codex/context-summary-task-7.md | .codex/archive/context-summaries/context-summary-task-7.md | 2026-05-13 03:11:31 | 2720 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-task-7.md' -Destination '.codex/context-summary-task-7.md' |
| 85 | .codex/context-summary-task-8.md | .codex/archive/context-summaries/context-summary-task-8.md | 2026-05-13 10:12:16 | 3881 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-task-8.md' -Destination '.codex/context-summary-task-8.md' |
| 86 | .codex/context-summary-task-9.md | .codex/archive/context-summaries/context-summary-task-9.md | 2026-05-13 11:44:07 | 2784 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-task-9.md' -Destination '.codex/context-summary-task-9.md' |
| 87 | .codex/context-summary-task-9-spec-fix.md | .codex/archive/context-summaries/context-summary-task-9-spec-fix.md | 2026-05-13 11:35:06 | 2613 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-task-9-spec-fix.md' -Destination '.codex/context-summary-task-9-spec-fix.md' |
| 88 | .codex/context-summary-web-studio-book-list-read.md | .codex/archive/context-summaries/context-summary-web-studio-book-list-read.md | 2026-05-27 00:03:24 | 3283 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-web-studio-book-list-read.md' -Destination '.codex/context-summary-web-studio-book-list-read.md' |
| 89 | .codex/context-summary-workflow-api-adapter.md | .codex/archive/context-summaries/context-summary-workflow-api-adapter.md | 2026-05-21 00:13:28 | 5711 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-workflow-api-adapter.md' -Destination '.codex/context-summary-workflow-api-adapter.md' |
| 90 | .codex/context-summary-workflow-model-run-link.md | .codex/archive/context-summaries/context-summary-workflow-model-run-link.md | 2026-05-27 00:03:24 | 3804 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-workflow-model-run-link.md' -Destination '.codex/context-summary-workflow-model-run-link.md' |
| 91 | .codex/context-summary-workflow-model-run-sink.md | .codex/archive/context-summaries/context-summary-workflow-model-run-sink.md | 2026-05-27 00:03:24 | 2874 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-workflow-model-run-sink.md' -Destination '.codex/context-summary-workflow-model-run-sink.md' |
| 92 | .codex/context-summary-workflow-state-references.md | .codex/archive/context-summaries/context-summary-workflow-state-references.md | 2026-05-19 19:17:15 | 3137 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-workflow-state-references.md' -Destination '.codex/context-summary-workflow-state-references.md' |
| 93 | .codex/context-summary-worldbuilding-router.md | .codex/archive/context-summaries/context-summary-worldbuilding-router.md | 2026-05-24 21:44:40 | 2237 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-worldbuilding-router.md' -Destination '.codex/context-summary-worldbuilding-router.md' |
| 94 | .codex/context-summary-编码与运维一致性三轮.md | .codex/archive/context-summaries/context-summary-编码与运维一致性三轮.md | 2026-05-18 15:28:14 | 2963 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-编码与运维一致性三轮.md' -Destination '.codex/context-summary-编码与运维一致性三轮.md' |
| 95 | .codex/context-summary-发布治理三轮.md | .codex/archive/context-summaries/context-summary-发布治理三轮.md | 2026-05-18 11:30:22 | 2487 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-发布治理三轮.md' -Destination '.codex/context-summary-发布治理三轮.md' |
| 96 | .codex/context-summary-根据-agents-修改计划.md | .codex/archive/context-summaries/context-summary-根据-agents-修改计划.md | 2026-05-12 14:17:37 | 3608 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-根据-agents-修改计划.md' -Destination '.codex/context-summary-根据-agents-修改计划.md' |
| 97 | .codex/context-summary-工程计划.md | .codex/archive/context-summaries/context-summary-工程计划.md | 2026-05-12 16:27:33 | 1763 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-工程计划.md' -Destination '.codex/context-summary-工程计划.md' |
| 98 | .codex/context-summary-架构改造第一轮.md | .codex/archive/context-summaries/context-summary-架构改造第一轮.md | 2026-05-19 19:17:15 | 3871 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-架构改造第一轮.md' -Destination '.codex/context-summary-架构改造第一轮.md' |
| 99 | .codex/context-summary-竞品调研.md | .codex/archive/context-summaries/context-summary-竞品调研.md | 2026-05-27 00:03:24 | 1132 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-竞品调研.md' -Destination '.codex/context-summary-竞品调研.md' |
| 100 | .codex/context-summary-竞品架构横评.md | .codex/archive/context-summaries/context-summary-竞品架构横评.md | 2026-05-18 16:29:41 | 4198 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-竞品架构横评.md' -Destination '.codex/context-summary-竞品架构横评.md' |
| 101 | .codex/context-summary-竞品架构横评落地修改.md | .codex/archive/context-summaries/context-summary-竞品架构横评落地修改.md | 2026-05-18 16:43:11 | 3665 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-竞品架构横评落地修改.md' -Destination '.codex/context-summary-竞品架构横评落地修改.md' |
| 102 | .codex/context-summary-三轮连续推进.md | .codex/archive/context-summaries/context-summary-三轮连续推进.md | 2026-05-18 10:54:24 | 2949 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-三轮连续推进.md' -Destination '.codex/context-summary-三轮连续推进.md' |
| 103 | .codex/context-summary-上线前全量整改.md | .codex/archive/context-summaries/context-summary-上线前全量整改.md | 2026-05-21 13:06:28 | 2542 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-上线前全量整改.md' -Destination '.codex/context-summary-上线前全量整改.md' |
| 104 | .codex/context-summary-上线前终审报告.md | .codex/archive/context-summaries/context-summary-上线前终审报告.md | 2026-05-24 22:23:26 | 3979 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-上线前终审报告.md' -Destination '.codex/context-summary-上线前终审报告.md' |
| 105 | .codex/context-summary-外部优秀方案吸收.md | .codex/archive/context-summaries/context-summary-外部优秀方案吸收.md | 2026-05-27 00:03:25 | 2400 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-外部优秀方案吸收.md' -Destination '.codex/context-summary-外部优秀方案吸收.md' |
| 106 | .codex/context-summary-项目体检.md | .codex/archive/context-summaries/context-summary-项目体检.md | 2026-05-25 19:31:35 | 4525 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-项目体检.md' -Destination '.codex/context-summary-项目体检.md' |
| 107 | .codex/context-summary-项目总结推送.md | .codex/archive/context-summaries/context-summary-项目总结推送.md | 2026-05-20 17:11:09 | 3316 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-项目总结推送.md' -Destination '.codex/context-summary-项目总结推送.md' |
| 108 | .codex/context-summary-终审压力测试.md | .codex/archive/context-summaries/context-summary-终审压力测试.md | 2026-05-21 18:35:51 | 1628 | 旧上下文摘要，未命中本轮暂缓规则；仍需用户确认后才能移动。 | Move-Item -LiteralPath '.codex/archive/context-summaries/context-summary-终审压力测试.md' -Destination '.codex/context-summary-终审压力测试.md' |

## 5. 暂缓清单

以下条目暂不进入批次 A 自动归档范围，需要后续按具体上下文人工判断。

| 序号 | 源路径 | 修改时间 | Git 状态 | 字节数 | 暂缓理由 |
| --- | --- | --- | --- | ---: | --- |
| 1 | .codex/context-summary-9B-real-llm-smoke.md | 2026-05-28 01:57:33 |  | 4673 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 2 | .codex/context-summary-assistant-artifact-export.md | 2026-06-02 17:42:46 |  | 3995 | 最近 7 天内更新。 |
| 3 | .codex/context-summary-assistant-artifact-export-p0.md | 2026-06-03 04:12:12 |  | 5697 | 最近 7 天内更新。 |
| 4 | .codex/context-summary-assistant-browser-session.md | 2026-06-03 02:46:53 |  | 5436 | 最近 7 天内更新。 |
| 5 | .codex/context-summary-assistant-chapter-review-active-create.md | 2026-06-03 00:03:20 |  | 3229 | 最近 7 天内更新。 |
| 6 | .codex/context-summary-assistant-chapter-review-natural-target.md | 2026-06-03 00:32:29 |  | 5894 | 最近 7 天内更新。 |
| 7 | .codex/context-summary-assistant-chapter-review-summary.md | 2026-06-02 17:37:03 |  | 3801 | 最近 7 天内更新。 |
| 8 | .codex/context-summary-assistant-continuous-session.md | 2026-06-03 02:23:13 |  | 6657 | 最近 7 天内更新。 |
| 9 | .codex/context-summary-assistant-recent-sessions.md | 2026-06-03 03:58:43 |  | 5273 | 最近 7 天内更新。 |
| 10 | .codex/context-summary-assistant-session-bookrun-closure.md | 2026-06-02 17:47:03 |  | 4597 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 11 | .codex/context-summary-assistant-session-detail-restore.md | 2026-06-03 05:04:19 |  | 6673 | 最近 7 天内更新。 |
| 12 | .codex/context-summary-assistant-session-persistence.md | 2026-06-02 21:57:30 |  | 7938 | 最近 7 天内更新。 |
| 13 | .codex/context-summary-bookrun-eventsource-hooks-lint.md | 2026-05-29 16:32:12 |  | 3036 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 14 | .codex/context-summary-bookrun-production-dispatch.md | 2026-06-01 13:50:46 |  | 2534 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 15 | .codex/context-summary-bookrun-timeline-sync.md | 2026-06-02 21:57:39 |  | 4037 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 16 | .codex/context-summary-bookrun-volume-contract.md | 2026-06-02 18:32:54 |  | 6253 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 17 | .codex/context-summary-bookrun-workflow-adapter.md | 2026-06-01 03:56:06 |  | 6969 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 18 | .codex/context-summary-character-bible-version-sync.md | 2026-06-02 19:30:49 |  | 3682 | 最近 7 天内更新。 |
| 19 | .codex/context-summary-ci-fix.md | 2026-05-28 02:53:59 |  | 3415 | 最近 7 天内更新。 |
| 20 | .codex/context-summary-ci-local-verify-alignment.md | 2026-05-29 17:07:50 |  | 2768 | 最近 7 天内更新。 |
| 21 | .codex/context-summary-ci-prettier-format.md | 2026-05-29 16:46:38 |  | 2625 | 最近 7 天内更新。 |
| 22 | .codex/context-summary-dev-plan.md | 2026-05-28 01:57:33 |  | 7066 | 最近 7 天内更新。 |
| 23 | .codex/context-summary-fix-phase9b-prior-chapter.md | 2026-05-31 03:18:39 |  | 3075 | 最近 7 天内更新。 |
| 24 | .codex/context-summary-foreshadow-lifecycle.md | 2026-06-02 18:40:46 |  | 6750 | 最近 7 天内更新。 |
| 25 | .codex/context-summary-foreshadow-read-side.md | 2026-06-02 20:22:22 |  | 4879 | 最近 7 天内更新。 |
| 26 | .codex/context-summary-home-recent-real-data.md | 2026-06-02 00:17:49 |  | 3209 | 最近 7 天内更新。 |
| 27 | .codex/context-summary-home-workbench-views.md | 2026-06-01 22:59:36 | ?? | 2933 | 当前 git status 标记为 ??；最近 7 天内更新。 |
| 28 | .codex/context-summary-local-core-gate-snapshot.md | 2026-06-03 05:50:49 |  | 3792 | 最近 7 天内更新。 |
| 29 | .codex/context-summary-local-e2e-browser-gate.md | 2026-06-03 06:09:58 |  | 7024 | 最近 7 天内更新。 |
| 30 | .codex/context-summary-manual-read-gate.md | 2026-06-02 21:09:29 |  | 4746 | 最近 7 天内更新。 |
| 31 | .codex/context-summary-memory-extract-bridge.md | 2026-06-02 18:42:14 |  | 5718 | 最近 7 天内更新。 |
| 32 | .codex/context-summary-merge-ph2.md | 2026-05-31 21:17:15 |  | 5776 | 最近 7 天内更新。 |
| 33 | .codex/context-summary-next-stage-execution.md | 2026-06-02 21:01:08 |  | 2342 | 最近 7 天内更新。 |
| 34 | .codex/context-summary-novel-loop-skill-runner-integration.md | 2026-05-31 19:38:05 |  | 3644 | 最近 7 天内更新。 |
| 35 | .codex/context-summary-novel-quality-total.md | 2026-05-31 21:06:11 |  | 5639 | 最近 7 天内更新。 |
| 36 | .codex/context-summary-novel-skill-framework.md | 2026-05-31 21:01:16 |  | 6628 | 最近 7 天内更新。 |
| 37 | .codex/context-summary-novel-skill-framework-polish.md | 2026-05-31 03:18:40 |  | 3388 | 最近 7 天内更新。 |
| 38 | .codex/context-summary-novel-skill-framework-post-phase1.md | 2026-05-31 19:31:13 |  | 1784 | 最近 7 天内更新。 |
| 39 | .codex/context-summary-novel-skill-runner.md | 2026-05-31 19:31:13 |  | 3663 | 最近 7 天内更新。 |
| 40 | .codex/context-summary-openapi-verify.md | 2026-05-26 23:17:45 |  | 4140 | 命中高风险或当前链路关键词。 |
| 41 | .codex/context-summary-openapi-volume-progress.md | 2026-06-02 20:23:36 |  | 4196 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 42 | .codex/context-summary-OpenAPI验证治理三轮.md | 2026-05-27 00:03:24 |  | 3072 | 命中高风险或当前链路关键词。 |
| 43 | .codex/context-summary-p2-api-dispatch-resume-retry.md | 2026-06-03 01:32:04 | ?? | 3355 | 当前 git status 标记为 ??；最近 7 天内更新。 |
| 44 | .codex/context-summary-p2-frontend-scale-intent.md | 2026-06-03 01:27:19 | ?? | 3566 | 当前 git status 标记为 ??；最近 7 天内更新。 |
| 45 | .codex/context-summary-p2-longform-readiness-gate.md | 2026-06-03 05:21:40 |  | 5361 | 最近 7 天内更新。 |
| 46 | .codex/context-summary-p2-manual-read-gate-evidence.md | 2026-06-03 05:15:36 |  | 4977 | 最近 7 天内更新。 |
| 47 | .codex/context-summary-p2-real-llm-gate.md | 2026-06-03 05:28:38 |  | 5011 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 48 | .codex/context-summary-ph2-plan.md | 2026-05-31 21:06:50 |  | 7755 | 最近 7 天内更新。 |
| 49 | .codex/context-summary-ph2-task-1.md | 2026-05-31 21:06:50 |  | 2804 | 最近 7 天内更新。 |
| 50 | .codex/context-summary-ph2-task-2.md | 2026-05-31 21:06:50 |  | 2507 | 最近 7 天内更新。 |
| 51 | .codex/context-summary-ph2-task-3.md | 2026-05-31 21:06:50 |  | 1935 | 最近 7 天内更新。 |
| 52 | .codex/context-summary-ph2-task-4.md | 2026-05-31 21:06:50 |  | 3850 | 最近 7 天内更新。 |
| 53 | .codex/context-summary-phase6-studio-judge.md | 2026-05-19 19:17:15 |  | 2942 | 命中高风险或当前链路关键词。 |
| 54 | .codex/context-summary-phase9b.md | 2026-05-28 01:57:33 |  | 4578 | 最近 7 天内更新。 |
| 55 | .codex/context-summary-phase9b-real-llm-smoke.md | 2026-06-02 17:59:52 |  | 6711 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 56 | .codex/context-summary-phase9c.md | 2026-05-28 01:57:33 |  | 4491 | 最近 7 天内更新。 |
| 57 | .codex/context-summary-phase9c-2a.md | 2026-05-28 01:57:33 |  | 3630 | 最近 7 天内更新。 |
| 58 | .codex/context-summary-phase9c-2b.md | 2026-05-28 01:57:33 |  | 3646 | 最近 7 天内更新。 |
| 59 | .codex/context-summary-phase9c-2c.md | 2026-05-28 01:57:33 |  | 2965 | 最近 7 天内更新。 |
| 60 | .codex/context-summary-phase9c-3a.md | 2026-05-28 01:57:33 |  | 3504 | 最近 7 天内更新。 |
| 61 | .codex/context-summary-phase9c-3b.md | 2026-05-28 01:57:33 |  | 3581 | 最近 7 天内更新。 |
| 62 | .codex/context-summary-phase9c-4.md | 2026-05-28 01:57:33 |  | 5381 | 最近 7 天内更新。 |
| 63 | .codex/context-summary-project-health.md | 2026-06-01 13:50:46 |  | 7345 | 最近 7 天内更新。 |
| 64 | .codex/context-summary-project-review.md | 2026-06-02 17:18:30 |  | 11782 | 最近 7 天内更新。 |
| 65 | .codex/context-summary-provider-api-key-settings.md | 2026-06-01 19:05:22 |  | 5090 | 最近 7 天内更新。 |
| 66 | .codex/context-summary-provider-budget-visibility.md | 2026-06-03 01:18:03 | ?? | 5267 | 当前 git status 标记为 ??；最近 7 天内更新。 |
| 67 | .codex/context-summary-provider-resolution-progress.md | 2026-06-02 17:42:48 |  | 4362 | 最近 7 天内更新。 |
| 68 | .codex/context-summary-provider-settings.md | 2026-05-31 03:21:42 |  | 1063 | 最近 7 天内更新。 |
| 69 | .codex/context-summary-real-judge-audit-fix.md | 2026-06-03 17:52:56 | ?? | 3155 | 当前 git status 标记为 ??；最近 7 天内更新；命中高风险或当前链路关键词。 |
| 70 | .codex/context-summary-real-llm.md | 2026-06-03 15:18:14 | ?? | 11388 | 当前 git status 标记为 ??；最近 7 天内更新；命中高风险或当前链路关键词。 |
| 71 | .codex/context-summary-real-llm-10ch-gate.md | 2026-06-03 19:17:17 | ?? | 2752 | 当前 git status 标记为 ??；最近 7 天内更新；命中高风险或当前链路关键词。 |
| 72 | .codex/context-summary-real-llm-1ch-smoke.md | 2026-06-03 14:13:05 | ?? | 3883 | 当前 git status 标记为 ??；最近 7 天内更新；命中高风险或当前链路关键词。 |
| 73 | .codex/context-summary-run-novel-now.md | 2026-06-01 14:08:23 |  | 5188 | 最近 7 天内更新。 |
| 74 | .codex/context-summary-settings-browser-interaction.md | 2026-06-03 03:37:54 |  | 5199 | 最近 7 天内更新。 |
| 75 | .codex/context-summary-skill-audit-recorded-runs.md | 2026-05-31 19:45:19 |  | 3356 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 76 | .codex/context-summary-storyforge-assistant-workflow.md | 2026-06-02 03:53:43 |  | 8563 | 最近 7 天内更新。 |
| 77 | .codex/context-summary-storyforge-vscode-ide.md | 2026-05-28 03:47:01 |  | 4152 | 最近 7 天内更新。 |
| 78 | .codex/context-summary-storyforge-vscode-ide-bookrun-command-state.md | 2026-05-29 04:01:56 |  | 4236 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 79 | .codex/context-summary-storyforge-vscode-ide-final.md | 2026-05-28 11:29:44 |  | 4993 | 最近 7 天内更新。 |
| 80 | .codex/context-summary-storyforge-vscode-ide-p0-legacy-redirects.md | 2026-05-29 04:01:56 |  | 3367 | 最近 7 天内更新。 |
| 81 | .codex/context-summary-storyforge-vscode-ide-p0-legacy-views.md | 2026-05-29 04:01:56 |  | 3567 | 最近 7 天内更新。 |
| 82 | .codex/context-summary-storyforge-vscode-ide-p15-bookrun-events.md | 2026-05-29 04:01:56 |  | 3406 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 83 | .codex/context-summary-storyforge-vscode-ide-p15-command-governance.md | 2026-05-29 04:01:56 |  | 3469 | 最近 7 天内更新。 |
| 84 | .codex/context-summary-storyforge-vscode-ide-p15-entry-links.md | 2026-05-29 04:01:56 |  | 4810 | 最近 7 天内更新。 |
| 85 | .codex/context-summary-storyforge-vscode-ide-p15-exit-audit.md | 2026-05-29 04:01:56 |  | 3873 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 86 | .codex/context-summary-storyforge-vscode-ide-p15-judge-loop.md | 2026-05-29 04:01:56 |  | 5193 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 87 | .codex/context-summary-storyforge-vscode-ide-p1-frontend-real-loop.md | 2026-05-29 04:01:56 |  | 4254 | 最近 7 天内更新。 |
| 88 | .codex/context-summary-storyforge-vscode-ide-p1-page-diagnostics.md | 2026-05-29 04:01:56 |  | 3273 | 最近 7 天内更新。 |
| 89 | .codex/context-summary-storyforge-vscode-ide-p1-persistent-audit-events.md | 2026-05-29 04:01:56 |  | 4057 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 90 | .codex/context-summary-storyforge-vscode-ide-p1-real-commands.md | 2026-05-29 04:01:56 |  | 4804 | 最近 7 天内更新。 |
| 91 | .codex/context-summary-storyforge-vscode-ide-p2-context-inspector.md | 2026-05-29 04:01:56 |  | 3955 | 最近 7 天内更新。 |
| 92 | .codex/context-summary-storyforge-vscode-ide-p2-inspector-load.md | 2026-05-29 04:01:56 |  | 4102 | 最近 7 天内更新。 |
| 93 | .codex/context-summary-storyforge-vscode-ide-p2-trace-context-links.md | 2026-05-29 04:01:56 |  | 4165 | 最近 7 天内更新。 |
| 94 | .codex/context-summary-storyforge-vscode-ide-p3-memory.md | 2026-05-28 10:32:12 |  | 3754 | 最近 7 天内更新。 |
| 95 | .codex/context-summary-storyforge-vscode-ide-p3-story-memory.md | 2026-05-29 04:01:56 |  | 5554 | 最近 7 天内更新。 |
| 96 | .codex/context-summary-storyforge-vscode-ide-p4-bookrun-links.md | 2026-05-29 04:01:56 |  | 3703 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 97 | .codex/context-summary-storyforge-vscode-ide-p4-eventsource-client.md | 2026-05-29 04:01:56 |  | 3872 | 最近 7 天内更新。 |
| 98 | .codex/context-summary-storyforge-vscode-ide-p4-runs.md | 2026-05-28 10:32:12 |  | 2789 | 最近 7 天内更新。 |
| 99 | .codex/context-summary-storyforge-vscode-ide-p5-command-agent.md | 2026-05-28 05:06:30 |  | 3885 | 最近 7 天内更新。 |
| 100 | .codex/context-summary-storyforge-vscode-ide-p5-command-governance-gate.md | 2026-05-29 04:01:56 |  | 2256 | 最近 7 天内更新。 |
| 101 | .codex/context-summary-storyforge-vscode-ide-p6-artifact-preview-load.md | 2026-05-29 04:01:56 |  | 3600 | 最近 7 天内更新。 |
| 102 | .codex/context-summary-storyforge-vscode-ide-p6-artifacts.md | 2026-05-28 05:19:01 |  | 3969 | 最近 7 天内更新。 |
| 103 | .codex/context-summary-storyforge-vscode-ide-p7-personalization.md | 2026-05-28 10:32:12 |  | 4759 | 最近 7 天内更新。 |
| 104 | .codex/context-summary-storyforge-vscode-ide-p7-preferences-writeback.md | 2026-05-29 04:01:56 |  | 3794 | 最近 7 天内更新。 |
| 105 | .codex/context-summary-storyforge-vscode-ide-runtime-budgets.md | 2026-05-29 04:01:56 |  | 4494 | 最近 7 天内更新。 |
| 106 | .codex/context-summary-storyforge-vscode-ide-sse-p95.md | 2026-05-29 04:01:56 |  | 4130 | 最近 7 天内更新。 |
| 107 | .codex/context-summary-storyforge-vscode-ide-url-history.md | 2026-05-29 04:01:56 |  | 3880 | 最近 7 天内更新。 |
| 108 | .codex/context-summary-story-memory-guard.md | 2026-06-02 21:14:46 |  | 5112 | 最近 7 天内更新。 |
| 109 | .codex/context-summary-task-5-api-audit-skill-chain.md | 2026-05-31 19:53:18 |  | 4818 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 110 | .codex/context-summary-task-6-web-skill-chain.md | 2026-05-31 19:59:26 |  | 4065 | 最近 7 天内更新。 |
| 111 | .codex/context-summary-task-7-genre-skill-pack.md | 2026-05-31 20:07:33 |  | 4551 | 最近 7 天内更新。 |
| 112 | .codex/context-summary-timeline-bookrun-sync.md | 2026-06-02 21:14:45 | ?? | 4595 | 当前 git status 标记为 ??；最近 7 天内更新；命中高风险或当前链路关键词。 |
| 113 | .codex/context-summary-timeline-events.md | 2026-06-02 18:23:52 |  | 4920 | 最近 7 天内更新；命中高风险或当前链路关键词。 |
| 114 | .codex/context-summary-uiux.md | 2026-06-01 15:34:15 |  | 5692 | 最近 7 天内更新。 |
| 115 | .codex/context-summary-uiux-main.md | 2026-06-02 02:23:56 |  | 3172 | 最近 7 天内更新。 |
| 116 | .codex/context-summary-volume-plan-dispatch.md | 2026-06-02 20:43:04 |  | 3343 | 最近 7 天内更新。 |
| 117 | .codex/context-summary-workflow-resume-budget.md | 2026-06-03 01:31:08 |  | 5778 | 最近 7 天内更新。 |
| 118 | .codex/context-summary-workflow-volume-progress.md | 2026-06-02 20:02:40 |  | 2772 | 最近 7 天内更新。 |
| 119 | .codex/context-summary-工作流审查.md | 2026-05-31 22:52:10 |  | 6565 | 最近 7 天内更新。 |
| 120 | .codex/context-summary-实施dev-plan.md | 2026-05-28 01:57:33 |  | 3983 | 最近 7 天内更新。 |
| 121 | .codex/context-summary-项目剪枝完善.md | 2026-06-03 16:39:27 | ?? | 4626 | 当前 git status 标记为 ??；最近 7 天内更新；命中高风险或当前链路关键词。 |

## 6. 回滚命令说明

真实归档执行时，每一条移动都必须保留对应回滚命令。若验证失败，按表格中的回滚命令逐项还原。

批量执行前应先创建归档目录：

```powershell
New-Item -ItemType Directory -Force -Path '.codex/archive/context-summaries'
```

## 7. 本地验证

```powershell
Test-Path .codex\pruning-batch-a-context-summary-move-list.md
Select-String -Path .codex\pruning-batch-a-context-summary-move-list.md -Pattern "执行边界|扫描统计|待移动清单|暂缓清单|回滚命令|本地验证"
$dangerPattern = ("已" + "归档真实文件") + "|" + ("已" + "删除真实文件") + "|" + ("已" + "移动真实文件")
Select-String -Path .codex\pruning-batch-a-context-summary-move-list.md -Pattern $dangerPattern
Select-String -Path .codex\pruning-batch-a-context-summary-move-list.md -Pattern '\$\(EscapeCell \@\{|\$\@\{'
git status --short .codex/pruning-batch-a-context-summary-move-list.md
```

## 8. 下一步建议

用户确认后，再进入批次 A 的真实归档执行；执行完成后必须重新生成验证报告并提交。
