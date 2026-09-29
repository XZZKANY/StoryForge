# Agent Runs Structure

> S4 navigation. The live runtime is organized behind six public package faces; fixed intent and managed BookRun enter only through explicit adapters.

## Main Read Order

Read the live path in this order. The list intentionally stays within eight files.

1. `router.py` - AgentRun REST and durable SSE endpoints.
2. `service.py` - run lifecycle facade, control handling, and compatibility re-exports.
3. `runtime.py` - thin `AgentRuntime` facade and compatibility exports.
4. `loop/conversation_runtime.py` - free-text conversation orchestration.
5. `loop_runtime.py` - StoryForge message assembly and the stable adapter over the internal SDK runtime.
6. `tools/execution_runtime.py` - ToolSpec registration, permission gate, and dispatch.
7. `fs/runtime_tools.py` - runtime handlers over project-scoped filesystem primitives.
8. `events/runtime_support.py` - response, interruption, trace, and artifact projections.

Supporting modules such as `schemas.py`, `models.py`, `run_payloads.py`, `runtime_recovery.py`, and the scan/canon modules should be opened only when the main path points to them. Newer responsibility owners to consult on demand: `service_execution.py` (run start/finish settlement invoked by the facade), `runtime_delivery.py` (result delivery), `request_evidence.py` (request/response evidence capture), `runtime_progress.py` (progress projection), `loop/recovery.py` and `loop/checkpoint_store.py` (interruption recovery and checkpoints). Several of these are recent work-tree additions; treat their presence here as navigation, not as shipped-acceptance evidence.

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

`test_agent_runs_private_cross_module_access_is_zero` is the S1 hard gate; a separate test already pins BookRun private access at zero (`test_source_code_standards.py` book_runs zero gate), so "reaching zero in S5" is no longer future tense for that slice. The broader S0 fingerprint in `tests/fixtures/source_code_standards_baseline.json` remains as the freeze list for the rest of the legacy private imports — it documents tolerated baseline debt, not a goal state.

## Runtime Facade

`runtime.py` owns only construction, the top-level user-message switch, the monkeypatch-compatible `_file_review` seam, and temporary helper re-exports. Behavior methods live in responsibility-scoped mixins under the six faces; every new runtime module remains below 500 lines.

## Service Facade

`service.py` is the stable import surface for routers, the SSE author-chat path, startup reaping, event sinks, and BookRun snapshots. It keeps `execute_agent_user_message_run` next to the imported `AgentRuntime` so tests and callers that monkeypatch `service.AgentRuntime` still replace the runtime used at execution time. Control helpers receive that executor as a dependency instead of importing the facade back and creating a cycle.

Open the focused service modules only for the responsibility being changed:

- `service_types.py` owns lifecycle result records, errors, and terminal-status constants.
- `service_lifecycle.py` owns AgentRun creation/resume and the initial started/plan events.
- `service_execution.py` owns run start/finish settlement handed off by the facade.
- `service_store.py` owns persistence, ordered events, artifacts, terminal transitions, reaping, and save-point queries.
- `service_control.py` owns durable control events and pending-call resume diagnostics.
- `service_bookrun_bridge.py` owns BookRun snapshots and managed control translation.

These modules are internal owners; external callers keep importing from `service.py`. The facade and every focused service module stay below 500 lines.

## Tooling Layout

- `tools/spec_models.py` owns immutable ToolSpec/schema types, permission derivation, and loop input/context/trace policies.
- `tools/specs/` groups declarations by domain while `tools/catalog.py` preserves one ordered catalog.
- `tools/loop_schema.py` derives LLM schemas, names, and patch-tool sets from that catalog.
- `tools/execution.py` owns execution result types, registry, permission gate, and subagent executor.
- `loop/sdk_adapters.py` projects loop-visible ToolSpecs and StoryForge permission/evidence/artifact ports into the SDK; it is not a second tool catalog.
- Domain runtime modules own both handler implementations and their local name-to-handler maps; `tools/execution_runtime.py` only merges maps and registers in catalog order.
- `tooling.py` is a compatibility facade. Production modules import the `tools` or `permission` public face.

Adding a loop-visible tool means one ToolSpec entry with `loop_schema` plus its implementation/mapping in one domain handler module. Declare its loop execution policy on that same spec:

- `loop_input_mode`: `project` (default), `existing_file` (bounded project read), or `new_file` (resolve a target without reading manuscript content).
- `loop_trusted_context`: whether the adapter builds a snapshot from trusted request context at tool execution time. Requires a file input mode; it does not grant write permission.
- `loop_trace_owner`: `generic` (default) or `handler` for safe successful input/output/audit summaries. A missing handler output summary retains the generic fallback; an empty dictionary is an explicit summary.

The three policies are independent: `knowledge.propose` owns its trace but is not a patch tool; `prose.continue` prepares an existing file without the snapshot policy. `ToolDefinition` derives them from the spec, and both loop consumers read the registered definition. Models cannot supply these fields. The old name-set exports in `tools/runtime_arguments.py` are derived compatibility views, not policy owners.

