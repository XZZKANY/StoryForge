import type { AgentExecutionOutcome, AgentRuntimeInterruption } from './generated/agent-ws';
import type { AgentResultMessage, AgentPlanStep, AgentToolTrace } from './types';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function runtimeInterruptionFromResult(
  response: AgentResultMessage,
): AgentRuntimeInterruption | null {
  const value: unknown = response.runtime_interruption;
  const interrupted = response.agent_result.runtime_interrupted;
  if (value == null && interrupted !== true) return null;
  if (
    interrupted !== true ||
    !record(value) ||
    (value.status !== 'stopped' && value.status !== 'paused') ||
    typeof value.boundary !== 'string' ||
    !value.boundary.trim() ||
    response.agent_result.requires_user_confirmation !== false ||
    response.proposed_patch != null
  ) {
    throw new Error('Agent runtime_interruption 契约无效，不能作为成功或待写回结果处理。');
  }
  // 作者控制终态与此前执行失败是两个维度；保留并独立校验失败证据。
  executionOutcomeFromResult(response);
  return { status: value.status, boundary: value.boundary };
}

export function executionOutcomeFromResult(
  response: AgentResultMessage,
): AgentExecutionOutcome | null {
  const value: unknown = response.agent_result.execution_outcome;
  if (value === undefined) return null;
  if (
    !record(value) ||
    (value.status !== 'failed' && value.status !== 'partial') ||
    typeof value.code !== 'string' ||
    typeof value.message !== 'string'
  ) {
    throw new Error('Agent execution_outcome 契约无效，不能作为成功结果处理。');
  }
  if (
    response.proposed_patch != null &&
    (response.agent_result.requires_user_confirmation !== true ||
      response.proposed_patch.requires_confirmation !== true ||
      response.agent_result.patch_resolution !== undefined)
  ) {
    throw new Error('未完成运行的补丁确认状态矛盾，不能自动写回。');
  }
  return { status: value.status, code: value.code, message: value.message };
}

function plan(value: unknown): value is AgentPlanStep {
  return (
    record(value) &&
    typeof value.step === 'string' &&
    typeof value.detail === 'string' &&
    typeof value.status === 'string'
  );
}
function trace(value: unknown): value is AgentToolTrace {
  return (
    record(value) &&
    typeof value.tool_name === 'string' &&
    typeof value.status === 'string' &&
    record(value.input_summary)
  );
}
function result(value: unknown): value is AgentResultMessage {
  return (
    record(value) &&
    value.type === 'agent_result' &&
    typeof value.session_id === 'string' &&
    typeof value.run_id === 'string' &&
    typeof value.assistant_session_id === 'number' &&
    Number.isInteger(value.assistant_session_id) &&
    value.assistant_session_id > 0 &&
    typeof value.intent === 'string' &&
    typeof value.user_message === 'string' &&
    Array.isArray(value.plan) &&
    value.plan.every(plan) &&
    Array.isArray(value.tool_trace) &&
    value.tool_trace.every(trace) &&
    record(value.agent_result) &&
    typeof value.agent_result.summary === 'string' &&
    typeof value.agent_result.requires_user_confirmation === 'boolean' &&
    (value.proposed_patch == null || record(value.proposed_patch))
  );
}

export function decodeExecutionResult(
  value: unknown,
  context: { runId: string; sessionId: string },
): AgentResultMessage {
  if (
    !result(value) ||
    value.run_id !== context.runId ||
    value.session_id !== context.sessionId ||
    (!runtimeInterruptionFromResult(value) && !executionOutcomeFromResult(value))
  ) {
    throw new Error('持久运行结果不完整或身份不匹配，不能恢复为成功。');
  }
  return value;
}
