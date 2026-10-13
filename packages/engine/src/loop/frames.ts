import { pythonFloatRepr } from '../kernel/json';
import { pythonStrip } from '../kernel/pythonText';
import {
  redactSensitive,
  redactSensitiveText,
  type PlainJson,
  type SecretContext,
} from '../kernel/redaction';
import { canonicalPermissionProfile } from './permission';
import {
  AGENT_PLAN_CREATED,
  AGENT_RUN_COMPLETED,
  AGENT_RUN_FAILED,
  AGENT_RUN_INTERRUPTED,
  AGENT_RUN_STARTED,
  AGENT_RUNTIME_PROGRESS,
  PERMISSION_REQUIRED,
  TOOL_TRACE,
} from './runPayloads';

/**
 * Agent 实时帧：字段名、顺序与可空性同 packages/shared/src/contracts/agent-ws.schema.json；
 * 空值键一律保留（前端按 type 判别后按需取键）。外部写回的等待帧在单进程里不存在，不搬。
 */
export type AgentRunStartedFrame = {
  type: 'agent_run_started';
  session_id: string;
  run_id: string;
  user_message: string;
  event_id: number;
  permission_profile: string;
  agent_role_hints: string[];
  agent_role_mentions: string[];
};
export type AgentStepFrame = {
  type: 'agent_step';
  session_id: string;
  run_id: string;
  assistant_session_id: number | null;
  event_id: number;
  sequence: number;
  index: number;
  step: string | null;
  detail: string | null;
  status: string | null;
};
export type ToolTraceFrame = {
  type: 'tool_trace';
  session_id: string;
  run_id: string;
  assistant_session_id: number | null;
  event_id: number;
  sequence: number;
  index: number;
  trace: { [key: string]: unknown };
};
export type PermissionRequiredFrame = {
  type: 'permission_required';
  session_id: string;
  run_id: string;
  assistant_session_id: number | null;
  event_id: number;
  sequence: number;
  permission_profile: string;
  reason: string;
  proposed_patch: { [key: string]: unknown } | null;
  confirmation_action: string | { [key: string]: unknown } | null;
  blocked_tool: string | null;
};
export type TerminalFrame = {
  type: 'agent_run_completed' | 'agent_run_failed' | 'agent_run_interrupted';
  session_id: string;
  run_id: string;
  assistant_session_id: number | null;
  event_id: number;
  sequence: number;
  status: string;
  message: string | null;
  payload: { [key: string]: unknown };
};
export type ControlAckFrame = {
  type:
    | 'permission_approved'
    | 'permission_denied'
    | 'pause_run'
    | 'resume_run'
    | 'stop_run'
    | 'retry_from_checkpoint';
  session_id: string;
  run_id: string;
  event_id: number;
  status: 'recorded';
  control_effect: 'requested' | 'applied' | 'ignored' | null;
  runtime_state: 'in_flight' | 'settled' | null;
  run_status: string | null;
};
export type AgentTextStreamStartedFrame = {
  type: 'agent_text_stream_started';
  run_id: string;
  stream_id: string;
  round_index: number;
  chunk_sequence: 0;
};
export type AgentTextDeltaFrame = {
  type: 'agent_text_delta';
  run_id: string;
  stream_id: string;
  round_index: number;
  chunk_sequence: number;
  text_delta: string;
};
export type AgentFrame =
  | AgentRunStartedFrame
  | AgentStepFrame
  | ToolTraceFrame
  | PermissionRequiredFrame
  | TerminalFrame
  | ControlAckFrame
  | AgentTextStreamStartedFrame
  | AgentTextDeltaFrame;

/** 编码帧所需的 run 字段（P4 前由内存存储提供）。 */
export type RunView = {
  readonly session_id: string;
  readonly public_id: string;
  readonly assistant_session_id: number | null;
  readonly status: string;
  readonly goal: string;
  readonly scope: unknown;
  readonly permission_profile: unknown;
};
export type RunEventView = {
  readonly id: number;
  readonly event_type: string;
  readonly message: string;
  readonly payload: unknown;
  readonly sequence: number;
};

type Obj = { [key: string]: unknown };
const objectOf = (value: unknown): Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Obj) : {};
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

export function startedFrame(
  run: RunView,
  event: RunEventView,
  secrets: SecretContext,
): AgentRunStartedFrame {
  const scope = objectOf(run.scope);
  const list = (key: string) =>
    Array.isArray(scope[key])
      ? (scope[key] as unknown[])
          .filter((item): item is string => typeof item === 'string' && pythonStrip(item) !== '')
          .map((item) => redactSensitiveText(item, secrets))
      : [];
  return {
    type: 'agent_run_started',
    session_id: run.session_id,
    run_id: run.public_id,
    user_message: redactSensitiveText(run.goal, secrets),
    event_id: event.id,
    permission_profile: canonicalPermissionProfile(run.permission_profile),
    agent_role_hints: list('agent_role_hints'),
    agent_role_mentions: list('agent_role_mentions'),
  };
}

