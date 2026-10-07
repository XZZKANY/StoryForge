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

The three policies are independent: `knowledge.propose` owns its trace but is not a patch tool; `prose.continue` declares existing-file input, trusted snapshot preparation and handler-owned trace. `ToolDefinition` derives them from the spec, and both loop consumers read the registered definition. Models cannot supply these fields. The old name-set exports in `tools/runtime_arguments.py` are derived compatibility views, not policy owners.

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

`llm_context.py` assembles sanitized snapshots and keeps the prompt-conversion compatibility export. `llm_prompt_context.py` owns bounded Assistant bundle delivery, review summaries and knowledge source-state labels; `llm_context_limits.py` separates ordinary-file selection limits from the existing Assistant delivery limits. Structured retrieval excerpts must not be cropped again to the ordinary-file budget. A successful review produced inside the live loop is explicitly handed to the next snapshot before end-of-loop artifact persistence.

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


Current-review ownership lives in `events/review_sources.py`: persisted reports are selected by the current assistant conversation, with backend-only transient reports for unsettled successful tool calls. `patches/revise_input.py` resolves that identity, verifies the manuscript source and applies the original author's scope before writing prompts. `revise_scope.py` remains the pure selection/delivery contract. Both chat and fixed adapters consume this owner; a fixed revision must not implicitly rerun review and renumber an author's selected issue. Canonical session/project ownership is exported by `assistant.service` from `assistant/session_scope.py`; recovery messages retain the original session and project instead of silently adopting unbound history.


`fs/ordinary_context.py` owns bounded live revalidation of selected ordinary pins/read facts and immutable captures, then pure final-excerpt source evidence. `knowledge_context` collects those values alongside structured admission before selection/delivery. `llm_context` never performs hidden I/O in its collected-value entry; `llm_prompt_context` sends bounded Context Sources with exact final excerpt hashes and explicit omissions. The chat adapter binds the real project root even without a frontend bundle. Captured provenance is not perpetual freshness or a full author/style/canon/memory SourceRef manifest.


Final writer admission is owned by `patches/writing_context.py`, using original selected inputs and `ToolExecutionContext.writing_read_sources` before structural filtering. `assistant/writing_context.py` owns frozen, target/body/intent-bound backend handoffs and raw direct-request admission; the handoff never re-reads synthetic prompt channels. Writer traces retain the final snapshot ID, selected full supplied-text hash and exact excerpt manifest. Chapter tools live in `adapters/chapter_writing_tools.py`, inherited by the original pipeline facade; draft/repair verify the existing source guard immediately before handing over a confirmed bundle. Backend handoff types and reader facts are not wire/schema/model parameters or durable live caches.


`context_channel_requests.py` records raw synthetic-channel selection counts/value identities before summaries lose information. `llm_prompt_context.synthetic_context_delivery` is the common final-budget projection for Story Memory, Chapter Context and Review Report; the snapshot manifest and actual prompt share its excerpt hashes/omissions. Memory atoms and chapter fields are not cut mid-item at the final slot boundary. Supplied-channel hashes are not live file freshness proofs; these refs remain unverified, including legacy snapshots without a supplied-value hash.


Project containment and complete bounded traversal are owned by `app/common/project_tree.py`, a domain-free leaf reused by manuscript/style/previous-chapter inputs. `fs_safety` retains its public error classes, signatures and module-level budget overrides as a compatibility facade; bounded reader/search behavior remains there. Manuscript discovery prunes hidden/non-manuscript directories before descent. Independent author instructions and previous tails require bounded complete reads; style sampling deduplicates physical files before its recent-file window and rechecks queued sources before reading. These guards do not constitute final SourceRefs or an atomic filesystem snapshot.


Independent writer input observations are owned by domain-free `common/generation_sources.py`. The four Assistant writer facades scope actual author/style/canon/previous reads and persist final request hashes/projections in Assistant ToolCall input evidence before the existing provider seam. Readers never re-open sources to manufacture receipts. Style prefix hashes do not claim whole-file identity; supplied manuscript identity is unverified file provenance. Canon/hooks read paths are contained and bounded; scene active-hook/agenda projections share one hooks value. This evidence currently does not merge into outer Agent provenance or cold-resume source guards. The original committed running-tool-before-author-read boundary stays intact; the final receipt adds one short committed transaction, not a model-wait transaction.


### 续写 source receipt 跨层关联（2026-10-05，本地增量）

`common/generation_delivery` 用显式 ContextVar execution scope 把已提交的 Assistant 续写来源回执链接到 SDK 当前 running tool；SDK 在 writer provider 前短提交准确 id/hash，成功、失败、中断后的 trace 保留同一事实，外层自身 id 不变。只保存不可变、无正文的关联，不复制或猜测最近一条 ToolCall，不让 model 参数定义证据。其他 writer producer、恢复 guard 与完整 D02/C02 不属于本批完成项。


