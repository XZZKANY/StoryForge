import { isObj, type Obj } from '../kernel/json';
import { KNOWLEDGE_PROPOSAL_ARTIFACT_KIND } from '../kernel/knowledgeProposals';
import { codePoints } from '../kernel/pythonText';
import { redactSensitive, redactSensitiveText, type PlainJson } from '../kernel/redaction';
import type { SecretContext } from '../kernel/redaction';
import type { ProjectReader } from '../readPort';
import type { ArtifactRecord, RunEventRecord, RunRecord, RunStore } from '../store/runs';
import { diagnoseCheckpoint, type LoopCheckpointStore } from './chatLoopCheckpoints';
import { SYSTEM_COMPACTION_ARTIFACT_KIND } from './conversationHistory';
import { AgentRunNotFoundError } from './runEvents';
import { agentExecutionState } from './runControlChannel';
import {
  AGENT_EXECUTION_SETTLED,
  AGENT_EXECUTION_STARTED,
  AGENT_RUN_COMPLETED,
  AGENT_RUN_FAILED,
  AGENT_RUN_INTERRUPTED,
  AGENT_RUN_STARTED,
  PAUSE_RUN,
  PERMISSION_APPROVED,
  PERMISSION_DENIED,
  PERMISSION_REQUIRED,
  RESUME_RUN,
  RETRY_FROM_CHECKPOINT,
  STOP_RUN,
  TOOL_TRACE,
} from './runPayloads';
import { SYSTEM_SUMMARY_ARTIFACT_KIND } from './systemJobs';
import {
  buildRuntimePendingCallSummary,
  publicRuntimeEventPayload,
  RUNTIME_PENDING_CALL_ARTIFACT_KIND,
  RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
} from './traces';

const objectOf = (value: unknown): Obj => (isObj(value) ? value : {});
/** Python `isinstance(value, int)`：布尔也算。 */
const pyInt = (value: unknown): value is number | boolean =>
  typeof value === 'boolean' || (typeof value === 'number' && Number.isInteger(value));
const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

/** 列表与快照里看不见的系统 artifact（Python `HIDDEN_SYSTEM_ARTIFACT_KINDS`）。 */
const HIDDEN_SYSTEM_ARTIFACT_KINDS = new Set([
  SYSTEM_SUMMARY_ARTIFACT_KIND,
  SYSTEM_COMPACTION_ARTIFACT_KIND,
  'model_request_evidence',
  'runtime_checkpoint',
  RUNTIME_PENDING_CALL_ARTIFACT_KIND,
  RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
  KNOWLEDGE_PROPOSAL_ARTIFACT_KIND,
]);

function copyStrings(target: Obj, source: Obj, keys: readonly string[]) {
  for (const key of keys) if (nonEmptyString(source[key])) target[key] = source[key];
}

function copyInts(target: Obj, source: Obj, keys: readonly string[]) {
  for (const key of keys) if (pyInt(source[key])) target[key] = source[key];
}

function copyBools(target: Obj, source: Obj, keys: readonly string[]) {
  for (const key of keys) if (typeof source[key] === 'boolean') target[key] = source[key];
}

function latestEvent(events: readonly RunEventRecord[], ...types: string[]) {
  for (let index = events.length - 1; index >= 0; index--)
    if (types.includes(events[index].event_type)) return events[index];
  return null;
}

function latestArtifact(artifacts: readonly ArtifactRecord[], kind: string) {
  for (let index = artifacts.length - 1; index >= 0; index--)
    if (artifacts[index].kind === kind) return artifacts[index];
  return null;
}

function blockedTool(event: RunEventRecord | null): string | null {
  if (event === null) return null;
  const value = isObj(event.payload) ? event.payload.blocked_tool : undefined;
  return nonEmptyString(value) ? value : null;
}

function eventSavePoint(kind: string, event: RunEventRecord, summary: Obj | null = null): Obj {
  return {
    kind,
    source: 'event',
    event_id: event.id,
    event_type: event.event_type,
    sequence: event.sequence,
    summary: summary && Object.keys(summary).length ? summary : {},
  };
}

function toolTraceSummary(event: RunEventRecord): Obj {
  const payload = objectOf(event.payload);
  const trace = objectOf(payload.trace);
  const summary: Obj = {};
  copyStrings(summary, trace, ['tool_name', 'status', 'audit_event_id']);
  if (pyInt(payload.index)) summary.index = payload.index;
  return summary;
}

