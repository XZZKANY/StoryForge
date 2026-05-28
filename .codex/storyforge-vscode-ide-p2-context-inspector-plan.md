# Context Inspector P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 StoryForge IDE 增加 P2 Context Inspector 最小闭环：后端可按 `compiled_context_id` 回放快照，前端可展示注入/裁剪块、预算和缺失提示。

**Architecture:** 复用已有 `CompiledContextRecord` 持久化表作为真相源，不重复实现 Phase 8 Context Compiler。`apps/api/app/domains/ide` 追加只读 schema/service/router；`apps/web/components/ide/views` 新增纯展示组件，并让 EditorArea 能按 `context:<id>` 渲染占位数据。

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic；Next/React Server Render 组件；node:test；pytest。

---

### Task 1: API Context Snapshot

**Files:**
- Modify: `apps/api/app/domains/ide/schemas.py`
- Modify: `apps/api/app/domains/ide/service.py`
- Modify: `apps/api/app/domains/ide/router.py`
- Test: `apps/api/tests/test_ide_context_snapshot.py`

- [ ] **Step 1: Write failing API tests**

Create `apps/api/tests/test_ide_context_snapshot.py` with tests that persist a compiled context and call `GET /api/ide/context-snapshot/{id}`. Assert response includes `compiled_context_id`, `token_budget`, `used_tokens`, injected/dropped refs and `debug_summary`. Add a missing-id test that expects 404 with `snapshot evicted at unknown: <id>`.

- [ ] **Step 2: Run RED**

Run: `cd apps/api; uv run pytest tests/test_ide_context_snapshot.py -q`
Expected: FAIL because route is missing.

- [ ] **Step 3: Implement schema/service/router**

Add Pydantic models `IdeContextBudget`, `IdeContextBlockRef`, `IdeContextSnapshot`; add service `get_context_snapshot(session, compiled_context_id)` reading `CompiledContextRecord` and mapping `block_refs`. Add route `/context-snapshot/{compiled_context_id}` returning 404 on missing snapshot.

- [ ] **Step 4: Run GREEN**

Run: `cd apps/api; uv run pytest tests/test_ide_context_snapshot.py -q`
Expected: PASS.

### Task 2: Web Context Inspector Component

**Files:**
- Create: `apps/web/components/ide/views/ContextInspector.tsx`
- Modify: `apps/web/components/ide/shell/EditorArea.tsx`
- Modify: `apps/web/tests/ide-components.test.tsx`

- [ ] **Step 1: Write failing component tests**

Extend `apps/web/tests/ide-components.test.tsx` to import `ContextInspector`. Add tests for a normal snapshot rendering injected/dropped counts, budget `60/100 tokens`, source refs and debug summary; add an evicted state test with `snapshot evicted at <ts>`.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @storyforge/web test`
Expected: FAIL because `ContextInspector` file/export does not exist.

- [ ] **Step 3: Implement component and EditorArea branch**

Create `ContextInspector.tsx` with typed props and pure SSR-safe markup. Modify `EditorArea` to render `ContextInspector` when `activeTabId` starts with `context:` using a minimal evicted placeholder.

- [ ] **Step 4: Run GREEN**

Run: `pnpm --filter @storyforge/web test`
Expected: PASS.

### Task 3: Contracts and Verification

**Files:**
- Modify generated: `packages/shared/src/contracts/storyforge.openapi.json`
- Modify generated: `packages/shared/src/generated/api-types.ts`
- Modify docs: `.codex/verification-report-ide-p2.md`
- Modify docs: `.codex/operations-log.md`

- [ ] **Step 1: Generate OpenAPI**

Run: `pnpm openapi`
Expected: PASS and generated contract includes `/api/ide/context-snapshot/{compiled_context_id}`.

- [ ] **Step 2: Targeted verification**

Run: `cd apps/api; uv run pytest tests/test_ide_context_snapshot.py tests/test_ide_workspace_tree.py tests/test_ide_diagnostics.py tests/test_ide_commands.py -q`
Run: `pnpm --filter @storyforge/web test`
Run: `pnpm --filter @storyforge/web lint`
Expected: all PASS.

- [ ] **Step 3: Record reports**

Append operations log and create `.codex/verification-report-ide-p2.md` with commands, results, OpenAPI diff explanation and remaining P3+ scope.

---

## Self-Review

- Spec coverage: P2 requires `GET /ide/context-snapshot/{id}` and Inspector showing injected/dropped counts, reasons, token budget and explicit missing snapshot. Tasks cover these requirements in `/api/ide/context-snapshot/{id}` under existing API prefix.
- Placeholder scan: no TBD/TODO/implement later.
- Type consistency: API uses `compiled_context_id`, `budget`, `injected_blocks`, `dropped_blocks`, `debug_summary`; Web component mirrors these fields.
