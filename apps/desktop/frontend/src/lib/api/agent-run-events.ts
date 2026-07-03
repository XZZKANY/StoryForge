import type {
  AgentErrorMessage,
  AgentPlanStep,
  AgentProposedPatch,
  AgentResultMessage,
  AgentSocketMessage,
  AgentToolTrace,
} from './types';

// 后端 GET /api/agent-runs/{id}/events 返回的单条事件形状（AgentRunEventRead 子集）。
export type AgentRunEventRecord = {
  event_type: string;
  message?: string;
  payload?: Record<string, unknown> | null;
  sequence?: number;
};

// 从事件表重建终态时关心的三类落点：完成 / 失败 / 待确认（暂停）。
const TERMINAL_EVENT_TYPES = new Set([
  'agent_run_completed',
  'agent_run_failed',
  'permission_required',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function planFromEvents(events: AgentRunEventRecord[]): AgentPlanStep[] {
  const planEvent = [...events]
    .reverse()
    .find((event) => event.event_type === 'agent_plan_created');
  const plan = asRecord(planEvent?.payload).plan;
  if (!Array.isArray(plan)) return [];
  return plan.filter((step): step is AgentPlanStep => step !== null && typeof step === 'object');
}

function toolTraceFromEvents(events: AgentRunEventRecord[]): AgentToolTrace[] {
  const traces: AgentToolTrace[] = [];
  for (const event of events) {
    if (event.event_type !== 'tool_trace') continue;
    const trace = asRecord(event.payload).trace;
    if (trace && typeof trace === 'object') {
      traces.push(trace as AgentToolTrace);
    }
  }
  return traces;
}

/**
 * 从事件表重建 AgentSocketMessage：前端超时转后台轮询后，用这批持久化事件把丢失的
 * 瞬时 _STREAM_RESULT 还原成完成 / 失败 / 待确认结果（F10）。找不到终态事件返回 null（继续轮询）。
 * 纯函数：不触网、不读全局，供 node:test 直接覆盖。
 */
export function reconstructAgentResultFromEvents(
  events: AgentRunEventRecord[],
  context: { sessionId: string; runId: string },
): AgentSocketMessage | null {
  const terminal = [...events]
    .reverse()
    .find((event) => TERMINAL_EVENT_TYPES.has(event.event_type));
  if (terminal === undefined) return null;

  const payload = asRecord(terminal.payload);

  if (terminal.event_type === 'agent_run_failed') {
    const error: AgentErrorMessage = {
      type: 'error',
      session_id: context.sessionId,
      run_id: context.runId,
      detail: terminal.message || '运行失败。',
    };
    return error;
  }

  const assistantSessionId = payload.assistant_session_id;
  if (typeof assistantSessionId !== 'number') {
    // 缺少重建 agent_result 的最低要求，交回调用方继续轮询或彻底超时。
    return null;
  }

  const proposedPatch =
    payload.proposed_patch && typeof payload.proposed_patch === 'object'
      ? (payload.proposed_patch as AgentProposedPatch)
      : null;
  const requiresConfirmation =
    terminal.event_type === 'permission_required' || Boolean(payload.requires_user_confirmation);

  const summary =
    typeof payload.summary === 'string'
      ? payload.summary
      : terminal.event_type === 'permission_required'
        ? '该步骤需要作者确认后才能继续。'
        : (terminal.message ?? '');

  const result: AgentResultMessage = {
    type: 'agent_result',
    session_id: context.sessionId,
    run_id: context.runId,
    assistant_session_id: assistantSessionId,
    intent: typeof payload.intent === 'string' ? payload.intent : 'chat.explain',
    user_message: '',
    plan: planFromEvents(events),
    agent_result: {
      summary,
      requires_user_confirmation: requiresConfirmation,
      ...(requiresConfirmation ? { writeback_blocked_until_user_confirms: true } : {}),
    },
    tool_trace: toolTraceFromEvents(events),
    proposed_patch: proposedPatch,
  };
  return result;
}
