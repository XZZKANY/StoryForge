type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 流式响应与事件里的轻量工具调用轨迹。 */
export type AgentToolTrace = {
  readonly tool_name: string;
  readonly status: string;
  readonly input_summary: Obj;
  readonly output_summary?: Obj | null;
  readonly audit_event_id?: string | null;
  readonly assistant_tool_call_id?: number | null;
  readonly error_message?: string | null;
};

export function traceAsDict(trace: AgentToolTrace): Obj {
  const payload: Obj = {
    tool_name: trace.tool_name,
    status: trace.status,
    input_summary: trace.input_summary,
  };
  if (trace.output_summary !== null && trace.output_summary !== undefined)
    payload.output_summary = trace.output_summary;
  if (trace.audit_event_id !== null && trace.audit_event_id !== undefined)
    payload.audit_event_id = trace.audit_event_id;
  if (trace.assistant_tool_call_id !== null && trace.assistant_tool_call_id !== undefined)
    payload.assistant_tool_call_id = trace.assistant_tool_call_id;
  if (trace.error_message !== null && trace.error_message !== undefined)
    payload.error_message = trace.error_message;
  return payload;
}

/** 工具注册信息里恢复标记用到的四项。 */
export type ToolRecoveryPolicy = {
  readonly retry_safe: boolean;
  readonly idempotent: boolean;
  readonly execution_mode: string;
  readonly artifact_kinds: readonly string[];
};

/** 结果已落进事件表之后的边界：能否从这里重放。 */
export function buildRuntimeExecutionMarker(
  trace: AgentToolTrace,
  index: number,
  spec: ToolRecoveryPolicy | null,
): Obj {
  const replaySafe =
    trace.status === 'completed' && spec !== null && spec.retry_safe && spec.idempotent;
  const reason =
    trace.status !== 'completed'
      ? 'tool_not_completed'
      : replaySafe
        ? 'retry_safe_idempotent_tool'
        : spec === null
          ? 'unknown_tool_policy'
          : 'tool_not_retry_safe';
  return {
    kind: 'after_tool',
    source: 'tool_trace',
    tool_name: trace.tool_name,
    tool_index: index,
    status: trace.status,
    replay_safe: replaySafe,
    resume_strategy: replaySafe ? 'replay_from_tool_boundary' : 'manual_restart_required',
    reason,
  };
}

/** tool_trace 事件携带的恢复标记。 */
export function buildToolRecoveryPayload(
  trace: AgentToolTrace,
  index: number,
  spec: ToolRecoveryPolicy | null,
): Obj {
  const payload: Obj = {
    kind: 'tool_completed',
    tool_name: trace.tool_name,
    status: trace.status,
    index,
  };
  if (spec !== null)
    Object.assign(payload, {
      retry_safe: spec.retry_safe,
      idempotent: spec.idempotent,
      execution_mode: spec.execution_mode,
      artifact_kinds: [...spec.artifact_kinds],
    });
  payload.execution_marker = buildRuntimeExecutionMarker(trace, index, spec);
  return payload;
}

/**
 * 把 run 已有的 paused / stopped 状态投影成运行时中断。Python 版另有「托管宿主正在关闭」
 * 一支：单进程后关窗即进程退出，没有这个中间态，不搬。
 */
export function buildRuntimeInterruptionPayload(
  run: { readonly status: string; readonly current_step: unknown },
  boundary: string,
): Obj | null {
  if (run.status !== 'paused' && run.status !== 'stopped') return null;
  return {
    status: run.status,
    boundary,
    kind: 'runtime_interruption',
    current_step: typeof run.current_step === 'string' ? run.current_step : null,
    uses_existing_status: true,
    resume_strategy: run.status === 'paused' ? 'await_resume' : 'stopped_by_user',
    automatic_resume_supported: false,
  };
}

export const RUNTIME_PENDING_CALL_ARTIFACT_KIND = 'runtime_pending_call';
export const RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND = 'runtime_pending_call_resolution';
export const SUPPORTED_RUNTIME_PENDING_CALL_INTENTS = new Set([
  'chapter.review',
  'file.review',
  'chapter.write',
]);

