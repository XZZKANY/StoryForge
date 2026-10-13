import { cloneJson, type JsonValue } from '../kernel/json';
import { normalizeAgentRoleInputs } from '../kernel/roleCatalog';
import {
  redactSensitive,
  redactSensitiveText,
  type PlainJson,
  type SecretContext,
} from '../kernel/redaction';
import { agentPlanPayload } from '../kernel/skillCatalog';
import {
  RunPublicIdConflictError,
  type RunEventFields,
  type RunEventRecord,
  type RunRecord,
  type RunStore,
} from '../store/runs';
import { canonicalPermissionProfile, normalizePermissionProfile } from './permission';
import {
  AGENT_ARTIFACT,
  AGENT_EXECUTION_SETTLED,
  AGENT_EXECUTION_STARTED,
  AGENT_PLAN_CREATED,
  AGENT_RUN_COMPLETED,
  AGENT_RUN_FAILED,
  AGENT_RUN_INTERRUPTED,
  AGENT_RUN_STARTED,
  AGENT_RUNTIME_PROGRESS,
  AgentOrchestrationError,
  budgetSummary,
  currentPlanStep,
  executionResultPayload,
  messageInputSummary,
  optionalPositiveInt,
  optionalString,
  payloadMessageText,
  PERMISSION_REQUIRED,
  scopeSummary,
  SUBAGENT_COMPLETED,
  SUBAGENT_STARTED,
  SYSTEM_JOB,
  TOOL_TRACE,
} from './runPayloads';
import { AGENT_RUNTIME_TOOL_SPECS } from './tools/catalog';
import {
  buildRuntimeInterruptionPayload,
  buildToolRecoveryPayload,
  normalizeRuntimeProgress,
  publicRuntimeEventPayload,
  traceAsDict,
  type AgentToolTrace,
} from './traces';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const deepCopy = <T>(value: T): T => cloneJson(value as JsonValue) as T;
/** 整数列：Python 的 True 是 int 1，落库后读回就是 1。 */
const sessionColumn = (value: unknown): number | null => {
  const id = optionalPositiveInt(value);
  return id === null ? null : Number(id);
};

export const AGENT_RUN_TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped']);
const KNOWLEDGE_PROPOSAL_ARTIFACT_KIND = 'knowledge_proposal';
const SPECS_BY_NAME = new Map(AGENT_RUNTIME_TOOL_SPECS.map((spec) => [spec.name, spec]));

export class AgentRunNotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'AgentRun 不存在。') {
    super(message);
    this.name = 'AgentRunNotFoundError';
  }
}

/** 一条事件连同记录它那一刻的 run（帧编码要用当时的状态）。 */
export type EventObserver = (event: RunEventRecord, run: RunRecord) => void;

export type RunServices = { store: RunStore; secrets: SecretContext };

type AgentEventInput = { eventType: string; actor: string; message?: string; payload?: Obj | null };

/** 事件行：消息与载荷脱敏，私有可恢复 artifact 只留对外摘要。 */
function agentEventFields(
  secrets: SecretContext,
  run: RunRecord,
  fields: AgentEventInput,
): RunEventFields {
  return {
    run_id: run.id,
    event_type: fields.eventType,
    actor: fields.actor,
    message: redactSensitiveText(fields.message ?? '', secrets),
    payload: redactSensitive(
      publicRuntimeEventPayload(fields.eventType, deepCopy(fields.payload ?? {})) as PlainJson,
      secrets,
    ) as Obj,
  };
}

export const recordAgentEvent = (
  services: RunServices,
  run: RunRecord,
  fields: AgentEventInput,
): Promise<RunEventRecord> =>
  services.store.appendEvent(agentEventFields(services.secrets, run, fields));

function artifactEventPayload(kind: string, payload: Obj): Obj {
  if (kind !== KNOWLEDGE_PROPOSAL_ARTIFACT_KIND) return payload;
  const proposals = Array.isArray(payload.proposals) ? payload.proposals : [];
  return {
    proposal_group_id: payload.proposal_group_id ?? null,
    revision: payload.revision ?? null,
    proposal_count: proposals.length,
    target_paths: proposals
      .filter((item): item is Obj => isObj(item) && typeof item.target_path === 'string')
      .map((item) => item.target_path),
  };
}

