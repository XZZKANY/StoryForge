import { ChatMessage, ToolCall, type MessageRole } from '../llm/contracts';
import {
  cloneJson,
  deepFreeze,
  InputDomainError,
  JsonFields,
  JsonFloat,
  type JsonObject,
  type JsonValue,
} from '../kernel/json';
import { runtimeArtifact, type RuntimeArtifact } from './sdkTools';

/** Python SDK 的 approval_required / external_result_required 在 StoryForge 里没有调用方，不搬。 */
export const RUNTIME_PHASES = [
  'before_model',
  'model_completed',
  'tools_pending',
  'tool_started',
  'after_tool',
  'interrupted',
  'completed',
  'failed',
] as const;
export type RuntimePhase = (typeof RUNTIME_PHASES)[number];

export type RuntimeResultStatus =
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'reconciliation_required';

export type RuntimeLimits = {
  readonly maxRounds: number;
  readonly maxToolCalls: number;
  readonly maxToolOutputChars: number;
  readonly maxTokens: number | null;
  readonly maxCost: number | null;
  readonly finalMessage: string;
};

export function runtimeLimits(fields: Partial<RuntimeLimits> = {}): RuntimeLimits {
  const limits: RuntimeLimits = {
    maxRounds: 8,
    maxToolCalls: 32,
    maxToolOutputChars: 60_000,
    maxTokens: null,
    maxCost: null,
    finalMessage:
      'Tools are no longer available. Finish the response using the information already collected.',
    ...fields,
  };
  if (limits.maxRounds < 1) throw new RangeError('max_rounds must be at least 1');
  if (limits.maxToolCalls < 0 || limits.maxToolOutputChars < 0)
    throw new RangeError('tool limits must be non-negative');
  if (limits.maxTokens !== null && limits.maxTokens < 1)
    throw new RangeError('max_tokens must be positive when configured');
  if (limits.maxCost !== null && limits.maxCost < 0)
    throw new RangeError('max_cost must be non-negative when configured');
  return limits;
}

export type PendingToolCall = {
  readonly callId: string;
  readonly name: string;
  readonly arguments: JsonObject;
  readonly attempt: number;
};

export const pendingToolCall = (
  callId: string,
  name: string,
  args: JsonObject,
  attempt = 0,
): PendingToolCall =>
  Object.freeze({ callId, name, arguments: deepFreeze(cloneJson(args)), attempt });

/** 消息与 Python 的 frozen ChatMessage 一样不可变：工具调用、metadata、provider 续接状态都冻结。 */
function freezeMessage(message: ChatMessage): ChatMessage {
  if (Object.isFrozen(message)) return message;
  message.toolCalls.forEach((call) => Object.freeze(call));
  Object.freeze(message.toolCalls);
  deepFreeze(message.metadata);
  deepFreeze(message.continuation);
  return Object.freeze(message);
}

type CheckpointFields = {
  runId: string;
  model: string;
  phase: RuntimePhase;
  messages: readonly ChatMessage[];
  roundCount: number;
  toolAttempts: number;
  toolOutputChars: number;
  totalTokens: number;
  totalCost: number | null;
  usageAvailable: boolean;
  costAvailable: boolean;
  pending: PendingToolCall | null;
  completedToolCallIds: readonly string[];
  artifacts: readonly RuntimeArtifact[];
  exhausted: boolean;
  sequence: number;
  interruptionReason: string | null;
  continuationOmitted: boolean;
};

/** 运行时检查点：内存里保留 provider 续接状态；序列化后续接状态丢失，恢复时要求对账。 */
export class RuntimeCheckpoint {
  readonly runId!: string;
  readonly model!: string;
  readonly phase!: RuntimePhase;
  readonly messages!: readonly ChatMessage[];
  readonly roundCount!: number;
  readonly toolAttempts!: number;
  readonly toolOutputChars!: number;
  readonly totalTokens!: number;
  readonly totalCost!: number | null;
  readonly usageAvailable!: boolean;
  readonly costAvailable!: boolean;
  readonly pending!: PendingToolCall | null;
  readonly completedToolCallIds!: readonly string[];
  readonly artifacts!: readonly RuntimeArtifact[];
  readonly exhausted!: boolean;
  readonly sequence!: number;
  readonly interruptionReason!: string | null;
  readonly continuationOmitted!: boolean;

