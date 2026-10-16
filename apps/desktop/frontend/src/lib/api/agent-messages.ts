import type {
  AgentControlAckMessage,
  AgentErrorMessage,
  AgentPermissionRequiredMessage,
  AgentResultMessage,
  AgentRunStartedMessage,
  AgentRunWaitingMessage,
  AgentSocketMessage,
  AgentStepEventMessage,
  AgentToolTraceEventMessage,
} from './types';

export function isAgentErrorMessage(message: AgentSocketMessage): message is AgentErrorMessage {
  return message.type === 'error' && typeof (message as AgentErrorMessage).detail === 'string';
}

export function isAgentResultMessage(message: AgentSocketMessage): message is AgentResultMessage {
  return (
    message.type === 'agent_result' &&
    typeof (message as AgentResultMessage).assistant_session_id === 'number' &&
    Array.isArray((message as AgentResultMessage).plan) &&
    Array.isArray((message as AgentResultMessage).tool_trace)
  );
}

export function isAgentRunStartedMessage(
  message: AgentSocketMessage,
): message is AgentRunStartedMessage {
  return (
    message.type === 'agent_run_started' &&
    typeof (message as AgentRunStartedMessage).run_id === 'string'
  );
}

export function isAgentRunWaitingMessage(
  message: AgentSocketMessage,
): message is AgentRunWaitingMessage {
  const value = message as Partial<AgentRunWaitingMessage>;
  return (
    value.type === 'agent_run_waiting' &&
    value.protocol === 'external_writeback_v1' &&
    typeof value.run_id === 'string' &&
    typeof value.session_id === 'string' &&
    typeof value.wait_id === 'string' &&
    Number.isSafeInteger(value.revision) &&
    Number(value.revision) > 0 &&
    Number.isSafeInteger(value.assistant_session_id) &&
    Number(value.assistant_session_id) > 0 &&
    Number.isSafeInteger(value.event_id) &&
    Number(value.event_id) > 0 &&
    Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) > 0 &&
    (value.execution_epoch === null ||
      (typeof value.execution_epoch === 'string' && value.execution_epoch.length > 0)) &&
    [
      'await_authorization',
      'awaiting_receipt',
      'reconciliation',
      'receipt_ready',
      'claimed',
    ].includes(String(value.stage))
  );
}

export function isAgentStepEventMessage(
  message: AgentSocketMessage,
): message is AgentStepEventMessage {
  return (
    message.type === 'agent_step' &&
    typeof (message as AgentStepEventMessage).step === 'string' &&
    typeof (message as AgentStepEventMessage).status === 'string'
  );
}

export function isAgentToolTraceEventMessage(
  message: AgentSocketMessage,
): message is AgentToolTraceEventMessage {
  return (
    message.type === 'tool_trace' &&
    typeof (message as AgentToolTraceEventMessage).trace === 'object' &&
    (message as AgentToolTraceEventMessage).trace !== null
  );
}

export function isAgentPermissionRequiredMessage(
  message: AgentSocketMessage,
): message is AgentPermissionRequiredMessage {
  return (
    message.type === 'permission_required' &&
    typeof (message as AgentPermissionRequiredMessage).run_id === 'string'
  );
}

export function isAgentControlAckMessage(
  message: AgentSocketMessage,
): message is AgentControlAckMessage {
  return (
    (message.type === 'permission_approved' ||
      message.type === 'permission_denied' ||
      message.type === 'pause_run' ||
      message.type === 'resume_run' ||
      message.type === 'stop_run' ||
      message.type === 'retry_from_checkpoint') &&
    (message as AgentControlAckMessage).status === 'recorded'
  );
}