export async function recordAgentArtifact(
  services: RunServices,
  run: RunRecord,
  fields: { kind: string; payload: Obj; requiresConfirmation?: boolean },
) {
  const artifact = await services.store.insertArtifact({
    run_id: run.id,
    kind: fields.kind,
    payload: redactSensitive(deepCopy(fields.payload) as PlainJson, services.secrets) as Obj,
    requires_confirmation: fields.requiresConfirmation ?? false,
  });
  const event = await recordAgentEvent(services, run, {
    eventType: AGENT_ARTIFACT,
    actor: 'root-agent',
    message: `Root Agent 产出 ${fields.kind} artifact。`,
    payload: {
      artifact_id: artifact.id,
      kind: artifact.kind,
      requires_confirmation: artifact.requires_confirmation,
      payload: artifactEventPayload(artifact.kind, artifact.payload),
    },
  });
  return { artifact, event };
}

/** 创建或续接一次 run；续接只认同一 session，终态的 run 重新进入 running。 */
export async function createOrResumeAgentRun(
  services: RunServices,
  fields: {
    publicId: string;
    sessionId: string;
    goal: string;
    scope: Obj;
    permissionProfile: string | null;
    budget: Obj;
  },
): Promise<RunRecord> {
  const { store, secrets } = services;
  const requested = normalizePermissionProfile(fields.permissionProfile);
  const redact = (value: Obj) => redactSensitive(deepCopy(value) as PlainJson, secrets) as Obj;
  let existing = await store.findRun(fields.publicId);
  if (existing === null) {
    try {
      return await store.insertRun({
        public_id: fields.publicId,
        session_id: fields.sessionId,
        assistant_session_id: null,
        goal: redactSensitiveText(fields.goal, secrets),
        scope: redact(fields.scope),
        permission_profile: requested.profile,
        budget: redact(fields.budget),
        status: 'running',
        root_plan: [],
        current_step: null,
      });
    } catch (error) {
      // 同一 run 被并发创建：唯一约束挡下后到者，它按续接重走下面的归属守卫（与先后到达同义）。
      if (!(error instanceof RunPublicIdConflictError)) throw error;
      existing = await store.findRun(fields.publicId);
      if (existing === null) throw error;
    }
  }
  // 归属守卫：不能把另一会话的 run 静默搬到本会话，不符按「不存在」报错。
  if (existing.session_id !== fields.sessionId) throw new AgentRunNotFoundError();
  const pick = (value: Obj, fallback: Obj) => (Object.keys(value).length ? value : fallback);
  return store.updateRun(existing.id, {
    session_id: fields.sessionId,
    goal: redactSensitiveText(fields.goal, secrets),
    scope: redact(pick(fields.scope, existing.scope)),
    permission_profile:
      fields.permissionProfile !== null
        ? requested.profile
        : canonicalPermissionProfile(existing.permission_profile),
    budget: redact(pick(fields.budget, existing.budget)),
    ...(AGENT_RUN_TERMINAL_STATUSES.has(existing.status) ? { status: 'running' } : {}),
  });
}

/** 为一条作者消息建立 run 并写 started 事件。 */
export async function startAgentUserMessageRun(
  services: RunServices,
  input: { agentSessionId: string; message: Obj; newRunId: () => string },
): Promise<{ run: RunRecord; startedEvent: RunEventRecord }> {
  const { message } = input;
  const userMessage = payloadMessageText(message);
  const runId = optionalString(message.run_id) ?? input.newRunId();
  const args = isObj(message.args) ? message.args : {};
  const roles = normalizeAgentRoleInputs(args);
  const rawProfile = optionalString(message.permission_profile);
  const requested = rawProfile === null ? null : normalizePermissionProfile(rawProfile, false);
  const run = await createOrResumeAgentRun(services, {
    publicId: runId,
    sessionId: input.agentSessionId,
    goal: userMessage,
    scope: scopeSummary(args),
    permissionProfile: requested === null ? null : requested.profile,
    budget: budgetSummary(args),
  });
  const startedEvent = await recordAgentEvent(services, run, {
    eventType: AGENT_RUN_STARTED,
    actor: 'root-agent',
    message: 'Root Agent 已接收作者目标。',
    payload: {
      session_id: input.agentSessionId,
      run_id: run.public_id,
      user_message: userMessage,
      input_summary: messageInputSummary(message),
      agent_role_hints: roles.hints,
      agent_role_mentions: roles.mentions,
      unknown_agent_role_hints: roles.unknown_hints,
      unknown_agent_role_mentions: roles.unknown_mentions,
      permission_profile: run.permission_profile,
      ...(requested !== null && requested.migrated_from !== null
        ? { profile_migrated_from: requested.migrated_from }
        : {}),
    },
  });
  return { run, startedEvent };
}