  // 与 Python 的 frozen dataclass 一样整棵不可变：交给钩子与存储的快照改不动活动状态。
  constructor(fields: CheckpointFields) {
    Object.assign(this, fields, {
      messages: Object.freeze(fields.messages.map(freezeMessage)),
      completedToolCallIds: Object.freeze([...fields.completedToolCallIds]),
      artifacts: Object.freeze([...fields.artifacts]),
    });
    Object.freeze(this);
  }

  toDict(): JsonObject {
    const omitted =
      this.continuationOmitted || this.messages.some((message) => message.continuation !== null);
    return {
      run_id: this.runId,
      model: this.model,
      phase: this.phase,
      messages: this.messages.map((message) => ({
        role: message.role,
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          arguments_json: call.argumentsJson,
          type: call.type,
        })),
        tool_call_id: message.toolCallId,
        name: message.name,
      })),
      round_count: this.roundCount,
      tool_attempts: this.toolAttempts,
      tool_output_chars: this.toolOutputChars,
      total_tokens: this.totalTokens,
      total_cost: this.totalCost === null ? null : new JsonFloat(this.totalCost),
      usage_available: this.usageAvailable,
      cost_available: this.costAvailable,
      pending:
        this.pending === null
          ? null
          : {
              call_id: this.pending.callId,
              name: this.pending.name,
              arguments: cloneJson(this.pending.arguments),
              attempt: this.pending.attempt,
            },
      completed_tool_call_ids: [...this.completedToolCallIds],
      artifacts: this.artifacts.map((artifact) => ({
        kind: artifact.kind,
        payload: cloneJson(artifact.payload),
        reference: artifact.reference,
      })),
      exhausted: this.exhausted,
      sequence: this.sequence,
      interruption_reason: this.interruptionReason,
      continuation_omitted: omitted,
    };
  }

  /**
   * 只读回 toDict 写出的形状（应用自己写的缓存，§4.3.1）；形状不符直接报错，
   * 不像 Python 那样把缺字段、错类型硬转成 0 / 空串继续跑。
   */
  static fromDict(value: JsonValue, source = 'agent checkpoint'): RuntimeCheckpoint {
    const f = new JsonFields(source);
    const root = f.object(value, '$');
    const get = (object: JsonObject, key: string) => f.member(object, key);
    const phase = f.string(get(root, 'phase'), 'phase');
    if (!(RUNTIME_PHASES as readonly string[]).includes(phase))
      throw new InputDomainError(`${source} 的 phase 不是已知阶段：${phase}`);
    const messages = f.optionalArray(get(root, 'messages'), 'messages').map((item, index) => {
      const at = `messages[${index}]`;
      const row = f.object(item, at);
      const role = f.string(get(row, 'role'), `${at}.role`);
      if (!['system', 'user', 'assistant', 'tool'].includes(role))
        throw new InputDomainError(`${source} 的 ${at}.role 不是已知角色：${role}`);
      const calls = f.optionalArray(get(row, 'tool_calls'), `${at}.tool_calls`).map((call, i) => {
        const c = f.object(call, `${at}.tool_calls[${i}]`);
        const path = `${at}.tool_calls[${i}]`;
        return new ToolCall(
          f.string(get(c, 'id'), `${path}.id`),
          f.string(get(c, 'name'), `${path}.name`),
          f.string(get(c, 'arguments_json'), `${path}.arguments_json`),
          f.string(get(c, 'type'), `${path}.type`),
        );
      });
      return new ChatMessage(
        role as MessageRole,
        f.optionalString(get(row, 'content'), `${at}.content`),
        calls,
        f.optionalString(get(row, 'tool_call_id'), `${at}.tool_call_id`),
        f.optionalString(get(row, 'name'), `${at}.name`),
      );
    });
    const rawPending = get(root, 'pending');
    const pending =
      rawPending === null || rawPending === undefined
        ? null
        : (() => {
            const p = f.object(rawPending, 'pending');
            return pendingToolCall(
              f.string(get(p, 'call_id'), 'pending.call_id'),
              f.string(get(p, 'name'), 'pending.name'),
              f.object(get(p, 'arguments'), 'pending.arguments'),
              f.integer(get(p, 'attempt'), 'pending.attempt'),
            );
          })();
    const cost = get(root, 'total_cost');
    const totalCost =
      cost === null || cost === undefined
        ? null
        : cost instanceof JsonFloat
          ? cost.value
          : f.integer(cost, 'total_cost');
    return new RuntimeCheckpoint({
      runId: f.string(get(root, 'run_id'), 'run_id'),
      model: f.string(get(root, 'model'), 'model'),
      phase: phase as RuntimePhase,
      messages,
      roundCount: f.integer(get(root, 'round_count'), 'round_count'),
      toolAttempts: f.integer(get(root, 'tool_attempts'), 'tool_attempts'),
      toolOutputChars: f.integer(get(root, 'tool_output_chars'), 'tool_output_chars'),
      totalTokens: f.integer(get(root, 'total_tokens'), 'total_tokens'),
      totalCost,
      usageAvailable: f.boolean(get(root, 'usage_available'), 'usage_available'),
      costAvailable: f.boolean(get(root, 'cost_available'), 'cost_available'),
      pending,
      completedToolCallIds: f
        .optionalArray(get(root, 'completed_tool_call_ids'), 'completed_tool_call_ids')
        .map((item, i) => f.string(item, `completed_tool_call_ids[${i}]`)),
      artifacts: f.optionalArray(get(root, 'artifacts'), 'artifacts').map((item, i) => {
        const a = f.object(item, `artifacts[${i}]`);
        return runtimeArtifact(
          f.string(get(a, 'kind'), `artifacts[${i}].kind`),
          f.object(get(a, 'payload'), `artifacts[${i}].payload`),
          f.optionalString(get(a, 'reference'), `artifacts[${i}].reference`),
        );
      }),
      exhausted: f.boolean(get(root, 'exhausted'), 'exhausted'),
      sequence: f.integer(get(root, 'sequence'), 'sequence'),
      interruptionReason: f.optionalString(get(root, 'interruption_reason'), 'interruption_reason'),
      continuationOmitted: f.boolean(get(root, 'continuation_omitted'), 'continuation_omitted'),
    });
  }
}

