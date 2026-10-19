import { redactSensitive, type PlainJson } from '../kernel/redaction';
import type { RunEventRecord, RunRecord, RunStore } from '../store/runs';
import {
  executeAgentUserMessageRun,
  type AgentRuntimeDeps,
  type ExecuteRunInput,
} from './agentRuntime';
import { diagnoseCheckpoint } from './chatLoopCheckpoints';
import { latestRuntimePendingCall } from './fixedPipelines';
import { canonicalPermissionProfile } from './permission';
import {
  AGENT_RUN_TERMINAL_STATUSES,
  AgentRunNotFoundError,
  failAgentRun,
  interruptedResult,
  recordAgentEvent,
  settleAgentRunInterruption,
  type RunServices,
} from './runEvents';
import {
  AGENT_EXECUTION_CLAIMED,
  AGENT_EXECUTION_SETTLED,
  AGENT_EXECUTION_STARTED,
  AGENT_RUN_COMPLETED,
  AGENT_RUN_FAILED,
  AGENT_RUN_INTERRUPTED,
  APPROVE_PERMISSION_COMMAND,
  controlEventMessage,
  controlEventType,
  DENY_PERMISSION_COMMAND,
  PAUSE_RUN,
  PERMISSION_REQUIRED,
  resolveExecutionResult,
  RESUME_RUN,
  STOP_RUN,
} from './runPayloads';
import { buildRuntimePendingCallResumeDiagnostic } from './traces';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

export type RuntimeState = 'in_flight' | 'settled';
export type ControlEffect = 'applied' | 'requested' | 'ignored';

const OWNERSHIP_EVENTS = new Set([
  AGENT_EXECUTION_CLAIMED,
  AGENT_EXECUTION_STARTED,
  AGENT_EXECUTION_SETTLED,
  AGENT_RUN_INTERRUPTED,
]);

/**
 * 有没有执行正在跑（取自执行开始 / 结算 / 认领事件）：执行开始而未结算就是 in_flight；
 * 认领后、开始前也算 in_flight，除非认领被诊断判为不能续跑。没有任何事件时只有 running 才算在跑。
 */
export async function agentExecutionState(store: RunStore, run: RunRecord): Promise<RuntimeState> {
  const events = await store.events(run.id);
  const latest = [...events].reverse().find((event) => OWNERSHIP_EVENTS.has(event.event_type));
  if (latest === undefined) return run.status === 'running' ? 'in_flight' : 'settled';
  if (latest.event_type === AGENT_EXECUTION_CLAIMED) {
    const controlId = latest.payload.control_event_id;
    const control = isInt(controlId) ? events.find((event) => event.id === controlId) : undefined;
    const recovery = control === undefined ? null : control.payload.runtime_recovery;
    const diagnostic = isObj(recovery) ? recovery.resume_diagnostic : null;
    return isObj(diagnostic) && diagnostic.can_resume === false ? 'settled' : 'in_flight';
  }
  if (latest.event_type === AGENT_EXECUTION_STARTED) return 'in_flight';
  const owner = [...events]
    .reverse()
    .find(
      (event) =>
        event.event_type === AGENT_EXECUTION_CLAIMED ||
        event.event_type === AGENT_EXECUTION_STARTED,
    );
  const settledId = latest.payload.execution_id;
  if (
    owner !== undefined &&
    settledId !== null &&
    settledId !== undefined &&
    settledId !== owner.id
  ) {
    // 迟到的收尾结算不了更新的执行（或它开始前的认领）。
    const matching = events.some(
      (event) =>
        (event.event_type === AGENT_EXECUTION_SETTLED ||
          event.event_type === AGENT_RUN_INTERRUPTED) &&
        event.sequence > owner.sequence &&
        event.payload.execution_id === owner.id,
    );
    return matching ? 'settled' : 'in_flight';
  }
  return 'settled';
}