export const startAgentExecution = (services: RunServices, run: RunRecord) =>
  recordAgentEvent(services, run, {
    eventType: AGENT_EXECUTION_STARTED,
    actor: 'agent-runtime',
    payload: { runtime_state: 'in_flight', run_id: run.public_id, session_id: run.session_id },
  });

// ---- 结果整形（runtime_support） ----

export const planStep = (step: string, detail: string, status: string) => ({
  step,
  detail,
  status,
});

export function runtimeInterruptionSummary(interruption: Obj): string {
  const { status, boundary } = interruption;
  if (status === 'paused') return `AgentRun 已在 ${String(boundary)} 边界暂停，等待继续指令。`;
  if (status === 'stopped') return `AgentRun 已在 ${String(boundary)} 边界停止。`;
  return `AgentRun 已在 ${String(boundary)} 边界中断。`;
}

export function runtimeInterruptedResponse(
  result: Obj,
  interruption: Obj,
  eventsRecorded = false,
): Obj {
  let agentResult = result.agent_result;
  if (!isObj(agentResult)) {
    agentResult = {};
    result.agent_result = agentResult;
  }
  const agent = agentResult as Obj;
  agent.summary = runtimeInterruptionSummary(interruption);
  agent.requires_user_confirmation = false;
  agent.runtime_interrupted = true;
  // 撤回尚未送达的写入，但保留章纲 / 审稿的恢复数据与路由标记。
  result.proposed_patch = null;
  delete result._tool_artifacts;
  result.runtime_interruption = interruption;
  result._runtime_interrupted = true;
  if (eventsRecorded) result._events_recorded = true;
  return result;
}

export function popRuntimeInternalMarkers(result: Obj): void {
  delete result._events_recorded;
  delete result._runtime_interrupted;
  delete result._tool_artifacts;
}

export function resultRequiresConfirmation(result: Obj): boolean {
  const agent = isObj(result.agent_result) ? result.agent_result : {};
  const patch = isObj(result.proposed_patch) ? result.proposed_patch : null;
  return Boolean(
    agent.requires_user_confirmation ||
    agent.confirmation_required ||
    (patch !== null && patch.requires_confirmation),
  );
}

// ---- 终态事件载荷（events/contracts） ----

const textOrNull = (value: unknown) => (typeof value === 'string' ? value : null);
const intOrNull = (value: unknown) =>
  typeof value === 'boolean' || (typeof value === 'number' && Number.isInteger(value))
    ? value
    : null;

export function completedEventPayload(result: Obj, agentResult: Obj): Obj {
  const summary = agentResult.summary;
  const patch = isObj(result.proposed_patch) ? result.proposed_patch : null;
  const loop = isObj(agentResult.chat_loop) ? agentResult.chat_loop : null;
  return {
    intent: textOrNull(result.intent),
    assistant_session_id: intOrNull(result.assistant_session_id),
    requires_user_confirmation: Boolean(agentResult.requires_user_confirmation),
    summary: typeof summary === 'string' ? Array.from(summary).slice(0, 4000).join('') : null,
    has_proposed_patch: patch !== null,
    has_review_report: isObj(agentResult.review_report),
    ...(patch !== null
      ? {
          proposed_patch: {
            id: patch.id ?? null,
            created_by_tool: textOrNull(patch.created_by_tool),
            file_path: textOrNull(patch.file_path),
          },
        }
      : {}),
    ...(loop !== null
      ? {
          chat_loop: {
            rounds: intOrNull(loop.rounds),
            tool_call_count: intOrNull(loop.tool_call_count),
          },
        }
      : {}),
  };
}

// ---- 守卫式终态：控制通道可能已经把 run 落成 paused / stopped，不能覆盖 ----

