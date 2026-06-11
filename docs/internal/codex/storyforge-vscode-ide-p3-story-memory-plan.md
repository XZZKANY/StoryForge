# Story Memory Explorer P3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 StoryForge IDE 增加 P3 Story Memory Explorer 最小闭环：可按作品、实体、fact_type、章节区间和冲突状态查询长效记忆，并在 IDE 左侧展示记忆与冲突队列。

**Architecture:** API 层复用 Phase 9 `MemoryAtomRecord`、`list_memory_atoms` 和 `detect_memory_conflicts`，只新增 IDE 查询投影 `POST /api/ide/story-memory/query`。Web 层新增 SSR-safe `StoryMemoryExplorer` 组件并挂到 IDE SidePanel 的 `memory` 活动入口。

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic；React 19 SSR 组件；pytest；node:test。

---

### Task 1: API Story Memory Query

**Files:**
- Modify: `apps/api/app/domains/ide/schemas.py`
- Modify: `apps/api/app/domains/ide/service.py`
- Modify: `apps/api/app/domains/ide/router.py`
- Test: `apps/api/tests/test_ide_story_memory.py`

- [ ] **Step 1: Write failing API tests**

Create `apps/api/tests/test_ide_story_memory.py` with tests for:
1. `POST /api/ide/story-memory/query` filters by `book_id`, `entity_id`, `fact_type`, and `chapter`.
2. `conflict_status="conflicted"` returns only atoms participating in detected conflicts and includes `conflict_queue`.
3. Unknown or empty result returns empty `items` and `conflict_queue`.

- [ ] **Step 2: Run RED**

Run: `cd apps/api; uv run pytest tests/test_ide_story_memory.py -q`
Expected: FAIL because endpoint/schema does not exist.

- [ ] **Step 3: Implement API projection**

Add schema models `IdeStoryMemoryQuery`, `IdeStoryMemoryItem`, `IdeStoryMemoryConflict`, `IdeStoryMemoryQueryResult`. Add service `query_story_memory(session, payload)` that calls `list_memory_atoms`, filters chapter activity, calls `detect_memory_conflicts`, and applies `conflict_status`.

- [ ] **Step 4: Run GREEN**

Run: `cd apps/api; uv run pytest tests/test_ide_story_memory.py -q`
Expected: PASS.

### Task 2: Web Story Memory Explorer

**Files:**
- Create: `apps/web/components/ide/views/StoryMemoryExplorer.tsx`
- Modify: `apps/web/components/ide/shell/ActivityBar.tsx`
- Modify: `apps/web/components/ide/shell/SidePanel.tsx`
- Modify: `apps/web/scripts/phase1-contract-test.mjs`
- Modify: `apps/web/tests/ide-components.test.tsx`

- [ ] **Step 1: Write failing Web tests**

Extend `apps/web/tests/ide-components.test.tsx` to import `StoryMemoryExplorer`; assert it renders filters, memory rows, conflict queue, and empty state. Add shell tests asserting ActivityBar includes `Story Memory` and SidePanel renders Memory view when activePanel is `memory`.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @storyforge/web test`
Expected: FAIL because `StoryMemoryExplorer` does not exist or shell lacks memory entry.

- [ ] **Step 3: Implement component and shell wiring**

Create `StoryMemoryExplorer.tsx` with typed props, empty state, filter summary, memory cards and conflict queue. Add `memory` activity and render StoryMemoryExplorer placeholder in SidePanel.

- [ ] **Step 4: Run GREEN**

Run: `pnpm --filter @storyforge/web test`
Expected: PASS.

### Task 3: Contracts and Verification

**Files:**
- Modify generated: `packages/shared/src/contracts/storyforge.openapi.json`
- Modify generated: `packages/shared/src/generated/api-types.ts`
- Create: `.codex/verification-report-ide-p3.md`
- Create or append: `.codex/operations-log-p3-story-memory.md`

- [ ] **Step 1: Generate OpenAPI**

Run: `pnpm openapi`
Expected: PASS and generated contract includes `/api/ide/story-memory/query`.

- [ ] **Step 2: Targeted verification**

Run: `cd apps/api; uv run pytest tests/test_ide_story_memory.py tests/test_story_memory_persistence.py tests/test_story_memory_contract.py -q`
Run: `pnpm --filter @storyforge/web test`
Run: `pnpm --filter @storyforge/web lint`
Run: `pnpm --filter @storyforge/shared test`
Expected: all PASS.

- [ ] **Step 3: Record report**

Create `.codex/verification-report-ide-p3.md` with commands, results, OpenAPI diff explanation, risks and remaining P4+ scope.

---

## Self-Review

- Spec coverage: P3 requires browse/filter/conflict arbitration. This plan covers browse/filter and conflict_queue projection; write-side arbitration is acknowledged as Phase 9/P5 command integration rather than duplicate implementation.
- Placeholder scan: no TBD/TODO/implement later.
- Type consistency: API and Web use `items`, `conflict_queue`, `conflict_status`, `valid_from_chapter`, `valid_to_chapter` consistently.