function controlEventSummary(event: RunEventRecord): Obj {
  const summary: Obj = {};
  copyStrings(summary, objectOf(event.payload), [
    'control_type',
    'reason',
    'source',
    'run_id',
    'session_id',
  ]);
  return summary;
}

function executionMarkerSummary(recovery: Obj): Obj | null {
  const marker = recovery.execution_marker;
  if (!isObj(marker)) return null;
  const summary: Obj = {};
  copyStrings(summary, marker, [
    'kind',
    'source',
    'tool_name',
    'status',
    'resume_strategy',
    'reason',
  ]);
  if (pyInt(marker.tool_index)) summary.tool_index = marker.tool_index;
  if (typeof marker.replay_safe === 'boolean') summary.replay_safe = marker.replay_safe;
  return Object.keys(summary).length ? summary : null;
}

function toolRecoverySummary(event: RunEventRecord): Obj {
  const payload = objectOf(event.payload);
  if (!isObj(payload.recovery)) return toolTraceSummary(event);
  const recovery = payload.recovery;
  const summary: Obj = {};
  copyStrings(summary, recovery, [
    'kind',
    'tool_name',
    'status',
    'execution_mode',
    'audit_event_id',
  ]);
  copyInts(summary, recovery, ['index']);
  copyBools(summary, recovery, ['retry_safe', 'idempotent']);
  if (Array.isArray(recovery.artifact_kinds))
    summary.artifact_kinds = recovery.artifact_kinds.filter((item) => typeof item === 'string');
  const marker = executionMarkerSummary(recovery);
  if (marker !== null) summary.execution_marker = marker;
  return Object.keys(summary).length ? summary : toolTraceSummary(event);
}

function savePointFromEvent(event: RunEventRecord): Obj | null {
  switch (event.event_type) {
    case AGENT_RUN_STARTED:
      return eventSavePoint('run_started', event);
    case PERMISSION_REQUIRED:
      return eventSavePoint('permission_required', event, {
        blocked_tool: blockedTool(event),
        requires_user_decision: true,
      });
    case PERMISSION_APPROVED:
    case PERMISSION_DENIED:
      return eventSavePoint('permission_decided', event, { decision: event.event_type });
    case AGENT_RUN_COMPLETED:
      return eventSavePoint('run_completed', event);
    case AGENT_RUN_FAILED:
      return eventSavePoint('run_failed', event);
    case AGENT_RUN_INTERRUPTED:
      return eventSavePoint('run_interrupted', event, { runtime_state: 'settled' });
    case PAUSE_RUN:
    case STOP_RUN:
    case RESUME_RUN:
    case RETRY_FROM_CHECKPOINT:
      return eventSavePoint('control_message', event, controlEventSummary(event));
    case TOOL_TRACE:
      return eventSavePoint('tool_completed', event, toolRecoverySummary(event));
    default:
      return null;
  }
}

const ARTIFACT_SUMMARY_KEYS = [
  'kind',
  'file_path',
  'status',
  'intent',
  'boundary',
  'resume_strategy',
  'resolution',
  'resolved_by',
  'result_status',
  'pending_resume_strategy',
  'token_budget',
  'total_chapters',
];

function artifactSummary(artifact: ArtifactRecord): Obj {
  const payload = objectOf(artifact.payload);
  const summary: Obj = {};
  for (const key of ARTIFACT_SUMMARY_KEYS) {
    const value = payload[key];
    if (typeof value === 'string' || pyInt(value)) summary[key] = value;
  }
  if (pyInt(payload.pending_artifact_id)) summary.pending_artifact_id = payload.pending_artifact_id;
  const contextOutput = objectOf(payload.context_output);
  if (Object.keys(contextOutput).length) {
    if (nonEmptyString(contextOutput.file_path)) summary.file_path = contextOutput.file_path;
    if (typeof contextOutput.content === 'string')
      summary.content_chars = codePoints(contextOutput.content).length;
  }
  return summary;
}

function savePointFromArtifact(artifact: ArtifactRecord): Obj {
  const kind =
    artifact.kind === RUNTIME_PENDING_CALL_ARTIFACT_KIND ||
    artifact.kind === RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND
      ? artifact.kind
      : 'artifact_persisted';
  return {
    kind,
    source: 'artifact',
    artifact_id: artifact.id,
    artifact_kind: artifact.kind,
    requires_confirmation: artifact.requires_confirmation,
    summary: artifactSummary(artifact),
  };
}