const redactedOptional = (value: unknown, secrets: SecretContext) =>
  typeof value === 'string' ? redactSensitiveText(value, secrets) : null;

/** 重试等待里的秒数：Python 端除「放弃 stream_options 重发」的整数 0 外都是浮点。 */
const delayText = (delay: unknown) =>
  delay === 0 ? '0' : typeof delay === 'number' ? pythonFloatRepr(delay) : String(delay);

/** 把一条持久事件编码成前端帧；与前端无关的事件返回空数组。 */
export function framesForEvent(
  run: RunView,
  event: RunEventView,
  secrets: SecretContext,
): AgentFrame[] {
  const payload = objectOf(event.payload);
  const base = {
    session_id: run.session_id,
    run_id: run.public_id,
    assistant_session_id: run.assistant_session_id,
    event_id: event.id,
    sequence: event.sequence,
  };
  switch (event.event_type) {
    case AGENT_RUN_STARTED:
      return [startedFrame(run, event, secrets)];
    case AGENT_PLAN_CREATED: {
      const plan = Array.isArray(payload.plan) ? payload.plan : [];
      const frames: AgentFrame[] = [];
      plan.forEach((step, index) => {
        if (!isObj(step)) return;
        frames.push({
          type: 'agent_step',
          ...base,
          index,
          step: redactedOptional(step.step, secrets),
          detail: redactedOptional(step.detail, secrets),
          status: redactedOptional(step.status, secrets),
        });
      });
      return frames;
    }
    case AGENT_RUNTIME_PROGRESS: {
      const phase = payload.phase;
      const detail =
        phase === 'retry_wait'
          ? `模型请求暂不可用，等待 ${delayText(payload.delay_seconds)} 秒后重试。`
          : phase === 'retry_started'
            ? '退避结束，准备重试。'
            : `准备第 ${String(payload.request_number)} 次模型请求。`;
      return [
        {
          type: 'agent_step',
          ...base,
          index: -1,
          step: 'agent.provider',
          detail,
          status: 'running',
        },
      ];
    }
    case TOOL_TRACE:
      return [
        {
          type: 'tool_trace',
          ...base,
          index: isInt(payload.index) ? payload.index : 0,
          trace: redactSensitive(
            (isObj(payload.trace) ? payload.trace : {}) as PlainJson,
            secrets,
          ) as Obj,
        },
      ];
    case PERMISSION_REQUIRED:
      return [
        {
          type: 'permission_required',
          ...base,
          permission_profile: canonicalPermissionProfile(
            payload.permission_profile,
            run.permission_profile,
          ),
          reason: redactSensitiveText(
            payload.reason ? String(payload.reason) : 'requires_user_confirmation',
            secrets,
          ),
          proposed_patch: isObj(payload.proposed_patch)
            ? (redactSensitive(payload.proposed_patch as PlainJson, secrets) as Obj)
            : null,
          confirmation_action:
            payload.confirmation_action === undefined
              ? null
              : (redactSensitive(payload.confirmation_action as PlainJson, secrets) as
                  | string
                  | Obj
                  | null),
          blocked_tool: typeof payload.blocked_tool === 'string' ? payload.blocked_tool : null,
        },
      ];
    case AGENT_RUN_COMPLETED:
    case AGENT_RUN_FAILED:
    case AGENT_RUN_INTERRUPTED:
      return [
        {
          type: event.event_type,
          ...base,
          status: run.status,
          message: redactSensitiveText(event.message, secrets),
          payload: redactSensitive(payload as PlainJson, secrets) as Obj,
        },
      ];
    default:
      return [];
  }
}

export function controlAckFrame(event: {
  readonly id: number;
  readonly event_type: ControlAckFrame['type'];
  readonly payload: Obj;
}): ControlAckFrame {
  const { payload } = event;
  return {
    type: event.event_type,
    session_id: payload.session_id ? String(payload.session_id) : '',
    run_id: payload.run_id ? String(payload.run_id) : '',
    event_id: event.id,
    status: 'recorded',
    control_effect: (payload.control_effect ?? null) as ControlAckFrame['control_effect'],
    runtime_state: (payload.runtime_state ?? null) as ControlAckFrame['runtime_state'],
    run_status: (payload.run_status ?? null) as string | null,
  };
}
