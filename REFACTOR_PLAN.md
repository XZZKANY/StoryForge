# StoryForge 受控全项目重构计划（第一轮）

日期：2026-07-08  
分支：`codex/refactor-overnight-20260708`

## 启动状态

已执行 `git status --short --branch`，启动时当前分支已经是目标分支：

```text
## codex/refactor-overnight-20260708
?? .agents/
?? .codex/agents/
?? .codex/config.toml
?? .codex/e2e-1-runsheet-remaining.md
?? .codex/hooks.json
?? .codex/hooks/
?? .trellis/
?? AGENTS.md
```

这些路径视为启动前既有未跟踪内容。本轮不会盲目 stage，也不会把既有 Trellis/Codex 配置纳入提交。

## 已读上下文

- `AGENTS.md`
- `CONTEXT.md`
- `docs/internal/current-phase.md`
- `docs/internal/TODO.md`
- `apps/api/app/domains/DOMAINS.md`
- `.trellis/workflow.md`
- `.trellis/spec/guides/index.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`
- `.trellis/spec/guides/code-reuse-thinking-guide.md`
- `.trellis/spec/storyforge-api/backend/index.md` 及该层 guideline 文件
- `.trellis/spec/desktop/frontend/index.md` 及该层 guideline 文件
- `.trellis/spec/shared/backend/index.md`、`.trellis/spec/shared/frontend/index.md` 及 guideline 文件
- `.trellis/spec/storyforge-workflow/backend/index.md` 及该层 guideline 文件

MCP 状态：本线程未暴露项目要求优先使用的 `desktop-commander`、GitHub、tavily/firecrawl；已降级为只读 shell/`rg` 审计。

## 审计结果

1. `apps/web` 目录已经不存在；源码、脚本、测试中的当前引用只剩事实源断言和 `apps/workflow/tests/test_source_pruning.py` 的负向护栏。大量 `apps/web` 命中位于历史计划文档，不应作为本轮维护目标。
2. `apps/api/app/domains/DOMAINS.md` 明确：batch-2 frozen router 需要观察期后再逐域卸载，且 models 多数不可删。本轮不做 frozen router batch-2，也不物理删除 frozen domain 目录。
3. `/health/ready` 是 Desktop sidecar 版本握手和状态栏轮询的 live 面，但后端没有显式 response model，OpenAPI 里是松散 object；前端因此在 `runtime-health.ts` 手写 `ApiRuntimeHealthResponse`。这是低风险 contract 收敛点。
4. Agent WS 已有后端 Pydantic -> `agent-ws.schema.json` -> 前端生成类型链路，但 `apps/desktop/frontend/src/lib/api/types.ts` 仍手写 `agent_run_started` / `agent_step` / `tool_trace` / `permission_required` / control ack 消息形状。可让这些类型从生成帧派生，减少 contract 镜像。
5. 仓库存在三个孤立 ad-hoc WS 手测入口：
   - `scripts/test-agent-websocket.py`
   - `scripts/test-file-revise-llm.py`
   - `apps/desktop/frontend/test-agent-websocket.html`

   `rg` 未发现当前脚本或代码引用它们；正式验证入口已经是 `apps/desktop/frontend/scripts/verify-agent-conversation.mjs` 和 API/desktop 行为测试。它们硬编码本地端口和 `local-dev-key`，且仍按旧 intent/args 示例手测，适合删除以隔离废弃入口。
6. Agent Runtime ToolSpec 已经把 loop tool schema 从 `tooling.py` 派生，仍在 `loop_runtime.py` 缓存 `_TOOL_NAME_MAP` / `_PATCH_TOOLS` / `LOOP_TOOL_SCHEMAS`。现有测试锁定这条派生链，进一步收敛要小心避免把清理变成行为改动。
7. 前端 `BUILTIN_AGENT_ROLE_ALIASES` 与后端 `role_catalog.py` 有重复事实源，但它还承担离线/加载前 fallback。此处属于 UX/契约设计问题，本轮只登记，不直接改。

## 候选批次

### B1. Health live contract 收敛（低风险，执行）

目标：给 `/health/live`、`/health/ready` 增加显式 Pydantic response model，并让 desktop runtime health 前端类型消费生成 contract。

改动面：

- `apps/api/app/domains/health/schemas.py`
- `apps/api/app/domains/health/router.py`
- `apps/api/tests/test_health_probes.py`
- `apps/desktop/frontend/src/lib/api/contracts.ts`
- `apps/desktop/frontend/src/lib/api/runtime-health.ts`
- OpenAPI 生成产物