function pendingCallSummary(artifact: ArtifactRecord | null): Obj | null {
  if (artifact === null || artifact.kind !== RUNTIME_PENDING_CALL_ARTIFACT_KIND) return null;
  return buildRuntimePendingCallSummary(artifact.payload, artifact.id, artifact.kind);
}

function pendingResolutionSummary(artifact: ArtifactRecord | null): Obj | null {
  if (artifact === null || artifact.kind !== RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND)
    return null;
  const payload = objectOf(artifact.payload);
  const summary: Obj = { artifact_id: artifact.id, artifact_kind: artifact.kind };
  copyStrings(summary, payload, [
    'status',
    'resolution',
    'resolved_by',
    'result_status',
    'intent',
    'boundary',
    'pending_tool',
    'pending_resume_strategy',
  ]);
  copyInts(summary, payload, ['pending_artifact_id', 'next_trace_index']);
  return summary;
}

function resumeStrategy(run: RunRecord, pendingPermission: boolean): string {
  if (pendingPermission) return 'await_permission_decision';
  if (run.status === 'failed') return 'manual_restart_required';
  if (run.status === 'stopped') return 'stopped_by_user';
  return 'none';
}

function executionMarkerFromEvent(event: RunEventRecord): Obj | null {
  if (event.event_type !== TOOL_TRACE) return null;
  const recovery = objectOf(event.payload).recovery;
  return isObj(recovery) ? executionMarkerSummary(recovery) : null;
}

function markerReference(marker: Obj): Obj {
  const reference: Obj = {};
  for (const key of [
    'event_id',
    'sequence',
    'kind',
    'tool_name',
    'status',
    'resume_strategy',
    'reason',
  ]) {
    const value = marker[key];
    if (typeof value === 'string' || pyInt(value)) reference[key] = value;
  }
  if (typeof marker.replay_safe === 'boolean') reference.replay_safe = marker.replay_safe;
  if (pyInt(marker.tool_index)) reference.tool_index = marker.tool_index;
  return reference;
}

function latestRuntimeFailure(event: RunEventRecord | null, latestMarker: Obj | null): Obj | null {
  if (event === null) return null;
  const summary: Obj = {
    event_id: event.id,
    sequence: event.sequence,
    event_type: event.event_type,
    manual_restart_required: true,
    resume_strategy: 'manual_restart_required',
  };
  if (event.message) summary.message = codePoints(event.message).slice(0, 500).join('');
  if (latestMarker !== null) summary.latest_execution_marker = markerReference(latestMarker);
  return summary;
}

function latestRuntimeInterruption(events: readonly RunEventRecord[]): Obj | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.event_type !== PAUSE_RUN && event.event_type !== STOP_RUN) continue;
    const status = event.event_type === PAUSE_RUN ? 'paused' : 'stopped';
    return {
      event_id: event.id,
      sequence: event.sequence,
      event_type: event.event_type,
      status,
      resume_strategy: status === 'paused' ? 'await_resume' : 'stopped_by_user',
      automatic_resume_supported: false,
    };
  }
  return null;
}

const CONTROL_EVENTS = [
  PERMISSION_APPROVED,
  PERMISSION_DENIED,
  PAUSE_RUN,
  RESUME_RUN,
  STOP_RUN,
  RETRY_FROM_CHECKPOINT,
];

function latestControlEvent(events: readonly RunEventRecord[]): Obj | null {
  const event = latestEvent(events, ...CONTROL_EVENTS);
  if (event === null) return null;
  return {
    event_id: event.id,
    sequence: event.sequence,
    event_type: event.event_type,
    ...controlEventSummary(event),
  };
}

function resumeDiagnosticSummary(diagnostic: Obj): Obj | null {
  const summary: Obj = {};
  copyStrings(summary, diagnostic, [
    'kind',
    'reason',
    'intent',
    'boundary',
    'status',
    'pending_tool',
    'resume_strategy',
    'pending_resume_strategy',
    'run_status',
    'current_step',
    'artifact_kind',
  ]);
  copyInts(summary, diagnostic, ['artifact_id', 'next_trace_index']);
  copyBools(summary, diagnostic, [
    'can_resume',
    'resume_via_control_channel',
    'requires_manual_restart',
  ]);
  return Object.keys(summary).length ? summary : null;
}

function latestResumeDiagnostic(events: readonly RunEventRecord[]): Obj | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.event_type !== RESUME_RUN) continue;
    const recovery = objectOf(objectOf(event.payload).runtime_recovery);
    const diagnostic = recovery.resume_diagnostic;
    const summary = isObj(diagnostic) ? resumeDiagnosticSummary(diagnostic) : null;
    if (summary !== null)
      return {
        event_id: event.id,
        sequence: event.sequence,
        event_type: event.event_type,
        ...summary,
      };
  }
  return null;
}