/**
 * 起服收尸（Python `reap_non_terminal_agent_runs`）：上次进程里没跑完的 run 已没有执行在驱动，
 * running 收为 failed（reason=process_restart）；paused 是等作者确认 / 恢复的持久态，不动。
 * 引擎的检查点只在内存，没有 Python 那样可停放到 runtime.recovery 的持久检查点；
 * 上次进程里没结算的执行（认领了没开始、开始了没结束）补一条结算事件。返回非终态且非 paused 的 run 数。
 */
export async function reapInterruptedRuns(services: RunServices): Promise<number> {
  const stale = (await services.store.allRuns()).filter(
    (run) => !AGENT_RUN_TERMINAL_STATUSES.has(run.status) && run.status !== 'paused',
  );
  for (const run of stale)
    await failAgentRun(
      services,
      run,
      {
        message: '进程重启，运行未完成即收尸。',
        payload: { reason: 'process_restart', run_id: run.public_id },
      },
      { executionId: null },
    );
  for (const run of await services.store.allRuns()) {
    const latest = [...(await services.store.events(run.id))]
      .reverse()
      .find(
        (event) =>
          event.event_type === AGENT_EXECUTION_CLAIMED ||
          event.event_type === AGENT_EXECUTION_STARTED,
      );
    // 认领了没开始、开始了没结束，都是上次进程里的执行：进程已经没了，补一条结算，
    // 否则暂停后来不及停下就退出的 run 会一直显示「在跑」，点继续也没反应。
    if (latest !== undefined && (await agentExecutionState(services.store, run)) === 'in_flight')
      await recordAgentEvent(services, run, {
        eventType: AGENT_EXECUTION_SETTLED,
        actor: 'agent-runtime',
        payload: {
          runtime_state: 'settled',
          execution_id: latest.id,
          run_status: run.status,
          reason: 'process_restart',
        },
      });
  }
  return stale.length;
}

async function ownedRun(store: RunStore, publicId: string, sessionId: string): Promise<RunRecord> {
  const run = await store.findRun(publicId);
  // 归属不符按「不存在」报错，不泄漏 run 存在性。
  if (run === null || run.session_id !== sessionId) throw new AgentRunNotFoundError();
  return run;
}

/**
 * 记一条作者的控制消息并按 run 当下的状态裁决效果。所有状态写都是比较交换：
 * 终态 run 不会被迟到的暂停 / 停止拖回，恢复只从已结算的 paused 生效、两条恢复只有一条认领成功。
 */
