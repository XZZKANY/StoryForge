import { engineAgent } from './engine-agent-loader';
import type {
  AgentControlAckMessage,
  AgentControlMessageRequest,
  AgentErrorMessage,
  AgentSocketMessage,
  AgentUserMessageRequest,
} from './types';

export {
  isAgentControlAckMessage,
  isAgentErrorMessage,
  isAgentPermissionRequiredMessage,
  isAgentResultMessage,
  isAgentRunStartedMessage,
  isAgentRunWaitingMessage,
  isAgentStepEventMessage,
  isAgentToolTraceEventMessage,
} from './agent-messages';

// 「开始起草」这类控制要等起草加检查跑完才回执；给调用方的等待上限。
export const DEFAULT_AGENT_TIMEOUT_MS = 360_000;

/** 作者消息在进程内的 TS 引擎里跑：流帧经 onEvent 回调，终态帧作为结果返回。 */
export async function sendAgentUserMessage(
  request: AgentUserMessageRequest,
): Promise<AgentSocketMessage> {
  return (await engineAgent()).sendAgentUserMessage(request);
}

/** 控制（确认 / 拒绝 / 暂停 / 继续 / 停止 / 重试）交给持有这个 run 的引擎。 */
export async function sendAgentControlMessage(
  request: AgentControlMessageRequest,
): Promise<AgentControlAckMessage | AgentErrorMessage> {
  return (await engineAgent()).sendAgentControlMessage(request);
}