function runtimeRecoveryProjection(
  run: RunRecord,
  events: readonly RunEventRecord[],
  pendingCall: ArtifactRecord | null,
  pendingResolution: ArtifactRecord | null,
): Obj {
  const markers: Obj[] = [];
  for (const event of events) {
    const marker = executionMarkerFromEvent(event);
    if (marker !== null) markers.push({ event_id: event.id, sequence: event.sequence, ...marker });
  }
  const replaySafe = markers.filter((marker) => marker.replay_safe === true);
  const latestMarker = markers.length ? markers[markers.length - 1] : null;
  return {
    latest_execution_marker: latestMarker,
    latest_replay_safe_marker: replaySafe.length ? replaySafe[replaySafe.length - 1] : null,
    latest_failure: latestRuntimeFailure(latestEvent(events, AGENT_RUN_FAILED), latestMarker),
    latest_control: latestControlEvent(events),
    latest_interruption: latestRuntimeInterruption(events),
    latest_resume_diagnostic: latestResumeDiagnostic(events),
    latest_pending_call: pendingCallSummary(pendingCall),
    latest_pending_call_resolution: pendingResolutionSummary(pendingResolution),
    automatic_resume_supported: false,
    manual_restart_required: run.status === 'failed',
  };
}

/** Python `build_agent_run_save_point_projection`：从持久事件与 artifact 推出可恢复边界（只读）。 */
export function buildSavePointProjection(
  run: RunRecord,
  events: readonly RunEventRecord[],
  artifacts: readonly ArtifactRecord[],
  secrets: SecretContext,
): Obj {
  const orderedEvents = [...events].sort((a, b) => a.sequence - b.sequence || a.id - b.id);
  const orderedArtifacts = [...artifacts].sort((a, b) => a.id - b.id);
  const savePoints: Obj[] = [];
  for (const event of orderedEvents) {
    const point = savePointFromEvent(event);
    if (point !== null) savePoints.push(point);
  }
  for (const artifact of orderedArtifacts) savePoints.push(savePointFromArtifact(artifact));

  const latestPermission = latestEvent(orderedEvents, PERMISSION_REQUIRED);
  const latestDecision = latestEvent(orderedEvents, PERMISSION_APPROVED, PERMISSION_DENIED);
  const proposedPatch = latestArtifact(orderedArtifacts, 'proposed_patch');
  let latestPendingFact: ArtifactRecord | null = null;
  for (let index = orderedArtifacts.length - 1; index >= 0; index--) {
    const kind = orderedArtifacts[index].kind;
    if (
      kind === RUNTIME_PENDING_CALL_ARTIFACT_KIND ||
      kind === RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND
    ) {
      latestPendingFact = orderedArtifacts[index];
      break;
    }
  }
  const pendingCall = pendingCallSummary(latestPendingFact) !== null ? latestPendingFact : null;
  const activePendingCall =
    run.status === 'paused' || run.status === 'running' ? pendingCall : null;
  const pendingResolution = latestArtifact(
    orderedArtifacts,
    RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
  );
  const terminalEvent = latestEvent(
    orderedEvents.filter((event) => event.event_type !== STOP_RUN),
    AGENT_RUN_COMPLETED,
    AGENT_RUN_FAILED,
    AGENT_RUN_INTERRUPTED,
    STOP_RUN,
  );
  const pendingPermission =
    latestPermission !== null &&
    (latestDecision === null || latestDecision.sequence < latestPermission.sequence) &&
    run.status === 'paused';
  const execution = latestEvent(
    orderedEvents,
    AGENT_EXECUTION_STARTED,
    AGENT_EXECUTION_SETTLED,
    AGENT_RUN_INTERRUPTED,
  );
  const runtimeState =
    execution !== null
      ? execution.event_type === AGENT_EXECUTION_STARTED
        ? 'in_flight'
        : 'settled'
      : run.status === 'running'
        ? 'in_flight'
        : 'settled';
  const activeSummary = pendingCallSummary(activePendingCall);
  const projection: Obj = {
    run_id: run.public_id,
    status: run.status,
    current_step: run.current_step,
    save_points: savePoints,
    pending: {
      permission_required: pendingPermission,
      permission_event_id: pendingPermission ? latestPermission!.id : null,
      blocked_tool: pendingPermission ? blockedTool(latestPermission) : null,
      proposed_patch_artifact_id:
        proposedPatch !== null && pendingPermission ? proposedPatch.id : null,
      runtime_pending_call_artifact_id: activeSummary !== null ? activePendingCall!.id : null,
      runtime_pending_tool:
        activeSummary !== null && typeof activeSummary.pending_tool === 'string'
          ? activeSummary.pending_tool
          : null,
    },
    recoverability: {
      terminal_event_id: terminalEvent !== null ? terminalEvent.id : null,
      resume_strategy: resumeStrategy(run, pendingPermission),
    },
    runtime_recovery: runtimeRecoveryProjection(
      run,
      orderedEvents,
      activePendingCall,
      pendingResolution,
    ),
    interruption_model: {
      uses_existing_paused_status: run.status === 'paused',
      uses_existing_stopped_status: run.status === 'stopped',
      has_interrupted_event: latestEvent(orderedEvents, AGENT_RUN_INTERRUPTED) !== null,
      runtime_state: runtimeState,
    },
  };
  return redactSensitive(projection as PlainJson, secrets) as Obj;
}