验证：

- `cd apps/api && uv run pytest tests/test_health_probes.py -q`
- `pnpm openapi`
- `npm --prefix apps/desktop/frontend run typecheck`
- `npm --prefix apps/desktop/frontend run test`

风险：OpenAPI 会发生预期 drift，需要确认只新增/收紧 health response schema，不改变路径行为。

### B2. 前端 Agent WS 类型改为生成帧派生（低风险，执行）

目标：减少前端手写 WS frame 镜像，保留现有 runtime guard 和 null/undefined 容忍语义。

改动面：

- `apps/desktop/frontend/src/lib/api/types.ts`
- 复用现有 `apps/desktop/frontend/src/lib/api/agent-ws.contract.ts` 编译期护栏

验证：

- `npm --prefix apps/desktop/frontend run typecheck`
- `npm --prefix apps/desktop/frontend run test`

风险：纯类型改动；主要风险是生成帧字段恒在而旧前端类型把部分字段建模为可选，需要用派生 helper 保持现有调用点兼容。

### B3. 删除孤立 ad-hoc WS 手测入口（低风险，执行）

目标：隔离废弃入口，避免未来继续维护旧手测脚本或旧 HTML 测试页。

改动面：

- 删除 `scripts/test-agent-websocket.py`
- 删除 `scripts/test-file-revise-llm.py`
- 删除 `apps/desktop/frontend/test-agent-websocket.html`

验证：

- `rg -n "test-agent-websocket|test-file-revise-llm" . --glob "!node_modules/**" --glob "!.git/**"`
- `npm --prefix apps/desktop/frontend run test`

风险：若用户仍手动依赖这些脚本，会少一个非门禁手测入口；正式门禁不依赖它们。

### B4. OpenAPI 生成链补齐 shared TS types（低风险，执行）

目标：`pnpm openapi` 一次刷新完整契约产物，包括 `packages/shared/src/generated/api-types.ts`；`check-openapi-drift` 同步把该文件纳入漂移检查。

改动面：

- `scripts/generate-openapi.mjs`
- `scripts/check-openapi-drift.mjs`
- `packages/shared/src/generated/api-types.ts`

验证：

- `pnpm openapi`
- `pnpm run check:drift`
- `npm --prefix apps/desktop/frontend run typecheck`

风险：生成脚本多跑一次 `openapi-typescript`，会略增 `pnpm openapi` 时间，但避免 JSON 与 TS types 失配。

### B5. ToolSpec runtime 缓存继续收敛（中低风险，候选暂缓）

目标：把 `loop_runtime.py` 的 `_TOOL_NAME_MAP` / `_PATCH_TOOLS` / `_PATCH_TOOL_LLM_NAMES` 缓存改成更薄的派生 accessor，进一步压缩事实源镜像。

验证：

- `cd apps/api && uv run pytest tests/test_loop_tool_schemas.py tests/test_agent_loop_runtime.py -q`

风险：现有测试显式断言 `loop_runtime` 模块级常量吃派生结果。可做，但收益低于 B1/B2，第一轮先暂缓。

### B6. Frozen router batch-2 卸载（中高风险，不执行）

目标：卸载 `assets` / `prompt_packs` / `evaluations` / `series` / `workspaces` / `worldbuilding` 等无 live HTTP 消费 router。

不执行原因：`DOMAINS.md` 明确 batch-2 需观察期，且测试/e2e 契约纠缠较多；本轮夜间第一刀不扩大到该面。

### B7. Agent role alias 前后端事实源收敛（中风险，暂缓）

目标：减少 `BUILTIN_AGENT_ROLE_ALIASES` 与后端 `role_catalog.py` 的重复。

不执行原因：前端 fallback 语义与 roles 加载失败体验需要设计，不适合本轮无交互夜间改动。

## 第一轮执行范围

执行 B1、B2、B3、B4。若 B1 或 B2 验证失败且无法快速修复，停止扩大改动面，只记录失败原因。

## 提交策略

- 只 stage 本轮修改的 tracked files 与本轮新增的 `REFACTOR_PLAN.md` / `.codex/verification-report.md`。
- 不 stage 启动前既有未跟踪 `.agents/`、`.trellis/`、`.codex/agents/`、`.codex/config.toml`、`.codex/hooks*`、`AGENTS.md` 等。
- 完成后按可验证改动创建小提交；不 push。