export type RuntimeResult = {
  readonly status: RuntimeResultStatus;
  readonly runId: string;
  readonly content: string;
  readonly messages: readonly ChatMessage[];
  readonly artifacts: readonly RuntimeArtifact[];
  readonly totalTokens: number;
  readonly totalCost: number | null;
  readonly usageAvailable: boolean;
  readonly costAvailable: boolean;
  readonly toolAttempts: number;
  readonly exhausted: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly checkpoint: RuntimeCheckpoint | null;
  readonly pendingToolCallId: string | null;
};

/** 一次运行的可变状态；checkpoint() 拍快照，fromCheckpoint() 从快照恢复。 */
export class RuntimeState implements CheckpointFields {
  roundCount = 0;
  toolAttempts = 0;
  toolOutputChars = 0;
  totalTokens = 0;
  totalCost: number | null = null;
  usageAvailable = false;
  costAvailable = false;
  pending: PendingToolCall | null = null;
  completedToolCallIds: string[] = [];
  artifacts: RuntimeArtifact[] = [];
  exhausted = false;
  sequence = 0;
  interruptionReason: string | null = null;
  continuationOmitted = false;

  constructor(
    public runId: string,
    public model: string,
    public phase: RuntimePhase,
    public messages: ChatMessage[],
  ) {}

  static fromCheckpoint(checkpoint: RuntimeCheckpoint): RuntimeState {
    const state = new RuntimeState(checkpoint.runId, checkpoint.model, checkpoint.phase, [
      ...checkpoint.messages,
    ]);
    Object.assign(state, {
      roundCount: checkpoint.roundCount,
      toolAttempts: checkpoint.toolAttempts,
      toolOutputChars: checkpoint.toolOutputChars,
      totalTokens: checkpoint.totalTokens,
      totalCost: checkpoint.totalCost,
      usageAvailable: checkpoint.usageAvailable,
      costAvailable: checkpoint.costAvailable,
      pending: checkpoint.pending,
      completedToolCallIds: [...checkpoint.completedToolCallIds],
      artifacts: [...checkpoint.artifacts],
      exhausted: checkpoint.exhausted,
      sequence: checkpoint.sequence,
      interruptionReason: checkpoint.interruptionReason,
      continuationOmitted: checkpoint.continuationOmitted,
    });
    return state;
  }

  checkpoint(): RuntimeCheckpoint {
    return new RuntimeCheckpoint(this);
  }
}