export type RunReadDeps = {
  readonly store: RunStore;
  readonly secrets: SecretContext;
  readonly reader: ProjectReader;
  readonly checkpoints: LoopCheckpointStore;
};

async function ownedRun(store: RunStore, publicId: string): Promise<RunRecord> {
  const run = await store.findRun(publicId);
  if (run === null) throw new AgentRunNotFoundError();
  return run;
}

/**
 * `GET /api/agent-runs/{id}/events`：按写入顺序的事件，消息与载荷脱敏、未决调用只露摘要。
 * 内存存储不记时间戳，所以没有 created_at / updated_at（前端不读）。
 */
export async function listAgentRunEvents(deps: RunReadDeps, publicId: string): Promise<Obj[]> {
  const run = await ownedRun(deps.store, publicId);
  const events = [...(await deps.store.events(run.id))].sort(
    (a, b) => a.sequence - b.sequence || a.id - b.id,
  );
  return events.map((event) => ({
    id: event.id,
    run_id: event.run_id,
    event_type: event.event_type,
    actor: event.actor,
    message: redactSensitiveText(event.message, deps.secrets),
    payload: redactSensitive(
      publicRuntimeEventPayload(event.event_type, event.payload) as PlainJson,
      deps.secrets,
    ),
    sequence: event.sequence,
  }));
}

/**
 * `GET /api/agent-runs/{id}/save-points`：保存点投影，再叠上检查点能否续跑。
 * 检查点只在引擎内存（§2.6），诊断从内存里最近一份算，没有 artifact_id。
 */
export async function agentRunSavePoints(deps: RunReadDeps, publicId: string): Promise<Obj> {
  const run = await ownedRun(deps.store, publicId);
  const events = await deps.store.events(run.id);
  const artifacts = (await deps.store.artifacts(run.id)).filter(
    (artifact) =>
      !HIDDEN_SYSTEM_ARTIFACT_KINDS.has(artifact.kind) ||
      artifact.kind === RUNTIME_PENDING_CALL_ARTIFACT_KIND ||
      artifact.kind === RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
  );
  const projection = buildSavePointProjection(run, events, artifacts, deps.secrets);
  const saved = deps.checkpoints.latest(run.public_id);
  if (saved === null) return projection;
  let diagnostic = await diagnoseCheckpoint(deps, saved, run);
  // 已完成 / 已停止的 run 与既有的权限等待以它们自己为准。
  const settled = (await agentExecutionState(deps.store, run)) === 'settled';
  const canResume =
    diagnostic.can_resume === true &&
    settled &&
    run.status === 'paused' &&
    run.current_step !== 'permission.confirm';
  if (run.status === 'paused' && !settled)
    diagnostic = {
      ...diagnostic,
      reason: 'execution_in_flight',
      resume_strategy: 'await_settlement',
    };
  diagnostic = { ...diagnostic, can_resume: canResume, resume_via_control_channel: canResume };
  const recovery = projection.runtime_recovery as Obj;
  const recoverability = projection.recoverability as Obj;
  recovery.checkpoint_resume = diagnostic;
  recoverability.can_resume = canResume;
  if (run.status === 'paused' && run.current_step !== 'permission.confirm') {
    recoverability.resume_strategy = !settled
      ? 'await_settlement'
      : canResume
        ? 'continue_checkpoint'
        : 'reconciliation_required';
    recovery.manual_restart_required = false;
  }
  return projection;
}
