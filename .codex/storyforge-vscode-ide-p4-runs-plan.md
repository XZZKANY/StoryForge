# BookRun Run Panel P4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 StoryForge IDE 增加 P4 BookRun Run Panel 最小闭环：提供 BookRun SSE 快照事件流，并在 IDE 底部 Runs 面板展示进度、checkpoint、阻塞章节和预算。

**Architecture:** API 复用 `BookRun` 真相源，从 `progress/checkpoint/cost_summary` 派生 IDE run event，`StreamingResponse` 输出标准 SSE。Web 新增 SSR-safe `BookRunPanel`，并接入 `BottomPanel activePanel="runs"`。

**Tech Stack:** FastAPI StreamingResponse + SQLAlchemy；React SSR；pytest；node:test。

---

### Task 1: API Run Events SSE

**Files:**
- Modify: `apps/api/app/domains/ide/schemas.py`
- Modify: `apps/api/app/domains/ide/service.py`
- Modify: `apps/api/app/domains/ide/router.py`
- Test: `apps/api/tests/test_ide_run_events.py`

- [ ] Write failing tests for `build_run_events` and `GET /api/ide/runs/{id}/events`.
- [ ] Run RED: `cd apps/api; uv run pytest tests/test_ide_run_events.py -q`.
- [ ] Implement event schema/projection and SSE endpoint.
- [ ] Run GREEN with the same command.

### Task 2: Web BookRunPanel

**Files:**
- Create: `apps/web/components/ide/views/BookRunPanel.tsx`
- Modify: `apps/web/components/ide/shell/BottomPanel.tsx`
- Modify: `apps/web/scripts/phase1-contract-test.mjs`
- Modify: `apps/web/tests/ide-components.test.tsx`

- [ ] Write failing SSR tests for BookRunPanel and BottomPanel runs branch.
- [ ] Run RED: `pnpm --filter @storyforge/web test`.
- [ ] Implement component and shell wiring.
- [ ] Run GREEN with the same command.

### Task 3: Verification

- [ ] Run `pnpm openapi`.
- [ ] Run `cd apps/api; uv run pytest tests/test_ide_run_events.py tests/test_book_runs.py tests/test_book_run_resume.py tests/test_book_run_budget.py -q`.
- [ ] Run `pnpm --filter @storyforge/web test`, `pnpm --filter @storyforge/web lint`, `pnpm --filter @storyforge/shared test`.
- [ ] Write `.codex/verification-report-ide-p4.md` and `.codex/operations-log-p4-runs.md`.

---

## Self-Review

- 覆盖 P4：SSE、checkpoint、blocked chapter、budget、Run Panel。
- 不覆盖写操作命令化：Start/Pause/Stop 留给 P5 CommandRegistry，避免直接绕过审计链。
- 无占位步骤；所有路径明确。