export async function completeAgentRun(
  services: RunServices,
  run: RunRecord,
  result: Obj,
  options: { executionId: number | null; onEvent?: EventObserver },
): Promise<RunRecord> {
  const agentResult = isObj(result.agent_result) ? result.agent_result : {};
  const settled = await services.store.settleRun(
    run.id,
    'running',
    {
      status: 'completed',
      current_step: 'completed',
      assistant_session_id: sessionColumn(result.assistant_session_id),
    },
    (updated) =>
      agentEventFields(services.secrets, updated, {
        eventType: AGENT_RUN_COMPLETED,
        actor: 'root-agent',
        message: String(agentResult.summary || 'AgentRun 已完成。'),
        payload: {
          ...completedEventPayload(result, agentResult),
          permission_profile: canonicalPermissionProfile(updated.permission_profile),
          ...(options.executionId !== null ? { execution_id: options.executionId } : {}),
        },
      }),
  );
  if (settled === null) return services.store.getRun(run.id);
  options.onEvent?.(settled.event, settled.run);
  return settled.run;
}

export async function failAgentRun(
  services: RunServices,
  run: RunRecord,
  fields: { message: string; payload?: Obj | null },
  options: { executionId: number | null; onEvent?: EventObserver },
): Promise<RunRecord> {
  const settled = await services.store.settleRun(
    run.id,
    'running',
    { status: 'failed', current_step: 'failed' },
    (updated) =>
      agentEventFields(services.secrets, updated, {
        eventType: AGENT_RUN_FAILED,
        actor: 'root-agent',
        message: fields.message,
        payload: {
          ...(fields.payload ?? {}),
          permission_profile: canonicalPermissionProfile(updated.permission_profile),
          ...(options.executionId !== null ? { execution_id: options.executionId } : {}),
        },
      }),
  );
  if (settled === null) return services.store.getRun(run.id);
  options.onEvent?.(settled.event, settled.run);
  return settled.run;
}

// ---- 收尾：worker 返回之后按 run 状态结算（单进程里执行权恒为本次） ----

export async function interruptedResult(
  services: RunServices,
  run: RunRecord,
  result: Obj | null,
): Promise<Obj> {
  let output = result;
  if (output === null) {
    const prior = (await services.store.events(run.id))
      .filter(
        (event) =>
          event.event_type === PERMISSION_REQUIRED || event.event_type === AGENT_RUN_INTERRUPTED,
      )
      .pop();
    const payload = prior?.payload ?? {};
    output = isObj(payload.execution_result)
      ? deepCopy(payload.execution_result)
      : {
          type: 'agent_result',
          session_id: run.session_id,
          run_id: run.public_id,
          assistant_session_id: run.assistant_session_id,
          intent: payload.intent || 'chat.explain',
          user_message: '',
          plan: run.root_plan.length ? run.root_plan : [],
          tool_trace: [],
          agent_result: {},
          proposed_patch: null,
        };
  }
  const previous = output.runtime_interruption;
  const interruption =
    isObj(previous) && previous.status === run.status
      ? previous
      : buildRuntimeInterruptionPayload(run, 'worker_settled');
  if (interruption === null)
    throw new RangeError('interrupted result requires paused/stopped status');
  output.run_id = run.public_id;
  runtimeInterruptedResponse(output, interruption);
  const agent = output.agent_result as Obj;
  delete agent.proposed_patch;
  agent.writeback_blocked_until_user_confirms = false;
  popRuntimeInternalMarkers(output);
  return output;
}

export async function settleAgentRunInterruption(
  services: RunServices,
  run: RunRecord,
  result: Obj | null,
  executionId: number | null,
): Promise<[Obj, RunEventRecord]> {
  const output = await interruptedResult(services, run, result);
  const event = await recordAgentEvent(services, run, {
    eventType: AGENT_RUN_INTERRUPTED,
    actor: 'agent-runtime',
    message: String((output.agent_result as Obj).summary),
    payload: {
      ...executionResultPayload(output),
      assistant_session_id: output.assistant_session_id ?? null,
      run_id: run.public_id,
      session_id: run.session_id,
      runtime_state: 'settled',
      execution_id: executionId,
      run_status: run.status,
    },
  });
  return [output, event];
}