/** 结果里的轨迹（字典或已有轨迹）规整成轨迹对象；缺字段按 Python 的缺省补。 */
export function traceObjects(result: Obj): AgentToolTrace[] {
  const traces = Array.isArray(result.tool_trace) ? result.tool_trace : [];
  return traces.filter(isObj).map((trace) => ({
    tool_name: String(trace.tool_name || 'unknown'),
    status: String(trace.status || 'completed'),
    input_summary: isObj(trace.input_summary) ? trace.input_summary : {},
    output_summary: isObj(trace.output_summary) ? trace.output_summary : null,
    audit_event_id: typeof trace.audit_event_id === 'string' ? trace.audit_event_id : null,
    assistant_tool_call_id:
      typeof trace.assistant_tool_call_id === 'number' &&
      Number.isInteger(trace.assistant_tool_call_id)
        ? trace.assistant_tool_call_id
        : null,
    error_message: typeof trace.error_message === 'string' ? trace.error_message : null,
  }));
}

/** 未决调用 artifact 的安全摘要：只挑几个已知字段，私有正文不外露。 */
export function buildRuntimePendingCallSummary(
  payload: unknown,
  artifactId: number | null = null,
  artifactKind: string | null = RUNTIME_PENDING_CALL_ARTIFACT_KIND,
): Obj | null {
  if (!isObj(payload) || payload.status !== 'pending') return null;
  const summary: Obj = {};
  if (artifactId !== null) summary.artifact_id = artifactId;
  if (artifactKind) summary.artifact_kind = artifactKind;
  for (const key of ['intent', 'boundary', 'status', 'resume_strategy']) {
    const value = payload[key];
    if (typeof value === 'string' && value) summary[key] = value;
  }
  if (summary.intent === 'file.review')
    summary.pending_tool =
      summary.boundary !== 'after_tool:context.load' ? 'file.review.postprocess' : 'file.review';
  else if (summary.intent === 'chapter.review') summary.pending_tool = 'chapter.review.postprocess';
  else if (summary.intent === 'chapter.write') summary.pending_tool = 'chapter.write.brief_confirm';
  const next = payload.next_trace_index;
  if (typeof next === 'number' && Number.isInteger(next)) summary.next_trace_index = next;
  return summary;
}

/** 未决调用能不能经控制通道恢复，以及不能的原因（runtime_recovery 的恢复诊断）。 */
export function buildRuntimePendingCallResumeDiagnostic(input: {
  runStatus: unknown;
  currentStep: unknown;
  payload: unknown;
  artifactId?: number | null;
  artifactKind?: string | null;
}): Obj {
  const artifactId = input.artifactId ?? null;
  const artifactKind =
    input.artifactKind === undefined ? RUNTIME_PENDING_CALL_ARTIFACT_KIND : input.artifactKind;
  const summary = buildRuntimePendingCallSummary(input.payload, artifactId, artifactKind);
  const diagnostic: Obj = {
    kind: 'runtime_pending_call_resume',
    can_resume: false,
    resume_via_control_channel: false,
    requires_manual_restart: true,
    reason: 'invalid_pending_call',
    resume_strategy: 'manual_restart_required',
  };
  if (artifactId !== null) diagnostic.artifact_id = artifactId;
  if (artifactKind) diagnostic.artifact_kind = artifactKind;
  if (typeof input.runStatus === 'string') diagnostic.run_status = input.runStatus;
  if (typeof input.currentStep === 'string') diagnostic.current_step = input.currentStep;
  if (summary === null) return diagnostic;
  for (const key of ['intent', 'boundary', 'status', 'pending_tool', 'next_trace_index']) {
    const value = summary[key];
    if (typeof value === 'string' || typeof value === 'number') diagnostic[key] = value;
  }
  const pendingStrategy = summary.resume_strategy;
  if (typeof pendingStrategy === 'string' && pendingStrategy)
    diagnostic.pending_resume_strategy = pendingStrategy;
  const intent = summary.intent;
  if (typeof intent !== 'string' || !SUPPORTED_RUNTIME_PENDING_CALL_INTENTS.has(intent)) {
    diagnostic.reason = 'unsupported_pending_call_intent';
    return diagnostic;
  }
  if (input.runStatus !== 'running' || input.currentStep !== 'resumed') {
    diagnostic.reason = 'run_not_resumed';
    diagnostic.requires_manual_restart = false;
    diagnostic.resume_strategy = 'await_resume';
    return diagnostic;
  }
  const payload = input.payload as Obj;
  if (!isObj(payload.resume_message)) {
    diagnostic.reason = 'missing_resume_message';
    return diagnostic;
  }
  if (
    intent === 'chapter.review' &&
    (!isObj(payload.judge_output) || !isObj(payload.judge_trace))
  ) {
    diagnostic.reason = 'missing_resume_payload';
    return diagnostic;
  }
  if (intent === 'chapter.write' && !isObj(payload.chapter_brief)) {
    diagnostic.reason = 'missing_resume_payload';
    return diagnostic;
  }
  diagnostic.can_resume = true;
  diagnostic.resume_via_control_channel = true;
  diagnostic.requires_manual_restart = false;
  diagnostic.reason = 'pending_call_ready';
  diagnostic.resume_strategy =
    typeof pendingStrategy === 'string' && pendingStrategy
      ? pendingStrategy
      : 'continue_pending_call';
  return diagnostic;
}