export async function recordAgentControlEvent(
  services: RunServices,
  input: { publicId: string; sessionId: string; controlType: string; payload?: Obj | null },
): Promise<RunEventRecord> {
  const { store } = services;
  const { publicId, sessionId, controlType } = input;
  let run = await ownedRun(store, publicId, sessionId);
  const eventPayload: Obj = {
    session_id: sessionId,
    run_id: publicId,
    control_type: controlType,
    ...(input.payload ?? {}),
  };
  // 执行权只由服务端提交的状态转换授予，调用方带来的效果与恢复信息一律不认。
  eventPayload.control_effect = 'ignored';
  delete eventPayload.runtime_recovery;
  let event = await recordAgentEvent(services, run, {
    eventType: controlEventType(controlType),
    actor: 'desktop-ide',
    message: controlEventMessage(controlType),
    payload: eventPayload,
  });
  run = await store.getRun(run.id);
  let runtimeState = await agentExecutionState(store, run);
  let effect: ControlEffect = 'ignored';
  let resolution: Obj = {};
  const permissionControl =
    controlType === APPROVE_PERMISSION_COMMAND || controlType === DENY_PERMISSION_COMMAND;
  let permissionTransition =
    permissionControl &&
    run.status === 'paused' &&
    run.current_step === 'permission.confirm' &&
    runtimeState === 'settled';
  if (permissionTransition) {
    const pending = (await store.events(run.id))
      .filter((item) => item.event_type === PERMISSION_REQUIRED)
      .pop();
    permissionTransition = pending !== undefined;
    if (pending !== undefined)
      resolution = resolveExecutionResult(
        pending.payload,
        controlType === APPROVE_PERMISSION_COMMAND,
      );
  }
  const expected = { status: run.status, current_step: run.current_step };
  const terminal = AGENT_RUN_TERMINAL_STATUSES.has(run.status);
  if ((controlType === PAUSE_RUN || controlType === STOP_RUN) && !terminal) {
    const target = controlType === PAUSE_RUN ? 'paused' : 'stopped';
    const changed = await store.updateRunIf(run.id, expected, {
      status: target,
      current_step: target,
    });
    run = await store.getRun(run.id);
    if (changed === null) runtimeState = await agentExecutionState(store, run);
    effect = changed === null ? 'ignored' : runtimeState === 'in_flight' ? 'requested' : 'applied';
  } else if (
    controlType === RESUME_RUN &&
    run.status === 'paused' &&
    runtimeState === 'settled' &&
    run.current_step !== 'permission.confirm'
  ) {
    // 两条控制连接都可能读到 paused：只有赢得这次状态转换的一方能启动续跑。
    const claimed = await store.updateRunIf(
      run.id,
      { status: 'paused', current_step: run.current_step },
      { status: 'running', current_step: 'resumed' },
    );
    run = await store.getRun(run.id);
    runtimeState = await agentExecutionState(store, run);
    effect = claimed === null ? 'ignored' : 'applied';
    if (effect === 'applied') runtimeState = 'in_flight';
  } else if (controlType === STOP_RUN && run.status === 'stopped' && runtimeState === 'in_flight') {
    effect = 'requested';
  } else if (permissionControl && permissionTransition) {
    const approved = controlType === APPROVE_PERMISSION_COMMAND;
    const resolved = Object.keys(resolution).length > 0;
    const changed = await store.updateRunIf(
      run.id,
      { status: 'paused', current_step: 'permission.confirm' },
      {
        status: approved && !resolved ? 'completed' : 'failed',
        current_step:
          approved && resolved
            ? 'permission.approved'
            : approved
              ? 'completed'
              : 'permission.denied',
      },
    );
    run = await store.getRun(run.id);
    runtimeState = await agentExecutionState(store, run);
    effect = changed === null ? 'ignored' : 'applied';
  }
  event = await store.updateEvent(event.id, {
    ...event.payload,
    control_effect: effect,
    runtime_state: runtimeState,
    run_status: run.status,
  });
  if ((controlType === PAUSE_RUN || controlType === STOP_RUN) && effect === 'applied') {
    await settleAgentRunInterruption(services, run, null, null);
  } else if (permissionControl && effect === 'applied') {
    const approved = controlType === APPROVE_PERMISSION_COMMAND;
    const resolved = Object.keys(resolution).length > 0;
    await recordAgentEvent(services, run, {
      eventType: approved && !resolved ? AGENT_RUN_COMPLETED : AGENT_RUN_FAILED,
      actor: approved ? 'root-agent' : 'permission-gate',
      message: approved
        ? resolved
          ? '作者已批准已有提案；本轮执行仍未完成。'
          : '权限已批准，AgentRun 已完成待确认步骤。'
        : '作者拒绝权限请求，AgentRun 已停止。',
      payload: {
        session_id: sessionId,
        run_id: publicId,
        control_type: controlType,
        ...resolution,
        assistant_session_id: run.assistant_session_id,
        permission_profile: canonicalPermissionProfile(run.permission_profile),
      },
    });
  } else if (controlType === RESUME_RUN && effect === 'applied') {
    await recordAgentEvent(services, run, {
      eventType: AGENT_EXECUTION_CLAIMED,
      actor: 'agent-runtime',
      payload: { control_event_id: event.id, runtime_state: 'in_flight' },
    });
  }
  return event;
}