export async function finishAgentExecution(
  services: RunServices,
  runId: number,
  started: RunEventRecord,
  result: Obj | null,
): Promise<[Obj | null, RunEventRecord, RunRecord]> {
  const run = await services.store.getRun(runId);
  const agent = isObj(result) && isObj(result.agent_result) ? result.agent_result : null;
  const confirmationWait =
    run.status === 'paused' &&
    (run.current_step === 'permission.confirm' || run.current_step === 'chapter.brief.confirm') &&
    agent !== null &&
    agent.requires_user_confirmation === true;
  if (run.status === 'stopped' || (run.status === 'paused' && !confirmationWait)) {
    const [output, event] = await settleAgentRunInterruption(services, run, result, started.id);
    return [output, event, run];
  }
  if (confirmationWait && run.current_step === 'chapter.brief.confirm') {
    // 章纲确认走内部中断标记跳过普通完成；公开的确认等待不是作者取消。
    delete agent!.runtime_interrupted;
    delete result!.runtime_interruption;
  }
  const event = await recordAgentEvent(services, run, {
    eventType: AGENT_EXECUTION_SETTLED,
    actor: 'agent-runtime',
    payload: {
      runtime_state: 'settled',
      execution_id: started.id,
      run_status: run.status,
      run_id: run.public_id,
      session_id: run.session_id,
    },
  });
  return [result, event, run];
}

/**
 * agent 运行时往事件表写东西的唯一出口；每条事件连同当时的 run 交给观察者（帧编码）。
 * 写回红线不变：这里只记事实，不写作者文件。
 */
export class AgentRunEventSink {
  private executionId: number | null = null;
  /** 传输进度是同步回调：先排队，后续每次记录前都等它落库（与 Python 同步提交同序）。 */
  private progress: Promise<void> = Promise.resolve();

  constructor(
    private readonly services: RunServices,
    private readonly onEvent: EventObserver | null = null,
  ) {}

  bindExecution(started: RunEventRecord): void {
    this.executionId = started.id;
  }

  get boundExecutionId(): number | null {
    return this.executionId;
  }

  private async emit(event: RunEventRecord): Promise<void> {
    if (this.onEvent) this.onEvent(event, await this.services.store.getRun(event.run_id));
  }

  queueRuntimeProgress(run: RunRecord, progress: Obj): void {
    this.progress = this.progress.then(() => this.recordRuntimeProgress(run, progress));
  }

  /** 排队中的传输进度全部落库（收尾之前、以及每次记别的事件之前）。 */
  drainRuntimeProgress(): Promise<void> {
    return this.progress;
  }

  async recordPlan(run: RunRecord, result: Obj): Promise<RunRecord> {
    await this.progress;
    const plan = Array.isArray(result.plan) ? result.plan : [];
    const updated = await this.services.store.updateRun(run.id, {
      root_plan: plan,
      current_step: currentPlanStep(plan),
      assistant_session_id: sessionColumn(result.assistant_session_id),
    });
    await this.emit(
      await recordAgentEvent(this.services, updated, {
        eventType: AGENT_PLAN_CREATED,
        actor: 'root-agent',
        message: 'Root Agent 已创建执行计划。',
        payload: agentPlanPayload({
          intent: result.intent ?? null,
          goal: updated.goal,
          scope: updated.scope as never,
          plan,
        }) as Obj,
      }),
    );
    return updated;
  }

  async recordToolTrace(run: RunRecord, trace: AgentToolTrace, index: number): Promise<void> {
    await this.progress;
    const input = trace.input_summary;
    const output = trace.output_summary ?? {};
    if (trace.tool_name.startsWith('subagent.')) {
      const role = trace.tool_name.slice('subagent.'.length);
      await this.emit(
        await recordAgentEvent(this.services, run, {
          eventType: SUBAGENT_STARTED,
          actor: 'root-agent',
          message: `${role} 子代理开始执行。`,
          payload: { index, role, input_summary: input },
        }),
      );
      const subagent = await this.services.store.insertSubagent({
        run_id: run.id,
        parent_run_id: null,
        role,
        input: redactSensitive(deepCopy(input) as PlainJson, this.services.secrets) as Obj,
        output: redactSensitive(deepCopy(output) as PlainJson, this.services.secrets) as Obj,
        status: trace.status,
      });
      await this.emit(
        await recordAgentEvent(this.services, run, {
          eventType: SUBAGENT_COMPLETED,
          actor: role,
          message: `${role} 子代理执行完成。`,
          payload: { index, subagent_run_id: subagent.id, role, output_summary: output },
        }),
      );
    }
    const spec = SPECS_BY_NAME.get(trace.tool_name) ?? null;
    await this.emit(
      await recordAgentEvent(this.services, run, {
        eventType: TOOL_TRACE,
        actor: 'tool-registry',
        message: `工具 ${trace.tool_name} 返回 ${trace.status}。`,
        payload: {
          index,
          trace: traceAsDict(trace),
          recovery: buildToolRecoveryPayload(trace, index, spec),
        },
      }),
    );
  }

