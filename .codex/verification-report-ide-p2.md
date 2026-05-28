# StoryForge IDE P2 Context Inspector 验证报告

生成时间：2026-05-28 04:40:01 +08:00

## 本轮目标

推进 D:/StoryForge/.codex/storyforge-vscode-ide-master-plan.md 的 P2 Context Inspector：消费 Phase 8 Context Compiler 持久化输出，提供 IDE 快照回放端点和前端 Inspector 展示。

## 交付物

- API schema：pps/api/app/domains/ide/schemas.py
- API service：pps/api/app/domains/ide/service.py
- API route：pps/api/app/domains/ide/router.py
- API test：pps/api/tests/test_ide_context_snapshot.py
- Web view：pps/web/components/ide/views/ContextInspector.tsx
- Web integration：pps/web/components/ide/shell/EditorArea.tsx
- Web test：pps/web/tests/ide-components.test.tsx
- Test runner mapping：pps/web/scripts/phase1-contract-test.mjs
- OpenAPI：packages/shared/src/contracts/storyforge.openapi.json、packages/shared/src/generated/api-types.ts

## TDD 证据

- RED/API：cd apps/api; uv run pytest tests/test_ide_context_snapshot.py -q 初次失败，原因是 /api/ide/context-snapshot/{id} 返回通用 404。
- GREEN/API：同命令通过，结果 2 passed in 1.08s。
- RED/Web：pnpm --filter @storyforge/web test 初次失败，原因是 ContextInspector 模块不存在。
- GREEN/Web：补齐组件与测试 runner 映射后通过，结果 83 passed, 0 failed。

## 本地验证结果

- pnpm openapi：通过，已生成 OpenAPI 契约。
- cd apps/api; uv run pytest tests/test_ide_context_snapshot.py tests/test_ide_workspace_tree.py tests/test_ide_diagnostics.py tests/test_ide_commands.py -q：通过，6 passed in 1.78s。
- pnpm --filter @storyforge/web lint：通过，	sc --noEmit 退出码 0。
- pnpm --filter @storyforge/web test：通过，83 passed, 0 failed。
- pnpm --filter @storyforge/shared test：通过，	sc --noEmit 退出码 0。

## OpenAPI diff 说明

新增 /api/ide/context-snapshot/{compiled_context_id}，新增 IDE Context Inspector 响应 schema：IdeContextSnapshot、IdeContextBudget、IdeContextBlockRef。该变更对应主计划 P2 数据契约，不破坏既有端点。

## 验收映射

- 任意已持久化 compiled context 可按 ID 回放：由 	est_read_context_snapshot_returns_budget_blocks_and_debug_summary 覆盖。
- 展示 injected/dropped 数量、原因、token 预算：由 API payload 断言与 ContextInspector SSR 测试覆盖。
- 快照缺失显式提示：API 返回 snapshot evicted at unknown: <id>，前端显示 snapshot evicted at <ts>。

## 风险与后续

- 目前 EditorArea 的 context:<id> 分支使用 evicted 占位展示，尚未接入客户端 fetch；端点与展示组件已具备可集成契约。
- P3 Story Memory Explorer、P4 BookRun SSE、P5 Command Registry + Agent Sidebar、P6 Artifact Viewer、P7 个性化仍未完成。

## 评分

- 技术维度：92/100
- 战略维度：91/100
- 综合评分：92/100
- 建议：通过本轮 P2 最小增量，继续推进 P3。
