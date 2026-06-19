# Stage A — Background start-trigger for BookRun generation

Part of task #5 (使用闭环). Stage A of the backend work: make `POST /api/book-runs/{id}/start` actually generate chapters (capped 3-6) in the background. Stage B (MinIO signed-URL export) follows separately.

## The gap (verified)
`create_book_run` (`service.py:66-98`) inserts a `status="running"` row and stops — nothing consumes it. The only working generator, `resume_phase9b_real_llm_smoke` (`phase9b_real_llm_smoke.py:236-362`), already drives an **arbitrary existing book_run** through the full generate→judge→repair→finalize→export pipeline (with the P0-A/B/C fixes), reconstructing prior progress and honoring budget/failure pauses. It is reachable only via CLI/tests today.

## Design decision
Reuse `resume_phase9b_real_llm_smoke` as the generation worker — do **not** re-implement the loop. For a fresh API-created run it reconstructs zero completed chapters and generates from chapter 1. The smoke seed (Character Bible / Style Pack) is optional enrichment; generation degrades gracefully without it, and a real locked blueprint + planned chapters supply everything required.

Not renaming the `phase9b_real_llm_smoke` module in this stage (too broad, touches many tests). I'll import it from `service.py` with a comment marking it the canonical Phase 9B sequential driver. A rename can be a separate cleanup.

## Changes

### 1. `app/domains/book_runs/schemas.py`
- Add `BookRunStartRequest`: `max_chapters: int = Field(default=6, ge=1, le=6)`. Upper bound 6 enforces the in-process safety cap (5-13 min wall-clock).
- Add `BookRunStartAccepted` (or reuse `BookRunRead`) for the 202 body.

### 2. `app/domains/book_runs/service.py`
- `assert_book_run_startable(session, book_run_id, *, env) -> tuple[BookRun, int, int]` — **synchronous** preflight called inline by the endpoint so the user gets immediate feedback:
  - 404 `BookRunNotFoundError` if missing.
  - 422 `BookRunBlockedError` if `status != "running"` (already completed/paused/stopped — use resume/retry instead).
  - 422 `BookRunBlockedError` if `missing_phase9b_real_llm_env(env)` is non-empty (lists missing `STORYFORGE_LLM_*` creds). This is the credential guard.
  - 409-style `BookRunBlockedError` if progress already marks generation dispatched/running (double-start guard).
  - Returns `(run, chapter_count, token_budget)` where `chapter_count = min(total_chapters, max_chapters)` and `token_budget = run.token_budget or default`.
- `mark_book_run_generation_dispatched(session, book_run_id)` — set `book_run.progress = {**book_run.progress, "generation": {"state": "dispatched", "dispatched_at": <iso>}}` **directly** and commit. Do NOT route through `apply_book_run_progress` — that function recomputes status/budget/checkpoint/latency from the progress payload and would clobber real run state. The marker lives under a `"generation"` sub-key; once generation finishes `resume_*` overwrites progress and flips status to completed, so the marker can't cause stale rejects (the status guard handles re-starts).
- `run_book_run_generation_blocking(book_run_id, *, chapter_count, token_budget, env)` — the worker body: opens its **own** `SessionLocal()` (request session is closed by the time the background task runs), calls `resume_phase9b_real_llm_smoke(session, book_run_id=..., chapter_count=..., token_budget=..., max_chapter_count=6, env=env)`, commits/closes. On exception: `resume_*` already records pause-by-failure evidence and flips status; log and swallow so the background task doesn't crash the worker.

### 3. `app/domains/book_runs/router.py`
- `POST /{book_run_id}/start` accepting `BookRunStartRequest`, `SessionDependency`, and `BackgroundTasks`:
  - call `assert_book_run_startable(...)` (maps errors to 404/422 like sibling endpoints).
  - `mark_book_run_generation_dispatched(...)`.
  - `background_tasks.add_task(run_book_run_generation_blocking, book_run_id, chapter_count=..., token_budget=..., env=dict(os.environ))` — snapshot env at request time.
  - return `202 Accepted` with the current `BookRunRead` (status "running", progress shows dispatched).
- Env is read from `os.environ` at dispatch (matches how the smoke path resolves creds).

### 4. Security note
The endpoint kicks off real LLM spend. It's behind the existing `X-StoryForge-API-Key` middleware (same as all `/api/book-runs/*`). I'll note in the response/docstring that it consumes provider budget. No new auth surface.

## Tests (`tests/test_book_run_start.py`, credential-free)
Reuse the `_Phase9BChatHandler` local `HTTPServer` fake-provider pattern from `test_phase9b_real_llm_smoke.py`:
1. **missing creds → 422**: start with no `STORYFORGE_LLM_*` env → `BookRunBlockedError`, no background task, run stays running.
2. **happy path**: seed a book + locked blueprint + planned chapters (reuse smoke helpers or the existing book_run test fixtures), point env at fake provider, call `assert_book_run_startable` + `run_book_run_generation_blocking` directly (synchronous, deterministic) → run reaches `completed`, chapters approved, markdown/audit artifacts exist, `chapter_count == min(total, max_chapters)`.
3. **cap enforcement**: blueprint with total_chapters=10, max_chapters=3 → exactly 3 chapters generated.
4. **double-start guard**: second `assert_book_run_startable` after dispatch marker → `BookRunBlockedError`.
5. **wrong status**: start on a completed/stopped run → 422.

(The endpoint's `BackgroundTasks` wiring is exercised via FastAPI `TestClient` in one test asserting 202 + dispatched marker; the generation body is tested directly to avoid background-thread timing flakiness.)

### 5. Frontend Start-button wiring (`apps/web`)
The `bookrun.start` command is **registered** (`registerBuiltinCommands.ts:13`) and shown as a Start button (`BookRunPanel.tsx:49`), but its action handler (`components/home/assistant-book-run-actions.ts:11`) only supports `pause|resume|stop|retry` — Start currently does nothing. To make "产品发起" reachable from the UI:
- Extend `AssistantBookRunCommand` to include `start` and add the `/api/book-runs/{id}/start` POST branch (status 202 handling) in the action map.
- Keep it minimal and mirror the existing pause/stop branch shape. Update `assistant-book-run-actions.test.ts` accordingly.

## Verification
- `cd apps/api && uv run pytest tests/test_book_run_start.py tests/test_phase9b_real_llm_smoke.py tests/test_book_runs.py -q` — new + existing pass.
- `cd apps/web && npm run lint && npm run test` — frontend types + contract tests pass with the new start branch.
- Confirm no existing book_run test regresses from the schema/service additions.

## Out of scope (stage B)
- Real object storage / MinIO signed URLs — exports still produce `memory://` placeholder artifacts with inline payload. The start endpoint returns artifacts in that existing form.
- No manuscript-reader page beyond the existing IDE ArtifactViewer.ing that loop can follow once the endpoint exists).