Do not add schema/name/patch/input/trace mirrors to `loop_runtime.py` or a central handler-name table. Keep argument sanitization at the permission, execution, and evidence boundaries. Internal loop policies never enter the model schema or runtime-tool catalog DTO. `test_loop_tool_policy.py` exercises an unfamiliar test-only tool through the live chat/SDK adapter; it is not a production capability or a substitute for real-feature acceptance.

## Typed Loop Seams

- `loop/types.py` keeps compatibility views and owns `LoopToolFeedback` plus `ChatLoopOutcome`.
- `patches/types.py` owns the frozen `PatchProposal` view while preserving the existing wire dict exactly.
- `events/contracts.py` owns frozen completed/failed terminal payload builders.
- `result_contracts.py` owns non-success execution outcomes and public execution-result snapshots; proposal resolution cannot erase a failed/partial run.
- `tools/execution.py` keeps `ToolResult` generic over output shape and carries an optional typed patch proposal.
- `loop_runtime.py` assembles StoryForge context and maps the SDK terminal result; provider/tool payload decoding and generic rounds belong to `app.platform.ai_sdk`.
- `loop/sdk_context.py` is the opaque application context. `loop/sdk_adapters.py` owns ToolSpec projection, PermissionGate mapping, usage/cost, trace/evidence, checkpoint, filtered feedback, and artifact projection.
- SDK checkpoint state may be recursively immutable, but runtime handlers and feedback receive recursively thawed JSON dictionaries/lists. Frozen nested values must not reach domain handlers or durable JSON evidence.

Prompt/author instructions live in `loop/prompt_context.py`; history, budget, feedback, and output summarization live in `loop/support.py`. LLM-context value filtering lives in `loop/context_values.py`. Save-point projection helpers live in `events/save_point_projection.py`.

## Dual Track Boundary

- Free-text chat enters `loop/conversation_runtime.py` and `loop_runtime.py`; files under `loop/` may not import `adapters/` or `book_runs`.
- Explicit legacy intents enter `adapters/intent_fixed_pipeline_adapter.py`, which dispatches a typed `FixedPipelineRequest` to the existing review/revise/chapter pipelines.
- Fixed pipeline implementations live under `adapters/`, not under the loop public face.
- AgentRuntime BookRun tools enter `adapters/bookrun_managed_run_adapter.py`, which preserves IDE command audit/evidence behavior and reaches the current managed WritingRun seam.
- The managed BookRun command tuple must equal the declared `bookrun.*` ToolSpec tuple.
- A proposed patch is an artifact only. The backend never writes a user's manuscript file directly.

## Frozen Import Boundary

Live `health`, `assistant`, `agent_runs`, and `ide` modules do not add dependencies on frozen domains. `test_live_domains_do_not_add_frozen_imports` enforces the concrete frozen module list and allows only the existing `ide/command_registry.py -> workspaces.models.Workspace` ORM audit edge. Conceptual names in plans must resolve to the real Python module path; for example, the legacy `books.lineage` area is implemented by `books/lineage_service.py`.

## S0 Audit Notes

- `websocket_stream_events_from_agent_event` is used by the live SSE pump.
- `websocket_control_event` is used by the live REST control endpoint.
- Their names are compatibility debt, not dead code. Rename them behind transport-neutral public functions before deleting the old names.
- The former parallel BookRun support module had no live caller, registration, reflection path, or test dependency; it was removed with the retired parallel runner. Keep future cleanup notes tied to files that still exist.


## AgentRun 结算边界

- `service_store.rollback_failed_settlement` 只清理一次本地结算异常，不自行提交；块内先改状态，最后由 `record_agent_event` 同次提交状态与证据。禁止在二者之间提前 commit。事件 writer 的 SAVEPOINT 序号重试仍保留，不能将它误当外层状态事务。
- `complete_agent_run` / `fail_agent_run` / permission sink 保留 running 守卫；approve/deny 保留 paused 守卫与先行命令审计。服务 facade 导出清理边界，sink 不依赖内部 store 模块。
- BookRun 终态快照不得先重开既有镜像；只有上游已明确恢复运行才允许重新 running。镜像终态以已提交 BookRun 为准，包括 failed 对旧 paused 镜像的修正；普通 worker 不因此失去 running 守卫。重复终态快照仍可追加事件，不承诺 exactly-once。
- 无 pending anchor 的 resume 使用同次 commit 保存 stopped 与已有 resume 事件诊断，不新增事件类型。该结算失败回到已提交的 running/resumed，而不是伪称整条恢复命令回到 paused。
- 提交后通知失败不能撤销已持久化配对，也不能补出相反终态；不把模型调用、上游 BookRun、先前 trace/artifact 纳入大事务。
- `test_agent_settlement_atomicity.py` 用文件 SQLite、WAL、独立物理连接及外键验证 INSERT / commit / UPDATE 故障、同 Session 重试、序号冲突、提交后 refresh/通知和主 REST 控制入口。它不证明跨数据库并发 exactly-once 或完整 GUI 验收。