/** 消费掉的未决调用留一条只增不改的隐藏记录。 */
export function buildRuntimePendingCallResolutionPayload(
  payload: unknown,
  artifactId: number,
  artifactKind: string = RUNTIME_PENDING_CALL_ARTIFACT_KIND,
): Obj {
  const pending = buildRuntimePendingCallSummary(payload, artifactId, artifactKind);
  const result: Obj = {
    kind: RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
    status: 'resolved',
    resolution: 'resumed',
    resolved_by: 'agent_runtime',
    result_status: 'completed',
    pending_artifact_id: artifactId,
    pending_artifact_kind: artifactKind,
  };
  if (pending !== null) {
    result.pending_call = pending;
    for (const key of ['intent', 'boundary', 'pending_tool', 'next_trace_index']) {
      const value = pending[key];
      if (typeof value === 'string' || typeof value === 'number') result[key] = value;
    }
    const strategy = pending.resume_strategy;
    if (typeof strategy === 'string' && strategy) result.pending_resume_strategy = strategy;
  }
  return result;
}

/** 私有的可恢复 artifact 对外只给摘要；其余事件原样。 */
export function publicRuntimeEventPayload(eventType: string, payload: Obj): Obj {
  if (eventType !== 'agent_artifact' || payload.kind !== RUNTIME_PENDING_CALL_ARTIFACT_KIND)
    return payload;
  const visible: Obj = {
    kind: RUNTIME_PENDING_CALL_ARTIFACT_KIND,
    payload: buildRuntimePendingCallSummary(payload.payload) ?? {},
  };
  if (typeof payload.artifact_id === 'number' && Number.isInteger(payload.artifact_id))
    visible.artifact_id = payload.artifact_id;
  if (typeof payload.requires_confirmation === 'boolean')
    visible.requires_confirmation = payload.requires_confirmation;
  return visible;
}

const PROGRESS_FIELDS: Readonly<Record<string, string | null>> = {
  request_started: 'timeout_seconds',
  retry_wait: 'delay_seconds',
  retry_started: null,
};

/** 模型传输进度只留阶段、序号与时长；路径、提示词、错误正文一律不进事件表。 */
export function normalizeRuntimeProgress(progress: Obj): Obj {
  const phase = progress.phase;
  if (typeof phase !== 'string' || !Object.prototype.hasOwnProperty.call(PROGRESS_FIELDS, phase))
    throw new RangeError('Unknown runtime progress phase');
  const number = progress.request_number;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1)
    throw new RangeError('Runtime progress requires a positive request number');
  const result: Obj = { phase, request_number: number };
  const field = PROGRESS_FIELDS[phase];
  if (field !== null) {
    const value = progress[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      throw new RangeError('Runtime progress requires a finite non-negative duration');
    result[field] = value;
  }
  return result;
}