async function recordResumeDiagnostic(
  services: RunServices,
  event: RunEventRecord,
  diagnostic: Obj,
): Promise<RunEventRecord> {
  const recovery = isObj(event.payload.runtime_recovery) ? event.payload.runtime_recovery : {};
  const payload = redactSensitive(
    {
      ...event.payload,
      runtime_recovery: { ...recovery, resume_diagnostic: diagnostic },
    } as PlainJson,
    services.secrets,
  ) as Obj;
  return services.store.updateEvent(event.id, payload);
}

/** 不能续跑的检查点：run 停在 paused / runtime.recovery，带着上次的轨迹与诊断原因结算。 */
async function parkCheckpointRun(deps: AgentRuntimeDeps, run: RunRecord, reason: string) {
  const services: RunServices = { store: deps.store, secrets: deps.secrets };
  const changed = await deps.store.updateRunIf(
    run.id,
    { status: ['running', 'paused'] },
    { status: 'paused', current_step: 'runtime.recovery' },
  );
  if (changed === null) return;
  const result = await interruptedResult(services, changed, null);
  const saved = deps.checkpoints.latest(run.public_id);
  const outcome = saved === null ? {} : saved.outcome;
  result.tool_trace = Array.isArray(outcome.traces) ? outcome.traces : [];
  if (isObj(outcome.review_report))
    (result.agent_result as Obj).review_report = outcome.review_report;
  const ready = reason === 'durable_checkpoint_ready';
  result.runtime_recovery = {
    reason,
    can_resume: ready,
    resume_strategy: ready ? 'continue_checkpoint' : 'reconciliation_required',
  };
  await settleAgentRunInterruption(services, changed, result, null);
}

/** 恢复只走内存检查点：先诊断，能接着跑就以续跑身份再执行一次，否则停在 runtime.recovery。 */
async function resumeCheckpointRun(
  deps: AgentRuntimeDeps,
  run: RunRecord,
  input: ExecuteRunInput,
): Promise<[Obj | null, Obj | null]> {
  const saved = deps.checkpoints.latest(run.public_id);
  if (saved === null) return [null, null];
  const diagnostic = await diagnoseCheckpoint(deps, saved, run);
  if (diagnostic.can_resume !== true) {
    await parkCheckpointRun(deps, run, String(diagnostic.reason));
    return [null, diagnostic];
  }
  const result = await executeAgentUserMessageRun(deps, await deps.store.getRun(run.id), {
    ...input,
    message: { ...saved.resumeMessage, run_id: run.public_id },
  });
  result.run_id = run.public_id;
  return [result, null];
}

/**
 * 恢复：有可恢复的未决调用就按它记下的消息重放（固定管线停在边界上的那一步），
 * 没有就从内存检查点接着跑。
 */
async function resumeAgentRunIfPending(
  deps: AgentRuntimeDeps,
  run: RunRecord,
  input: ExecuteRunInput,
  controlPayload: Obj | null,
): Promise<[Obj | null, Obj | null]> {
  const pending = await latestRuntimePendingCall(deps.store, run);
  if (pending === null) return resumeCheckpointRun(deps, run, input);
  const payload = isObj(pending.payload) ? pending.payload : {};
  const diagnostic = buildRuntimePendingCallResumeDiagnostic({
    runStatus: run.status,
    currentStep: run.current_step,
    payload,
    artifactId: pending.id,
    artifactKind: pending.kind,
  });
  if (diagnostic.can_resume !== true) return [null, diagnostic];
  const message = isObj(payload.resume_message) ? payload.resume_message : null;
  if (message === null) return [null, diagnostic];
  const resumeMessage: Obj = { ...message };
  if (payload.intent === 'chapter.write') {
    // 作者确认（可能改过）的 brief 随恢复控制一起交来，脱敏后放进重放消息。
    const candidate = (controlPayload ?? {}).chapter_brief;
    if (isObj(candidate))
      resumeMessage.args = {
        ...(isObj(message.args) ? message.args : {}),
        chapter_brief: redactSensitive(candidate as PlainJson, deps.secrets),
      };
  }
  const result = await executeAgentUserMessageRun(deps, run, {
    ...input,
    message: {
      ...resumeMessage,
      run_id: run.public_id,
      intent: typeof payload.intent === 'string' ? payload.intent : message.intent,
    },
  });
  result.run_id = run.public_id;
  return [result, null];
}

