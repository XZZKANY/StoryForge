import type { AgentRunEventRecord } from './agent-run-events';
import { engineAgent } from './engine-agent-loader';
import type { AgentRunSavePointProjection } from './types';

// 读取在进程内、不需要中止；形参兼容跨进程恢复层的调用方（P6-1b 删）。
export async function getAgentRunSavePoints(
  runId: string,
  _options?: { signal?: AbortSignal },
): Promise<AgentRunSavePointProjection> {
  return (await engineAgent()).agentRunSavePoints(runId);
}

/** 持久化事件表：配合 reconstructAgentResultFromEvents 重建终态。 */
export async function getAgentRunEvents(
  runId: string,
  _options?: { signal?: AbortSignal; config?: unknown },
): Promise<AgentRunEventRecord[]> {
  return (await engineAgent()).agentRunEvents(runId);
}
