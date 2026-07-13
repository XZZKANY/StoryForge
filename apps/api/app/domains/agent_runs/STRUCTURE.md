# Agent Runs Structure

> S4 navigation. The live runtime is organized behind six public package faces; fixed intent and managed BookRun enter only through explicit adapters.

## Main Read Order

Read the live path in this order. The list intentionally stays within eight files.

1. `router.py` - AgentRun REST and durable SSE endpoints.
2. `service.py` - run lifecycle facade, control handling, and compatibility re-exports.
3. `runtime.py` - thin `AgentRuntime` facade and compatibility exports.
4. `loop/conversation_runtime.py` - free-text conversation orchestration.
5. `loop_runtime.py` - LLM tool-calling rounds and budget enforcement.
6. `tools/execution_runtime.py` - ToolSpec registration, permission gate, and dispatch.
7. `fs/runtime_tools.py` - runtime handlers over project-scoped filesystem primitives.
8. `events/runtime_support.py` - response, interruption, trace, and artifact projections.

Supporting modules such as `schemas.py`, `models.py`, `run_payloads.py`, `runtime_recovery.py`, and the scan/canon modules should be opened only when the main path points to them.

## Public Faces

Cross-face callers import public names from these packages. Private definitions may exist inside one module, but no production module may import a leading-underscore symbol from another module.

| Face | Owns | Must not own |
| --- | --- | --- |
| `loop` | tool-calling rounds, prompt/history/budget flow | filesystem path policy or event encoding |
| `tools` | ToolSpec registry, schema derivation, handler dispatch | direct manuscript write-back |
| `fs` | path-scoped list/read/search/resolve | LLM and permission policy |
| `events` | durable event types, sink, and transport encoding | tool execution |
| `permission` | confirmation derivation and execution gate | patch construction |
| `patches` | proposed-patch artifacts and single-patch guard | writing user files |

Cross-face callers may import public names only. S0 freezes every existing leading-underscore import and imported-module private attribute access in `tests/fixtures/source_code_standards_baseline.json`; new debt fails `test_source_code_standards.py`.

`test_agent_runs_private_cross_module_access_is_zero` is the S1 hard gate. The broader S0 fingerprint remains until book_runs reaches zero in S5.

## Runtime Facade

`runtime.py` owns only construction, the top-level user-message switch, the monkeypatch-compatible `_file_review` seam, and temporary helper re-exports. Behavior methods live in responsibility-scoped mixins under the six faces; every new runtime module remains below 500 lines.

## Tooling Layout

- `tools/spec_models.py` owns immutable ToolSpec/schema types and permission derivation.
- `tools/specs/` groups the 22 declarations by domain while `tools/catalog.py` preserves one ordered catalog.
- `tools/loop_schema.py` derives LLM schemas, names, and patch-tool sets from that catalog.
- `tools/execution.py` owns execution result types, registry, permission gate, and subagent executor.
- Domain runtime modules own both handler implementations and their local name-to-handler maps; `tools/execution_runtime.py` only merges maps and registers in catalog order.
- `tooling.py` is a compatibility facade. Production modules import the `tools` or `permission` public face.

Adding a loop-visible tool means one ToolSpec entry with `loop_schema` plus its implementation/mapping in one domain handler module. Do not add schema/name/patch mirrors to `loop_runtime.py` or a central handler-name table.

## Typed Loop Seams

- `loop/types.py` owns `LoopRoundResult`, `LoopToolCall`, `LoopToolFeedback`, and `ChatLoopOutcome`.
- `patches/types.py` owns the frozen `PatchProposal` view while preserving the existing wire dict exactly.
- `events/contracts.py` owns frozen completed/failed terminal payload builders.
- `tools/execution.py` keeps `ToolResult` generic over output shape and carries an optional typed patch proposal.
- `loop_runtime.py` performs orchestration only; provider/tool payload decoding belongs to the typed boundary modules. Its main function may not add raw business-payload `.get()` reads.

Prompt/author instructions live in `loop/prompt_context.py`; history, budget, feedback, and output summarization live in `loop/support.py`. LLM-context value filtering lives in `loop/context_values.py`. Save-point projection helpers live in `events/save_point_projection.py`.

## Dual Track Boundary

- Free-text chat enters `loop/conversation_runtime.py` and `loop_runtime.py`; files under `loop/` may not import `adapters/` or `book_runs`.
- Explicit legacy intents enter `adapters/intent_fixed_pipeline_adapter.py`, which dispatches a typed `FixedPipelineRequest` to the existing review/revise/chapter pipelines.
- Fixed pipeline implementations live under `adapters/`, not under the loop public face.
- AgentRuntime BookRun tools enter `adapters/bookrun_managed_run_adapter.py`, which preserves IDE command audit/evidence behavior and reaches the current managed WritingRun seam.
- The managed BookRun command tuple must equal the declared `bookrun.*` ToolSpec tuple.
- A proposed patch is an artifact only. The backend never writes a user's manuscript file directly.

## S0 Audit Notes

- `websocket_stream_events_from_agent_event` is used by the live SSE pump.
- `websocket_control_event` is used by the live REST control endpoint.
- Their names are compatibility debt, not dead code. Rename them behind transport-neutral public functions before deleting the old names.
- `_chapter_request` in `book_generation_parallel.py` had no caller, registration, reflection path, or test dependency and was removed as isolated dead code.
