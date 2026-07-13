# Agent Runs Structure

> S0 navigation draft. This document describes the current live path and the target public boundaries without changing runtime behavior.

## Main Read Order

Read the live path in this order. The list intentionally stays within eight files.

1. `router.py` - AgentRun REST and durable SSE endpoints.
2. `service.py` - run lifecycle facade, control handling, and compatibility re-exports.
3. `runtime.py` - fixed-intent orchestration and legacy runtime adapter.
4. `loop_runtime.py` - free-text chat tool loop adapter.
5. `tooling.py` - ToolSpec registry, loop schema derivation, and dispatch metadata.
6. `fs_tools.py` - project-root-scoped list/read/search primitives.
7. `event_sink.py` - durable event recording and terminal projection.
8. `event_encoders.py` - SSE/REST frame encoding from durable events.

Supporting modules such as `schemas.py`, `models.py`, `run_payloads.py`, `runtime_recovery.py`, and the scan/canon modules should be opened only when the main path points to them.

## Target Public Faces

S1 will organize the live runtime around six public faces:

| Face | Owns | Must not own |
| --- | --- | --- |
| `loop` | tool-calling rounds, prompt/history/budget flow | filesystem path policy or event encoding |
| `tools` | ToolSpec registry, schema derivation, handler dispatch | direct manuscript write-back |
| `fs` | path-scoped list/read/search/resolve | LLM and permission policy |
| `events` | durable event types, sink, and transport encoding | tool execution |
| `permission` | confirmation derivation and execution gate | patch construction |
| `patches` | proposed-patch artifacts and single-patch guard | writing user files |

Cross-face callers may import public names only. S0 freezes every existing leading-underscore import and imported-module private attribute access in `tests/fixtures/source_code_standards_baseline.json`; new debt fails `test_source_code_standards.py`.

## Dual Track Boundary

- Free-text chat enters the live loop.
- Explicit legacy intents remain behind a fixed-pipeline adapter.
- Managed BookRun remains a backing capability and must be reached through a public service or adapter.
- A proposed patch is an artifact only. The backend never writes a user's manuscript file directly.

## S0 Audit Notes

- `websocket_stream_events_from_agent_event` is used by the live SSE pump.
- `websocket_control_event` is used by the live REST control endpoint.
- Their names are compatibility debt, not dead code. Rename them behind transport-neutral public functions before deleting the old names.
- `_chapter_request` in `book_generation_parallel.py` had no caller, registration, reflection path, or test dependency and was removed as isolated dead code.