  async recordArtifact(
    run: RunRecord,
    fields: { kind: string; payload: Obj; requiresConfirmation: boolean },
  ): Promise<void> {
    await this.progress;
    const { event } = await recordAgentArtifact(this.services, run, fields);
    await this.emit(event);
  }

  async recordPermissionRequired(run: RunRecord, result: Obj, reason: string): Promise<void> {
    await this.progress;
    const agent = isObj(result.agent_result) ? result.agent_result : {};
    const patch = isObj(result.proposed_patch) ? result.proposed_patch : null;
    const settled = await this.services.store.settleRun(
      run.id,
      'running',
      { status: 'paused', current_step: 'permission.confirm' },
      (updated) =>
        agentEventFields(this.services.secrets, updated, {
          eventType: PERMISSION_REQUIRED,
          actor: 'permission-gate',
          message: '该步骤需要作者确认后才能继续。',
          payload: {
            permission_profile: canonicalPermissionProfile(updated.permission_profile),
            ...(this.executionId !== null ? { execution_id: this.executionId } : {}),
            intent: result.intent ?? null,
            // 断线后前端重建终态时，assistant_session_id 是必要字段。
            assistant_session_id: updated.assistant_session_id,
            summary: agent.summary ?? null,
            requires_user_confirmation: true,
            ...(agent.execution_outcome ? executionResultPayload(result) : {}),
            reason,
            proposed_patch: patch,
            confirmation_action: agent.confirmation_action ?? null,
            confirmation_kind: agent.confirmation_kind ?? null,
            chapter_brief: agent.chapter_brief ?? null,
            blocked_tool:
              patch !== null ? patch.created_by_tool || 'file.revise' : (result.intent ?? null),
          },
        }),
    );
    // 只有赢得结算的一方发帧；输了说明控制通道已经落了终态。
    if (settled !== null) this.onEvent?.(settled.event, settled.run);
  }

  async recordSystemJob(
    run: RunRecord,
    fields: {
      key: string;
      payload: Obj;
      artifactKind?: string | null;
      artifactPayload?: Obj | null;
    },
  ): Promise<void> {
    await this.progress;
    if (
      fields.artifactKind &&
      fields.artifactPayload !== null &&
      fields.artifactPayload !== undefined
    )
      await this.recordArtifact(run, {
        kind: fields.artifactKind,
        payload: fields.artifactPayload,
        requiresConfirmation: false,
      });
    const { payload } = fields;
    await this.emit(
      await recordAgentEvent(this.services, run, {
        eventType: SYSTEM_JOB,
        actor: String(payload.actor || `system-${fields.key}-agent`),
        message: String(payload.message || `隐藏系统任务 ${fields.key} 已完成。`),
        payload: Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'message')),
      }),
    );
  }

  async complete(run: RunRecord, result: Obj): Promise<RunRecord> {
    await this.progress;
    return completeAgentRun(this.services, run, result, {
      executionId: this.executionId,
      onEvent: this.onEvent ?? undefined,
    });
  }

  async fail(run: RunRecord, message: string, payload: Obj | null = null): Promise<RunRecord> {
    await this.progress;
    return failAgentRun(
      this.services,
      run,
      { message, payload },
      {
        executionId: this.executionId,
        onEvent: this.onEvent ?? undefined,
      },
    );
  }

  async recordRuntimeProgress(run: RunRecord, progress: Obj): Promise<void> {
    await this.emit(
      await recordAgentEvent(this.services, run, {
        eventType: AGENT_RUNTIME_PROGRESS,
        actor: 'provider-transport',
        message: '模型传输阶段更新。',
        payload: normalizeRuntimeProgress(progress),
      }),
    );
  }

  async runtimeInterruption(run: RunRecord, boundary: string): Promise<Obj | null> {
    return buildRuntimeInterruptionPayload(await this.services.store.getRun(run.id), boundary);
  }
}

export { AgentOrchestrationError };