### 续写独立来源的 checkpoint qualification（2026-10-05，本地增量）

`loop/generation_recovery.py` 从 named inner/outer ToolCall 的已提交列事实提取 detached receipt，归入 `checkpoint_store` 的 hidden sources；不读取“最新一次”或 flush/覆盖 pending ORM。普通 resume 对照生成时 actual bounded reads、选择 digest、投影/system hash 重跑同一只读 owner，来源或章序变化拒绝旧续写。`common/generation_sources` 仅记录 writer 的真实相对目标/阅读序选择，未启用 capture 时不多算 selection hash。其他 writer / memory 全生命周期、原生 host kill 与发布验收不是本批完成项。


### 续写知识恢复补充（2026-10-05）

`knowledge_context.py::project_knowledge_recovery_receipt` 是纯值知识选择证据 owner；live collector 保存其不可变 JSON，snapshot/Assistant frozen handoff 只搬运。
`loop/knowledge_recovery.py` 由 `generation_recovery.py` 调用，恢复时仅复用 `fs` 公共面的实际有界检索；不新增扫描器、预算策略、客户端信任标志或 DB commit。它校验 writer 已消费的选择，不在 checkpoint 准备时读取新盘来覆盖旧基线。


`patches/writing_context.py` 的 snapshot fallback 必须区分原始请求和自动检索产物；自动文件及其块外说明不回填为 author pin，loop reads 保持独立来源通道。共享 refresh 继续调用同一个 collector，不另建排序器或政策表。


### 普通上下文的续写恢复资格（2026-10-05）

`assistant/writing_context.py` 搬运生成时 final source manifest 到不可变 writer receipt；`loop/ordinary_recovery.py` 经 `fs` 公共 collector 比较实际普通来源的完整解码版本和准入省略状态，`generation_recovery.py` 统一编排。不要从 raw bundle 的非空 excerpt 推断所有已消费来源，也不要把 checkpoint 时的新盘读作为旧 writer 的基线。只处理实际 ordinary source 的恢复资格；知识、独立作者/上章/canon owners 和供应通道的事实边界保持。


### C17 Brief 的实际采集身份与冻结 writer handoff（2026-10-05）

`adapters/chapter_source_guard.py` v2 绑定原 snapshot context receipt / project / target，复用 `loop` 公共 face 的 `writing_context_sources_unchanged` 对 knowledge/ordinary owners 做统一资格核对。`chapter_writing_pipeline.py` 使用 admitted root 初始化 snapshot；tools 经 `prepare_chapter_writing_context` 校验已确认 projection 后传递 typed capsule。Assistant draft/revise 的原 capture scope 现在包括 admission，原事务/权限/模型调用结构不变，不把最新盘读或另一项目同内容当作旧Brief确认。

## Canon assertion semantics (SF-C01 / SF-C02 / SF-C03)

`canon_hooks_delta.evaluate_hook_admission` distinguishes exact normalized description text from lexical relation. Only empty/exact-repeat descriptions reject admission. Substring or Chinese character-set overlap is a **可能相关** advisory: `hooks_delta` keeps the candidate in `new_hooks` and links it in `related_hooks`. It does not prove narrative identity or write hooks.json.

`canon_context.build_scene_constraint_block` filters holders only when chapter order is known and always displays their effective inclusive window. Unknown order produces a time-qualified whole-book digest, not simultaneous current-chapter obligations. Existing-file reading order and absent-file 第N章 inference remain the chapter anchors.

`canon_assertions` owns optional assertion metadata used by delta normalization, tool schemas, scene projection and dossier rendering:
- `assertion_type`: `author_setting | text_observation | model_inference | unknown`.
- `evidence`: a list of nonempty `quote` references, optionally project-relative `path` plus positive `start_line` / `end_line`. References are retained data, not checked entailment; no evidence file is opened by this normalizer.
- Missing legacy metadata stays missing and renders as unknown/unprovided. Explicit model inference is advisory, not a current hard rule, even after author acceptance. Structural canon gate algorithms are unchanged.
- Invariant entries retain full-object proposal equality. Same-id pending entities cannot silently overwrite incompatible evidence/type; such a submission fails before proposal replacement. Metadata-free drafts may be enriched, and confirmed author entities retain the known-entity/read-only path.
- `proposals.json` → pending read → desktop raw proposal → author merge preserves metadata without changing the declaration version or adding a store. Dossier entity occurrence `provenance` is not assertion evidence. Display snippets are bounded; stored quotes are not truncated.

Regression anchors: `test_agent_canon_hooks.py`, `test_canon_unwritten_chapter_window.py`, `test_agent_canon_delta.py`, `test_agent_canon.py`, the canon-delta chat-loop test in `test_agent_loop_runtime_tools.py`, and desktop `tests/canon-merge.test.ts`. Loop schema changes must update only affected records in `tests/fixtures/loop_tool_schemas_golden.json`.