/**
 * 认领了续跑却没有检查点可接（例如回落单轮在第一次模型调用前就停了）：没有执行在驱动它，
 * 回落为 stopped 并记诊断，作者重新发问。
 */
async function parkUnresumableResumedRun(
  deps: AgentRuntimeDeps,
  event: RunEventRecord,
  publicId: string,
): Promise<[Obj | null, RunEventRecord]> {
  const services: RunServices = { store: deps.store, secrets: deps.secrets };
  const run = (await deps.store.findRun(publicId))!;
  if (run.status !== 'running') return [null, event];
  if (deps.checkpoints.latest(publicId) !== null) return [null, event];
  const stopped = await deps.store.updateRun(run.id, {
    status: 'stopped',
    current_step: 'stopped',
  });
  const diagnostic = {
    kind: 'runtime_pending_call_resume',
    can_resume: false,
    resume_via_control_channel: false,
    requires_manual_restart: false,
    reason: 'no_pending_call',
    resume_strategy: 'start_new_message',
    reverted_status: 'stopped',
  };
  const updated = await recordResumeDiagnostic(services, event, diagnostic);
  await settleAgentRunInterruption(services, stopped, null, null);
  return [diagnostic, updated];
}

export type AgentControlResult = {
  readonly event: RunEventRecord;
  readonly resumedResult: Obj | null;
  readonly resumeDiagnostic: Obj | null;
};

/**
 * 作者的控制消息（暂停 / 停止 / 恢复 / 批准 / 拒绝）。恢复生效后在本次调用里接着跑完；
 * 章节管线的待定调用（章纲确认）随 P3-6，在那之前续跑只走内存检查点。
 */
export async function handleAgentControlMessage(
  deps: AgentRuntimeDeps,
  input: {
    publicId: string;
    sessionId: string;
    controlType: string;
    payload?: Obj | null;
    onEvent?: ExecuteRunInput['onEvent'];
    onText?: ExecuteRunInput['onText'];
  },
): Promise<AgentControlResult> {
  const services: RunServices = { store: deps.store, secrets: deps.secrets };
  let event = await recordAgentControlEvent(services, input);
  let resumedResult: Obj | null = null;
  let resumeDiagnostic: Obj | null = null;
  if (input.controlType === RESUME_RUN) {
    if (event.payload.control_effect === 'applied') {
      const run = await ownedRun(deps.store, input.publicId, input.sessionId);
      [resumedResult, resumeDiagnostic] = await resumeAgentRunIfPending(
        deps,
        run,
        {
          agentSessionId: input.sessionId,
          message: {},
          onEvent: input.onEvent,
          onText: input.onText,
        },
        input.payload ?? null,
      );
      if (resumeDiagnostic !== null)
        event = await recordResumeDiagnostic(services, event, resumeDiagnostic);
      else if (resumedResult === null)
        [resumeDiagnostic, event] = await parkUnresumableResumedRun(deps, event, input.publicId);
    } else {
      const run = (await deps.store.findRun(input.publicId))!;
      if (
        run.status === 'running' &&
        run.current_step === 'resumed' &&
        (await latestRuntimePendingCall(deps.store, run)) === null
      )
        [resumeDiagnostic, event] = await parkUnresumableResumedRun(deps, event, input.publicId);
    }
    const run = (await deps.store.findRun(input.publicId))!;
    event = await deps.store.updateEvent(event.id, {
      ...event.payload,
      runtime_state: await agentExecutionState(deps.store, run),
      run_status: run.status,
    });
  }
  return { event, resumedResult, resumeDiagnostic };
}
